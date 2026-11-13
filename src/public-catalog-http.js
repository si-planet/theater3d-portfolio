import { normalizeHostedPublicCatalogSettings } from './public-catalog-config.js';
import { createCatalogTransport } from './catalog-repository.js';
import { PUBLIC_CATALOG_PROJECT, PUBLIC_CATALOG_PROTOCOL, PUBLIC_CATALOG_ORIGIN, PUBLIC_CATALOG_ENDPOINT,
  PUBLIC_CATALOG_LIMITS, publicRoute, publicExact, publicCanonical, publicReadError, validatePublicReadResult } from './public-catalog-http-contract.js';
import { parsePublicCatalogJSON } from './public-catalog-http-json.js';

/** Fixed HTTPS public read only. No ambient fetch, auth/session, retry or storage. */
export function createPublicCatalogHttpTransport({settings,fetchImpl}={}){
  const normalized=normalizeHostedPublicCatalogSettings(settings);
  const configured=normalized.state==='hosted-ready'&&typeof fetchImpl==='function';
  let sequence=0;
  async function wire(url,options){
    const virtual=new URL(url),path=virtual.pathname,route=publicRoute(path,Object.fromEntries(virtual.searchParams));
    const request={protocol:PUBLIC_CATALOG_PROTOCOL,projectRef:PUBLIC_CATALOG_PROJECT,requestId:'public-read-'+ ++sequence,path,query:route.query};
    const target=new URL(PUBLIC_CATALOG_ENDPOINT);target.searchParams.set('request',JSON.stringify(request));
    if(target.href.length>8192)throw publicReadError('BAD_REQUEST');
    const abort=new AbortController(),cancel=()=>abort.abort(),signal=options.signal;
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    const timer=setTimeout(cancel,20000);timer?.unref?.();
    function step(fn){return new Promise((resolve,reject)=>{let settled=false;const done=(f,v)=>{if(settled)return;settled=true;abort.signal.removeEventListener('abort',stop);f(v);};const stop=()=>done(reject,publicReadError('ABORTED'));abort.signal.addEventListener('abort',stop,{once:true});if(abort.signal.aborted){stop();return;}Promise.resolve().then(()=>settled?undefined:fn()).then(v=>done(resolve,v),()=>done(reject,publicReadError('REQUEST_FAILED')));});}
    try{
      const response=await step(()=>fetchImpl(target.href,{method:'GET',headers:{Accept:'application/json',apikey:normalized.settings.publishableKey},credentials:'omit',redirect:'error',cache:'no-store',signal:abort.signal}));
      if(!response||response.redirected!==false||response.url!==target.href)throw publicReadError('INVALID_RESPONSE');
      if(response.status!==200)throw publicReadError(({400:'BAD_REQUEST',403:'ACCESS_DENIED',404:'NOT_FOUND',409:'REVISION_MISMATCH',503:'POLICY_UNCONFIGURED'})[response.status]??'REQUEST_FAILED');
      if(response.headers?.get('Content-Type')?.split(';')[0].trim()!=='application/json')throw publicReadError();
      const length=response.headers.get('Content-Length');if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>PUBLIC_CATALOG_LIMITS.body))throw publicReadError('LIMIT_EXCEEDED');
      const reader=response.body?.getReader();if(!reader)throw publicReadError();const chunks=[];let size=0,finished=false;
      try{while(true){const part=await step(()=>reader.read());if(part.done){finished=true;break;}if(!(part.value instanceof Uint8Array)||(size+=part.value.length)>PUBLIC_CATALOG_LIMITS.body||chunks.length>=8192)throw publicReadError('LIMIT_EXCEEDED');chunks.push(new Uint8Array(part.value));}}
      finally{if(!finished)try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
      if(length!==null&&Number(length)!==size)throw publicReadError();
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const value=publicExact(parsePublicCatalogJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),['ok','protocol','projectRef','requestId','path','query','support','result']);
      if(value.support!==route.support||value.ok!==true||value.protocol!==request.protocol||value.projectRef!==request.projectRef||value.requestId!==request.requestId||value.path!==path||publicCanonical(value.query)!==publicCanonical(route.query))throw publicReadError();
      const result=validatePublicReadResult(value.result,route);
      return {ok:true,status:200,json:async()=>result};
    }catch(error){throw publicReadError(['BAD_REQUEST','ACCESS_DENIED','NOT_FOUND','REVISION_MISMATCH','POLICY_UNCONFIGURED','LIMIT_EXCEEDED','ABORTED'].includes(error?.code)?error.code:'INVALID_RESPONSE');}
    finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  const inner=configured?createCatalogTransport({baseUrl:PUBLIC_CATALOG_ORIGIN,fetchImpl:wire}):null;
  return Object.freeze({getConnectionState:()=>Object.freeze({state:configured?'configured':normalized.state==='unconfigured'?'unconfigured':'invalid',kind:'hosted-public'}),
    async request(path,{query={},signal}={}){if(!inner)throw publicReadError('NOT_CONFIGURED');publicRoute(path,query);try{return await inner.request(path,{query,signal});}catch(error){throw publicReadError(['ABORT_ERR','CURSOR_MISMATCH','REVISION_MISMATCH','BAD_REQUEST'].includes(error?.code)?error.code:'REQUEST_FAILED');}}});
}
