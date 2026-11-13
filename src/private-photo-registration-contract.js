/** Shared private-only registration wire. No I/O, credential, UUID generation,
 * source inference or public DTO. Explicit canonical scope is server-verified.
 */
import {PHOTO_METADATA_FIELDS,normalizePhotoMetadataSources} from './catalog-repository.js';
export const PRIVATE_PHOTO_REGISTRATION_PROTOCOL='theater3d/private-photo-registration/v1';
export const PRIVATE_PHOTO_REGISTRATION_ENDPOINT='/functions/v1/theater3d-private-library/registration';
export const PRIVATE_PHOTO_REGISTRATION_ACTIONS=Object.freeze({register:'private.photo.register',status:'private.photo.registrationStatus'});
export const PRIVATE_PHOTO_REGISTRATION_LIMITS=Object.freeze({maxBytes:25*1024*1024,browserSourceMaxBytes:64*1024*1024,maxDimension:4096,maxPixels:24000000,maxManifestBytes:128*1024});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ANY_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
// Same explicit whitespace set as canonical SQL valid_text(..., false).
// Reject an empty name after that check; never trim or rewrite the original.
const WHITESPACE_NAME=/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
const bad=code=>{throw Object.assign(Error('Private photo registration rejected'),{code:code||'BAD_REQUEST'});};
function plain(v){if(!v||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))bad();const out={};
 for(const key of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||!d?.enumerable||!Object.hasOwn(d,'value'))bad();out[key]=d.value;}return out;}
function exact(v,keys,required=keys){const out=plain(v);if(Object.keys(out).some(k=>!keys.includes(k))||required.some(k=>!Object.hasOwn(out,k)))bad();return out;}
function clone(v,seen=new Set(),depth=0){if(depth>20)bad('LIMIT_EXCEEDED');if(v===null||typeof v==='boolean')return v;
 if(typeof v==='string'){if(v.length>32768||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))bad();return v;}
 if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))bad();return v;}if(typeof v!=='object'||seen.has(v))bad();seen.add(v);let result;
 if(Array.isArray(v)){if(v.length>5000||Reflect.ownKeys(v).length!==v.length+1)bad();result=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d?.enumerable||!Object.hasOwn(d,'value'))bad();result.push(clone(d.value,seen,depth+1));}}
 else{result={};const fields=plain(v);for(const k of Object.keys(fields).sort())result[k]=clone(fields[k],seen,depth+1);}seen.delete(v);return result;}
function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
export function canonicalPrivatePhotoRegistrationJSON(value){const text=JSON.stringify(clone(value));if(new TextEncoder().encode(text).length>PRIVATE_PHOTO_REGISTRATION_LIMITS.maxManifestBytes)bad('LIMIT_EXCEEDED');return text;}
const positive=n=>Number.isSafeInteger(n)&&n>0;
function text(v,max,empty=false){if(typeof v!=='string'||(!empty&&!v)||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))bad();return v;}
function dimensions(o,maxDimension=4096,maxBytes=PRIVATE_PHOTO_REGISTRATION_LIMITS.maxBytes){if(!positive(o.byteSize)||o.byteSize>maxBytes||![o.pixelWidth,o.pixelHeight].every(n=>positive(n)&&n<=maxDimension)||o.pixelWidth*o.pixelHeight>24000000)bad('LIMIT_EXCEEDED');
 if(typeof o.sha256!=='string'||!HASH.test(o.sha256)||!['image/png','image/jpeg','image/webp'].includes(o.mediaType))bad();}
function original(value,browser=false){const r=exact(value,['originalFilename','mediaType','byteSize','sha256','pixelWidth','pixelHeight','orientation']);text(r.originalFilename,255);
 if(WHITESPACE_NAME.test(r.originalFilename)||/[/\\]/.test(r.originalFilename)||['.','..'].includes(r.originalFilename))bad();dimensions(r,browser?8192:4096,browser?PRIVATE_PHOTO_REGISTRATION_LIMITS.browserSourceMaxBytes:PRIVATE_PHOTO_REGISTRATION_LIMITS.maxBytes);if(r.orientation!==null&&(!Number.isInteger(r.orientation)||r.orientation<1||r.orientation>8))bad();return r;}
function derivative(value,role){const d=exact(value,['role','sha256','mediaType','byteSize','pixelWidth','pixelHeight','orientation','exifPolicy','transformSpec']);
 if(d.role!==role||d.orientation!==1||d.exifPolicy!=='stripped'||d.mediaType!=='image/png')bad();dimensions(d);
 const t=exact(d.transformSpec,['version','parentSha256','sourceOrientation','sourceOrientationSource','fit','cropped','upscaled','maxEdge','orientedWidth','orientedHeight','scaleX','scaleY']);
 if(!Number.isSafeInteger(t.version)||t.version<1||!HASH.test(t.parentSha256)||!Number.isInteger(t.sourceOrientation)||t.sourceOrientation<1||t.sourceOrientation>8||!['exif','default'].includes(t.sourceOrientationSource)
  ||t.fit!=='contain'||t.cropped!==false||t.upscaled!==false||![t.maxEdge,t.orientedWidth,t.orientedHeight].every(positive)||t.maxEdge>4096
  ||![t.scaleX,t.scaleY].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=1))bad();return d;}
function seatContext(value){if(value===null)return null;const p=plain(value);
 if(p.kind==='source2d'){exact(p,['kind','informationRecordId','layoutVersionId','configurationKey','frameId','seatId','venueName','seatLabel']);
  for(const key of ['informationRecordId','layoutVersionId','configurationKey','frameId','seatId'])text(p[key],300);for(const key of ['venueName','seatLabel'])text(p[key],500,true);}
 else{exact(p,['venueId','venueName','modelId','modelVersion','seatId','seatLabel','source','layoutVersionId','productionRunId'],['venueId','venueName','modelId','modelVersion','seatId','seatLabel','source']);
  if(p.source!=='user_selected')bad();for(const [key,v]of Object.entries(p))text(v,key==='venueName'?200:key==='seatLabel'?100:160);}
 return p;}
const META=[...PHOTO_METADATA_FIELDS,'captureLocation'];
function snapshot(value){const s=exact(value,['metadata','metadataSources','seatContext','derivatives'],['metadata','seatContext','derivatives']);
 const metadata=exact(s.metadata,META,[]);for(const[key,v]of Object.entries(metadata)){
  if(v!==null&&typeof v!=='string'&&typeof v!=='number')bad();if(typeof v==='number'&&!Number.isFinite(v))bad();if(typeof v==='string')text(v,key==='captureLocation'?500:500,true);}
 if(new TextEncoder().encode(JSON.stringify(metadata)).length>16384)bad('LIMIT_EXCEEDED');
 if(Object.hasOwn(s,'metadataSources')){const sources=exact(s.metadataSources,META,[]),without=Object.fromEntries(Object.entries(sources).filter(([k])=>k!=='captureLocation'));
  normalizePhotoMetadataSources(Object.fromEntries(Object.entries(metadata).filter(([k])=>k!=='captureLocation')),without);
  if(Object.hasOwn(sources,'captureLocation')&&(!Object.hasOwn(metadata,'captureLocation')||sources.captureLocation!=='manual'))bad();}
 s.seatContext=seatContext(s.seatContext);const d=exact(s.derivatives,['display','thumbnail']);s.derivatives={display:derivative(d.display,'display'),thumbnail:derivative(d.thumbnail,'thumbnail')};return s;}
export function copyPrivatePhotoRegistrationManifest(value,{browserSource=false}={}){const r=exact(clone(value),['operationId','original','context','registrationSnapshot','storageMode','uploadCopy'],['operationId','original','context','registrationSnapshot']);
 const browser=Object.hasOwn(r,'storageMode')||Object.hasOwn(r,'uploadCopy');
 if(browser){if(r.storageMode!=='browser-fhd'||!Object.hasOwn(r,'uploadCopy'))bad();
  const d=exact(r.uploadCopy,['sha256','byteSize','mediaType','pixelWidth','pixelHeight','orientation']);dimensions(d);
  if(d.mediaType!=='image/jpeg'||d.orientation!==1||Math.max(d.pixelWidth,d.pixelHeight)>1920||Math.min(d.pixelWidth,d.pixelHeight)>1080)bad('ASSET_INTEGRITY');r.uploadCopy=d;}
 if(typeof r.operationId!=='string'||!UUID.test(r.operationId))bad('UNSUPPORTED_LOCAL_ID');r.original=original(r.original,browser||browserSource);
 const context=exact(r.context,['venueId','layoutEditionId','seatId','postId']);
 if(context.postId!==null||!(['venueId','layoutEditionId','seatId'].every(k=>context[k]===null)
  ||['venueId','layoutEditionId','seatId'].every(k=>typeof context[k]==='string'&&UUID.test(context[k]))))bad('CONTEXT_UNRESOLVED_ONLY');r.context=context;
 r.registrationSnapshot=snapshot(r.registrationSnapshot);
 for(const d of Object.values(r.registrationSnapshot.derivatives))if(d.transformSpec.parentSha256!==r.original.sha256)bad('ASSET_INTEGRITY');
 canonicalPrivatePhotoRegistrationJSON(r);return freeze(r);}
export function copyPrivatePhotoRegistrationPayload(value){const r=exact(value,['operationId','original','context','registrationSnapshot','requestFingerprint','storageMode','uploadCopy'],['operationId','original','context','registrationSnapshot','requestFingerprint']);
 if(typeof r.requestFingerprint!=='string'||!HASH.test(r.requestFingerprint))bad();const{requestFingerprint,...manifest}=r;return freeze({...copyPrivatePhotoRegistrationManifest(manifest),requestFingerprint});}
export function parsePrivatePhotoRegistrationResult(value,{operationId,requestFingerprint}={}){
 const keys=['operationId','requestFingerprint','status','sourceRefId','photoId','photoRevision','assetId','assetRevision','originalBackedUp','displayStored','replayed'];
 const r=exact(clone(value),[...keys,'storageMode'],keys);
 const fhdOnly=Object.hasOwn(r,'storageMode');if(fhdOnly&&!['fhd-only','browser-fhd'].includes(r.storageMode))bad('INVALID_RESPONSE');
 if(typeof operationId!=='string'||!UUID.test(operationId)||r.operationId!==operationId||!['absent','pending','ready'].includes(r.status)||typeof r.originalBackedUp!=='boolean'||typeof r.displayStored!=='boolean'||typeof r.replayed!=='boolean')bad('INVALID_RESPONSE');
 if(r.status==='absent'){if(['requestFingerprint','sourceRefId','photoId','photoRevision','assetId','assetRevision'].some(k=>r[k]!==null)||r.originalBackedUp||r.displayStored||r.replayed)bad('INVALID_RESPONSE');}
 else{if(typeof requestFingerprint!=='string'||!HASH.test(requestFingerprint)||r.requestFingerprint!==requestFingerprint||!['sourceRefId','photoId','assetId'].every(k=>typeof r[k]==='string'&&ANY_UUID.test(r[k]))||new Set([r.operationId,r.sourceRefId,r.photoId,r.assetId]).size!==4||![r.photoRevision,r.assetRevision].every(positive))bad('INVALID_RESPONSE');
  if(fhdOnly){if(r.originalBackedUp||r.status==='ready'&&!r.displayStored)bad('INVALID_RESPONSE');}
  else if(r.status==='ready'&&(!r.originalBackedUp||!r.displayStored)||r.displayStored&&!r.originalBackedUp)bad('INVALID_RESPONSE');}
 return freeze(r);
}
