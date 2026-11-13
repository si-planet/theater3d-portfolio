/** Explicit online-registration soft-delete transport. All I/O requires explicit enable,
 * project configuration, a live session and an injected fetch implementation.
 * No token/operation persistence, automatic retries or object deletion. No private-archive deletion or restore.
 */
import {PRIVATE_PHOTO_DELETE_PROTOCOL as PROTOCOL,PRIVATE_PHOTO_DELETE_ENDPOINT as PATH,
 PRIVATE_PHOTO_DELETE_ACTIONS as ACTIONS,copyPrivatePhotoDeletePayload,parsePrivatePhotoDeleteResult} from './private-photo-delete-contract.js';
const PROJECT='portfolio-demo-disabled',ORIGIN=`https://${PROJECT}.supabase.co`,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE=new Set(['BAD_REQUEST','INPUT_INVALID','INVALID_CONFIGURATION','UNCONFIGURED','DISPOSED','SESSION_REQUIRED','SESSION_CHANGED','SESSION_EXPIRED','ACCESS_DENIED','PROJECT_MISMATCH','ABORTED','TIMEOUT','CONTENT_CHANGED','BUSY','UNSUPPORTED_LOCAL_ID','CONTEXT_UNRESOLVED_ONLY','NOT_READY','LIMIT_EXCEEDED','ASSET_INTEGRITY','IMAGE_INTEGRITY','INVALID_RESPONSE','REQUEST_FAILED','OUTCOME_UNKNOWN','RECHECK_REQUIRED','NOT_FOUND','POLICY_UNCONFIGURED','OPERATION_CONFLICT','IDEMPOTENCY_CONFLICT','CONTRACT_REJECTED','SOURCE_BACKUP_REQUIRED','STORAGE_UNAVAILABLE','CONFLICT','REVISION_CONFLICT','STORAGE_REJECTED','POLICY_CHANGED','PHOTO_UNAVAILABLE','CONFLICT_RETRY_REQUIRED','TIMEOUT_RETRY_REQUIRED']);
const fail=code=>{throw Object.assign(Error('Private photo deletion rejected'),{code});};
const failed=(code,uncertain=false)=>Object.freeze({ok:false,confirmed:false,code,uncertain});
function plain(v,keys,required=keys){if(!v||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('BAD_REQUEST');const out={};
 for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||keys&&!keys.includes(k)||!d?.enumerable||!Object.hasOwn(d,'value'))fail('BAD_REQUEST');out[k]=d.value;}
 if(required?.some(k=>!Object.hasOwn(out,k)))fail('BAD_REQUEST');return out;}
const same=(a,b)=>a===b||a&&b&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>a[k]===b[k]);
export function createPrivatePhotoDeleteClient(options={}){
 const flag=options&&Object.getOwnPropertyDescriptor(options,'enabled');if(flag&&!Object.hasOwn(flag,'value'))fail('BAD_REQUEST');
 if(flag?.value===undefined||flag.value===false){const no=async()=>failed('UNCONFIGURED');return Object.freeze({remove:no,retry:no,recheck:no,
  getState:()=>Object.freeze({configured:false,authenticated:false,disposed:false,operations:[],pending:0}),subscribe:()=>()=>{},dispose(){}});}
 if(flag.value!==true)fail('BAD_REQUEST');
 const c=plain(options,['enabled','config','fetchImpl','sessionPort','clock','requestTimeoutMs'],['enabled','config','fetchImpl','sessionPort']);
 const config=plain(c.config,['projectRef','supabaseUrl','publishableKey']),port=plain(c.sessionPort,['getSession','getAccessToken','subscribeSession']);
 if(config.projectRef!==PROJECT||config.supabaseUrl!==ORIGIN||typeof config.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(config.publishableKey)||typeof c.fetchImpl!=='function'||Object.values(port).some(fn=>typeof fn!=='function'))fail('BAD_REQUEST');
 const clock=c.clock??Date.now,timeout=c.requestTimeoutMs??60000;
 if(typeof clock!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>120000)fail('BAD_REQUEST');
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
 async function step(run,fn){guard(run);let onAbort;const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(Object.assign(Error('Private photo deletion rejected'),{code:run.timedOut?'TIMEOUT':'ABORTED'}));run.abort.signal.addEventListener('abort',onAbort,{once:true});});
  const task=Promise.resolve().then(()=>{guard(run);return fn();});task.catch(()=>{});try{const value=await Promise.race([task,cancelled]);guard(run);return value;}finally{run.abort.signal.removeEventListener('abort',onAbort);}}
 async function readJSON(response,run){if(response.headers?.get('Content-Type')?.split(';')[0].trim()!=='application/json')fail('INVALID_RESPONSE');const length=response.headers.get('Content-Length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>4096))fail('INVALID_RESPONSE');const reader=response.body?.getReader();if(!reader)fail('INVALID_RESPONSE');
  let size=0,done=false;const chunks=[];try{for(;;){const part=await step(run,()=>reader.read());if(part.done){done=true;break;}if(!(part.value instanceof Uint8Array)||(size+=part.value.byteLength)>4096)fail('LIMIT_EXCEEDED');chunks.push(new Uint8Array(part.value));}}
  finally{if(!done)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
  // Fetch exposes decoded Response bytes, but Content-Length may describe compressed wire bytes.
  // Keep strict length for non-Response adapters; the decoded streaming cap above remains mandatory.
  if(!(response instanceof Response)&&length!==null&&Number(length)!==size)fail('INVALID_RESPONSE');const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_RESPONSE');}}
 async function send(entry,run,action){guard(run);if(++sequence>Number.MAX_SAFE_INTEGER)fail('REQUEST_FAILED');let token=null;
  try{token=port.getAccessToken.call(c.sessionPort);guard(run);if(typeof token!=='string'||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))fail('SESSION_REQUIRED');
   const request={protocol:PROTOCOL,projectRef:PROJECT,accountId:run.s.accountId,epoch:run.s.epoch,requestId:`private-photo-delete-request:${sequence}`,action,payload:entry.payload};
   const headers={apikey:config.publishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body=JSON.stringify(request);
   const response=await step(run,()=>{if(action===ACTIONS.remove)run.dispatched=true;return fetchImpl(ORIGIN+PATH,{method:'POST',headers,body,signal:run.abort.signal,credentials:'omit',cache:'no-store',redirect:'error'});});
   if(!response||response.redirected||response.url&&response.url!==ORIGIN+PATH)fail('INVALID_RESPONSE');
   if(response.status===401||response.status===403){denied.set(run.s.accountId,Math.max(run.s.epoch,denied.get(run.s.accountId)??-1));session();fail('ACCESS_DENIED');}
   const raw=await readJSON(response,run);guard(run);
   if(raw?.ok===false){let error;try{error=plain(raw,['ok','code','message']);if(error.message!=='Private photo deletion rejected')fail('INVALID_RESPONSE');}catch{fail('INVALID_RESPONSE');}
    const code=SAFE.has(error.code)?error.code:'REQUEST_FAILED';if([400,403,404,409,413,422].includes(response.status)&&code!=='REQUEST_FAILED')run.definitive=true;fail(code);}
   const envelope=plain(raw,['protocol','projectRef','accountId','epoch','requestId','action','kind','source','ok','result']);
   if(response.status!==200||envelope.ok!==true||envelope.kind!=='configured-private'||envelope.source!=='private-provider'||['protocol','projectRef','accountId','epoch','requestId','action'].some(k=>envelope[k]!==request[k]))fail('INVALID_RESPONSE');
   const result=parsePrivatePhotoDeleteResult(envelope.result,entry.payload);
   if(action===ACTIONS.remove&&result.status!=='deleted')fail('INVALID_RESPONSE');guard(run);return result;
  }finally{token=null;}}
 function state(){const authenticated=!!session();return Object.freeze({configured:true,authenticated,disposed,pending:active.size,operations:Object.freeze(authenticated?[...operations.values()].map(e=>Object.freeze({operationId:e.payload.operationId,photoId:e.payload.photoId,status:e.status,uncertain:e.uncertain,code:e.code})):[])});}
 function deliver(entry,run,result){guard(run);entry.status=result.status;entry.uncertain=false;entry.code=null;notify();guard(run);
  return Object.freeze({ok:true,confirmed:result.status==='deleted',uncertain:false,...result});}
 function perform(mode,captured,options={}){let input,entry,run;
  try{const requestedSession=session();if(!requestedSession)fail(disposed?'DISPOSED':'SESSION_REQUIRED');const opts=plain(options,['signal'],[]);input=copyPrivatePhotoDeletePayload(captured);entry=operations.get(input.operationId);
   if(entry&&JSON.stringify(entry.payload)!==JSON.stringify(input)){
    // An authenticated metadata correction may advance the same live photo. A fresh
    // status request still verifies this CAS; never replace an uncertain/deleted operation.
    if(entry.payload.photoId!==input.photoId||input.expectedRevision<=entry.payload.expectedRevision||entry.active||entry.uncertain||!['live','failed'].includes(entry.status))fail('CONTENT_CHANGED');
    entry=null;operations.delete(input.operationId);
   }if(entry?.active)return entry.active;
   if(mode==='remove'&&entry?.status==='unknown')return Promise.resolve(failed('RECHECK_REQUIRED',true));
   if(!entry){if(operations.size>=100)fail('LIMIT_EXCEEDED');entry={payload:input,status:'idle',code:null,uncertain:false,active:null};operations.set(input.operationId,entry);}
   run=begin(opts.signal);if(!same(requestedSession,run.s))fail('SESSION_CHANGED');
  }catch(e){run?.close();return Promise.resolve(failed(SAFE.has(e?.code)?e.code:'BAD_REQUEST'));}
  const work=Promise.resolve().then(async()=>{try{entry.status='checking';entry.code=null;notify();guard(run);const existing=await send(entry,run,ACTIONS.status);
    entry.uncertain=false;
    if(existing.status==='deleted'||mode==='recheck')return deliver(entry,run,existing);
    entry.status='deleting';notify();guard(run);return deliver(entry,run,await send(entry,run,ACTIONS.remove));
   }catch(e){const uncertain=entry.uncertain||run.dispatched&&!run.definitive;let code=uncertain?'OUTCOME_UNKNOWN':SAFE.has(e?.code)?e.code:'REQUEST_FAILED';
    if(!disposed&&run.generation===generation&&same(run.s,session())){entry.status=uncertain?'unknown':'failed';entry.uncertain=uncertain;entry.code=code;notify();}return failed(code,uncertain);
   }finally{run.close();if(entry.active===work)entry.active=null;notify();}});entry.active=work;return work;
 }
 return Object.freeze({remove:(captured,options)=>perform('remove',captured,options),retry:(captured,options)=>perform('retry',captured,options),recheck:(captured,options)=>perform('recheck',captured,options),getState:state,
  subscribe(fn){if(typeof fn!=='function'||disposed)fail('BAD_REQUEST');listeners.add(fn);return()=>listeners.delete(fn);},
  dispose(){if(disposed)return;disposed=true;generation++;current=null;for(const run of active)run.abort.abort();active.clear();operations.clear();off();notify();listeners.clear();}});
}
