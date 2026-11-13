/** Session-scoped composition only. No storage, Auth, fetch or automatic PUT.
 * Existing authenticated client owns token validation and HTTP cancellation. */
import {POST_PROJECT,postDeny,postCode} from './private-seat-notes-contract.js';
import {validateLensSettings,validateLensSettingsResult,cloneLensSettingsJSON} from './private-lens-settings-contract.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const denied=code=>Object.freeze({ok:false,code});
export function createPrivateLensSettingsSession(options={}) {
 if(Object.getOwnPropertyDescriptor(options,'enabled')?.value!==true)return Object.freeze({enabled:false,start:async()=>postDeny('UNCONFIGURED'),save:async()=>postDeny('UNCONFIGURED'),markEdited(){},getState:()=>Object.freeze({enabled:false,status:'disabled',revision:null,dirty:false,code:null}),dispose(){}});
 const {client,getSettings,applySettings,restoreLocal,createRequestId,onState=()=>{}}=options;
 if(client?.enabled!==true||['getSession','subscribeSession','read','put'].some(k=>typeof client?.[k]!=='function')
  ||[getSettings,applySettings,restoreLocal,createRequestId,onState].some(fn=>typeof fn!=='function'))throw Error('Invalid lens session composition');
 let disposed=false,key=null,serial=0,edit=0,revision=null,dirty=false,blocked=false,busy=false,pending=null,abort=null,status='signed-out',code=null;
 const snapshot=()=>Object.freeze({enabled:true,status,revision,dirty,code});
 function notify(){try{onState(snapshot());}catch{}}
 function sessionKey(){try{const s=client.getSession();return s&&s.projectRef===POST_PROJECT&&UUID.test(s.accountId??'')&&Number.isSafeInteger(s.epoch)&&s.epoch>=0?JSON.stringify([s.projectRef,s.accountId,s.epoch]):null;}catch{return null;}}
 const current=own=>!disposed&&own===serial&&key!==null&&sessionKey()===key;
 function failure(value){const checked=postDeny(value?.code);return checked.code;}
 async function sync(){
  if(disposed)return denied('UNCONFIGURED');const next=sessionKey();if(next===key)return pending??{ok:true};
  const own=++serial;abort?.abort();abort=null;pending=null;key=next;edit=0;revision=null;dirty=false;blocked=false;busy=false;code=null;
  // Remote owner values/drafts never enter the preserved browser-local baseline.
  restoreLocal();status=key===null?'signed-out':'loading';notify();if(key===null)return denied('SESSION_REQUIRED');
  abort=new AbortController();const signal=abort.signal,atEdit=edit;
  pending=(async()=>{
   try{const result=validateLensSettingsResult(await client.read({}, {signal}),{action:'private.lens.read'});
    if(!current(own))return denied('SESSION_CHANGED');
    if(!result.ok){code=failure(result);status='error';notify();return result;}
    revision=result.revision;
    if(result.settings!==null&&edit===atEdit&&!dirty)applySettings(cloneLensSettingsJSON(result.settings));
    status=dirty?'dirty':result.settings===null?'empty':'ready';code=null;notify();return{ok:true};
   }catch(error){if(!current(own))return denied('SESSION_CHANGED');code=postCode(error);status='error';notify();return denied(code);}
   finally{if(own===serial){pending=null;abort=null;}}
  })();return pending;
 }
 const unsubscribe=client.subscribeSession(()=>{void sync().catch(()=>{});});
 return Object.freeze({enabled:true,start:sync,getState:snapshot,
  markEdited(){if(disposed)return;edit++;dirty=true;if(revision!==null&&!busy&&!blocked)status='dirty';notify();},
  async save(){
   if(disposed)return denied('UNCONFIGURED');
   const before=sessionKey();if(before===null)return denied('SESSION_REQUIRED');
   if(before!==key){await sync();return denied('SESSION_CHANGED');}
   const own=serial,atEdit=edit;
   let settings;try{settings=validateLensSettings(getSettings());}catch(error){code=postCode(error);status='error';notify();return denied(code);}
   if(pending)await pending;
   if(!current(own))return denied('SESSION_CHANGED');
   if(blocked)return denied(code??'REVISION_CONFLICT');
   if(busy)return denied('BUSY_RETRY_LATER');
   if(revision===null){code='READ_REQUIRED';status='error';notify();return denied(code);}
   let requestId;try{requestId=createRequestId();if(!UUID.test(requestId??''))throw Error();}catch{return denied('INPUT_INVALID');}
   const payload={requestId,expectedRevision:revision,settings};busy=true;status='saving';code=null;notify();
   try{const result=validateLensSettingsResult(await client.put(payload),{action:'private.lens.put',payload});
    if(!current(own))return denied('SESSION_CHANGED');
    if(!result.ok){code=failure(result);blocked=['REVISION_CONFLICT','CONFLICT','OUTCOME_UNKNOWN'].includes(code);status=blocked?'blocked':'error';notify();return result;}
    revision=result.revision;if(edit===atEdit)dirty=false;status=dirty?'dirty':'ready';code=null;notify();return result;
   }catch(error){if(!current(own))return denied('SESSION_CHANGED');code='OUTCOME_UNKNOWN';blocked=true;status='blocked';notify();return denied(code);}
   finally{if(own===serial){busy=false;}}
  },
  dispose(){if(disposed)return;disposed=true;serial++;abort?.abort();abort=null;pending=null;key=null;revision=null;dirty=false;blocked=false;busy=false;status='disabled';code=null;unsubscribe?.();restoreLocal();notify();},
 });
}
