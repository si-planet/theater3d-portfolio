import {createPrivatePhotoHttpProvider} from './private-photo-http-provider.js';
import {PRIVATE_PHOTO_PROTOCOL,PRIVATE_PHOTO_PROJECT} from './private-photo-library.js';
import {PRIVATE_PHOTO_REGISTRATION_READ_ACTION as ACTION,copyPrivatePhotoRegistrationReadPayload,copyPrivatePhotoRegistrationReadResult} from './private-photo-registration-read-contract.js';
/** Separate read client using the existing HTTP/session boundary. No cache. */
export function createPrivatePhotoRegistrationReader({enabled=false,config,fetchImpl,sessionPort,clock}={}){
 const provider=createPrivatePhotoHttpProvider(enabled===true?{enabled:true,...config,fetchImpl,sessionPort,...(clock?{clock}:{})}:{enabled:false});let seq=0;
 const off=provider.subscribeSession(()=>{});
 return Object.freeze({
  async read(raw,{signal}={}){const p=copyPrivatePhotoRegistrationReadPayload(raw),s=provider.getSession();if(!s)throw Object.assign(Error('Private registration read rejected'),{code:'SESSION_REQUIRED'});
   if(++seq>Number.MAX_SAFE_INTEGER)throw Object.assign(Error('Private registration read rejected'),{code:'LIMIT_EXCEEDED'});
   const e=await provider.readRegisteredMetadata({protocol:PRIVATE_PHOTO_PROTOCOL,projectRef:PRIVATE_PHOTO_PROJECT,accountId:s.accountId,epoch:s.epoch,requestId:`private-photo-request:${seq}`,action:ACTION,payload:p},{signal});
   return copyPrivatePhotoRegistrationReadResult(e.result,p);
  },getSession:provider.getSession,subscribeSession:provider.subscribeSession,dispose(){off();provider.dispose();},
 });
}
