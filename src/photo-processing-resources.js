// One native image operation at a time across preview and upload processors.
// Abort/timeout cannot cancel browser codecs or Blob reads. Keep the slot until
// their actual promises settle, including the late-bitmap cleanup callback.
let occupied=false;
export function claimPhotoProcessing() {
  if(occupied)return null;
  occupied=true;let released=false;const tasks=new Set();
  const finish=()=>{if(released&&!tasks.size)occupied=false;};
  return {track(promise){const task=Promise.resolve(promise);tasks.add(task);
    const done=()=>{tasks.delete(task);finish();};task.then(done,done);return task;},
    release(){released=true;finish();}};
}

// The strict JPEG parser strips all APP blocks for exported derivatives. Keep
// only ICC APP2 blocks for *decoding* so color conversion precedes metadata
// stripping. EXIF is still absent and orientation is applied exactly once.
export function photoDecodeParts(bytes,mediaType,info) {
  if(mediaType!=='image/jpeg')return info.parts;
  const profiles=[];let p=2,scan=false;
  while(p<bytes.length){
    if(scan)while(p<bytes.length&&bytes[p]!==255)p++;
    const begin=p++;while(bytes[p]===255)p++;const marker=bytes[p++];
    if(scan&&(marker===0||marker>=208&&marker<=215))continue;
    scan=false;if(marker===217)break;
    const n=(bytes[p]<<8)|bytes[p+1];
    if(marker===226&&n>=16&&String.fromCharCode(...bytes.subarray(p+2,p+14))==='ICC_PROFILE\0')profiles.push(bytes.subarray(begin,p+n));
    p+=n;if(marker===218)scan=true;
  }
  return [info.parts[0],...profiles,...info.parts.slice(1)];
}
