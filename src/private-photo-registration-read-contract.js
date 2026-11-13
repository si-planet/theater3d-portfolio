import {copyPrivatePhotoRegistrationManifest,canonicalPrivatePhotoRegistrationJSON} from './private-photo-registration-contract.js';
import {privatePhotoDeleteExact as exact} from './private-photo-delete-contract.js';
import {copyPrivatePhotoMetadataCorrection} from './private-photo-metadata-contract.js';
export const PRIVATE_PHOTO_REGISTRATION_READ_ACTION='private.photo.registrationRead';
export const PRIVATE_PHOTO_REGISTRATION_READ_ENDPOINT='/functions/v1/theater3d-private-library/registration-read';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(){throw Object.assign(new Error('Private registration read rejected'),{code:'INVALID_RESPONSE'});}
export function copyPrivatePhotoRegistrationReadPayload(raw){const p=exact(raw,['photoId','photoRevision','displayRevision']);
 if(typeof p.photoId!=='string'||!UUID.test(p.photoId)||![p.photoRevision,p.displayRevision].every(n=>Number.isSafeInteger(n)&&n>0))fail();return Object.freeze(p);}
export function copyPrivatePhotoRegistrationReadResult(raw,input){const p=copyPrivatePhotoRegistrationReadPayload(input),hasCorrection=raw&&Object.hasOwn(raw,'correction'),r=exact(raw,['photoId','photoRevision','displayRevision','operationId','manifest',...(hasCorrection?['correction']:[])]);
 if(Object.keys(p).some(k=>r[k]!==p[k]))fail();r.manifest=copyPrivatePhotoRegistrationManifest(r.manifest);if(r.operationId!==r.manifest.operationId)fail();
 if(hasCorrection){r.correction=copyPrivatePhotoMetadataCorrection(r.correction);if(r.correction&&r.correction.revision>r.photoRevision)fail();}return Object.freeze(r);}
/** Compare original identity fields only, never a filename/label/coordinate guess.
 * Optional legacy edition/run claims must have the same presence and value. */
export function privateRegisteredPhotoMatchesSelection(source,current){
 try{if(!source||!current)return false;
  const a=JSON.parse(canonicalPrivatePhotoRegistrationJSON(source)),b=JSON.parse(canonicalPrivatePhotoRegistrationJSON(current));
  const is2d=a.kind==='source2d';if(is2d!==(b.kind==='source2d'))return false;
  const keys=is2d?['kind','informationRecordId','layoutVersionId','configurationKey','frameId','seatId']:['venueId','modelId','modelVersion','seatId','source','layoutVersionId','productionRunId'];
  if(!is2d&&(a.source!=='user_selected'||b.source!=='user_selected'))return false;
  return keys.every(k=>Object.hasOwn(a,k)===Object.hasOwn(b,k)&&a[k]===b[k])&&keys.filter(k=>!['layoutVersionId','productionRunId'].includes(k)||is2d).every(k=>typeof a[k]==='string'&&a[k].length>0);
 }catch{return false;}
}
