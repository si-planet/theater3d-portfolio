/** Owner-authorized soft deletion. Archive originals and Storage objects are preserved. */
export const PRIVATE_PHOTO_DELETE_PROTOCOL='theater3d/private-photo-delete/v1';
export const PRIVATE_PHOTO_DELETE_ENDPOINT='/functions/v1/theater3d-private-library/photo-delete';
export const PRIVATE_PHOTO_DELETE_ACTIONS=Object.freeze({remove:'private.photo.delete',status:'private.photo.deleteStatus'});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(){throw Object.assign(new Error('Private photo deletion rejected'),{code:'INPUT_INVALID'});}
export function privatePhotoDeleteExact(v,keys){
 if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
 const found=Reflect.ownKeys(v);if(found.length!==keys.length||found.some(k=>!keys.includes(k)))fail();const out={};
 for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();out[k]=d.value;}return out;
}
export function copyPrivatePhotoDeletePayload(raw){const p=privatePhotoDeleteExact(raw,['operationId','photoId','expectedRevision']);
 if(typeof p.operationId!=='string'||!UUID.test(p.operationId)||typeof p.photoId!=='string'||!UUID.test(p.photoId)||p.operationId===p.photoId
  ||!Number.isSafeInteger(p.expectedRevision)||p.expectedRevision<1||p.expectedRevision>=Number.MAX_SAFE_INTEGER)fail();return Object.freeze(p);}
export function parsePrivatePhotoDeleteResult(raw,input){const p=copyPrivatePhotoDeletePayload(input),r=privatePhotoDeleteExact(raw,['operationId','photoId','expectedRevision','photoRevision','status','replayed']);
 if(['operationId','photoId','expectedRevision'].some(k=>r[k]!==p[k])||!['live','deleted'].includes(r.status)||typeof r.replayed!=='boolean'
  ||r.photoRevision!==p.expectedRevision+(r.status==='deleted'?1:0)||r.status==='live'&&r.replayed)fail();return Object.freeze(r);}

/** Optional owner-only list descriptor; never infer an operation from photo/file IDs. */
export function copyPrivatePhotoDeletionDescriptor(raw,photoId,revision){
 const d=privatePhotoDeleteExact(raw,['operationId','expectedRevision']);
 const p=copyPrivatePhotoDeletePayload({...d,photoId});if(p.expectedRevision!==revision)fail();
 return Object.freeze({operationId:p.operationId,expectedRevision:p.expectedRevision});
}
