import {PHOTO_METADATA_FIELDS} from './catalog-repository.js';
import {privatePhotoDeleteExact as exact,copyPrivatePhotoDeletePayload} from './private-photo-delete-contract.js';
export const PRIVATE_PHOTO_METADATA_PROTOCOL='theater3d/private-photo-metadata/v1';
export const PRIVATE_PHOTO_METADATA_ENDPOINT='/functions/v1/theater3d-private-library/photo-metadata';
export const PRIVATE_PHOTO_METADATA_ACTIONS=Object.freeze({save:'private.photo.metadataSave',status:'private.photo.metadataStatus'});
export const PRIVATE_PHOTO_METADATA_FIELDS=Object.freeze([...PHOTO_METADATA_FIELDS.filter(k=>!['venueName','seatLabel'].includes(k)),'captureLocation']);
const CONTRACT='theater3d.private-photo-metadata-correction/v1';
const fail=()=>{throw Object.assign(Error('Private photo metadata rejected'),{code:'INPUT_INVALID'});};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function copyPrivatePhotoMetadataFields(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))fail();const keys=Reflect.ownKeys(raw);if(!keys.length||keys.some(k=>!PRIVATE_PHOTO_METADATA_FIELDS.includes(k)))fail();const r=exact(raw,keys),out={};
 for(const k of [...keys].sort()){const v=exact(r[k],['value','source']);if(v.source!=='manual')fail();
  if(v.value!==null&&typeof v.value!=='string'&&typeof v.value!=='number')fail();
  if(typeof v.value==='number'&&(!Number.isFinite(v.value)||Object.is(v.value,-0)))fail();
  if(typeof v.value==='string'&&(v.value.length>500||/[\u0000-\u001f\u007f]/u.test(v.value)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v.value)))fail();out[k]=v;}
 return freeze(out);}
export function copyPrivatePhotoMetadataPayload(raw){const r=exact(raw,['operationId','photoId','expectedRevision','fields']);const{fields,...p}=r;return freeze({...copyPrivatePhotoDeletePayload(p),fields:copyPrivatePhotoMetadataFields(fields)});}
export function copyPrivatePhotoMetadataCorrection(raw){if(raw===null)return null;const r=exact(raw,['contract','revision','baseRevision','patch','fields']);
 if(r.contract!==CONTRACT||!Number.isSafeInteger(r.baseRevision)||r.baseRevision<1||r.baseRevision>=Number.MAX_SAFE_INTEGER||r.revision!==r.baseRevision+1)fail();
 r.patch=copyPrivatePhotoMetadataFields(r.patch);r.fields=copyPrivatePhotoMetadataFields(r.fields);for(const k of Object.keys(r.patch))if(JSON.stringify(r.patch[k])!==JSON.stringify(r.fields[k]))fail();return freeze(r);}
export function parsePrivatePhotoMetadataResult(raw,input){const p=copyPrivatePhotoMetadataPayload(input),r=exact(raw,['operationId','photoId','expectedRevision','photoRevision','status','replayed','correction']);
 if(['operationId','photoId','expectedRevision'].some(k=>r[k]!==p[k])||!['unchanged','saved'].includes(r.status)||typeof r.replayed!=='boolean'||r.photoRevision!==p.expectedRevision+(r.status==='saved'?1:0))fail();
 r.correction=copyPrivatePhotoMetadataCorrection(r.correction);if(r.correction&&r.correction.revision>r.photoRevision)fail();
 if(r.status==='saved'&&(!r.correction||r.correction.baseRevision!==p.expectedRevision||JSON.stringify(r.correction.patch)!==JSON.stringify(p.fields)))fail();
 if(r.status==='unchanged'&&r.replayed)fail();return freeze(r);}
export function effectivePrivatePhotoMetadata(value){const raw=value.manifest.registrationSnapshot,correction=copyPrivatePhotoMetadataCorrection(value.correction??null),metadata={...raw.metadata};
 let sources=Object.hasOwn(raw,'metadataSources')?{...raw.metadataSources}:undefined;
 if(correction){sources??={};for(const[k,v]of Object.entries(correction.fields)){metadata[k]=v.value;sources[k]='manual';}}
 return freeze({metadata,...(sources===undefined?{}:{metadataSources:sources})});}
