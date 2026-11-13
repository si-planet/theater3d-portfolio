/** Optional hosted client. No ambient storage/auth/fetch access, no migration. */
import { resolveCanonicalSelection } from './canonical-selection-context.js';
import { POST_PROJECT,POST_PROTOCOL,postExact,postClone,postId,postScope,postCode,postDeny,postFail,validatePostRequest,validatePostResult } from './private-seat-notes-contract.js';
export function prepareSeatPostScope(input){
 if(input&&Object.hasOwn(input,'canonicalScope')){try{const outer=postExact(input,['canonicalScope']),c=postExact(postClone(outer.canonicalScope),['projectRef','venueId','layoutEditionId','seatId']);if(c.projectRef!==POST_PROJECT)postFail('PROJECT_MISMATCH');return Object.freeze({status:'resolved',scope:postScope({venueId:c.venueId,layoutEditionId:c.layoutEditionId,seatId:c.seatId})});}catch(error){return Object.freeze({status:'unresolved',code:postCode(error),scope:null});}}
 const {selection,registry}=input??{};const r=resolveCanonicalSelection(selection,registry);
 if(r.status!=='resolved')return Object.freeze({status:'unresolved',code:'SEAT_MAPPING_UNAVAILABLE',scope:null});
 return Object.freeze({status:'resolved',scope:Object.freeze({venueId:r.canonical.venue_id,layoutEditionId:r.canonical.layout_edition_id,seatId:r.canonical.seat_id})});}
export function createPrivateSeatNotesClient(options={}){
 const flag=Object.getOwnPropertyDescriptor(options,'enabled');if(!flag||!Object.hasOwn(flag,'value')||flag.value!==true)return Object.freeze({enabled:false,list:async()=>postDeny('UNCONFIGURED'),read:async()=>postDeny('UNCONFIGURED'),create:async()=>postDeny('UNCONFIGURED'),update:async()=>postDeny('UNCONFIGURED'),clear:async()=>postDeny('UNCONFIGURED'),createDraftId:()=>null});
 const c=postExact(options,['enabled','transport','createId']);if(typeof c.transport!=='function'||typeof c.createId!=='function')postFail('POLICY_UNCONFIGURED');
 async function run(action,input,{signal}={}){let request;try{const fields={list:['selection','registry','limit','afterId'],read:['selection','registry','id'],create:['selection','registry','id','opinion','password'],update:['selection','registry','id','expectedRevision','opinion','password'],clear:['selection','registry','id','expectedRevision','password']};
  const p=postExact(input,fields[action]),mapped=prepareSeatPostScope(p);if(mapped.status!=='resolved')return postDeny(mapped.code);
  const payload=Object.fromEntries(Object.entries(p).filter(([k])=>!['selection','registry'].includes(k)));
  request=validatePostRequest({protocol:POST_PROTOCOL,projectRef:POST_PROJECT,action:'post.'+action,scope:mapped.scope,payload});
  if(signal?.aborted)return postDeny('ABORTED');const result=await c.transport(request,{signal});
  if(signal?.aborted)return postDeny(['list','read'].includes(action)?'ABORTED':'OUTCOME_UNKNOWN');return validatePostResult(result,request);
 }catch(error){return postDeny(postCode(error));}}
 return Object.freeze({enabled:true,createDraftId:()=>postId(c.createId()),list:(p,o)=>run('list',p,o),read:(p,o)=>run('read',p,o),create:(p,o)=>run('create',p,o),update:(p,o)=>run('update',p,o),clear:(p,o)=>run('clear',p,o)});
}
export function createPrivateSeatNotesHTTPTransport(options={}){
 const flag=Object.getOwnPropertyDescriptor(options,'enabled');if(!flag||!Object.hasOwn(flag,'value')||flag.value!==true)return async()=>postDeny('UNCONFIGURED');
 const c=postExact(options,['enabled','config','fetchImpl']),config=postExact(c.config,['projectRef','supabaseUrl','publishableKey']);
 const origin=`https://${POST_PROJECT}.supabase.co`;
 if(config.projectRef!==POST_PROJECT||config.supabaseUrl!==origin)postFail('PROJECT_MISMATCH');
 if(typeof c.fetchImpl!=='function'||typeof config.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,480}$/.test(config.publishableKey))postFail('POLICY_UNCONFIGURED');
 return async(input,{signal}={})=>{let request;try{request=validatePostRequest(input);if(signal?.aborted)return postDeny('ABORTED');
  const response=await (0, c.fetchImpl)(origin+'/functions/v1/theater3d-private-library/posts',{method:'POST',headers:{'content-type':'application/json',apikey:config.publishableKey},body:JSON.stringify(request),signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  if(!(response instanceof Response)||response.redirected||response.headers.get('content-type')?.split(';')[0]!=='application/json')return postDeny(['post.list','post.read'].includes(request.action)?'INVALID_RESPONSE':'OUTCOME_UNKNOWN');
  const reader=response.body?.getReader();if(!reader)return postDeny('INVALID_RESPONSE');let size=0,chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>256*1024){await reader.cancel();return postDeny(['post.list','post.read'].includes(request.action)?'INVALID_RESPONSE':'OUTCOME_UNKNOWN');}chunks.push(value);}}finally{reader.releaseLock();}
  const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));value=validatePostResult(value,request);}catch{return postDeny(['post.list','post.read'].includes(request.action)?'INVALID_RESPONSE':'OUTCOME_UNKNOWN');}
  if(response.ok!==value.ok)return postDeny(['post.list','post.read'].includes(request.action)?'INVALID_RESPONSE':'OUTCOME_UNKNOWN');return value;
 }catch{return postDeny(['post.list','post.read'].includes(request?.action)?'REQUEST_FAILED':'OUTCOME_UNKNOWN');}};
}
/** Explicit local-note review input only. Caller must deliberately obtain raw;
 * this helper never reads storage, generates IDs, publishes, or deletes notes.
 */
export function prepareLegacySeatNotesForReview({raw,mappings=[]}){try{
 if(typeof raw!=='string'||raw.length>1024*1024||!Array.isArray(mappings))postFail();const value=postExact(postClone(JSON.parse(raw),1024*1024),['version','notes']);
 if(value.version!==1||!value.notes||Array.isArray(value.notes)||typeof value.notes!=='object')postFail();const lookup=new Map();
 for(const row of mappings){const v=postExact(row,['legacyKey','selection','registry']);if(typeof v.legacyKey!=='string'||lookup.has(v.legacyKey))postFail();lookup.set(v.legacyKey,prepareSeatPostScope(v));}
 const items=Object.entries(value.notes).map(([legacyKey,opinion])=>{if(typeof opinion!=='string'||opinion.length>2000)postFail();const mapped=lookup.get(legacyKey);return {legacyKey,opinion,scope:mapped?.scope??null,status:mapped?.status==='resolved'?'review-required':'unresolved'};});
 return postClone({status:'review-required',originalRaw:raw,items,automaticMigration:false},3*1024*1024);
 }catch{return Object.freeze({status:'unresolved',code:'INPUT_INVALID',originalRaw:typeof raw==='string'?raw:null,automaticMigration:false});}}

import { PUBLIC_POST_PROTOCOL,validatePublicPostV2Request,validatePublicPostV2Result } from './private-seat-notes-contract.js';
export function createPublicSeatPostsV2Client(options={}){
 if(Object.getOwnPropertyDescriptor(options,'enabled')?.value!==true){const no=async()=>postDeny('UNCONFIGURED');return Object.freeze({enabled:false,list:no,read:no,create:no,update:no,remove:no,createDraftId:()=>null});}
 const c=postExact(options,['enabled','transport','createId']);if(typeof c.transport!=='function'||typeof c.createId!=='function')postFail('POLICY_UNCONFIGURED');
 async function run(action,input,{signal}={}){let request;try{const context=Object.hasOwn(input,'canonicalScope')?['canonicalScope']:['selection','registry'];
  const fields={list:['limit','afterId'],read:['id'],create:['id','title','opinion','deletePassword'],delete:['id','expectedRevision','deletePassword']};const p=postExact(input,[...context,...fields[action]]);
  const mapped=prepareSeatPostScope(Object.fromEntries(context.map(k=>[k,p[k]])));if(mapped.status!=='resolved')return postDeny(mapped.code);
  request=validatePublicPostV2Request({protocol:PUBLIC_POST_PROTOCOL,projectRef:POST_PROJECT,action:'post.'+action,scope:mapped.scope,payload:Object.fromEntries(fields[action].map(k=>[k,p[k]]))});
  if(signal?.aborted)return postDeny('ABORTED');const result=await c.transport(request,{signal});if(signal?.aborted)return postDeny(['list','read'].includes(action)?'ABORTED':'OUTCOME_UNKNOWN');return validatePublicPostV2Result(result,request);
 }catch(error){return postDeny(postCode(error));}}
 // Compatibility facade denies before reading any caller input or invoking transport.
 return Object.freeze({enabled:true,createDraftId:()=>postId(c.createId()),list:(p,o)=>run('list',p,o),read:(p,o)=>run('read',p,o),create:(p,o)=>run('create',p,o),update:async()=>postDeny('OPERATION_NOT_SUPPORTED'),remove:(p,o)=>run('delete',p,o)});
}
export function createPublicSeatPostsV2HTTPTransport(options={}){
 if(Object.getOwnPropertyDescriptor(options,'enabled')?.value!==true)return async()=>postDeny('UNCONFIGURED');
 const c=postExact(options,['enabled','config','fetchImpl']),config=postExact(c.config,['projectRef','supabaseUrl','publishableKey']),origin=`https://${POST_PROJECT}.supabase.co`,url=origin+'/functions/v1/theater3d-private-library/posts-v2';
 if(config.projectRef!==POST_PROJECT||config.supabaseUrl!==origin)postFail('PROJECT_MISMATCH');if(typeof c.fetchImpl!=='function'||typeof config.publishableKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{1,480}$/.test(config.publishableKey))postFail('POLICY_UNCONFIGURED');
 return async(input,{signal}={})=>{let request,sent=false,reader,timer;const controller=new AbortController();let rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});const stop=()=>{controller.abort();rejectStop(new Error('Stopped public request'));};
  try{request=validatePublicPostV2Request(input);if(signal?.aborted)return postDeny('ABORTED');signal?.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,20000);const step=p=>Promise.race([Promise.resolve(p),stopped]);sent=true;
   const response=await step((0, c.fetchImpl)(url,{method:'POST',headers:{'content-type':'application/json',apikey:config.publishableKey},body:JSON.stringify(request),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'}));
   if(!(response instanceof Response)||response.redirected||response.url&&response.url!==url||response.headers.get('content-type')?.split(';')[0]!=='application/json')postFail('INVALID_RESPONSE');
   reader=response.body?.getReader();if(!reader)postFail('INVALID_RESPONSE');let size=0,chunks=[];while(true){const {done,value}=await step(reader.read());if(done)break;size+=value.length;if(size>256*1024)postFail('INVALID_RESPONSE');chunks.push(value);}
   const bytes=new Uint8Array(size);let off=0;for(const b of chunks){bytes.set(b,off);off+=b.length;}const result=validatePublicPostV2Result(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),request);if(response.ok!==result.ok)postFail('INVALID_RESPONSE');return result;
  }catch(error){return postDeny(sent&&!['post.read','post.list'].includes(request?.action)?'OUTCOME_UNKNOWN':signal?.aborted?'ABORTED':postCode(error));}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);controller.abort();if(reader){reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}}
 };
}
