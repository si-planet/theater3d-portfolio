/** Pure local contract checks; these do not verify DB, storage or permissions. */
export const CATALOG_CONTRACT_VERSION = 1;
export const LEGACY_LAYOUT_MAP = Object.freeze({});
const arrays = ['venues', 'venueNames', 'venueRelations', 'layoutVersions', 'seats', 'seatAliases', 'seatPositions', 'works', 'productionRuns', 'performanceEvents', 'photos', 'assets', 'sources'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(v);
const issue = (code, path, message, severity = 'error') => ({ code, path, severity, message });
const report = issues => ({ valid: !issues.some(i => i.severity === 'error'), issues });
const list = (s, key) => Array.isArray(s?.[key]) ? s[key] : [];
const find = (s, key, id) => list(s, key).find(v => v?.id === id);
const nullableId = v => v === null || text(v);
const publication = ['private', 'draft', 'review', 'published', 'withdrawn'];

function dateParts(v) {
  if (!object(v) || typeof v.value !== 'string') return null;
  const patterns = { year: /^\d{4}$/, month: /^\d{4}-\d{2}$/, day: /^\d{4}-\d{2}-\d{2}$/,
    minute: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/,
    second: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?$/ };
  if (!patterns[v.precision]?.test(v.value)) return null;
  const [y, m = 1, d = 1, h = 0, min = 0, sec = 0] = v.value.split(/[-T:Z+]/).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
      || h > 23 || min > 59 || sec > 59) return null;
  const offset = /([+-])(\d{2}):(\d{2})$/.exec(v.value);
  if (offset && (Number(offset[2]) > 14 || Number(offset[3]) > 59 || (Number(offset[2]) === 14 && Number(offset[3]) !== 0))) return null;
  return { y, m, d, h, min, sec };
}
export function validatePartialDate(value) {
  const issues = [];
  if (!object(value)) return report([issue('invalid-date', '', 'PartialDate object required')]);
  if (!['unknown', 'year', 'month', 'day', 'minute', 'second'].includes(value.precision)) issues.push(issue('invalid-precision', 'precision', 'Unknown precision'));
  if (value.precision === 'unknown' ? value.value !== null : !dateParts(value)) issues.push(issue('invalid-date', 'value', 'Date must match precision and calendar'));
  if (value.timezone !== null && value.timezone !== undefined) {
    try { if (!text(value.timezone)) throw Error(); new Intl.DateTimeFormat('en', { timeZone: value.timezone }); }
    catch { issues.push(issue('invalid-timezone', 'timezone', 'Invalid IANA timezone')); }
  }
  if (!['official','user_observation','photo_interpretation','model_assumption','unverified'].includes(value.evidenceKind)) issues.push(issue('missing-evidence', 'evidenceKind', 'Date evidence required'));
  if (!Array.isArray(value.sourceRefs)) issues.push(issue('missing-sources', 'sourceRefs', 'Source references array required'));
  return report(issues);
}
function range(date) {
  const p = dateParts(date); if (!p) return null;
  const pad = n => String(n).padStart(2, '0');
  const start = `${String(p.y).padStart(4,'0')}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}:${pad(p.sec)}`;
  const leap = p.y % 4 === 0 && (p.y % 100 !== 0 || p.y % 400 === 0);
  const lastDay = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][p.m-1];
  const end = date.precision === 'year' ? `${String(p.y).padStart(4,'0')}-12-31T23:59:59`
    : date.precision === 'month' ? `${String(p.y).padStart(4,'0')}-${pad(p.m)}-${pad(lastDay)}T23:59:59`
    : date.precision === 'day' ? start.slice(0,10)+'T23:59:59'
    : date.precision === 'minute' ? start.slice(0,18)+'59' : start;
  const zone = /(Z|[+-]\d{2}:\d{2})$/.exec(date.value)?.[1];
  return zone ? [Date.parse(start+zone), Date.parse(end+zone)] : [start,end];
}
export function validatePeriod(value) {
  if (!object(value)) return report([issue('invalid-period', '', 'Period object required')]);
  const issues = ['start','end'].flatMap(k => validatePartialDate(value[k]).issues.map(i => ({...i,path:k+(i.path?'.'+i.path:'')})));
  if (typeof value.endInclusive !== 'boolean') issues.push(issue('invalid-period','endInclusive','Explicit end convention required'));
  if (!['known','partial','unknown'].includes(value.status)) issues.push(issue('invalid-period','status','Period status required'));
  const a=range(value.start), b=range(value.end);
  if (a && b) {
    // Compare zoned instants or matching local timezone/calendar context only.
    const sameBasis = typeof a[0] === typeof b[0] && (typeof a[0] === 'number' || (value.start.timezone ?? null) === (value.end.timezone ?? null));
    if (sameBasis && a[0] > b[1]) issues.push(issue('reversed-period','end','End precedes start'));
    if (!sameBasis) issues.push(issue('uncertain-timezone','end','Period ordering needs timezone verification','warning'));
  }
  if (value.status === 'known' && (!a || !b)) issues.push(issue('invalid-period','status','Known period requires known endpoints'));
  return report(issues);
}

export function resolveLegacySeatContext(context, snapshot) {
  if (context === null) return {status:'unresolved',mapping:null,issues:[]};
  const fail = (status,code,message) => ({status,mapping:null,issues:[issue(code,'seatContext',message,status === 'unresolved' ? 'warning':'error')]});
  if (!object(context) || context.source !== 'user_selected' || !['venueId','venueName','modelId','modelVersion','seatId','seatLabel'].every(k=>text(context[k]))) return fail('mismatch','invalid-context','Explicit complete user-selected context required');
  const venue=find(snapshot,'venues',context.venueId), mapped=LEGACY_LAYOUT_MAP[context.modelId];
  if (!venue || !mapped) return fail('unresolved','unresolved-context','Unknown venue or legacy model; no inferred mapping');
  const layout=find(snapshot,'layoutVersions',mapped), seat=find(snapshot,'seats',context.seatId);
  if (!layout || !seat) return fail('unresolved','unresolved-context','Unknown layout or seat');
  if (context.modelVersion !== context.modelId || layout.venueId !== venue.id || seat.venueId !== venue.id) return fail('mismatch','context-ownership','Venue/model/version/seat differ');
  const labels=[seat.officialLabel,...list(snapshot,'seatAliases').filter(a=>a.seatId===seat.id && a.venueId===venue.id && a.verificationStatus==='verified').map(a=>a.label)];
  const spelling = v=>v.normalize('NFC').trim().replace(/\s+/g,'').toUpperCase();
  if (!labels.some(v=>text(v)&&spelling(v)===spelling(context.seatLabel))) return fail('mismatch','context-label','Seat label does not match selected identity');
  const names=[venue.displayName,...list(snapshot,'venueNames').filter(n=>n.venueId===venue.id).map(n=>n.name)];
  if (!names.includes(context.venueName)) return fail('mismatch','context-name','Venue name does not match identity');
  return {status:'resolved',mapping:{venueId:venue.id,layoutVersionId:layout.id,seatId:seat.id},issues:[]};
}

export function validatePhotoRecord(photo, snapshot) {
  if (!object(photo)) return report([issue('invalid-photo','','Photo object required')]);
  const issues=[];
  if (!text(photo.id)) issues.push(issue('missing-id','id','Photo ID required'));
  if (!publication.includes(photo.publicationStatus)) issues.push(issue('invalid-publication','publicationStatus','Publication state required'));
  if (!object(photo.metadata)||!object(photo.metadataSources)) issues.push(issue('missing-metadata','metadata','Metadata and field sources required'));
  for(const k of ['venueId','layoutVersionId','seatId','productionRunId','performanceEventId','originalAssetId','displayAssetId']) if(!nullableId(photo[k])) issues.push(issue('invalid-reference',k,'Explicit nullable ID required'));
  for(const [k,collection] of [['venueId','venues'],['layoutVersionId','layoutVersions'],['seatId','seats'],['productionRunId','productionRuns'],['performanceEventId','performanceEvents'],['originalAssetId','assets'],['displayAssetId','assets']]) {
    if(text(photo[k])&&!find(snapshot,collection,photo[k])) issues.push(issue('missing-reference',k,'Referenced record missing'));
  }
  const layout=find(snapshot,'layoutVersions',photo.layoutVersionId), seat=find(snapshot,'seats',photo.seatId), run=find(snapshot,'productionRuns',photo.productionRunId), event=find(snapshot,'performanceEvents',photo.performanceEventId);
  if (layout && layout.venueId!==photo.venueId || seat && (seat.venueId!==photo.venueId || !layout) || run && run.venueId!==photo.venueId || event && event.productionRunId!==photo.productionRunId) issues.push(issue('reference-ownership','seatId','Photo references cross contexts'));
  for(const k of ['originalAssetId','displayAssetId']) {const a=find(snapshot,'assets',photo[k]);if(a&&(a.photoId!==photo.id || k==='originalAssetId'&&a.role!=='original' || k==='displayAssetId'&&a.role!=='display')) issues.push(issue('asset-ownership',k,'Wrong photo or asset role'));}
  if(photo.metadataOnly===true&&(photo.originalAssetId!==null||photo.displayAssetId!==null||photo.publicationStatus!=='private')) issues.push(issue('metadata-only-boundary','metadataOnly','Metadata-only import must remain private without assets'));
  if(photo.metadataOnly===true&&!object(photo.legacyPayload)) issues.push(issue('missing-raw','legacyPayload','Legacy raw record required'));
  issues.push(...validatePartialDate(photo.capturedAt).issues.map(i=>({...i,path:'capturedAt.'+i.path})));
  if(photo.registrationContext!==null&&photo.registrationContext!==undefined){const resolved=resolveLegacySeatContext(photo.registrationContext,snapshot);issues.push(...resolved.issues);if(resolved.mapping&&['venueId','layoutVersionId','seatId'].some(k=>photo[k]!==resolved.mapping[k])) issues.push(issue('context-mapping','registrationContext','Stored mapping differs from fixed legacy context'));}
  if(photo.publicationStatus==='published') {const a=find(snapshot,'assets',photo.displayAssetId);if(!a||a.storageStatus!=='ready'||!object(photo.rightsRecord)||!object(photo.publicationApproval)||photo.publicationApproval.approved!==true||photo.publicationApproval.publicMetadataReviewed!==true||a.exifPolicy!=='stripped') issues.push(issue('unapproved-publication','publicationStatus','Ready approved derivative, rights and reviewed metadata required'));}
  return report(issues);
}

export function validateCatalogSnapshot(snapshot) {
  if(!object(snapshot)) return report([issue('invalid-snapshot','','Snapshot object required')]);
  const issues=[];
  if(snapshot.contractVersion!==CATALOG_CONTRACT_VERSION) issues.push(issue('contract-version','contractVersion','Unsupported contract version'));
  for(const key of arrays) {
    if(!Array.isArray(snapshot[key])) {issues.push(issue('missing-array',key,'Array required'));continue;}
    const seen=new Set();snapshot[key].forEach((v,i)=>{if(!object(v)||!text(v.id)) issues.push(issue('missing-id',`${key}[${i}].id`,'Record ID required'));else if(seen.has(v.id))issues.push(issue('duplicate-id',`${key}[${i}].id`,'Duplicate record ID'));else seen.add(v.id);});
  }
  const refs={venueNames:{venueId:'venues'},venueRelations:{fromVenueId:'venues',toVenueId:'venues'},layoutVersions:{venueId:'venues',parentLayoutVersionId:'layoutVersions'},seats:{venueId:'venues'},seatAliases:{venueId:'venues',seatId:'seats'},seatPositions:{layoutVersionId:'layoutVersions',seatId:'seats'},productionRuns:{venueId:'venues',workId:'works',layoutVersionId:'layoutVersions'},performanceEvents:{productionRunId:'productionRuns'},assets:{photoId:'photos',parentAssetId:'assets'}};
  for(const [key,fields] of Object.entries(refs))list(snapshot,key).forEach((v,i)=>{if(!object(v))return;for(const [field,target]of Object.entries(fields)){const optional=['fromVenueId','parentLayoutVersionId','layoutVersionId','parentAssetId'].includes(field)&&key!=='seatPositions';if(v[field]===null&&optional)continue;if(!text(v[field])||!find(snapshot,target,v[field]))issues.push(issue('missing-reference',`${key}[${i}].${field}`,'Missing referenced identity'));}});
  const pairs=new Set();list(snapshot,'seatPositions').forEach((p,i)=>{if(!object(p))return;const layout=find(snapshot,'layoutVersions',p.layoutVersionId), seat=find(snapshot,'seats',p.seatId);if(layout&&seat&&layout.venueId!==seat.venueId)issues.push(issue('reference-ownership',`seatPositions[${i}]`,'Seat and layout belong to different venues'));const pair=JSON.stringify([p.layoutVersionId,p.seatId]);if(pairs.has(pair))issues.push(issue('duplicate-position',`seatPositions[${i}]`,'Duplicate seat position'));pairs.add(pair);for(const k of ['x','z','floorY'])if(p[k]!==null&&(typeof p[k]!=='number'||!Number.isFinite(p[k])))issues.push(issue('invalid-coordinate',`seatPositions[${i}].${k}`,'Finite coordinate or explicit null required'));});
  list(snapshot,'seats').forEach((s,i)=>{if(!object(s))return;if(!text(s.officialLabel)&&s.kind!=='virtual')issues.push(issue('missing-label',`seats[${i}].officialLabel`,'Official label required'));if(s.kind==='virtual'&&(!(typeof s.id==='string'&&s.id.startsWith('virtual:'))||s.officialLabel!==null))issues.push(issue('virtual-seat-boundary',`seats[${i}]`,'Virtual namespace cannot claim official identity'));});
  const aliases=new Map();list(snapshot,'seatAliases').forEach((a,i)=>{if(!object(a))return;const seat=find(snapshot,'seats',a.seatId);if(seat&&seat.venueId!==a.venueId)issues.push(issue('reference-ownership',`seatAliases[${i}]`,'Alias crosses venues'));if(!text(a.label))issues.push(issue('invalid-alias',`seatAliases[${i}].label`,'Alias label required'));else{const key=JSON.stringify([a.venueId,a.label.normalize('NFC').replace(/\s+/g,'').toUpperCase()]);if(aliases.has(key)&&aliases.get(key)!==a.seatId)issues.push(issue('ambiguous-alias',`seatAliases[${i}]`,'Alias identifies multiple seats'));aliases.set(key,a.seatId);}});
  list(snapshot,'layoutVersions').forEach((l,i)=>{if(!object(l))return;if(!object(l.geometry)||!object(l.coordinateSystem)||!object(l.legacyPayload))issues.push(issue('missing-layout-evidence',`layoutVersions[${i}]`,'Raw layout, geometry and coordinate system required'));});
  for(const key of ['venueNames','venueRelations','layoutVersions','seats','productionRuns'])list(snapshot,key).forEach((v,i)=>{if(object(v)&&v.validPeriod!==undefined)issues.push(...validatePeriod(v.validPeriod).issues.map(x=>({...x,path:`${key}[${i}].validPeriod.${x.path}`})));if(object(v)&&v.runPeriod!==undefined)issues.push(...validatePeriod(v.runPeriod).issues.map(x=>({...x,path:`${key}[${i}].runPeriod.${x.path}`})));});
  list(snapshot,'assets').forEach((a,i)=>{if(!object(a))return;if(!['original','display','thumbnail'].includes(a.role)||!text(a.objectKey)||/^(?:blob:|https?:|data:)/i.test(a.objectKey)||!/^[0-9a-f]{64}$/i.test(a.sha256??'')||!Number.isSafeInteger(a.byteSize)||a.byteSize<=0)issues.push(issue('invalid-asset',`assets[${i}]`,'Stable object key, role, size and SHA256 required'));const parent=find(snapshot,'assets',a.parentAssetId);if(parent&&parent.photoId!==a.photoId)issues.push(issue('asset-ownership',`assets[${i}].parentAssetId`,'Initial assets cannot be shared across photos'));});
  for(const key of arrays)list(snapshot,key).forEach((v,i)=>{if(!object(v))return; if(v.sourceRefs!==undefined){if(!Array.isArray(v.sourceRefs))issues.push(issue('invalid-sources',`${key}[${i}].sourceRefs`,'Source refs must be an array'));else v.sourceRefs.forEach((ref,j)=>{if(!object(ref)||!find(snapshot,'sources',ref.sourceId))issues.push(issue('missing-reference',`${key}[${i}].sourceRefs[${j}]`,'Source missing'));});}});
  list(snapshot,'venues').forEach((v,i)=>{if(!object(v)||v.currentLayoutVersionId===undefined||v.currentLayoutVersionId===null)return;const layout=find(snapshot,'layoutVersions',v.currentLayoutVersionId);if(!layout||layout.venueId!==v.id)issues.push(issue('reference-ownership',`venues[${i}].currentLayoutVersionId`,'Current layout must belong to venue'));});
  list(snapshot,'productionRuns').forEach((r,i)=>{if(!object(r)||r.layoutVersionId===null)return;const layout=find(snapshot,'layoutVersions',r.layoutVersionId);if(layout&&layout.venueId!==r.venueId)issues.push(issue('reference-ownership',`productionRuns[${i}].layoutVersionId`,'Run layout crosses venues'));});
  list(snapshot,'photos').forEach((p,i)=>issues.push(...validatePhotoRecord(p,snapshot).issues.map(x=>({...x,path:`photos[${i}].${x.path}`}))));
  return report(issues);
}
