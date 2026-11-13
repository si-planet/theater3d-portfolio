import { CATALOG_CONTRACT_VERSION, validatePartialDate, validatePeriod } from './catalog-contract.js';

/** Anonymous, read-only DTO boundary. Server ACL/RLS/Storage remain unverified.
 * Transport.request(path,{query,signal}) returns a JSON envelope. No retry/cache.
 * Repository methods use options objects; all public fields below are allowlisted.
 */
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(v);
// Opaque paging tokens are not record IDs. Preserve bytes, reject whitespace/
// controls, and bound URL/query resource use independently of ID length.
const cursorToken = v => typeof v === 'string' && v.length >= 1 && v.length <= 4096 && /^[\x21-\x7e]+$/.test(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
export function catalogError(code, message, status = 0) {
  const error = new Error(message); error.name = 'CatalogError'; error.code = code; error.status = status; return error;
}
const fail = (code, message) => { throw catalogError(code, message); };
const abortError = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError', code: 'ABORT_ERR' });
function abortCheck(signal) { if (signal?.aborted) throw abortError(); }
async function abortable(promise, signal) {
  abortCheck(signal); if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { clean(); reject(abortError()); };
    const clean = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(v => { clean(); if (signal.aborted) reject(abortError()); else resolve(v); }, e => { clean(); reject(signal.aborted ? abortError() : e); });
  });
}
function id(value) { return text(value) && value.length <= 160 && value.trim() === value && !['.','..'].includes(value) && !/[\\/#?]/.test(value) && !/^(?:blob:|https?:|data:)/i.test(value); }
function safeUrl(value, { delivery = false } = {}) {
  if (!text(value)) return false;
  try {
    const url = new URL(value, 'https://public.invalid');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && (delivery || !/^(?:\/\/)/.test(value));
  } catch { return false; }
}
const scalar = v => v === null || text(v) || finite(v) || typeof v === 'boolean';
const nullableId = v => v === null || id(v);
const nullableNumber = v => v === null || finite(v);
const nullableText = v => v === null || text(v);
const boolean = v => typeof v === 'boolean';
const schema = (fields, required = []) => ({ fields, required });
const list = item => ({ array: item });
const literal = value => v => v === value;
const point = schema({ x: finite, z: finite }, ['x', 'z']);
const sourceRef = schema({ sourceId: id, locator: nullableText, claim: nullableText }, ['sourceId']);
const partialDate = schema({ value: nullableText, precision: v => ['unknown','year','month','day','minute','second'].includes(v), timezone: nullableText,
  evidenceKind: text, sourceRefs: list(sourceRef) }, ['value','precision','evidenceKind','sourceRefs']);
const period = schema({ start: partialDate, end: partialDate, endInclusive: boolean, status: v => ['known','partial','unknown'].includes(v),
  endMeaning: v => ['unknown','ongoing','bounded'].includes(v) }, ['start','end','endInclusive','status']);
const approval = schema({ approved: literal(true), publicMetadataReviewed: literal(true) }, ['approved','publicMetadataReviewed']);
const rights = schema({ publicationAllowed: literal(true), creditText: nullableText, license: nullableText }, ['publicationAllowed']);
const displayAsset = schema({ id, photoId: id, role: literal('display'), storageStatus: literal('ready'), exifPolicy: literal('stripped'),
  mediaType: v => ['image/jpeg','image/png','image/webp'].includes(v), pixelWidth: v => Number.isSafeInteger(v)&&v>0,
  pixelHeight: v => Number.isSafeInteger(v)&&v>0, byteSize: v=>Number.isSafeInteger(v)&&v>0 }, ['id','photoId','role','storageStatus','exifPolicy','mediaType','pixelWidth','pixelHeight']);
const common = { id, publicationStatus: literal('published'), revisionId: id, sourceRefs: list(sourceRef) };
const address = schema({ road: nullableText, parcel: nullableText, sourceId: id });
const position = schema({ id, layoutVersionId: id, seatId: id, x: nullableNumber, z: nullableNumber, floorY: nullableNumber,
  rotationDeg: nullableNumber, physicalRow: v=>v===null||Number.isSafeInteger(v), physicalRowLabel: nullableText,
  coordinateConfidence: text, floorConfidence: text, sourceRefs: list(sourceRef) }, ['layoutVersionId','seatId','x','z','floorY']);
const geometrySeat = schema({ row: v=>Number.isSafeInteger(v)&&v>0, rowLabel: text, number: v=>Number.isSafeInteger(v)&&v>0,
  label: text, displayLabel: text, physicalRow: v=>Number.isSafeInteger(v)&&v>0, physicalRowLabel: text,
  x: nullableNumber, z: nullableNumber, floorY: nullableNumber, rotationDeg: nullableNumber, seatHeightM: nullableNumber,
  coordinateConfidence: text, floorConfidence: text }, ['row','number','label','x','z','floorY']);
const platform = schema({ row: finite, rowLabel: text, physicalRow: finite, physicalRowLabel: text, section: text, xMin: finite, xMax: finite,
  zStart: finite, zEnd: finite, y: finite, floorY: finite, method: text });
const geometry = schema(Object.assign(Object.fromEntries(['stageWidthM','stageDepthM','stageHeightM','rowCount','seatsPerRow','rowSpacingM','seatSpacingM','firstRowDistanceM','rowRiseM','eyeHeightM','seatHeightM'].map(k=>[k,nullableNumber])), {
  stagePolygon: list(point), roomBoundary: list(point), seats: list(geometrySeat), rowPlatforms: list(platform) }));
const coordinateSystem = schema({ unit: text, x: text, y: text, z: text, origin: text, seatPoint: text }, ['unit','x','y','z','origin']);
export const PHOTO_METADATA_FIELDS = Object.freeze(['production','venueName','seatLabel','captureDateTime','device','focalLengthMm','focalLength35Mm','zoomFactor','digitalZoomRatio','pixelWidth','pixelHeight','orientation','aspectRatio','lens']);
const metadataKeys = PHOTO_METADATA_FIELDS;
const sourceFields = {
  manual: new Set(metadataKeys),
  exif: new Set(['device','lens','focalLengthMm','focalLength35Mm','captureDateTime','digitalZoomRatio','orientation','pixelWidth','pixelHeight','aspectRatio']),
  file: new Set(['pixelWidth','pixelHeight','aspectRatio']),
  filename: new Set(['production','venueName','seatLabel']),
  seat_selection: new Set(['venueName','seatLabel']),
};
/** Validate submitted provenance; it does not independently verify original EXIF.
 * Read defaults preserve sparse/empty stored maps; registration may fill manual.
 */
export function normalizePhotoMetadataSources(metadata, sources, {defaultManual=false,errorCode='BAD_REQUEST'}={}) {
  const reject = () => { throw catalogError(errorCode,'Invalid photo metadata provenance'); };
  const descriptors = value => {
    if (!record(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) reject();
    const out = {};
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value,key);
      if(typeof key!=='string'||!metadataKeys.includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)reject();
      out[key]=d.value;
    }
    return out;
  };
  const values=descriptors(metadata);
  if(sources===undefined&&!defaultManual)return undefined;
  const supplied=sources===undefined?{}:descriptors(sources), out={};
  for(const [key,tag] of Object.entries(supplied)) {
    if(!Object.hasOwn(values,key)||typeof tag!=='string'||!Object.hasOwn(sourceFields,tag)||!sourceFields[tag].has(key))reject();
    if(tag!=='manual'&&(values[key]===null||values[key]===undefined||typeof values[key]==='string'&&!values[key].trim()))reject();
    out[key]=tag;
  }
  if(defaultManual)for(const key of Object.keys(values))if(!Object.hasOwn(out,key))out[key]='manual';
  return out;
}
const metadata = schema(Object.fromEntries(metadataKeys.map(k=>[k,scalar])));
const metadataSources = schema(Object.fromEntries(metadataKeys.map(k=>[k,v=>typeof v==='string'&&Object.hasOwn(sourceFields,v)&&sourceFields[v].has(k)])));
const publicSchemas = {
  venue: schema({ ...common, displayName: text, officialName: text, address, currentLayoutVersionId: nullableId,
    hallScope: schema({ hallName: nullableText, hallNumber: nullableNumber, note: nullableText }), aliases: list(text) }, ['id','publicationStatus','displayName']),
  name: schema({ ...common, venueId: id, name: text, kind: text, validPeriod: period }, ['id','publicationStatus','venueId','name']),
  relation: schema({ ...common, fromVenueId: nullableId, toVenueId: id, historicalName: nullableText, kind: text,
    geometryContinuity: v=>['confirmed','changed','unknown'].includes(v), effectivePeriod: period }, ['id','publicationStatus','fromVenueId','toVenueId','kind']),
  layout: schema({ ...common, venueId: id, legacyModelId: id, parentLayoutVersionId: nullableId, label: text, changeKind: text,
    validPeriod: period, coordinateSystem, geometry }, ['id','publicationStatus','venueId','coordinateSystem','geometry']),
  seat: schema({ ...common, venueId: id, officialLabel: text, section: nullableText, rowLabel: nullableText, number: nullableNumber,
    kind: literal('official'), validPeriod: period, position: {nullable:position}, projectionEligible: boolean }, ['id','publicationStatus','venueId','officialLabel','position','projectionEligible']),
  work: schema({ ...common, title: text, alternateTitles: list(text) }, ['id','publicationStatus','title']),
  run: schema({ ...common, workId: id, venueId: id, layoutVersionId: nullableId, displayTitle: text, performanceYear: nullableNumber,
    yearBasis: nullableText, seasonLabel: nullableText, runPeriod: period }, ['id','publicationStatus','workId','venueId','layoutVersionId','displayTitle','runPeriod']),
  photo: schema({ ...common, venueId: nullableId, layoutVersionId: nullableId, seatId: nullableId, workId: nullableId, productionRunId: nullableId,
    performanceEventId: nullableId, capturedAt: partialDate, caption: nullableText, creditText: nullableText,
    metadata, metadataSources, displayAssetId: id, displayAsset, publicationApproval: approval, rightsRecord: rights,
    projectionEligible: boolean }, ['id','publicationStatus','venueId','layoutVersionId','seatId','productionRunId','performanceEventId','capturedAt','metadata','metadataSources','displayAssetId','displayAsset','publicationApproval','rightsRecord','projectionEligible']),
  delivery: schema({ ...common, assetId: id, photoId: id, role: literal('display'), storageStatus: literal('ready'), exifPolicy: literal('stripped'),
    deliveryUrl: v=>safeUrl(v,{delivery:true}), expiresAt: text, publicationApproval: approval, rightsRecord: rights }, ['assetId','photoId','publicationStatus','role','storageStatus','exifPolicy','deliveryUrl','expiresAt','publicationApproval','rightsRecord']),
};
function sanitize(value, spec, path) {
  if (typeof spec === 'function') { if (!spec(value)) fail('INVALID_RESPONSE', 'Invalid public field: '+path); return value; }
  if (spec.nullable) return value === null ? null : sanitize(value,spec.nullable,path);
  if (spec.array) {
    if (!Array.isArray(value) || value.length>10000) fail('INVALID_RESPONSE','Invalid public array: '+path);
    return value.map((v,i)=>sanitize(v,spec.array,`${path}[${i}]`));
  }
  if (!record(value)) fail('INVALID_RESPONSE','Invalid public record: '+path);
  const out = {};
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(spec.fields,key)) fail('UNSAFE_RESPONSE','Nonallowlisted response field: '+path+'.'+key);
    out[key] = sanitize(value[key],spec.fields[key],path+'.'+key);
  }
  for (const key of spec.required) if (!(key in out)) fail('INVALID_RESPONSE','Missing public field: '+path+'.'+key);
  if(spec === partialDate && !validatePartialDate(out).valid)fail('INVALID_RESPONSE','Invalid partial date: '+path);
  if(spec === period && !validatePeriod(out).valid)fail('INVALID_RESPONSE','Invalid period: '+path);
  return out;
}
function matches(item, filters, kind) {
  for(const k of ['venueId','layoutVersionId','seatId','workId','productionRunId','performanceEventId']) {
    if(filters[k]===undefined)continue;
    if(kind==='relation'&&k==='venueId'){if(item.fromVenueId!==filters[k]&&item.toVenueId!==filters[k])fail('INVALID_RESPONSE','Relation differs from fixed venue');continue;}
    const value = kind==='run'&&k==='productionRunId' ? item.id : kind==='layout'&&k==='layoutVersionId' ? item.id : kind==='seat'&&k==='seatId' ? item.id
      : kind==='seat'&&k==='layoutVersionId' ? item.position?.layoutVersionId : item[k];
    if(value!==filters[k])fail('INVALID_RESPONSE','Response differs from fixed filter '+k);
  }
}
export function validatePublicCatalogRecord(kind, item, filters = {}) {
  if (!publicSchemas[kind]) fail('BAD_REQUEST','Unknown public record type');
  if(kind==='photo')normalizePhotoMetadataSources(item?.metadata,item?.metadataSources,{errorCode:'UNSAFE_RESPONSE'});
  if (record(item)&&item.publicationStatus!=='published')fail('PRIVATE_RESPONSE','Nonpublished response rejected');
  const out=sanitize(item,publicSchemas[kind],kind);
  matches(out,filters,kind);
  if(kind==='seat') {
    const p=out.position;
    if(p&&(p.seatId!==out.id||!id(p.layoutVersionId)))fail('INVALID_RESPONSE','Seat position identity mismatch');
    const eligible=Boolean(p&&['x','z','floorY'].every(k=>finite(p[k])));
    if(out.projectionEligible!==eligible)fail('INVALID_RESPONSE','Unknown seat coordinates cannot be projected');
  }
  if(kind==='photo') {
    if(out.displayAssetId!==out.displayAsset.id||out.displayAsset.photoId!==out.id)fail('INVALID_RESPONSE','Display asset identity mismatch');
    if(out.seatId!==null&&(out.venueId===null||out.layoutVersionId===null))fail('INVALID_RESPONSE','Seat requires exact venue/layout context');
    if(out.performanceEventId!==null&&out.productionRunId===null)fail('INVALID_RESPONSE','Performance event requires run');
    if(out.projectionEligible&&(out.venueId===null||out.layoutVersionId===null||out.seatId===null))fail('INVALID_RESPONSE','Unknown photo context cannot be projected');
  }
  if(kind==='delivery') {
    const date=out.expiresAt;
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(date)||!Number.isFinite(Date.parse(date)))fail('INVALID_RESPONSE','Delivery expiry must be a UTC instant');
    if(new Date(Date.parse(date)).toISOString().slice(0,19)!==date.slice(0,19))fail('INVALID_RESPONSE','Delivery expiry has invalid calendar values');
    if(Date.parse(date)<=Date.now())fail('DELIVERY_EXPIRED','Delivery URL expired');
  }
  return out;
}

function envelope(value, single = false) {
  const spec=single?schema({contractVersion:literal(CATALOG_CONTRACT_VERSION),revision:id,item:v=>record(v)},['contractVersion','revision','item'])
    :schema({contractVersion:literal(CATALOG_CONTRACT_VERSION),revision:id,items:v=>Array.isArray(v),nextCursor:v=>v===null||cursorToken(v)},['contractVersion','revision','items','nextCursor']);
  return sanitize(value,spec,'response');
}
export function createCatalogTransport({ baseUrl = globalThis.location?.origin, fetchImpl = globalThis.fetch } = {}) {
  if(typeof fetchImpl!=='function'||!text(baseUrl))fail('BAD_REQUEST','Base URL and fetch function required');
  let base;try{base=new URL(baseUrl);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error();}catch{fail('BAD_REQUEST','Invalid service base URL');}
  const cursorContexts=new Map();let latestRevision=null, revisionSequence=0, sequence=0;
  return Object.freeze({ async request(path,{query={},signal}={}) {
    if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('BAD_REQUEST','AbortSignal required');
    abortCheck(signal);
    if(!/^\/api\/catalog\//.test(path)||!record(query))fail('BAD_REQUEST','Catalog GET path and query required');
    const entries=Object.entries(query).filter(([,v])=>v!==undefined&&v!==null);
    if(entries.some(([k,v])=>!text(k)||!['string','number'].includes(typeof v)||!(k==='cursor'?cursorToken(v):text(String(v)))))fail('BAD_REQUEST','Invalid query');
    const fingerprint=JSON.stringify([path,entries.filter(([k])=>!['cursor','revision'].includes(k)).sort(([a],[b])=>a.localeCompare(b))]);
    if(query.cursor!==undefined) {
      const context=cursorContexts.get(query.cursor);
      if(!context||context.fingerprint!==fingerprint)fail('CURSOR_MISMATCH','Cursor belongs to different query');
      if((query.revision!==undefined&&query.revision!==context.revision)||(latestRevision!==null&&latestRevision!==context.revision))fail('REVISION_MISMATCH','Cursor revision is no longer current');
      query={...query,revision:context.revision};
    }
    const url=new URL(path,base);for(const [k,v]of Object.entries(query))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
    const serial=++sequence;let response;
    try{response=await abortable(fetchImpl(url.href,{method:'GET',headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal}),signal);}catch(error){if(signal?.aborted||error?.name==='AbortError')throw abortError();throw catalogError('NETWORK_ERROR','Catalog request failed');}
    abortCheck(signal);
    if(!response||typeof response.json!=='function'||typeof response.ok!=='boolean')fail('INVALID_RESPONSE','Invalid HTTP response');
    if(!response.ok){const codes={400:'BAD_REQUEST',404:'NOT_FOUND',409:'CURSOR_MISMATCH',503:'SERVICE_UNAVAILABLE'};let code=codes[response.status]??'HTTP_ERROR';try{const body=await abortable(response.json(),signal);if(['BAD_REQUEST','NOT_FOUND','CURSOR_MISMATCH','REVISION_MISMATCH','SERVICE_UNAVAILABLE'].includes(body?.code))code=body.code;}catch(error){if(error?.name==='AbortError')throw error;}throw catalogError(code,'Catalog request rejected',response.status);}
    let raw;try{raw=await abortable(response.json(),signal);}catch(error){if(error?.name==='AbortError')throw error;throw catalogError('INVALID_RESPONSE','Catalog JSON is invalid');}
    abortCheck(signal);
    const single=Object.prototype.hasOwnProperty.call(raw??{},'item'), result=envelope(raw,single);
    if(query.revision!==undefined&&result.revision!==query.revision)fail('REVISION_MISMATCH','Response revision differs from requested revision');
    if(serial<revisionSequence&&latestRevision!==result.revision)fail('REVISION_MISMATCH','Delayed response has stale revision');
    if(serial>=revisionSequence){latestRevision=result.revision;revisionSequence=serial;}
    if(!single&&result.nextCursor!==null){if(cursorContexts.size>=1000)cursorContexts.delete(cursorContexts.keys().next().value);const old=cursorContexts.get(result.nextCursor);if(old&&(old.fingerprint!==fingerprint||old.revision!==result.revision))fail('INVALID_RESPONSE','Cursor token reused across contexts');cursorContexts.set(result.nextCursor,{fingerprint,revision:result.revision});}
    return result;
  }});
}

export function catalogPathId(value) { if(!id(value))fail('BAD_REQUEST','Invalid record identity');return encodeURIComponent(value); }
export async function readCatalogPublic(transport, kind, path, options={}, allowed=[], { single=false, expectedId=null }={}) {
  if(!transport||typeof transport.request!=='function'||!record(options))fail('BAD_REQUEST','Transport and options required');
  const accepted=new Set(['signal','revision',...(single?[]:['limit','cursor']),...allowed]);
  for(const k of Object.keys(options))if(!accepted.has(k))fail('BAD_REQUEST','Unsupported query option '+k);
  const query={};for(const k of ['revision','cursor',...allowed])if(options[k]!==undefined){if(!(k==='cursor'?cursorToken(options[k]):id(options[k])))fail('BAD_REQUEST','Invalid query option '+k);query[k]=options[k];}
  if(!single){const limit=options.limit??25;if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail('BAD_REQUEST','Limit must be 1–100');query.limit=limit;}
  const signal=options.signal;
  if(signal!==undefined&&(!signal||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'||typeof signal.aborted!=='boolean'))fail('BAD_REQUEST','AbortSignal required');
  abortCheck(signal);
  const raw=await abortable(transport.request(path,{query,signal}),signal);abortCheck(signal);
  const result=envelope(raw,single), filters=Object.fromEntries(allowed.filter(k=>query[k]!==undefined).map(k=>[k,query[k]]));
  if(options.revision!==undefined&&result.revision!==options.revision)fail('REVISION_MISMATCH','Response revision mismatch');
  if(single){const item=validatePublicCatalogRecord(kind,result.item,filters);if(expectedId!==null&&(kind==='delivery'?item.assetId:item.id)!==expectedId)fail('INVALID_RESPONSE','Response identity mismatch');return {...result,item};}
  if(result.items.length>query.limit)fail('INVALID_RESPONSE','Response exceeds requested limit');
  const seen=new Set();const items=result.items.map(item=>{const out=validatePublicCatalogRecord(kind,item,filters);if(seen.has(out.id))fail('INVALID_RESPONSE','Duplicate response ID');seen.add(out.id);return out;});
  if(!items.length&&result.nextCursor!==null)fail('INVALID_RESPONSE','Empty page has continuation cursor');
  return {...result,items};
}
export function createCatalogRepository({transport}={}) {
  if(!transport||typeof transport.request!=='function')fail('BAD_REQUEST','Transport required');
  const root='/api/catalog';
  const nested=async(kind,suffix,options={})=>{if(!record(options))fail('BAD_REQUEST','Options object required');const venueId=options.venueId;catalogPathId(venueId);return readCatalogPublic(transport,kind,`${root}/venues/${catalogPathId(venueId)}/${suffix}`,options,['venueId',...(kind==='seat'?['layoutVersionId','seatId']:[])]);};
  return Object.freeze({
    listVenues:(options={})=>readCatalogPublic(transport,'venue',root+'/venues',options),
    listVenueNames:(options={})=>nested('name','names',options),
    listVenueRelations:(options={})=>nested('relation','relations',options),
    listLayouts:(options={})=>nested('layout','layouts',options),
    getLayout:async(layoutId,options={})=>readCatalogPublic(transport,'layout',`${root}/layouts/${catalogPathId(layoutId)}`,options,[],{single:true,expectedId:layoutId}),
    listSeats:(options={})=>nested('seat','seats',options),
    listWorks:(options={})=>readCatalogPublic(transport,'work',root+'/works',options),
    listRuns:(options={})=>readCatalogPublic(transport,'run',root+'/runs',options,['venueId','layoutVersionId','workId','productionRunId']),
  });
}
