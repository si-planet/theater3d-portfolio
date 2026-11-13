import {catalogError} from './catalog-repository.js';

const PATH='/functions/v1/theater3d-catalog-registration';
const reject=code=>{throw catalogError(code,'Registration transport rejected request');};
const abort=()=>Object.assign(new Error('Registration transport cancelled'),{name:'AbortError',code:'ABORT_ERR'});
const id=value=>/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value)&&!['constructor','prototype','__proto__','.','..'].includes(value);
function fields(value,allowed){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))reject('BAD_REQUEST');
 const result={};
 for(const key of Reflect.ownKeys(value)){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!allowed.includes(key)||!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))reject('BAD_REQUEST');
  result[key]=descriptor.value;
 }
 return result;
}
function configuration(options){
 try{
  const {baseUrl,fetchImpl}=fields(options,['baseUrl','fetchImpl']);
  if(baseUrl===undefined&&fetchImpl===undefined)return{state:'unconfigured',code:'NOT_CONFIGURED'};
  if(typeof baseUrl!=='string'||typeof fetchImpl!=='function')throw Error();
  // Reject URL parser repairs, credentials, empty query/fragment and non-root paths.
  const parts=/^(https?):\/\/(\[[^\]]+\]|[^:/?#@\\\s]+)(?::([0-9]+))?\/?$/.exec(baseUrl);
  if(!parts||/[\u0000-\u0020\u007f\\]/.test(baseUrl))throw Error();
  if(parts[1]==='http'&&!['127.0.0.1','localhost','[::1]'].includes(parts[2].toLowerCase()))throw Error();
  const url=new URL(baseUrl);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();
  return{state:'configured',origin:url.origin,fetchImpl};
 }catch{return{state:'invalid',code:'INVALID_CONFIG'};}
}
function signalState(signal){
 if(signal===undefined)return;
 try{
  if(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function')reject('BAD_REQUEST');
  if(signal.aborted)throw abort();
 }catch(error){let name;try{name=error?.name;}catch{}if(name==='AbortError')throw abort();reject('BAD_REQUEST');}
}
function validateRequest(input){
 const fixed=fields(input,['method','path','body','signal']);
 const {method,path,body,signal}=fixed;
 if(typeof path!=='string')reject('BAD_REQUEST');
 if(method==='POST'){
  if(path!==PATH||typeof FormData==='undefined'||!(body instanceof FormData))reject('BAD_REQUEST');
 }else if(method==='GET'){
  if(body!==undefined||!path.startsWith(PATH+'/'))reject('BAD_REQUEST');
  const encoded=path.slice(PATH.length+1);let decoded;
  try{decoded=decodeURIComponent(encoded);}catch{reject('BAD_REQUEST');}
  if(!id(decoded)||encodeURIComponent(decoded)!==encoded)reject('BAD_REQUEST');
 }else reject('BAD_REQUEST');
 signalState(signal);return fixed;
}
async function waitForFetch(promise,signal){
 if(!signal)return promise;
 return new Promise((resolve,rejectPromise)=>{
  const cleanup=()=>signal.removeEventListener('abort',cancel);
  const cancel=()=>{cleanup();rejectPromise(abort());};
  signal.addEventListener('abort',cancel,{once:true});
  Promise.resolve(promise).then(value=>{cleanup();signal.aborted?rejectPromise(abort()):resolve(value);},error=>{cleanup();rejectPromise(error);});
  if(signal.aborted)cancel();
 });
}

/** Explicit HTTP port only. No authentication, defaults, body consumption or retry. */
export function createCatalogRegistrationHttpTransport(options={}){
 const config=configuration(options);
 return Object.freeze({
  getConnectionState:()=>({state:config.state,...(config.code?{code:config.code}:{})}),
  async request(input){
   if(config.state!=='configured')reject(config.code);
   let fixed;
   try{fixed=validateRequest(input);}catch(error){let name;try{name=error?.name;}catch{}if(name==='AbortError')throw abort();reject('BAD_REQUEST');}
   const {method,path,body,signal}=fixed;
   try{
    const response=await waitForFetch((0, config.fetchImpl)(config.origin+path,{method,body,signal,credentials:'omit',redirect:'error',cache:'no-store'}),signal);
    signalState(signal);return response;
   }catch(error){let name;try{name=error?.name;}catch{}if(signal?.aborted||name==='AbortError')throw abort();reject('NETWORK_ERROR');}
  },
 });
}
