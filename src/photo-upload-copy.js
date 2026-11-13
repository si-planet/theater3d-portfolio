import {parsePhotoMetadata} from './photo-metadata.js';

export const PHOTO_UPLOAD_COPY_LIMITS=Object.freeze({sourceMaxBytes:64*1024*1024,sourceMaxPixels:64000000,sourceMaxDimension:16384,maxUploadBytes:25*1024*1024});
const qualities=[90,85,80];
const formats={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const abort=()=>{throw Object.assign(new Error('Photo copy cancelled'),{name:'AbortError',code:'ABORT_ERR'});};
const check=signal=>{if(signal?.aborted)abort();};
const lengthGetter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'length').get;
function copyBytes(value){let length;try{length=lengthGetter.call(value);}catch{fail('INVALID_BYTES');}if(!(value instanceof Uint8Array)||!length)fail('INVALID_BYTES');if(length>PHOTO_UPLOAD_COPY_LIMITS.sourceMaxBytes)fail('SOURCE_TOO_LARGE');const out=new Uint8Array(length);out.set(value);return out;}
function sniff(b){if(b[0]===255&&b[1]===216)return'image/jpeg';if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)return'image/png';if(String.fromCharCode(...b.subarray(0,4))==='RIFF'&&String.fromCharCode(...b.subarray(8,12))==='WEBP')return'image/webp';return null;}
export function classifyPhotoUploadSource(input={}){
 const {name='',mediaType=''}=input&&typeof input==='object'?input:{};
 const ext=typeof name==='string'?name.split('.').pop().toLowerCase():'';const mime=typeof mediaType==='string'?mediaType.toLowerCase():'';
 if(mime.startsWith('video/')||['mp4','mov','m4v','avi','mkv','webm','mts','m2ts','3gp'].includes(ext))return{state:'excluded',code:'VIDEO_EXCLUDED',reason:'Video frame extraction is outside this version'};
 if(ext==='cr3'||['image/x-canon-cr3','image/x-canon-crx'].includes(mime))return{state:'unsupported',code:'CR3_UNSUPPORTED',reason:'CR3 decoding is not supported; retain the original'};
 const inferred={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[ext];
 if(mime&&mime!=='application/octet-stream'&&!Object.values(formats).includes(mime))return{state:'unsupported',code:'FORMAT_UNSUPPORTED',reason:'Only JPEG PNG and still WebP are supported'};
 const selected=mime&&mime!=='application/octet-stream'?mime:inferred;
 if(!selected)return{state:'unsupported',code:'FORMAT_UNSUPPORTED',reason:'Only JPEG PNG and still WebP are supported'};
 return{state:'supported',mediaType:selected};
}
function geometry(info){
 if(!info||!Number.isSafeInteger(info.pixelWidth)||!Number.isSafeInteger(info.pixelHeight)||info.pixelWidth<1||info.pixelHeight<1||info.pixelWidth>PHOTO_UPLOAD_COPY_LIMITS.sourceMaxDimension||info.pixelHeight>PHOTO_UPLOAD_COPY_LIMITS.sourceMaxDimension||info.pixelWidth*info.pixelHeight>PHOTO_UPLOAD_COPY_LIMITS.sourceMaxPixels)fail('SOURCE_DIMENSIONS_EXCEEDED');
 const orientation=info.orientation??1;if(!Number.isInteger(orientation)||orientation<1||orientation>8)fail('INVALID_ORIENTATION');
 return{pixelWidth:info.pixelWidth,pixelHeight:info.pixelHeight,orientation};
}
async function awaiting(promise,signal){check(signal);if(!signal)return promise;return new Promise((resolve,reject)=>{const clean=()=>signal.removeEventListener('abort',cancel),cancel=()=>{clean();reject(Object.assign(new Error('Photo copy cancelled'),{name:'AbortError',code:'ABORT_ERR'}));};signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(v=>{clean();signal.aborted?cancel():resolve(v);},e=>{clean();reject(e);});if(signal.aborted)cancel();});}
export function createPhotoUploadCopyProcessor({inspectImage,encodeJpeg,sha256}={}){
 const configured=[inspectImage,encodeJpeg,sha256].every(v=>typeof v==='function');
 return Object.freeze({async prepare(input,{signal}={}){
  check(signal);const classification=classifyPhotoUploadSource(input);if(classification.state!=='supported')return classification;
  const warnings=[];let source,attempts=[];
  try{
   if(!configured)fail('NOT_CONFIGURED');
   const name=input.name;if(typeof name!=='string'||!name||/[\/\\\u0000-\u001f\u007f]/.test(name))fail('INVALID_NAME');
   // Copy before the first await; native adapters and callers never receive the owned source.
   const bytes=copyBytes(input.bytes);const extracted=parsePhotoMetadata(bytes,{name});
   const info=await awaiting(inspectImage(new Uint8Array(bytes),{signal}),signal);check(signal);
   if(formats[info?.format]!==classification.mediaType||sniff(bytes)!==classification.mediaType)fail('FORMAT_MISMATCH');
   if(info.animated===true||info.pages!==undefined&&info.pages!==1)fail('ANIMATION_UNSUPPORTED');
   const rawGeometry=geometry(info),swapped=rawGeometry.orientation>=5;
   const orientedGeometry={pixelWidth:swapped?rawGeometry.pixelHeight:rawGeometry.pixelWidth,pixelHeight:swapped?rawGeometry.pixelWidth:rawGeometry.pixelHeight,orientation:1};
   const {pixelWidth:w,pixelHeight:h}=orientedGeometry;const box=w>h?{width:1920,height:1080}:w<h?{width:1080,height:1920}:{width:1080,height:1080};
   const scale=Math.min(1,box.width/w,box.height/h),pixelWidth=Math.max(1,Math.round(w*scale)),pixelHeight=Math.max(1,Math.round(h*scale));
   const sourceHash=await awaiting(sha256(new Uint8Array(bytes)),signal);if(typeof sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(sourceHash))fail('INVALID_HASH');
   source={name,mediaType:classification.mediaType,byteSize:bytes.length,sha256:sourceHash,...extracted,rawGeometry,orientedGeometry};
   if(extracted.status==='invalid')warnings.push('SOURCE_METADATA_INVALID');
   if(info.hasAlpha===true)warnings.push('ALPHA_COMPOSITED_WHITE');
   for(const quality of qualities){
    check(signal);
    const encoded=await awaiting(encodeJpeg(new Uint8Array(bytes),{signal,quality,orientation:rawGeometry.orientation,pixelWidth,pixelHeight,box,fit:'inside',withoutEnlargement:true,background:'#ffffff',stripMetadata:true}),signal);check(signal);
    const output=copyBytes(encoded?.bytes??encoded);
    const outInfo=await awaiting(inspectImage(new Uint8Array(output),{signal}),signal);check(signal);
    if(sniff(output)!=='image/jpeg'||outInfo?.format!=='jpeg'||outInfo.pixelWidth!==pixelWidth||outInfo.pixelHeight!==pixelHeight||(outInfo.orientation??1)!==1||outInfo.pages!==undefined&&outInfo.pages!==1||outInfo.animated===true||outInfo.hasAlpha===true||outInfo.hasMetadata===true)fail('INVALID_ENCODED_COPY');
    attempts.push({quality,byteSize:output.length,withinLimit:output.length<=PHOTO_UPLOAD_COPY_LIMITS.maxUploadBytes});
    if(output.length>PHOTO_UPLOAD_COPY_LIMITS.maxUploadBytes)continue;
    const digest=await awaiting(sha256(new Uint8Array(output)),signal);check(signal);if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))fail('INVALID_HASH');
    if(quality!==90)warnings.push('JPEG_QUALITY_REDUCED');
    return{state:'ready',source,uploadCopy:{bytes:output,mediaType:'image/jpeg',pixelWidth,pixelHeight,orientation:1,byteSize:output.length,sha256:digest,derivedFrom:sourceHash,quality,attempts},warnings,needsReview:warnings.length>0};
   }
   fail('UPLOAD_COPY_TOO_LARGE');
  }catch(error){if(signal?.aborted||error?.name==='AbortError')abort();const codes=['NOT_CONFIGURED','INVALID_NAME','INVALID_BYTES','SOURCE_TOO_LARGE','FORMAT_MISMATCH','ANIMATION_UNSUPPORTED','SOURCE_DIMENSIONS_EXCEEDED','INVALID_ORIENTATION','INVALID_HASH','INVALID_ENCODED_COPY','UPLOAD_COPY_TOO_LARGE'];return{state:error?.code==='ANIMATION_UNSUPPORTED'?'unsupported':'failed',code:codes.includes(error?.code)?error.code:'PROCESSING_FAILED',reason:'Upload copy was not prepared; retain the original',...(source?{source}:{}),attempts,warnings,needsReview:true};}
 }});
}
