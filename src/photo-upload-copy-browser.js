import {claimPhotoProcessing,photoDecodeParts} from './photo-processing-resources.js';
import {classifyPhotoUploadSource} from './photo-upload-copy.js';
import {parsePhotoMetadata} from './photo-metadata.js';
import {PHOTO_ASSET_LIMITS, inspectPhotoFormat, inspectPhotoPng, inspectPhotoJpeg,
  inspectPhotoWebp, checkedPhotoOrientation, photoOrientationMatrices, awaitPhotoProcessing} from './photo-asset-processing.js';

// Detect metadata in every JPEG segment, including segments between scans.
// Only a JFIF APP0 is allowed on the freshly encoded JPEG.
function jpegHasMetadata(bytes) {
  let p=2, scan=false;
  while (p<bytes.length) {
    if (scan) { while (p<bytes.length && bytes[p]!==255) p++; }
    if (bytes[p++]!==255) throw Error('INVALID_JPEG');
    while (bytes[p]===255) p++;
    const marker=bytes[p++];
    if (scan && (marker===0 || marker>=208 && marker<=215)) continue;
    scan=false;
    if (marker===217) return false;
    if (p+2>bytes.length) throw Error('INVALID_JPEG');
    const n=(bytes[p]<<8)|bytes[p+1];
    if (n<2 || p+n>bytes.length) throw Error('INVALID_JPEG');
    if (marker===254 || marker>=225 && marker<=239) return true;
    if (marker===224 && (n<7 || String.fromCharCode(...bytes.subarray(p+2,p+7))!=='JFIF\0')) return true;
    p+=n;
    if (marker===218) scan=true;
  }
  throw Error('INVALID_JPEG');
}

function header(bytes) {
  const mediaType=inspectPhotoFormat(bytes);
  const parsed=parsePhotoMetadata(bytes);
  if (parsed.status==='invalid') throw Error('INVALID_METADATA');
  const info=mediaType==='image/jpeg'?inspectPhotoJpeg(bytes):mediaType==='image/png'?inspectPhotoPng(bytes):inspectPhotoWebp(bytes);
  const orientation=checkedPhotoOrientation(info.exif,parsed);
  return {mediaType,info,orientation};
}

/** Bounded browser-only conversion. No original is uploaded or persisted.
 * 64 MiB compressed input; 24 MP / 8192 px decode guard; FHD output only.
 * Resize options bound the returned bitmap, not decoder-internal peak memory.
 */
export const BROWSER_PHOTO_SOURCE_LIMITS=Object.freeze({maxBytes:64*1024*1024,maxPixels:24000000,maxDimension:8192});
const failure=(code,reason)=>({state:'failed',code,reason,needsReview:true});
const retain='원본을 유지하고 기존 로컬 변환 도구로 FHD 사본을 만든 뒤 선택해 주세요.';
const cancelled=()=>{throw Object.assign(Error('Photo copy cancelled'),{name:'AbortError',code:'ABORT_ERR'});};
export function createBrowserPhotoUploadCopyProcessor() {
  return Object.freeze({async prepare(file,{signal,name}={}) {
    if(signal?.aborted)cancelled();
    if (!(file instanceof Blob) || name!==undefined && typeof name!=='string'
        || typeof file.name==='string' && name!==undefined && file.name!==name)
      return failure('INVALID_INPUT','사진 파일을 확인해 주세요.');
    const sourceName=name??file.name;
    if(typeof sourceName!=='string'||!sourceName||/[\/\\\u0000-\u001f\u007f]/.test(sourceName))return failure('INVALID_INPUT','사진 이름을 확인해 주세요.');
    const classification=classifyPhotoUploadSource({name:sourceName,mediaType:file.type});
    if(classification.state!=='supported')return classification;
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>BROWSER_PHOTO_SOURCE_LIMITS.maxBytes)
      return failure('SOURCE_TOO_LARGE','브라우저 입력은 64MiB까지 지원합니다. '+retain);
    if(typeof createImageBitmap!=='function'||!globalThis.crypto?.subtle||!globalThis.document?.createElement)
      return failure('ENVIRONMENT_UNAVAILABLE','이미지 변환을 지원하는 브라우저가 필요합니다.');
    const slot=claimPhotoProcessing();if(!slot)return failure('PROCESSING_BUSY','다른 사진 처리가 끝난 뒤 다시 시도해 주세요.');
    const wait=(promise,options)=>awaitPhotoProcessing(slot.track(promise),signal,options);
    const hash=async bytes=>Array.from(new Uint8Array(await wait(crypto.subtle.digest('SHA-256',bytes))),b=>b.toString(16).padStart(2,'0')).join('');
    let bitmap,canvas;
    try {
      // One owned source buffer: the generic native adapter defensively clones
      // at every port boundary and is deliberately not used for large Blobs.
      const bytes=new Uint8Array(await wait(Blob.prototype.arrayBuffer.call(file)));
      if(bytes.length!==file.size)return failure('INVALID_BYTES','사진 크기가 일치하지 않습니다.');
      const {mediaType,info,orientation}=header(bytes);
      if(mediaType!==classification.mediaType)return failure('FORMAT_MISMATCH','사진 형식과 내용이 다릅니다.');
      const parsed=parsePhotoMetadata(bytes,{name:sourceName});
      const w=orientation>=5?info.height:info.width,h=orientation>=5?info.width:info.height;
      const box=w>h?{width:1920,height:1080}:w<h?{width:1080,height:1920}:{width:1080,height:1080};
      const scale=Math.min(1,box.width/w,box.height/h),pixelWidth=Math.max(1,Math.round(w*scale)),pixelHeight=Math.max(1,Math.round(h*scale));
      const sha256=await hash(bytes);
      const source={name:sourceName,mediaType,byteSize:bytes.length,sha256,...parsed,
        rawGeometry:{pixelWidth:info.width,pixelHeight:info.height,orientation},
        orientedGeometry:{pixelWidth:w,pixelHeight:h,orientation:1}};
      const rw=orientation>=5?pixelHeight:pixelWidth,rh=orientation>=5?pixelWidth:pixelHeight;
      bitmap=await wait(createImageBitmap(new Blob(photoDecodeParts(bytes,mediaType,info),{type:mediaType}),
        {imageOrientation:'none',colorSpaceConversion:'default',resizeWidth:rw,resizeHeight:rh,resizeQuality:'high'}),{late:b=>b?.close()});
      if(bitmap.width!==rw||bitmap.height!==rh)throw Error('DIMENSION_MISMATCH');
      canvas=document.createElement('canvas');canvas.width=pixelWidth;canvas.height=pixelHeight;
      const ctx=canvas.getContext('2d',{colorSpace:'srgb'});if(!ctx)throw Error('CANVAS_UNAVAILABLE');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,pixelWidth,pixelHeight);
      ctx.transform(...photoOrientationMatrices(rw,rh)[orientation]);ctx.drawImage(bitmap,0,0);
      bitmap.close();bitmap=null;
      const attempts=[];
      for(const quality of [90,85,80]) {
        const blob=await wait(new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality/100)));
        if(!blob||blob.type!=='image/jpeg')throw Error('ENCODING_FAILED');
        if(blob.size>PHOTO_ASSET_LIMITS.maxBytes){attempts.push({quality,byteSize:blob.size,withinLimit:false});continue;}
        const encoded=new Uint8Array(await wait(blob.arrayBuffer()));
        const stripped=inspectPhotoJpeg(encoded);
        const output=new Uint8Array(await wait(new Blob(stripped.parts,{type:'image/jpeg'}).arrayBuffer()));
        const checked=header(output);
        if(checked.mediaType!=='image/jpeg'||checked.info.width!==pixelWidth||checked.info.height!==pixelHeight||checked.orientation!==1||jpegHasMetadata(output))throw Error('INVALID_ENCODED_COPY');
        attempts.push({quality,byteSize:output.length,withinLimit:true});
        const warnings=mediaType==='image/jpeg'?[]:['ALPHA_COMPOSITED_WHITE'];
        if(quality!==90)warnings.push('JPEG_QUALITY_REDUCED');
        return {state:'ready',source,uploadCopy:{bytes:output,mediaType:'image/jpeg',pixelWidth,pixelHeight,orientation:1,byteSize:output.length,sha256:await hash(output),derivedFrom:sha256,quality,attempts},warnings,needsReview:!!warnings.length};
      }
      return failure('UPLOAD_COPY_TOO_LARGE','FHD 사본 용량이 25MiB를 초과했습니다. '+retain);
    } catch(error) {
      if(signal?.aborted||error?.code==='ABORTED'||error?.name==='AbortError')cancelled();
      if(error?.code==='EXCESSIVE_IMAGE')return failure('SOURCE_DIMENSIONS_EXCEEDED','브라우저는 24MP·한 변 8192px까지 지원합니다. '+retain);
      if(error?.code==='UNSUPPORTED_ANIMATION')return {state:'unsupported',code:'ANIMATION_UNSUPPORTED',reason:'정지 JPEG·PNG·WebP만 지원합니다.',needsReview:true};
      return failure(error?.code==='PROCESSING_TIMEOUT'?'PROCESSING_TIMEOUT':'PROCESSING_FAILED','사진 사본을 준비하지 못했습니다. '+retain);
    } finally {bitmap?.close();if(canvas){canvas.width=0;canvas.height=0;}slot.release();}
  }});
}
