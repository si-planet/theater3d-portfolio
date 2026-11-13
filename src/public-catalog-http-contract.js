import { validatePublicCatalogRecord } from './catalog-repository.js';

export const PUBLIC_CATALOG_PROJECT = 'portfolio-demo-disabled';
export const PUBLIC_CATALOG_ORIGIN = `https://${PUBLIC_CATALOG_PROJECT}.supabase.co`;
export const PUBLIC_CATALOG_ENDPOINT = `${PUBLIC_CATALOG_ORIGIN}/functions/v1/theater3d-public-catalog`;
export const PUBLIC_CATALOG_PROTOCOL = 'theater3d.public-catalog/v1';
export const PUBLIC_CATALOG_LIMITS = Object.freeze({body:2097152,record:1048576,manifest:1048576,snapshot:33554432,records:10000,asset:26214400});
export const PUBLIC_CATALOG_KINDS = Object.freeze(['venue','layout','seat','work','run','name','relation','photo']);
export const publicId = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export const publicHash = v => typeof v==='string' && /^[0-9a-f]{64}$/.test(v);
export function publicReadError(code='INVALID_RESPONSE') { return Object.assign(new Error('Public catalog request rejected'),{code}); }
export function publicExact(value, allowed, required=allowed) {
  if(!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw publicReadError();
  const keys=Reflect.ownKeys(value),out={};
  for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!allowed.includes(key)||!d?.enumerable||!Object.hasOwn(d,'value'))throw publicReadError();out[key]=d.value;}
  if(required.some(k=>!Object.hasOwn(out,k)))throw publicReadError();return out;
}
export function publicFreeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))publicFreeze(child);Object.freeze(value);}return value;}
export function publicCanonical(value){if(Array.isArray(value))return '['+value.map(publicCanonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+publicCanonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export async function publicDigest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
// Production entries never supply local-development. No environment variable or
// caller request can enable it; explicit local harness construction is required.
export function publicOrigin(value,runtimeMode='production'){if(typeof value!=='string'||!['production','local-development'].includes(runtimeMode))return null;try{const u=new URL(value);const protocol=u.protocol==='https:'||runtimeMode==='local-development'&&u.protocol==='http:'&&u.hostname==='127.0.0.1';return protocol&&u.origin===value&&!u.username&&!u.password&&!u.search&&!u.hash?value:null;}catch{return null;}}
export function publicRoute(path,query={}){
  if(typeof path!=='string')throw publicReadError('BAD_REQUEST');
  let kind,id=null,venueId=null,m;
  const collections={venues:'venue',works:'work',runs:'run',photos:'photo'};
  if((m=/^\/api\/catalog\/(venues|works|runs|photos)$/.exec(path)))kind=collections[m[1]];
  else if((m=/^\/api\/catalog\/venues\/([^/]+)\/(layouts|seats|names|relations)$/.exec(path))&&publicId(m[1])){venueId=m[1];kind={layouts:'layout',seats:'seat',names:'name',relations:'relation'}[m[2]];}
  else if((m=/^\/api\/catalog\/layouts\/([^/]+)$/.exec(path))&&publicId(m[1])){id=m[1];kind='layout';}
  else if((m=/^\/api\/catalog\/photos\/([^/]+)$/.exec(path))&&publicId(m[1])){id=m[1];kind='photo';}
  else if((m=/^\/api\/catalog\/assets\/([^/]+)\/delivery$/.exec(path))&&publicId(m[1])){id=m[1];kind='delivery';}
  else throw publicReadError('BAD_REQUEST');
  const fields=kind==='photo'?['venueId','layoutVersionId','seatId','workId','productionRunId','performanceEventId']:kind==='run'?['venueId','layoutVersionId','workId','productionRunId']:[];
  const allowed=[...new Set(['revision',...(id?[]:['limit','cursor']),...(venueId?['venueId']:[]),...(kind==='seat'?['layoutVersionId','seatId']:[]),...fields])];
  const values=publicExact(query,allowed,[]),fixed={};
  for(const[key,value]of Object.entries(values)){
    if(key==='limit'){if(!/^[1-9][0-9]{0,2}$/.test(String(value))||Number(value)>100||!['number','string'].includes(typeof value))throw publicReadError('BAD_REQUEST');fixed.limit=Number(value);}
    else if(key==='cursor'){if(typeof value!=='string'||!/^[a-z0-9.-]{1,200}$/.test(value))throw publicReadError('BAD_REQUEST');fixed.cursor=value;}
    else {if(!publicId(value))throw publicReadError('BAD_REQUEST');fixed[key]=value;}
  }
  if(venueId&&fixed.venueId!==undefined&&fixed.venueId!==venueId)throw publicReadError('BAD_REQUEST');
  if(kind==='seat'&&!publicId(fixed.layoutVersionId))throw publicReadError('BAD_REQUEST');
  // There is no reviewed public performance-event DTO in this snapshot contract.
  if(fixed.performanceEventId!==undefined)throw publicReadError('BAD_REQUEST');
  if(!id&&fixed.limit===undefined)fixed.limit=25;
  const filters={...(venueId?{venueId}:{}),...Object.fromEntries(['venueId','layoutVersionId','seatId','workId','productionRunId','performanceEventId'].filter(key=>fixed[key]!==undefined).map(key=>[key,fixed[key]]))};
  return publicFreeze({kind,id,filters,query:fixed,support:'approved-snapshot'});
}
export function publicAssetURL(assetId,revision){
  if(!publicId(assetId)||!publicId(revision))throw publicReadError();
  return `${PUBLIC_CATALOG_ENDPOINT}/assets/${assetId}?revision=${revision}`;
}
function clean(value,depth=0,trail=[]){
  if(depth>32)throw publicReadError();
  if(Array.isArray(value)){if(value.length>10000||Reflect.ownKeys(value).length!==value.length+1)throw publicReadError();return Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))throw publicReadError();return clean(d.value,depth+1,[...trail,'*']);});}
  if(value&&typeof value==='object'){const keys=Reflect.ownKeys(value);if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw publicReadError();const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||['__proto__','constructor','prototype','legacyModelId'].includes(key)||!d?.enumerable||!Object.hasOwn(d,'value'))throw publicReadError('UNSAFE_RESPONSE');if(key==='sourceRefs'&&(!Array.isArray(d.value)||d.value.length!==0))throw publicReadError('UNSAFE_RESPONSE');if(/(?:^id$|Id$)/.test(key)&&d.value!==null&&!publicId(d.value))throw publicReadError('UNSAFE_RESPONSE');out[key]=clean(d.value,depth+1,[...trail,key]);}return out;}
  // Only schema-defined fields may contain these delimiters; no general URL/path exemption.
  if(typeof value==='string'&&trail.at(-1)==='timezone'){
    try{if(value.length>100)throw Error();new Intl.DateTimeFormat('en',{timeZone:value});return value;}catch{throw publicReadError('UNSAFE_RESPONSE');}
  }
  if(typeof value==='string'&&trail.join('.')==='displayAsset.mediaType'&&value==='image/png')return value;
  if(typeof value==='string'&&trail.join('.')==='deliveryUrl'){
    const u=new URL(value),id=u.pathname.split('/').at(-1),revision=u.searchParams.get('revision');
    if(value!==publicAssetURL(id,revision))throw publicReadError('UNSAFE_RESPONSE');return value;
  }
  if(typeof value==='string'&&(/[\\/\u0000-\u001f\u007f]|[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]{0,9}\b|sb_secret_|-----BEGIN |access_token|refresh_token/i.test(value)||value.length>2000))throw publicReadError('UNSAFE_RESPONSE');
  if(value!==null&&!['string','boolean','number'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw publicReadError();return value;
}
export function validatePublicReadDTO(kind,value,filters={}){
  if(![...PUBLIC_CATALOG_KINDS,'delivery'].includes(kind))throw publicReadError('UNSAFE_RESPONSE');
  try{const out=validatePublicCatalogRecord(kind,clean(value),filters);if(!publicId(kind==='delivery'?out.assetId:out.id)||kind==='seat'&&!out.position)throw publicReadError();
    if(kind==='relation'&&out.fromVenueId===null&&(!out.historicalName||out.geometryContinuity!=='unknown'))throw publicReadError();
    if(kind==='photo'){
      // Event publication and raw EXIF/filename provenance have no approved DTO boundary here.
      if(!Object.hasOwn(out,'workId')||out.performanceEventId!==null||out.displayAsset.mediaType!=='image/png'||Object.values(out.metadataSources).some(tag=>!['manual','seat_selection'].includes(tag)))throw publicReadError();
    }
    if(kind==='delivery'&&out.deliveryUrl!==publicAssetURL(out.assetId,new URL(out.deliveryUrl).searchParams.get('revision')))throw publicReadError();
    return publicFreeze(out);}catch{throw publicReadError('UNSAFE_RESPONSE');}
}
export function validatePublicReadResult(value,route){
  const out=publicExact(value,route.id?['contractVersion','revision','item']:['contractVersion','revision','items','nextCursor']);
  if(out.contractVersion!==1||!publicId(out.revision)||route.query.revision&&route.query.revision!==out.revision)throw publicReadError('REVISION_MISMATCH');
  if(route.id){out.item=validatePublicReadDTO(route.kind,out.item,route.filters);if((route.kind==='delivery'?out.item.assetId:out.item.id)!==route.id)throw publicReadError();if(route.kind==='delivery'&&out.item.deliveryUrl!==publicAssetURL(route.id,out.revision))throw publicReadError();}
  else{if(!Array.isArray(out.items)||out.items.length>route.query.limit)throw publicReadError();out.items=out.items.map(v=>validatePublicReadDTO(route.kind,v,route.filters));if(new Set(out.items.map(v=>v.id)).size!==out.items.length||out.nextCursor!==null&&(typeof out.nextCursor!=='string'||!/^[a-z0-9.-]{1,200}$/.test(out.nextCursor)||!out.items.length))throw publicReadError();}
  return publicFreeze(out);
}
