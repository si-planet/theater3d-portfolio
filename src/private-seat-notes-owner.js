import { POST_PROJECT,postExact,postClone,postId,postCode,postDeny,postFail } from './private-seat-notes-contract.js';
import { PRIVATE_NOTES_PROTOCOL,validateOwnedNoteRequest,validateOwnedNoteResult } from './private-seat-notes-owner-contract.js';
import { prepareSeatPostScope } from './private-seat-notes.js';
export function createPrivateSeatNotesOwnerClient(options={}){
 const flag=Object.getOwnPropertyDescriptor(options,'enabled');if(!flag||!Object.hasOwn(flag,'value')||flag.value!==true)return Object.freeze({enabled:false,getSession:()=>null,subscribeSession:()=>()=>{},createDraftId:()=>null,dispose(){},read:async()=>postDeny('UNCONFIGURED'),create:async()=>postDeny('UNCONFIGURED'),update:async()=>postDeny('UNCONFIGURED'),clear:async()=>postDeny('UNCONFIGURED')});
 const keys=Reflect.ownKeys(options);if(keys.some(k=>!['enabled','config','sessionPort','fetchImpl','createId','clock','timeoutMs'].includes(k)))postFail();
 const c=postExact(options,keys),config=postExact(c.config,['projectRef','supabaseUrl','publishableKey']),origin=`https://${POST_PROJECT}.supabase.co`,endpoint=origin+'/functions/v1/theater3d-private-library/notes';
 const timeoutMs=c.timeoutMs??20000;if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)postFail();
 if(config.projectRef!==POST_PROJECT||config.supabaseUrl!==origin)postFail('PROJECT_MISMATCH');
 if(!/^sb_publishable_[A-Za-z0-9_-]{1,480}$/.test(config.publishableKey)||typeof c.fetchImpl!=='function'||typeof c.createId!=='function'||typeof c.clock!=='function'
 ||['getSession','getAccessToken','subscribeSession'].some(k=>typeof c.sessionPort?.[k]!=='function'))postFail('POLICY_UNCONFIGURED');
 let disposed=false;const pending=new Set();const unsubscribe=c.sessionPort.subscribeSession(()=>{for(const cancel of pending)cancel('SESSION_CHANGED');});
 function session(){if(disposed)return null;const raw=c.sessionPort.getSession();if(!raw)return null;const s=postExact(postClone(raw),['projectRef','accountId','epoch','expiresAt']);
  if(s.projectRef!==POST_PROJECT||!Number.isSafeInteger(s.epoch)||s.epoch<0||!Number.isSafeInteger(s.expiresAt)||s.expiresAt<=c.clock()||typeof s.accountId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.accountId))return null;return Object.freeze(s);}
 async function run(kind,input,{signal}={}){let r,s,sent=false,reader,timer,cancel,external;const controller=new AbortController();let reason;
 const interrupted=new Promise((_,reject)=>{cancel=code=>{if(reason)return;reason=code;controller.abort();try{reader?.cancel().catch(()=>{});}catch{}try{postFail(code);}catch(e){reject(e);}};});interrupted.catch(()=>{});
 const step=work=>Promise.race([Promise.resolve().then(work),interrupted]);
 try{if(disposed)return postDeny('UNCONFIGURED');pending.add(cancel);timer=setTimeout(()=>cancel('REQUEST_FAILED'),timeoutMs);external=()=>cancel('ABORTED');if(signal){if(!(signal instanceof AbortSignal))postFail();signal.addEventListener('abort',external,{once:true});if(signal.aborted)cancel('ABORTED');}
  const fields={read:['selection','registry'],create:['selection','registry','id','opinion'],update:['selection','registry','id','expectedRevision','opinion'],clear:['selection','registry','id','expectedRevision']};const p=postExact(input,fields[kind]),mapped=prepareSeatPostScope(p);if(mapped.status!=='resolved')return postDeny(mapped.code);
  s=session();if(!s)return postDeny('SESSION_REQUIRED');const payload=Object.fromEntries(Object.entries(p).filter(([k])=>!['selection','registry'].includes(k)));
  r=validateOwnedNoteRequest({protocol:PRIVATE_NOTES_PROTOCOL,projectRef:POST_PROJECT,accountId:s.accountId,epoch:s.epoch,action:'private.note.'+kind,scope:mapped.scope,payload});
  if(signal?.aborted)return postDeny('ABORTED');const token=await step(()=>c.sessionPort.getAccessToken());if(typeof token!=='string'||token.length>8192||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return postDeny('SESSION_REQUIRED');
  const same=()=>{const next=session();return next&&next.accountId===s.accountId&&next.epoch===s.epoch;};if(!same())return postDeny('SESSION_CHANGED');
  sent=true;const response=await step(()=>(0, c.fetchImpl)(endpoint,{method:'POST',headers:{'content-type':'application/json',apikey:config.publishableKey,authorization:'Bearer '+token},body:JSON.stringify(r),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'}));
  if(!same()||signal?.aborted)return postDeny(kind==='read'?'SESSION_CHANGED':'OUTCOME_UNKNOWN');
  if(!(response instanceof Response)||response.redirected||response.url&&response.url!==endpoint||response.headers.get('content-type')?.split(';')[0]!=='application/json')postFail('INVALID_RESPONSE');
  reader=response.body?.getReader();if(!reader)postFail('INVALID_RESPONSE');let length=0,chunks=[];
  while(true){const {value,done}=await step(()=>reader.read());if(done)break;length+=value.length;if(length>32768){void reader.cancel().catch(()=>{});postFail('INVALID_RESPONSE');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const value=postClone(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)));if(!same())return postDeny(kind==='read'?'SESSION_CHANGED':'OUTCOME_UNKNOWN');
  if(value?.ok===false){const result=validateOwnedNoteResult(value,r);if(response.ok)postFail('INVALID_RESPONSE');return result;}
  const e=postExact(value,['protocol','projectRef','accountId','epoch','action','scope','ok','result']);
  if(!response.ok||e.ok!==true||e.protocol!==r.protocol||e.projectRef!==POST_PROJECT||e.accountId!==s.accountId||e.epoch!==s.epoch||e.action!==r.action||['venueId','layoutEditionId','seatId'].some(k=>e.scope?.[k]!==r.scope[k]))postFail('INVALID_RESPONSE');
  return validateOwnedNoteResult(e.result,r);
 }catch(error){return postDeny(sent&&kind!=='read'?'OUTCOME_UNKNOWN':postCode(error));}
 finally{clearTimeout(timer);pending.delete(cancel);if(signal&&external)signal.removeEventListener('abort',external);try{reader?.releaseLock();}catch{}}}
 return Object.freeze({enabled:true,getSession:()=>{try{return session();}catch{return null;}},subscribeSession:fn=>c.sessionPort.subscribeSession(fn),createDraftId:()=>{if(disposed)postFail('UNCONFIGURED');return postId(c.createId());},dispose(){if(disposed)return;disposed=true;for(const cancel of pending)cancel('SESSION_CHANGED');if(typeof unsubscribe==='function')unsubscribe();},
  read:(p,o)=>run('read',p,o),create:(p,o)=>run('create',p,o),update:(p,o)=>run('update',p,o),clear:(p,o)=>run('clear',p,o)});
}
