import {PHOTO_METADATA_FIELDS,normalizePhotoMetadataSources} from './catalog-repository.js';
import {assessRegistrationSnapshot} from './local-photo-registration.js';
import {evaluatePhotoRegistrationLimits} from './photo-registration-preflight.js';

const ROLES=['original','display','thumbnail'];
const CONTEXT=['venueId','layoutVersionId','seatId','productionRunId','performanceEventId'];
const INCOMPLETE=['pending','uploading','verifying','failed'];
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,159}$/.test(value)&&!['constructor','prototype','__proto__','.','..'].includes(value);
const bad=()=>{throw Object.assign(new Error('Invalid registration capture'),{code:'BAD_REQUEST'});};
function plain(value){
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))bad();
  const out={};
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key)||!d||!Object.hasOwn(d,'value')||!d.enumerable)bad();
    out[key]=d.value;
  }
  return out;
}
const exact=(value,keys)=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function assessFacts(facts){
  const reported=assessRegistrationSnapshot({target:'ts',...facts,requireBlobs:false});
  const measured={},mismatches=[];
  for(const role of ROLES){
    const asset=facts.assets[role];let size;
    try{size=Object.getOwnPropertyDescriptor(Blob.prototype,'size').get.call(asset.blob);}catch{}
    measured[role]={role:asset.role,byteSize:size,pixelWidth:asset.pixelWidth,pixelHeight:asset.pixelHeight};
    if(!Number.isSafeInteger(size)||size<1||size!==asset.byteSize)mismatches.push({code:'asset-size-mismatch',role,actual:Number.isSafeInteger(size)&&size>0?size:null,limit:Number.isSafeInteger(asset.byteSize)&&asset.byteSize>0?asset.byteSize:null,unit:'bytes'});
  }
  const actual=evaluatePhotoRegistrationLimits({target:'ts',processingStatus:facts.photo.processingStatus,fileByteSize:measured.original.byteSize,assets:measured});
  const state=reported.state==='blocked'||actual.state==='blocked'?'blocked':facts.photo.processingStatus!=='ready'?'not-ready':reported.state==='unknown'||actual.state==='unknown'||mismatches.length?'unknown':'within-limits';
  return {...reported,state,canSubmit:state==='within-limits',issues:[...reported.issues,...actual.issues,...mismatches].filter((v,i,a)=>a.findIndex(x=>JSON.stringify(x)===JSON.stringify(v))===i)};
}
function captureInput(raw){
  const input=plain(raw);
  if(!exact(input,['synthetic','photo','assets','context'])||input.synthetic!==true)bad();
  const photo=plain(input.photo),context=plain(input.context),assets=plain(input.assets);
  if(!exact(context,CONTEXT)||CONTEXT.some(key=>context[key]!==null&&!id(context[key])))bad();
  if(context.seatId!==null&&(context.venueId===null||context.layoutVersionId===null)||context.layoutVersionId!==null&&context.venueId===null||context.performanceEventId!==null&&context.productionRunId===null)bad();
  if(!exact(assets,ROLES))bad();
  const facts=Object.fromEntries(ROLES.map(role=>{const a=plain(assets[role]);return[role,Object.freeze({role:a.role,byteSize:a.byteSize,pixelWidth:a.pixelWidth,pixelHeight:a.pixelHeight,blob:a.blob})];}));
  const sourceMetadata=plain(photo.metadata);
  if(Object.keys(sourceMetadata).some(key=>!PHOTO_METADATA_FIELDS.includes(key)&&key!=='captureLocation'))bad();
  const metadata=Object.fromEntries(PHOTO_METADATA_FIELDS.filter(key=>Object.hasOwn(sourceMetadata,key)).map(key=>[key,sourceMetadata[key]]));
  if(Object.values(metadata).some(value=>value!==null&&!(typeof value==='string'||typeof value==='number'&&Number.isFinite(value)))||JSON.stringify(metadata).length>16384)bad();
  let sources;
  if(Object.hasOwn(photo,'metadataSources')&&photo.metadataSources!==undefined){
    const rawSources=plain(photo.metadataSources);
    if(Object.keys(rawSources).some(key=>!PHOTO_METADATA_FIELDS.includes(key)&&key!=='captureLocation'))bad();
    sources=normalizePhotoMetadataSources(metadata,Object.fromEntries(Object.entries(rawSources).filter(([key])=>key!=='captureLocation')));
  }
  if(typeof photo.name!=='string'||!photo.name||photo.name.length>255||['.','..'].includes(photo.name)||/[/\\\u0000-\u001f\u007f]/.test(photo.name))bad();
  const measuredPhoto=Object.freeze({size:photo.size,processingStatus:photo.processingStatus});
  const preflight=assessFacts({photo:measuredPhoto,assets:facts});
  return {preflight,metadataLoading:photo.metadataStatus==='loading',facts:Object.freeze({photo:measuredPhoto,assets:Object.freeze(facts)}),operation:{synthetic:true,context:Object.freeze(context),metadata:Object.freeze(metadata),...(sources===undefined?{}:{metadataSources:Object.freeze(sources)}),originalFilename:photo.name,...Object.fromEntries(ROLES.map(role=>[role,facts[role].blob]))}};
}
const SAFE_CODES=new Set(['BAD_REQUEST','NOT_CONFIGURED','NOT_FOUND','ACCESS_DENIED','NETWORK_ERROR','INVALID_RESPONSE','SERVICE_UNAVAILABLE','HTTP_ERROR','OPERATION_CONFLICT','CONTEXT_MISMATCH','IDEMPOTENCY_CONFLICT','REVISION_MISMATCH','ASSET_TOO_LARGE','INVALID_PNG','INVALID_IMAGE','IMAGE_DECODE_INVALID','ASPECT_MISMATCH','DERIVATIVE_METADATA','IMAGE_DECODER_NOT_CONFIGURED','IMAGE_DECODE_FAILED','ASSET_INTEGRITY','REGISTRATION_INCOMPLETE']);
function errorCode(error){try{return SAFE_CODES.has(error?.code)?error.code:'REGISTRATION_FAILED';}catch{return 'REGISTRATION_FAILED';}}
function validatedResult(raw,operationId,method){
  const result=plain(raw);
  if(result.operationId!==operationId)bad();
  if(method==='GET'&&INCOMPLETE.includes(result.state)&&exact(result,['state','operationId']))return result;
  if(!exact(result,['state','operationId','photoId','storageStatus','publicationStatus','assetIds','reused'])||result.state!=='ready'||!id(result.photoId)||result.storageStatus!=='ready'||result.publicationStatus!=='private'||!(method==='POST'?typeof result.reused==='boolean':result.reused===null))bad();
  const assets=plain(result.assetIds);
  if(!exact(assets,ROLES)||ROLES.some(role=>!id(assets[role]))||new Set(Object.values(assets)).size!==3)bad();
  return result;
}
function publicPreflight(value){
  if(!value)return null;
  return Object.freeze({target:value.target,state:value.state,canSubmit:value.canSubmit,issues:Object.freeze(value.issues.map(issue=>Object.freeze({...issue})))});
}

/** One explicit operation in memory. Communication and identifier generation
 * are injected. Configuration never implies authentication or server writes.
 * Methods resolve safe snapshots; operational failures are state, not raw errors.
 */
export function createPhotoRegistrationController({client,idFactory,onChange}={}){
  let disposed=false,serial=0,active=null,operation=null,facts=null;
  const configured=()=>{try{return typeof client?.getRegistration==='function'&&typeof client?.registerPhoto==='function'&&client.getConnectionState().state==='configured';}catch{return false;}};
  let current={state:configured()?'idle':'unconnected',operationId:null,photoId:null,serverStatus:null,errorCode:null,preflight:null,uncertain:false};
  function getSnapshot(){return Object.freeze({...current,preflight:publicPreflight(current.preflight)});}
  function publish(state,patch={}){current={...current,...patch,state};const value=getSnapshot();try{if(typeof onChange==='function')onChange(value);}catch{/* Observer errors do not change the operation or expose its request. */}return value;}
  function currentRun(run){return !disposed&&active===run&&run.generation===serial&&!run.controller.signal.aborted;}
  function terminate(state){
    const run=active;serial++;active=null;
    const value=publish(state,{errorCode:state==='disposed'?'DISPOSED':'ABORT_ERR',uncertain:!!operation&&current.state!=='saved-private'});
    if(run){run.cleanup();run.controller.abort();run.resolve(value);}
    return value;
  }
  function checkedSignal(options){
    const opts=options===undefined?{}:plain(options);
    if(Object.keys(opts).some(key=>key!=='signal'))bad();
    const signal=opts.signal;
    if(signal!==undefined&&(!signal||typeof signal.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))bad();
    return signal;
  }
  function acknowledged(run,result){if(currentRun(run))publish('saved-private',{photoId:result.photoId,serverStatus:'ready',errorCode:null,uncertain:false});}
  async function execute(run,mode){
    const signal=run.controller.signal;
    try{
      let result,knownMissing=false;
      try{result=await client.getRegistration(operation.operationId,{signal});}
      catch(error){
        if(!currentRun(run))return;
        if(errorCode(error)!=='NOT_FOUND')throw error;
        knownMissing=true;result={state:'missing',operationId:operation.operationId};
      }
      if(!currentRun(run))return;
      if(!knownMissing){
        try{result=validatedResult(result,operation.operationId,'GET');}catch{throw {code:'INVALID_RESPONSE'};}
        if(result.state==='ready'){acknowledged(run,result);return;}
      }
      publish(result.state==='failed'?'failed':'pending',{serverStatus:result.state,errorCode:result.state==='missing'?'NOT_FOUND':result.state==='failed'?'OPERATION_FAILED':null,uncertain:true});
      if(mode==='recheck'||!currentRun(run))return;
      publish('submitting',{errorCode:null,uncertain:true});
      if(!currentRun(run))return;
      let saved=await client.registerPhoto(operation,{signal});
      if(!currentRun(run))return;
      try{saved=validatedResult(saved,operation.operationId,'POST');}catch{throw {code:'INVALID_RESPONSE'};}
      acknowledged(run,saved);
    }catch(error){
      if(!currentRun(run))return;
      let aborted=false;try{aborted=error?.name==='AbortError'||error?.code==='ABORT_ERR';}catch{}
      if(aborted){terminate('cancelled-unconfirmed');return;}
      publish('failed',{errorCode:errorCode(error),uncertain:true});
    }finally{
      if(active===run){active=null;run.cleanup();run.resolve(getSnapshot());}
    }
  }
  function start(mode,signal){
    if(disposed)return Promise.resolve(getSnapshot());
    const preflight=assessFacts(facts);
    if(!preflight.canSubmit)return Promise.resolve(publish('preflight-blocked',{errorCode:'PREFLIGHT_BLOCKED',preflight}));
    const controller=new AbortController();let resolve;
    const promise=new Promise(done=>resolve=done),run={controller,promise,resolve,generation:++serial,cleanup:()=>{}};
    active=run;
    if(signal){const stop=()=>{if(active===run)terminate('cancelled-unconfirmed');};run.cleanup=()=>signal.removeEventListener('abort',stop);signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();}
    if(currentRun(run)){publish('checking',{preflight,errorCode:null,serverStatus:null});if(currentRun(run))execute(run,mode);}
    return promise;
  }
  function perform(mode,captured,options){
    if(disposed)return Promise.resolve(getSnapshot());
    if(active)return active.promise;
    let signal;
    try{signal=checkedSignal(options);}catch{return Promise.resolve(publish('failed',{errorCode:'BAD_REQUEST'}));}
    if(signal?.aborted)return Promise.resolve(publish('cancelled-unconfirmed',{errorCode:'ABORT_ERR',uncertain:!!operation}));
    if(!configured())return Promise.resolve(publish('unconnected',{errorCode:'NOT_CONFIGURED'}));
    if(!operation){
      if(mode!=='submit')return Promise.resolve(publish('failed',{errorCode:'NO_OPERATION'}));
      let fixed;
      try{fixed=captureInput(captured);}catch{return Promise.resolve(publish('preflight-blocked',{errorCode:'BAD_REQUEST',preflight:null}));}
      if(!fixed.preflight.canSubmit||fixed.metadataLoading)return Promise.resolve(publish('preflight-blocked',{errorCode:fixed.metadataLoading?'METADATA_NOT_READY':'PREFLIGHT_BLOCKED',preflight:fixed.preflight}));
      if(typeof idFactory!=='function')return Promise.resolve(publish('failed',{errorCode:'ID_FACTORY_REQUIRED',preflight:fixed.preflight}));
      let operationId;try{operationId=idFactory();if(!id(operationId))bad();}catch{return Promise.resolve(publish('failed',{errorCode:'ID_FACTORY_FAILED',preflight:fixed.preflight}));}
      if(disposed)return Promise.resolve(getSnapshot());
      facts=fixed.facts;operation=Object.freeze({...fixed.operation,operationId});current={...current,operationId,preflight:fixed.preflight};
    }else if(mode==='submit'&&current.state==='saved-private')return Promise.resolve(getSnapshot());
    return start(mode,signal);
  }
  const api=Object.freeze({getSnapshot,submit:(captured,options)=>perform('submit',captured,options),retry:options=>perform('retry',undefined,options),recheck:options=>perform('recheck',undefined,options),cancel:()=>active?terminate('cancelled-unconfirmed'):getSnapshot(),dispose(){if(!disposed){disposed=true;terminate('disposed');operation=null;facts=null;}return getSnapshot();}});
  try{if(typeof onChange==='function')onChange(getSnapshot());}catch{}
  return api;
}
