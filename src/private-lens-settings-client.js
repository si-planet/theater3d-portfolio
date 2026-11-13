/** Inactive browser transport only. No UI, storage, ID creation or auto retry. */
import { POST_PROJECT, postExact, postClone, postFail, postCode, postDeny } from './private-seat-notes-contract.js';
import { PRIVATE_LENS_SETTINGS_PROTOCOL, PRIVATE_LENS_SETTINGS_MAX_BYTES, validateLensSettingsRequest, validateLensSettingsResult } from './private-lens-settings-contract.js';
import { parsePrivateJSON } from './private-json.js';

export function createPrivateLensSettingsClient(options={}) {
  const flag=Object.getOwnPropertyDescriptor(options,'enabled');
  if (!flag || !Object.hasOwn(flag,'value') || flag.value!==true) return Object.freeze({
    enabled:false,getSession:()=>null,subscribeSession:()=>()=>{},dispose(){},
    read:async()=>postDeny('UNCONFIGURED'),put:async()=>postDeny('UNCONFIGURED'),
  });
  const keys=Reflect.ownKeys(options);
  if (keys.some(k=>!['enabled','config','sessionPort','fetchImpl','clock','timeoutMs'].includes(k))) postFail();
  const c=postExact(options,keys),config=postExact(c.config,['projectRef','supabaseUrl','publishableKey']);
  const origin=`https://${POST_PROJECT}.supabase.co`,endpoint=origin+'/functions/v1/theater3d-private-library/lens-settings';
  const timeoutMs=c.timeoutMs??20000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs<10 || timeoutMs>20000) postFail();
  if (config.projectRef!==POST_PROJECT || config.supabaseUrl!==origin) postFail('PROJECT_MISMATCH');
  if (typeof config.publishableKey!=='string' || !/^sb_publishable_[A-Za-z0-9_-]{1,480}$/.test(config.publishableKey)
    || typeof c.fetchImpl!=='function' || typeof c.clock!=='function'
    || ['getSession','getAccessToken','subscribeSession'].some(k=>typeof c.sessionPort?.[k]!=='function')) postFail('POLICY_UNCONFIGURED');
  // Native browser fetch rejects a configuration object as its receiver.
  const fetchImpl=c.fetchImpl;
  let disposed=false;
  const pending=new Set(),listeners=new Set();
  const unsubscribe=c.sessionPort.subscribeSession(()=>{
    for (const cancel of pending) cancel('SESSION_CHANGED');
    for (const listener of listeners) { try { listener(); } catch {} }
  });
  function session() {
    if (disposed) return null;
    let s;
    try {
      const raw=c.sessionPort.getSession(); if (!raw) return null;
      s=postExact(postClone(raw),['projectRef','accountId','epoch','expiresAt']);
    } catch { return null; }
    if (s.projectRef!==POST_PROJECT || !Number.isSafeInteger(s.epoch) || s.epoch<0 || !Number.isSafeInteger(s.expiresAt)
      || s.expiresAt<=c.clock() || typeof s.accountId!=='string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s.accountId)) return null;
    return Object.freeze(s);
  }
  async function run(kind,input,opts={}) {
    let s,sent=false,reader,timer,cancel,external,signal,reason;
    const controller=new AbortController();
    const interrupted=new Promise((_,reject)=>{
      cancel=code=>{
        if (reason) return; reason=code; controller.abort();
        try { reader?.cancel().catch(()=>{}); } catch {}
        try { postFail(code); } catch (error) { reject(error); }
      };
    });
    interrupted.catch(()=>{});
    const step=work=>Promise.race([Promise.resolve().then(()=>{ if(reason) postFail(reason); return work(); }),interrupted]);
    try {
      if (disposed) return postDeny('UNCONFIGURED');
      const optionKeys=Reflect.ownKeys(opts);
      if (optionKeys.some(k=>k!=='signal')) postFail();
      signal=postExact(opts,optionKeys).signal;
      if (signal!==undefined && !(signal instanceof AbortSignal)) postFail();
      pending.add(cancel); timer=setTimeout(()=>cancel('REQUEST_FAILED'),timeoutMs);
      external=()=>cancel('ABORTED');
      if (signal) { signal.addEventListener('abort',external,{once:true}); if (signal.aborted) return postDeny('ABORTED'); }
      s=session(); if (!s) return postDeny('SESSION_REQUIRED');
      const r=validateLensSettingsRequest({protocol:PRIVATE_LENS_SETTINGS_PROTOCOL,projectRef:POST_PROJECT,
        accountId:s.accountId,epoch:s.epoch,action:'private.lens.'+kind,payload:input});
      const token=await step(()=>c.sessionPort.getAccessToken());
      if (typeof token!=='string' || token.length>8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return postDeny('SESSION_REQUIRED');
      const same=()=>{const next=session();return next && next.projectRef===s.projectRef && next.accountId===s.accountId && next.epoch===s.epoch;};
      if (!same()) return postDeny('SESSION_CHANGED');
      const response=await step(()=>{
        sent=true;
        return fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',apikey:config.publishableKey,authorization:'Bearer '+token},
          body:JSON.stringify(r),signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
      });
      if (!same() || signal?.aborted) return postDeny(kind==='read'?'SESSION_CHANGED':'OUTCOME_UNKNOWN');
      if (!(response instanceof Response) || response.redirected || response.url && response.url!==endpoint
        || response.headers.get('content-type')?.split(';')[0].trim()!=='application/json') postFail('INVALID_RESPONSE');
      reader=response.body?.getReader(); if (!reader) postFail('INVALID_RESPONSE');
      let length=0; const chunks=[];
      while (true) {
        const {value,done}=await step(()=>reader.read()); if (done) break;
        length+=value.length;
        // Bounded envelope overhead; settings/result retain the 256 KiB contract.
        if (length>PRIVATE_LENS_SETTINGS_MAX_BYTES+4096) { void reader.cancel().catch(()=>{}); postFail('INVALID_RESPONSE'); }
        chunks.push(value);
      }
      const bytes=new Uint8Array(length); let at=0;
      for (const chunk of chunks) { bytes.set(chunk,at); at+=chunk.length; }
      let value;
      try { value=parsePrivateJSON(new TextDecoder('utf8',{fatal:true}).decode(bytes),{finiteNumberPaths:[['result','settings']]}); }
      catch { postFail('INVALID_RESPONSE'); }
      if (!same()) return postDeny(kind==='read'?'SESSION_CHANGED':'OUTCOME_UNKNOWN');
      const checkedResult=raw=>{try{return validateLensSettingsResult(raw,r);}catch{postFail('INVALID_RESPONSE');}};
      if (value?.ok===false) {
        const result=checkedResult(value);
        if (response.ok) postFail('INVALID_RESPONSE'); return result;
      }
      let e;
      try { e=postExact(value,['protocol','projectRef','accountId','epoch','action','ok','result']); }
      catch { postFail('INVALID_RESPONSE'); }
      if (!response.ok || e.ok!==true || e.protocol!==r.protocol || e.projectRef!==s.projectRef
        || e.accountId!==s.accountId || e.epoch!==s.epoch || e.action!==r.action) postFail('INVALID_RESPONSE');
      return checkedResult(e.result);
    } catch (error) { return postDeny(sent && kind==='put'?'OUTCOME_UNKNOWN':postCode(error)); }
    finally {
      clearTimeout(timer); pending.delete(cancel);
      if (signal && external) signal.removeEventListener('abort',external);
      try { reader?.releaseLock(); } catch {}
    }
  }
  return Object.freeze({
    enabled:true,getSession:()=>{try{return session();}catch{return null;}},
    subscribeSession(listener) {
      if (disposed) return ()=>{};
      if (typeof listener!=='function') postFail(); listeners.add(listener);
      return ()=>listeners.delete(listener);
    },
    read:(input={},opts)=>run('read',input,opts),put:(input,opts)=>run('put',input,opts),
    dispose() {
      if (disposed) return; disposed=true;
      for (const cancel of pending) cancel('SESSION_CHANGED');
      listeners.clear(); if (typeof unsubscribe==='function') unsubscribe();
    },
  });
}
