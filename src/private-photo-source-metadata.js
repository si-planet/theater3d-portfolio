/** Source observations only. No canonical mapping, date conversion or network. */
import {privatePhotoDeleteExact as exact} from './private-photo-delete-contract.js';
export const SOURCE_METADATA_CONTRACT='theater3d.preserved-photo-source/v1';
export const SOURCE_METADATA_FIELDS=Object.freeze(['device','lens','focalLengthMm','captureDateTime','pixelWidth','pixelHeight','orientation','aspectRatio','production','seatLabel']);
const SHA=/^[a-f0-9]{64}$/;
function fail(){throw Object.assign(Error('Source metadata rejected'),{code:'INPUT_INVALID'});}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
function geometry(raw){const g=exact(raw,['pixelWidth','pixelHeight','orientation']);if(![g.pixelWidth,g.pixelHeight].every(v=>Number.isSafeInteger(v)&&v>0&&v<=100000)||g.orientation!==null&&(!Number.isInteger(g.orientation)||g.orientation<1||g.orientation>8))fail();return g;}
export function copyPrivatePhotoSourceMetadata(raw,expectedOriginalSha256){
 const m=exact(raw,['contract','originalSha256','metadataDocumentSha256','metadata','metadataSources','rawGeometry','orientedGeometry','captureTimeTimezone','seatMapping']);
 if(m.contract!==SOURCE_METADATA_CONTRACT||typeof m.originalSha256!=='string'||!SHA.test(m.originalSha256)||typeof m.metadataDocumentSha256!=='string'||!SHA.test(m.metadataDocumentSha256)||expectedOriginalSha256!==undefined&&m.originalSha256!==expectedOriginalSha256||m.captureTimeTimezone!==null||m.seatMapping!=='unresolved')fail();
 if(!m.metadata||typeof m.metadata!=='object')fail();const keys=Reflect.ownKeys(m.metadata);if(!keys.length||keys.some(k=>!SOURCE_METADATA_FIELDS.includes(k)))fail();
 m.metadata=exact(m.metadata,keys);m.metadataSources=exact(m.metadataSources,keys);
 for(const k of keys){const v=m.metadata[k];if(typeof v!=='string'||!v.length||v.length>500||/[\u0000-\u001f\u007f]/u.test(v)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)||!['exif','file','filename'].includes(m.metadataSources[k]))fail();}
 m.rawGeometry=geometry(m.rawGeometry);m.orientedGeometry=geometry(m.orientedGeometry);
 if(new TextEncoder().encode(JSON.stringify(m)).length>16384)fail();return freeze(m);
}
