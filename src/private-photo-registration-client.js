/** Concrete private registration transport. All I/O requires explicit enable,
 * project configuration, a live session and an injected fetch implementation.
 * No token/operation persistence, automatic retries or image modification.
 */
import {assessRegistrationSnapshot} from './local-photo-registration.js';
import {PRIVATE_PHOTO_REGISTRATION_PROTOCOL as PROTOCOL,PRIVATE_PHOTO_REGISTRATION_ENDPOINT as PATH,
 PRIVATE_PHOTO_REGISTRATION_ACTIONS as ACTIONS,copyPrivatePhotoRegistrationManifest,copyPrivatePhotoRegistrationPayload,
 canonicalPrivatePhotoRegistrationJSON,parsePrivatePhotoRegistrationResult} from './private-photo-registration-contract.js';
const PROJECT='portfolio-demo-disabled',ORIGIN=`https://${PROJECT}.supabase.co`,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ROLES=['original','display','thumbnail'],NULL_CONTEXT=Object.freeze({venueId:null,layoutEditionId:null,seatId:null,postId:null});
const SAFE=new Set(['BAD_REQUEST','INPUT_INVALID','INVALID_CONFIGURATION','UNCONFIGURED','DISPOSED','SESSION_REQUIRED','SESSION_CHANGED','SESSION_EXPIRED','ACCESS_DENIED','PROJECT_MISMATCH','ABORTED','TIMEOUT','CONTENT_CHANGED','BUSY','UNSUPPORTED_LOCAL_ID','CONTEXT_UNRESOLVED_ONLY','NOT_READY','LIMIT_EXCEEDED','ASSET_INTEGRITY','IMAGE_INTEGRITY','INVALID_RESPONSE','REQUEST_FAILED','OUTCOME_UNKNOWN','RECHECK_REQUIRED','NOT_FOUND','POLICY_UNCONFIGURED','OPERATION_CONFLICT','IDEMPOTENCY_CONFLICT','CONTRACT_REJECTED','SOURCE_BACKUP_REQUIRED','STORAGE_UNAVAILABLE','CONFLICT','REVISION_CONFLICT','STORAGE_REJECTED','POLICY_CHANGED']);
const fail=code=>{throw Object.assign(Error('Private photo registration rejected'),{code});};
const failed=(code,uncertain=false)=>Object.freeze({ok:false,confirmed:false,code,uncertain});
function plain(v,keys,required=keys){if(!v||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('BAD_REQUEST');const out={};
 for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||keys&&!keys.includes(k)||!d?.enumerable||!Object.hasOwn(d,'value'))fail('BAD_REQUEST');out[k]=d.value;}
 if(required?.some(k=>!Object.hasOwn(out,k)))fail('BAD_REQUEST');return out;}
const same=(a,b)=>a===b||a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
const blobSize=b=>{try{return Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(b);}catch{fail('BAD_REQUEST');}};
function capture(raw,context,browserSource=false){
 const value=plain(raw,['photo','assets']),photo=plain(value.photo),assets=plain(value.assets,ROLES);
 if(photo.processingStatus!=='ready'||photo.metadataStatus==='loading')fail('NOT_READY');
 const copied={},blobs={};
 for(const role of ROLES){const a=plain(assets[role],['role','blob','sha256','mediaType','byteSize','pixelWidth','pixelHeight','orientation','exifPolicy',...(role==='original'?[]:['transformSpec'])]);
  if(a.role!==role||!(a.blob instanceof Blob)||blobSize(a.blob)!==a.byteSize)fail('ASSET_INTEGRITY');blobs[role]=a.blob;const{blob,...descriptor}=a;copied[role]=descriptor;}
 if(copied.original.exifPolicy!=='preserved'||photo.size!==copied.original.byteSize)fail('ASSET_INTEGRITY');
 const assessment=assessRegistrationSnapshot({target:browserSource?'browser-fhd':'ts',photo:{size:photo.size,processingStatus:photo.processingStatus},assets:copied});
 if(!assessment.canSubmit)fail('LIMIT_EXCEEDED');
 const snapshot={metadata:photo.metadata,seatContext:photo.seatContext,derivatives:{display:copied.display,thumbnail:copied.thumbnail}};
 if(Object.hasOwn(photo,'metadataSources'))snapshot.metadataSources=photo.metadataSources;
 const o=copied.original,manifest=copyPrivatePhotoRegistrationManifest({operationId:photo.id,
  original:{originalFilename:photo.name,mediaType:o.mediaType,byteSize:o.byteSize,sha256:o.sha256,pixelWidth:o.pixelWidth,pixelHeight:o.pixelHeight,orientation:o.orientation},
  context:context??NULL_CONTEXT,registrationSnapshot:snapshot},{browserSource});
 return{manifest,manifestJSON:canonicalPrivatePhotoRegistrationJSON(manifest),blobs};
}
async function defaultHash(bytes){const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function createPrivatePhotoRegistrationClient(options={}){
 const flag=options&&Object.getOwnPropertyDescriptor(options,'enabled');if(flag&&!Object.hasOwn(flag,'value'))fail('BAD_REQUEST');
 if(flag?.value===undefined||flag.value===false){const no=async()=>failed('UNCONFIGURED');return Object.freeze({register:no,retry:no,recheck:no,
  getState:()=>Object.freeze({configured:false,authenticated:false,disposed:false,operations:[],pending:0}),subscribe:()=>()=>{},dispose(){}});}
 if(flag.value!==true)fail('BAD_REQUEST');
 const c=plain(options,['enabled','config','fetchImpl','sessionPort','clock','sha256','requestTimeoutMs','uploadCopyProcessor'],['enabled','config','fetchImpl','sessionPort']);
 const config=plain(c.config,['projectRef','supabaseUrl','publishableKey']),port=plain(c.sessionPort,['getSession','getAccessToken','subscribeSession']);
 if(config.projectRef!==PROJECT||config.supabaseUrl!==ORIGIN||typeof config.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(config.publishableKey)||typeof c.fetchImpl!=='function'||Object.values(port).some(fn=>typeof fn!=='function'))fail('BAD_REQUEST');
 const clock=c.clock??Date.now,hash=c.sha256??defaultHash,timeout=c.requestTimeoutMs??60000;
 if(typeof clock!=='function'||typeof hash!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>120000||c.uploadCopyProcessor!==undefined&&typeof c.uploadCopyProcessor?.prepare!=='function')fail('BAD_REQUEST');
 // Detached invocation also supports native browser fetch without an illegal receiver.
 const fetchImpl=c.fetchImpl;
 const operations=new Map(),listeners=new Set(),active=new Set(),denied=new Map();let disposed=false,current=null,generation=0,sequence=0;
 function notify(){for(const fn of listeners)try{fn();}catch{}}
 function session(){if(disposed)return null;let next=null;try{const raw=port.getSession.call(c.sessionPort),now=clock();
  if(raw!==null){const s=plain(raw,['projectRef','accountId','epoch','expiresAt']);if(s.projectRef===PROJECT&&typeof s.accountId==='string'&&UUID.test(s.accountId)&&Number.isSafeInteger(s.epoch)&&s.epoch>=0&&Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(s.expiresAt)&&s.expiresAt>now&&s.epoch>(denied.get(s.accountId)??-1))next=s;}}
  catch{}if(!same(next,current)){current=next;generation++;operations.clear();for(const run of active)run.abort.abort();active.clear();notify();}return current?{...current}:null;}
 const off=port.subscribeSession.call(c.sessionPort,session);if(typeof off!=='function')fail('BAD_REQUEST');session();
 function begin(signal){const s=session();if(!s)fail(disposed?'DISPOSED':'SESSION_REQUIRED');if(signal!==undefined&&!(signal instanceof AbortSignal))fail('BAD_REQUEST');if(signal?.aborted)fail('ABORTED');
  const abort=new AbortController(),onAbort=()=>abort.abort(),run={s,abort,generation,timedOut:false,dispatched:false,definitive:false};signal?.addEventListener('abort',onAbort,{once:true});active.add(run);
  const timer=setTimeout(()=>{run.timedOut=true;abort.abort();},timeout);run.close=()=>{clearTimeout(timer);active.delete(run);signal?.removeEventListener('abort',onAbort);};return run;}
 function guard(run){if(disposed)fail('DISPOSED');if(run.generation!==generation||!same(run.s,session()))fail('SESSION_CHANGED');if(run.abort.signal.aborted)fail(run.timedOut?'TIMEOUT':'ABORTED');}
 async function step(run,fn){guard(run);let onAbort;const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(Object.assign(Error('Private photo registration rejected'),{code:run.timedOut?'TIMEOUT':'ABORTED'}));run.abort.signal.addEventListener('abort',onAbort,{once:true});});
  const task=Promise.resolve().then(()=>{guard(run);return fn();});task.catch(()=>{});try{const value=await Promise.race([task,cancelled]);guard(run);return value;}finally{run.abort.signal.removeEventListener('abort',onAbort);}}
 async function digest(run,bytes){const value=await step(run,()=>hash(bytes));if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))fail('ASSET_INTEGRITY');return value;}
 async function prepared(entry,run){if(entry.payload)return;
  for(const role of ROLES){if(c.uploadCopyProcessor&&role==='original')continue;const descriptor=role==='original'?entry.manifest.original:entry.manifest.registrationSnapshot.derivatives[role],blob=entry.blobs[role];
   const bytes=new Uint8Array(await step(run,()=>Blob.prototype.arrayBuffer.call(blob)));if(bytes.byteLength!==descriptor.byteSize||await digest(run,bytes)!==descriptor.sha256)fail('ASSET_INTEGRITY');}
  if(c.uploadCopyProcessor){entry.legacyFingerprint=await digest(run,new TextEncoder().encode(entry.manifestJSON));const result=await step(run,()=>c.uploadCopyProcessor.prepare(entry.blobs.original,{signal:run.abort.signal,name:entry.manifest.original.originalFilename}));
   if(result?.state!=='ready'||!(result.uploadCopy?.bytes instanceof Uint8Array))fail('IMAGE_INTEGRITY');
   const source=result.source,original=entry.manifest.original,copy=result.uploadCopy;
   if(source?.sha256!==original.sha256||source.byteSize!==original.byteSize||source.mediaType!==original.mediaType||source.rawGeometry?.pixelWidth!==original.pixelWidth||source.rawGeometry?.pixelHeight!==original.pixelHeight||source.rawGeometry?.orientation!==(original.orientation??1))fail('ASSET_INTEGRITY');
   const bytes=new Uint8Array(copy.bytes);if(bytes.length!==copy.byteSize||await digest(run,bytes)!==copy.sha256)fail('ASSET_INTEGRITY');
   const uploadCopy=Object.fromEntries(['sha256','byteSize','mediaType','pixelWidth','pixelHeight','orientation'].map(k=>[k,copy[k]]));
   entry.manifest=copyPrivatePhotoRegistrationManifest({...entry.manifest,storageMode:'browser-fhd',uploadCopy});entry.uploadBlob=new Blob([bytes],{type:'image/jpeg'});
  }
  const requestFingerprint=await digest(run,new TextEncoder().encode(canonicalPrivatePhotoRegistrationJSON(entry.manifest)));entry.payload=copyPrivatePhotoRegistrationPayload({...entry.manifest,requestFingerprint});
 }
 async function readJSON(response,run){if(response.headers?.get('Content-Type')?.split(';')[0].trim()!=='application/json')fail('INVALID_RESPONSE');const length=response.headers.get('Content-Length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>256*1024))fail('INVALID_RESPONSE');const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE');
  let size=0,done=false;const chunks=[];try{for(;;){const part=await step(run,()=>reader.read());if(part.done){done=true;break;}if(!(part.value instanceof Uint8Array)||(size+=part.value.byteLength)>256*1024)fail('LIMIT_EXCEEDED');chunks.push(new Uint8Array(part.value));}}
  finally{if(!done)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
  // Fetch exposes decoded Response bytes, but Content-Length may describe compressed wire bytes.
  // Keep strict length for non-Response adapters; the decoded streaming cap above remains mandatory.
  if(!(response instanceof Response)&&length!==null&&Number(length)!==size)fail('INVALID_RESPONSE');const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_RESPONSE');}}
 async function send(entry,run,action){guard(run);if(++sequence>Number.MAX_SAFE_INTEGER)fail('REQUEST_FAILED');let token=null;
  try{token=port.getAccessToken.call(c.sessionPort);guard(run);if(typeof token!=='string'||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail('SESSION_REQUIRED');
   const request={protocol:PROTOCOL,projectRef:PROJECT,accountId:run.s.accountId,epoch:run.s.epoch,requestId:`private-photo-registration-request:${sequence}`,action,payload:action===ACTIONS.register?entry.payload:{operationId:entry.manifest.operationId}};
   let body,headers={apikey:config.publishableKey,Authorization:`Bearer ${token}`};if(action===ACTIONS.register){body=new FormData();body.append('request',JSON.stringify(request));if(entry.uploadBlob)body.append('fhd',entry.uploadBlob,'upload.jpg');else body.append('original',entry.blobs.original,entry.manifest.original.originalFilename);}
   else{headers['Content-Type']='application/json';body=JSON.stringify(request);}
   const response=await step(run,()=>{if(action===ACTIONS.register)run.dispatched=true;return fetchImpl(ORIGIN+PATH,{method:'POST',headers,body,signal:run.abort.signal,credentials:'omit',cache:'no-store',redirect:'error'});});
   if(!response||response.redirected||response.url&&response.url!==ORIGIN+PATH)fail('INVALID_RESPONSE');
   if(response.status===401||response.status===403){denied.set(run.s.accountId,Math.max(run.s.epoch,denied.get(run.s.accountId)??-1));session();fail('ACCESS_DENIED');}
   const raw=await readJSON(response,run);guard(run);
   if(raw?.ok===false){let error;try{error=plain(raw,['ok','code','message']);if(error.message!=='Private photo registration rejected')fail('INVALID_RESPONSE');}catch{fail('INVALID_RESPONSE');}
    const code=SAFE.has(error.code)?error.code:'REQUEST_FAILED';if([400,403,404,409,413,422].includes(response.status)&&code!=='REQUEST_FAILED')run.definitive=true;fail(code);}
   const envelope=plain(raw,['protocol','projectRef','accountId','epoch','requestId','action','kind','source','ok','result']);
   if(response.status!==200||envelope.ok!==true||envelope.kind!=='configured-private'||envelope.source!=='private-provider'||['protocol','projectRef','accountId','epoch','requestId','action'].some(k=>envelope[k]!==request[k]))fail('INVALID_RESPONSE');
   const legacyStatus=action===ACTIONS.status&&entry.legacyFingerprint&&envelope.result?.storageMode!=='browser-fhd';
   const result=parsePrivatePhotoRegistrationResult(envelope.result,{operationId:entry.manifest.operationId,requestFingerprint:legacyStatus?entry.legacyFingerprint:entry.payload.requestFingerprint});
   entry.legacyStatus=!!legacyStatus&&result.status!=='absent';
   if(action===ACTIONS.register&&result.status!=='ready')fail('INVALID_RESPONSE');guard(run);return result;
  }finally{token=null;}}
 function state(){const authenticated=!!session();return Object.freeze({configured:true,authenticated,disposed,pending:active.size,operations:Object.freeze(authenticated?[...operations.values()].map(e=>Object.freeze({localPhotoId:e.manifest.operationId,status:e.status,uncertain:e.uncertain,code:e.code})):[])});}
 function deliver(entry,run,result){guard(run);entry.status=result.status==='ready'?'ready':result.status;entry.uncertain=result.status==='pending';entry.code=null;notify();guard(run);
  if(result.status!=='ready')return Object.freeze({ok:true,confirmed:false,operationId:result.operationId,status:result.status,code:result.status==='absent'?'NOT_FOUND':null,uncertain:result.status==='pending'});
  return Object.freeze({ok:true,confirmed:true,operationId:result.operationId,photoId:result.photoId,photoRevision:result.photoRevision,sourceRefId:result.sourceRefId,assetId:result.assetId,assetRevision:result.assetRevision,replayed:result.replayed,contextStatus:entry.manifest.context.seatId===null?'unresolved':'resolved'});}
 function perform(mode,captured,options={}){let input,entry,run;
  try{const requestedSession=session();if(!requestedSession)fail(disposed?'DISPOSED':'SESSION_REQUIRED');const opts=plain(options,['context','signal'],[]);input=capture(captured,opts.context,!!c.uploadCopyProcessor);entry=operations.get(input.manifest.operationId);
   if(entry&&entry.manifestJSON!==input.manifestJSON)fail('CONTENT_CHANGED');if(entry?.active)return entry.active;
   if(mode==='register'&&entry?.status==='unknown')return Promise.resolve(failed('RECHECK_REQUIRED',true));
   if(!entry){if(operations.size>=100)fail('LIMIT_EXCEEDED');entry={...input,payload:null,status:'idle',code:null,uncertain:false,active:null};operations.set(input.manifest.operationId,entry);}
   run=begin(opts.signal);if(!same(requestedSession,run.s))fail('SESSION_CHANGED');
  }catch(e){run?.close();return Promise.resolve(failed(SAFE.has(e?.code)?e.code:'BAD_REQUEST'));}
  const work=Promise.resolve().then(async()=>{try{entry.status='checking';entry.code=null;notify();guard(run);await prepared(entry,run);const existing=await send(entry,run,ACTIONS.status);
    entry.uncertain=existing.status==='pending';
    if(existing.status==='ready'||mode==='recheck')return deliver(entry,run,existing);
    if(existing.status==='pending'&&(mode!=='retry'||entry.legacyStatus))return deliver(entry,run,existing);
    entry.status='uploading';notify();guard(run);return deliver(entry,run,await send(entry,run,ACTIONS.register));
   }catch(e){const uncertain=entry.uncertain||run.dispatched&&!run.definitive;let code=uncertain?'OUTCOME_UNKNOWN':SAFE.has(e?.code)?e.code:'REQUEST_FAILED';
    if(!disposed&&run.generation===generation&&same(run.s,session())){entry.status=uncertain?'unknown':'failed';entry.uncertain=uncertain;entry.code=code;notify();}return failed(code,uncertain);
   }finally{run.close();if(entry.active===work)entry.active=null;notify();}});entry.active=work;return work;
 }
 return Object.freeze({register:(captured,options)=>perform('register',captured,options),retry:(captured,options)=>perform('retry',captured,options),recheck:(captured,options)=>perform('recheck',captured,options),getState:state,
  subscribe(fn){if(typeof fn!=='function'||disposed)fail('BAD_REQUEST');listeners.add(fn);return()=>listeners.delete(fn);},
  dispose(){if(disposed)return;disposed=true;generation++;current=null;for(const run of active)run.abort.abort();active.clear();operations.clear();off();notify();listeners.clear();}});
}
