import {catalogError,PHOTO_METADATA_FIELDS,normalizePhotoMetadataSources} from './catalog-repository.js';
import {PHOTO_ROUTE_LIMITS} from './photo-registration-preflight.js';
const PATH='/functions/v1/theater3d-catalog-registration';
const roles=['original','display','thumbnail'];
const contextKeys=['venueId','layoutVersionId','seatId','productionRunId','performanceEventId'];
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(v)&&!['constructor','prototype','__proto__','.','..'].includes(v);
const fail=(code='BAD_REQUEST',status=0)=>{throw catalogError(code,'Registration request rejected',status);};
const cancelled=(error,signal)=>{let name;try{name=error?.name;}catch{}return signal?.aborted===true||name==='AbortError';};
const abort=()=>Object.assign(new Error('Registration request cancelled'),{name:'AbortError',code:'ABORT_ERR'});
function signalCheck(signal){if(signal===undefined)return;try{if(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function')fail();if(signal.aborted)throw abort();}catch(e){if(e?.name==='AbortError')throw abort();fail();}}
function plain(value){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();const out={};for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)fail();out[key]=d.value;}return out;}
function jsonCopy(value,depth=0,seen=new Set()){
 if(depth>32)fail();if(value===null||typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number'){if(!Number.isFinite(value))fail();return value;}
 if(seen.has(value))fail();seen.add(value);let result;
 if(Array.isArray(value)){if(value.length>10000||Reflect.ownKeys(value).length!==value.length+1)fail();result=[];for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))fail();result.push(jsonCopy(d.value,depth+1,seen));}}
 else{result={};for(const[key,v]of Object.entries(plain(value)))result[key]=jsonCopy(v,depth+1,seen);}
 seen.delete(value);return result;
}
const exact=(value,keys)=>Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
export function parseCatalogRegistrationResponse(raw,{method,operationId}={}){
 if(!['GET','POST'].includes(method)||!id(operationId))fail();
 try{
  const root=jsonCopy(raw);if(!exact(root,method==='POST'?['contractVersion','item','reused']:['contractVersion','item'])||root.contractVersion!==1)fail();
  const item=plain(root.item);if(item.operationId!==operationId)fail();
  if(method==='GET'&&exact(item,['operationId','status'])&&['pending','uploading','verifying','failed'].includes(item.status))return{state:item.status,operationId};
  if(!exact(item,['operationId','photoId','storageStatus','publicationStatus','assetIds'])||!id(item.photoId)||item.storageStatus!=='ready'||item.publicationStatus!=='private'||method==='POST'&&typeof root.reused!=='boolean')fail();
  const assets=plain(item.assetIds);if(!exact(assets,roles)||roles.some(role=>!id(assets[role]))||new Set(Object.values(assets)).size!==3)fail();
  return{state:'ready',operationId,photoId:item.photoId,storageStatus:'ready',publicationStatus:'private',assetIds:assets,reused:method==='POST'?root.reused:null};
 }catch{fail('INVALID_RESPONSE');}
}
async function cancellable(promise,signal){signalCheck(signal);if(!signal)return promise;return new Promise((resolve,reject)=>{const clean=()=>signal.removeEventListener('abort',cancel),cancel=()=>{clean();reject(abort());};signal.addEventListener('abort',cancel,{once:true});Promise.resolve(promise).then(v=>{clean();signal.aborted?reject(abort()):resolve(v);},e=>{clean();reject(signal.aborted?abort():e);});if(signal.aborted)cancel();});}
function capture(operation){
 const input=plain(operation),allowed=['synthetic','operationId','context','metadata','metadataSources','originalFilename',...roles];if(Object.keys(input).some(k=>!allowed.includes(k))||input.synthetic!==true||!id(input.operationId))fail();
 const context=jsonCopy(input.context);if(!exact(context,contextKeys)||contextKeys.some(k=>context[k]!==null&&!id(context[k])))fail();
 if(context.seatId!==null&&(context.venueId===null||context.layoutVersionId===null)||context.layoutVersionId!==null&&context.venueId===null||context.performanceEventId!==null&&context.productionRunId===null)fail();
 const metadata=jsonCopy(input.metadata);plain(metadata);if(Object.keys(metadata).some(k=>!PHOTO_METADATA_FIELDS.includes(k)||metadata[k]!==null&&!['number','string'].includes(typeof metadata[k]))||JSON.stringify(metadata).length>16384)fail();
 const sources=input.metadataSources===undefined?undefined:normalizePhotoMetadataSources(metadata,jsonCopy(input.metadataSources));
 const name=input.originalFilename;if(typeof name!=='string'||!name||name.length>255||['.','..'].includes(name)||/[/\\\u0000-\u001f\u007f]/.test(name))fail();
 const blobs={};for(const role of roles){const b=input[role];if(typeof Blob==='undefined'||!(b instanceof Blob))fail();const size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(b);if(size<1||size>PHOTO_ROUTE_LIMITS.ts.maxBytes)fail();blobs[role]=b;}
 return{operationId:input.operationId,request:{synthetic:true,operationId:input.operationId,context,metadata,...(sources===undefined?{}:{metadataSources:sources}),originalFilename:name},blobs};
}
export function createCatalogRegistrationClient({request}={}){
 const configured=typeof request==='function';
 async function execute(method,path,body,signal,operationId){
  if(!configured)fail('NOT_CONFIGURED');signalCheck(signal);let response;
  try{response=await cancellable(Promise.resolve().then(()=>{signalCheck(signal);return request({method,path,body,signal});}),signal);}catch(e){if(cancelled(e,signal))throw abort();fail('NETWORK_ERROR');}
  signalCheck(signal);let status,ok,readJson;
  try{
   if(typeof Response!=='undefined'&&response instanceof Response){status=Object.getOwnPropertyDescriptor(Response.prototype,'status').get.call(response);ok=Object.getOwnPropertyDescriptor(Response.prototype,'ok').get.call(response);readJson=()=>Response.prototype.json.call(response);}
   else{const fields=plain(response);status=fields.status;ok=fields.ok;if(typeof fields.json!=='function')fail();readJson=()=>fields.json.call(response);}
   if(!Number.isInteger(status)||status<100||status>599||typeof ok!=='boolean'||ok!==(status>=200&&status<300))fail();
  }catch{fail('INVALID_RESPONSE');}
  if(!ok){const fixed={401:'ACCESS_DENIED',403:'ACCESS_DENIED',404:'NOT_FOUND'};if(fixed[status])fail(fixed[status],status);let code={400:'BAD_REQUEST',409:'OPERATION_CONFLICT',413:'ASSET_TOO_LARGE',429:'SERVICE_UNAVAILABLE',500:'SERVICE_UNAVAILABLE',503:'SERVICE_UNAVAILABLE'}[status]??'HTTP_ERROR';
   const byStatus={400:['BAD_REQUEST','INVALID_PNG','INVALID_IMAGE','IMAGE_DECODE_INVALID','ASPECT_MISMATCH','DERIVATIVE_METADATA'],409:['OPERATION_CONFLICT','CONTEXT_MISMATCH','IDEMPOTENCY_CONFLICT','REVISION_MISMATCH'],413:['ASSET_TOO_LARGE'],503:['NOT_CONFIGURED','IMAGE_DECODER_NOT_CONFIGURED','IMAGE_DECODE_FAILED','SERVICE_UNAVAILABLE','ASSET_INTEGRITY','REGISTRATION_INCOMPLETE']};
   try{const raw=plain(await cancellable(readJson(),signal));if(byStatus[status]?.includes(raw.code))code=raw.code;}catch(e){if(cancelled(e,signal))throw abort();}fail(code,status);
  }
  if(status!==200)fail('INVALID_RESPONSE');let raw;try{raw=await cancellable(readJson(),signal);}catch(e){if(cancelled(e,signal))throw abort();fail('INVALID_RESPONSE');}signalCheck(signal);return parseCatalogRegistrationResponse(raw,{method,operationId});
 }
 return Object.freeze({
  getConnectionState:()=>configured?{state:'configured'}:{state:'unconfigured',code:'NOT_CONFIGURED'},
  async getRegistration(operationId,{signal}={}){if(!configured)fail('NOT_CONFIGURED');signalCheck(signal);if(!id(operationId))fail();return execute('GET',PATH+'/'+encodeURIComponent(operationId),undefined,signal,operationId);},
  async registerPhoto(operation,{signal}={}){if(!configured)fail('NOT_CONFIGURED');signalCheck(signal);let fixed;try{fixed=capture(operation);}catch{fail();}const body=new FormData();body.append('request',JSON.stringify(fixed.request));for(const role of roles)body.append(role,fixed.blobs[role],role==='original'?fixed.request.originalFilename:role+'.png');return execute('POST',PATH,body,signal,fixed.operationId);},
 });
}
