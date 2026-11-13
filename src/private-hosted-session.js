import {createBrowserPhotoUploadCopyProcessor} from './photo-upload-copy-browser.js';
/** Explicit product composition: Email Auth, private runtime, photo and stage.
 * Configured-but-signed-out remains private/locked; it never selects a public
 * fallback. A complete disable/dispose is the only return to public mode.
 */
import { createPrivateSupabaseAuth } from './private-supabase-auth.js';
import { createPrivatePhotoSessionPort } from './private-photo-session-port.js';
import { createPrivateStageWorkspace } from './private-stage-workspace.js';
import { createPrivateRuntimeClient } from './private-runtime-client.js';
import { clonePrivateStageJSON, preparePrivateStageSnapshotV2 } from './private-stage-snapshot.js';
import { resolveCanonicalSelection } from './canonical-selection-context.js';
import { createPrivatePhotoRegistrationClient } from './private-photo-registration-client.js';
import { createPrivatePhotoRegistrationReader } from './private-photo-registration-reader.js';
import { createPrivatePhotoDeleteClient } from './private-photo-delete-client.js';
import { createPrivateSeatNotesOwnerClient } from './private-seat-notes-owner.js';

const PROJECT = 'portfolio-demo-disabled', errors = new WeakMap();
const fail = code => { const e = Error('Private hosted connection rejected'); errors.set(e, code); throw e; };
const failure = code => Object.freeze({ ok: false, code });
const copy = value => clonePrivateStageJSON(value, 8 * 1024 * 1024);
function exact(v, keys, required = keys) {
  if (!v || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('INVALID_CONFIGURATION');
  const names = Reflect.ownKeys(v), out = {};
  if (names.some(k => typeof k !== 'string' || !keys.includes(k)) || required.some(k => !names.includes(k))) fail('INVALID_CONFIGURATION');
  for (const k of names) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_CONFIGURATION'); out[k] = d.value; }
  return out;
}
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}
const sourceKeys = ['kind','venueId','venue_id','modelId','model_id','modelVersion','model_version','seatId','seat_id',
  'layoutVersionId','layout_version_id','productionRunId','production_run_id','source','venueName','venue_name','seatLabel','seat_label',
  'informationRecordId','information_record_id','configurationKey','configuration_key','frameId','frame_id'];
function requestValue(value) {
  if (value === null) return null;
  const r = exact(copy(value), ['sourceScheme','sourceIdentity','localContext','localSeats','selectedLocalSeat'], ['sourceScheme','sourceIdentity','localContext','localSeats']);
  if(r.sourceScheme===null||r.sourceIdentity===null){if(r.sourceScheme!==null||r.sourceIdentity!==null)fail('INVALID_SOURCE_IDENTITY');}
  else {
    if (!['legacy3d','source2d'].includes(r.sourceScheme)) fail('UNSUPPORTED_SOURCE_SCHEME');
    exact(r.sourceIdentity, sourceKeys, []);
    if (Object.values(r.sourceIdentity).some(v => v !== null && typeof v !== 'string' && !(Number.isSafeInteger(v) && v >= 0))) fail('INVALID_SOURCE_IDENTITY');
  }
  exact(r.localContext, ['venueId','layoutVersionId','seatId'], ['venueId','layoutVersionId']);
  if (typeof r.localContext.venueId !== 'string' || typeof r.localContext.layoutVersionId !== 'string') fail('INVALID_SOURCE_IDENTITY');
  if (!Array.isArray(r.localSeats) || r.localSeats.length > 5000) fail('INVALID_SEAT_BINDINGS');
  const seen = new Set(); for (const seat of r.localSeats) {
    exact(seat, ['row','number']); if (![seat.row,seat.number].every(n => Number.isSafeInteger(n) && n > 0)) fail('INVALID_SEAT_BINDINGS');
    const key = `${seat.row}:${seat.number}`; if (seen.has(key)) fail('DUPLICATE_SEAT_MAPPING'); seen.add(key);
  }
  if (Object.hasOwn(r, 'selectedLocalSeat')) {
    exact(r.selectedLocalSeat, ['row','number']);
    if (![r.selectedLocalSeat.row,r.selectedLocalSeat.number].every(n => Number.isSafeInteger(n) && n > 0 && n <= 500)
        || !seen.has(`${r.selectedLocalSeat.row}:${r.selectedLocalSeat.number}`)) fail('INVALID_SEAT_BINDINGS');
  }
  if (new TextEncoder().encode(JSON.stringify(r)).length > 512 * 1024) fail('LIMIT_EXCEEDED'); return r;
}
function mappingValue(value, request, preset) {
  const m = exact(copy(value), ['selection','registry','modelBinding','seatBindings']);
  const selected = resolveCanonicalSelection(m.selection, m.registry);
  if (selected.status !== 'resolved') fail(selected.code);
  if(request.sourceScheme!==null){
    const requested=resolveCanonicalSelection({...m.selection,sourceScheme:request.sourceScheme,sourceIdentity:request.sourceIdentity},m.registry);
    if(requested.status!=='resolved'||!same(requested.canonical,selected.canonical))fail('SOURCE_CONTEXT_MISMATCH');
  }
  const model = exact(m.modelBinding, ['schema','projectRef','registryId','sourceSelection','localContext','venueId','layoutEditionId','modelRevisionId','mappingStatus']);
  if (model.schema !== 'theater3d.stage-model-binding/v1' || model.projectRef !== PROJECT || model.mappingStatus !== 'verified'
      || model.registryId !== m.selection.registryId || !same(model.sourceSelection,m.selection) || !same(model.localContext,request.localContext)
      || model.venueId !== selected.canonical.venue_id || model.layoutEditionId !== selected.canonical.layout_edition_id
      || typeof model.modelRevisionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(model.modelRevisionId)) fail('MODEL_CONTEXT_MISMATCH');
  if (!Array.isArray(m.seatBindings) || m.seatBindings.length > 4096) fail('INVALID_SEAT_BINDINGS');
  const seats = new Set(), canonical = new Set();
  for (const row of m.seatBindings) {
    exact(row, ['localSeat','selection','audienceId']); exact(row.localSeat, ['row','number']);
    if (![row.localSeat.row,row.localSeat.number].every(n => Number.isSafeInteger(n) && n > 0)) fail('INVALID_SEAT_BINDINGS');
    if (row.audienceId !== null && typeof row.audienceId !== 'string') fail('INVALID_SEAT_BINDINGS');
    const resolved = resolveCanonicalSelection(row.selection,m.registry), key = `${row.localSeat.row}:${row.localSeat.number}`;
    if (resolved.status !== 'resolved') fail(resolved.code);
    if (resolved.canonical.venue_id !== model.venueId || resolved.canonical.layout_edition_id !== model.layoutEditionId) fail('SEAT_CONTEXT_MISMATCH');
    if (seats.has(key) || canonical.has(resolved.canonical.seat_id)) fail('DUPLICATE_SEAT_MAPPING'); seats.add(key); canonical.add(resolved.canonical.seat_id);
  }
  if(request.selectedLocalSeat){
    const binding=m.seatBindings.find(row=>row.localSeat.row===request.selectedLocalSeat.row&&row.localSeat.number===request.selectedLocalSeat.number);
    const root=binding&&resolveCanonicalSelection(binding.selection,m.registry);
    if(root?.status!=='resolved'||!same(root.canonical,selected.canonical))fail('SOURCE_CONTEXT_MISMATCH');
  }
  for (const seat of request.localSeats) if (!seats.has(`${seat.row}:${seat.number}`)) fail('SEAT_MAPPING_UNAVAILABLE');
  if (preset !== null) { const prepared = preparePrivateStageSnapshotV2({ preset, ...m }); if (prepared.status !== 'resolved') fail(prepared.code); }
  return m;
}

export function createPrivateHostedSession(options = {}) {
  const flag = options && Object.getOwnPropertyDescriptor(options,'enabled');
  if (flag && !Object.hasOwn(flag,'value')) fail('INVALID_CONFIGURATION');
  if (flag?.value === undefined || flag.value === false) {
    const no = async () => failure('UNCONFIGURED'), runtime = Object.freeze({ mode:'public',status:'ready',epoch:0 });
    return Object.freeze({start:no,login:no,logout:no,refresh:no,checkSession:no,refreshMapping:no,currentMapping:no,selectionForSource:no,
      sessionPort:Object.freeze({getSession:()=>null,getAccessToken:()=>null,subscribeSession:()=>()=>{}}),
      getState:()=>Object.freeze({configured:false,started:false,disposed:false,authentication:'unconfigured',authenticated:false,mapping:{status:'unresolved',code:'UNCONFIGURED'},runtime}),
      getRuntimeDataState:()=>runtime,subscribe:()=>()=>{},subscribeRuntimeData:()=>()=>{},dispose(){}});
  }
  if (flag.value !== true) fail('INVALID_CONFIGURATION');
  const c = exact(options,['enabled','config','fetchImpl','configurePhoto','configureStage','configureRuntime','getSelectionInput','requestCredentials','clock','configureRegistration','configureNotes','getCurrentPhotoSelection','onCompareRegisteredPhoto','onApplyRegisteredPhotoFocus','onPrivatePhotosCleared','continuityStore'],
    ['enabled','config','fetchImpl','configurePhoto','configureStage','configureRuntime','getSelectionInput']);
  for (const key of ['fetchImpl','configurePhoto','configureStage','configureRuntime','getSelectionInput']) if (typeof c[key] !== 'function') fail('INVALID_CONFIGURATION');
  if (c.requestCredentials !== undefined && typeof c.requestCredentials !== 'function') fail('INVALID_CONFIGURATION');
  if (c.configureNotes !== undefined && typeof c.configureNotes !== 'function') fail('INVALID_CONFIGURATION');
  if (c.configureRegistration !== undefined && typeof c.configureRegistration !== 'function') fail('INVALID_CONFIGURATION');
  for (const key of ['getCurrentPhotoSelection','onCompareRegisteredPhoto','onApplyRegisteredPhotoFocus','onPrivatePhotosCleared']) if(c[key]!==undefined&&typeof c[key]!=='function')fail('INVALID_CONFIGURATION');
  const config = exact(c.config,['projectRef','supabaseUrl','publishableKey']), clock = c.clock ?? Date.now;
  // Keep the injected native fetch receiver-free throughout this session.
  const fetchImpl = c.fetchImpl;
  const auth = createPrivateSupabaseAuth({enabled:true,config,fetchImpl,clock,...(c.continuityStore?{continuityStore:c.continuityStore}:{})});
  const bridge = createPrivatePhotoSessionPort({enabled:true,projectRef:PROJECT,authClient:auth.authClient,clock});
  const listeners = new Set(); let started=false,disposed=false,startPromise=null,epoch=0,signature=null,mappingSerial=0,authActionSerial=0;
  let mapping=null,mappingRequest=null,mappingStatus='unresolved',mappingCode='SESSION_REQUIRED',mappingAbort=null,stageWorkspace=null;
  const mappingCache=new Map(),mappingReads=new Set();
  function notify(){for(const fn of listeners)try{fn();}catch{}}
  const session = () => bridge.port.getSession();
  function clearMapping(code='SESSION_REQUIRED') {
    mappingSerial++; mappingAbort?.abort();mappingAbort=null; mapping=null;mappingRequest=null;mappingStatus='unresolved';mappingCode=code;
    mappingCache.clear();for(const abort of mappingReads)abort.abort();mappingReads.clear();
  }
  function clearStage(code='SESSION_REQUIRED') {
    clearMapping(code);
    try{c.configureStage(null);}catch{} try{stageWorkspace?.dispose();}catch{}stageWorkspace=null;
  }
  function sync(){
    if(disposed)return null;const s=session(),next=s?JSON.stringify(s):null;
    if(next!==signature){signature=next;epoch++;clearStage();notify();}return s;
  }
  const offSession=bridge.port.subscribeSession(sync);
  const transport=async(url,request)=>{
    const before=session(),response=await fetchImpl(url,request);
    if((response?.status===401||response?.status===403)&&before&&same(before,session()))auth.invalidate();
    return response;
  };
  const runtime=createPrivateRuntimeClient({enabled:true,config,fetchImpl:transport,sessionPort:bridge.port,clock});
  const registration=c.configureRegistration?createPrivatePhotoRegistrationClient({enabled:true,config,fetchImpl:transport,sessionPort:bridge.port,clock,uploadCopyProcessor:createBrowserPhotoUploadCopyProcessor()}):null;
  const registrationReader=createPrivatePhotoRegistrationReader({enabled:true,config,fetchImpl:transport,sessionPort:bridge.port,clock});
  const deleteClient=createPrivatePhotoDeleteClient({enabled:true,config,fetchImpl:transport,sessionPort:bridge.port,clock});
  const notes=c.configureNotes?createPrivateSeatNotesOwnerClient({enabled:true,config,fetchImpl:transport,sessionPort:bridge.port,clock,createId:()=>globalThis.crypto.randomUUID()}):null;
  const runtimePort=Object.freeze({readJSON:runtime.readJSON,getSession:runtime.getSession,subscribeSession:runtime.subscribeSession});
  function runtimeState(){const s=sync(),a=auth.getState();return Object.freeze({mode:'private',status:s?'ready':['signing-in','refreshing'].includes(a.status)?'loading':a.status==='error'?'error':'locked',epoch});}
  function state(){const a=auth.getState();return Object.freeze({configured:true,started,disposed,authentication:disposed?'disposed':a.status,
    authenticated:!disposed&&!!sync(),mapping:Object.freeze({status:mappingStatus,code:mappingCode}),runtime:runtimeState()});}
  function input(preset){return requestValue(c.getSelectionInput(preset));}
  function live(s,serial){if(disposed||serial!==mappingSerial||!same(s,sync()))fail('SESSION_CHANGED');}
  function cacheMapping(request,value){const key=JSON.stringify(request);mappingCache.delete(key);mappingCache.set(key,value);
    if(mappingCache.size>128)mappingCache.delete(mappingCache.keys().next().value);}
  async function currentMapping(preset){
    if(disposed)fail('DISPOSED');const s=sync();if(!s)fail('SESSION_REQUIRED');const ownEpoch=epoch,ownMapping=mappingSerial,request=input(preset),view=input(null);
    if(!request||!view)fail('NO_EXPLICIT_MAPPING');if(!same(request.localContext,view.localContext))fail('SOURCE_CONTEXT_MISMATCH');
    const guard=()=>{if(disposed||ownEpoch!==epoch||!same(s,sync()))fail('SESSION_CHANGED');
      if(ownMapping!==mappingSerial||!same(view,input(null))||!same(request,input(preset)))fail('SELECTION_CHANGED');};
    const known=mappingCache.get(JSON.stringify(request));
    if(known){const result=mappingValue(known,request,preset);guard();return result;}
    if(mapping&&mappingRequest&&request.sourceScheme===mappingRequest.sourceScheme&&same(request.sourceIdentity,mappingRequest.sourceIdentity)&&same(request.localContext,mappingRequest.localContext)){
      try{const checked=mappingValue(mapping,request,preset);guard();cacheMapping(request,checked);return checked;}catch(e){if(['SESSION_CHANGED','SELECTION_CHANGED'].includes(errors.get(e)))throw e;}
    }
    const abort=new AbortController();mappingReads.add(abort);
    try{
      const result=await runtime.resolveMapping(request,{signal:abort.signal});guard();
      if(result.status!=='resolved')fail(result.code||'NO_EXPLICIT_MAPPING');
      const checked=mappingValue(result.mapping,request,preset);guard();cacheMapping(request,checked);return checked;
    }finally{mappingReads.delete(abort);}
  }
  async function selectionForSource(sourceIdentity, opts = {}) {
    if (disposed) fail('DISPOSED'); const before = sync(); if (!before) fail('SESSION_REQUIRED');
    const ownEpoch = epoch;
    const r = await runtime.resolveSelection({sourceScheme:'source2d',sourceIdentity}, opts);
    if (disposed || epoch !== ownEpoch || !same(before,sync())) fail('SESSION_CHANGED');
    if (r.status !== 'resolved') return r;
    const checked = resolveCanonicalSelection(r.selection,r.registry);
    const requested=resolveCanonicalSelection({...r.selection,sourceScheme:'source2d',sourceIdentity},r.registry);
    if (checked.status !== 'resolved' || requested.status!=='resolved' || !same(checked.canonical,r.canonical)
        || !same(requested.canonical,checked.canonical) || r.selection.sourceScheme !== 'source2d') fail('SOURCE_CONTEXT_MISMATCH');
    return Object.freeze({status:'resolved',selection:r.selection,registry:r.registry,canonical:r.canonical});
  }
  async function refreshMapping(preset=null){
    let ownAbort,serial;
    try{
      if(disposed)fail('DISPOSED');if(!started)fail('UNCONFIGURED');const s=sync();if(!s)fail('SESSION_REQUIRED');
      const request=input(preset),view=input(null);clearMapping(request?'NO_EXPLICIT_MAPPING':'LOCAL_SOURCE_UNAVAILABLE');serial=mappingSerial;
      if(request===null){notify();return Object.freeze({status:'unresolved',code:'LOCAL_SOURCE_UNAVAILABLE',mapping:null});}
      mappingStatus='loading';mappingCode=null;ownAbort=new AbortController();mappingAbort=ownAbort;notify();
      const result=await runtime.resolveMapping(request,{signal:ownAbort.signal});live(s,serial);
      if(!same(view,input(null))||!same(request,input(preset)))fail('SELECTION_CHANGED');
      if(result.status==='unresolved'){mappingStatus='unresolved';mappingCode=result.code;notify();return Object.freeze({status:'unresolved',code:result.code,mapping:null});}
      const checked=mappingValue(result.mapping,request,preset);live(s,serial);
      mapping=checked;mappingRequest=request;cacheMapping(request,checked);mappingStatus='resolved';mappingCode=null;
      // Mapping changes do not replace the same-session controller. Its CAS
      // revisions and uncertain-write receipts must survive selection refresh.
      if(!stageWorkspace){
        stageWorkspace=createPrivateStageWorkspace({enabled:true,snapshotVersion:2,config,sessionPort:bridge.port,fetchImpl:transport,clock});
        const attached=c.configureStage({workspace:stageWorkspace,sessionPort:bridge.port,getMapping:currentMapping});
        if(attached?.ok===false){clearStage('INVALID_CONFIGURATION');fail('INVALID_CONFIGURATION');}
      }
      live(s,serial);notify();
      return Object.freeze({status:'resolved'});
    }catch(e){
      const code=errors.get(e)||(['SESSION_REQUIRED','SESSION_CHANGED','ACCESS_DENIED','POLICY_UNCONFIGURED','ABORTED','REQUEST_FAILED','INVALID_RESPONSE','LIMIT_EXCEEDED'].includes(e?.code)?e.code:'MAPPING_REJECTED');
      if(!disposed&&(serial===undefined||serial===mappingSerial)){clearMapping(code);notify();}
      return failure(code);
    }finally{if(mappingAbort===ownAbort)mappingAbort=null;}
  }
  async function start(){
    if(disposed)return failure('DISPOSED');if(startPromise)return startPromise;
    started=true;startPromise=(async()=>{
      try{
        const attached=c.configureRuntime(runtimePort);if(attached?.ok===false)fail('INVALID_CONFIGURATION');
        clearStage();await auth.restore();await bridge.start();if(disposed)fail('DISPOSED');
        const photo={config,authClient:auth.authClient,fetchImpl:transport,logoutAction:async()=>{const result=await logout();if(!result.ok)fail(result.code);return result;},clock};
        // Registered photos are read/delete-only. Pre-registration local input
        // remains separate; no metadata-write capability is given to the UI.
        photo.registrationReader=registrationReader;photo.deleteClient=deleteClient;
        for(const key of ['getCurrentPhotoSelection','onCompareRegisteredPhoto','onApplyRegisteredPhotoFocus','onPrivatePhotosCleared'])if(c[key])photo[key]=c[key];
        if(c.requestCredentials)photo.loginAction=async({signal})=>{const result=await login(undefined,{signal});if(!result.ok&&result.status!=='cancelled')fail(result.code);return result;};
        const result=await c.configurePhoto(photo);if(disposed)fail('DISPOSED');
        if(result?.ok===false||result?.status==='configuration-error')fail('INVALID_CONFIGURATION');
        if(registration){const attached=await c.configureRegistration(registration);if(disposed)fail('DISPOSED');if(attached?.ok===false)fail('INVALID_CONFIGURATION');}
        if(notes){const attached=await c.configureNotes(notes);if(disposed)fail('DISPOSED');if(attached?.ok===false)fail('INVALID_CONFIGURATION');}
        sync();notify();return Object.freeze({ok:true,status:sync()?'ready':'authentication-required'});
      }catch(e){return failure(errors.get(e)||'INVALID_CONFIGURATION');}
    })();return startPromise;
  }
  async function login(credentials,opts={}){
    if(disposed)return failure('DISPOSED');const own=++authActionSerial,initial=await start();if(!initial.ok)return initial;
    let values=credentials;
    try{
      if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');
      if(values===undefined){if(!c.requestCredentials)return failure('CREDENTIALS_REQUIRED');values=await c.requestCredentials(opts);if(values===null||values===false)return Object.freeze({ok:false,code:'CANCELLED',status:'cancelled'});}
      if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');const result=await auth.signIn(values,opts);values=null;if(!result.ok)return result;
      await bridge.start();if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');sync();
      const resolved=await refreshMapping();if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');
      return sync()?Object.freeze({ok:true,status:'ready',mappingStatus:resolved.status||'unresolved'}):failure('SESSION_REQUIRED');
    }catch{return failure('AUTH_ACTION_FAILED');}finally{values=null;}
  }
  async function afterAuth(result,own){if(!result.ok)return result;await bridge.start();if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');
    sync();await refreshMapping();if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');return sync()?Object.freeze({ok:true,status:'ready'}):failure('SESSION_REQUIRED');}
  async function refresh(opts={}){if(disposed)return failure('DISPOSED');const own=++authActionSerial;return afterAuth(await auth.refresh(opts),own);}
  async function checkSession(){
    if(disposed)return failure('DISPOSED');const own=authActionSerial,a=auth.getState();sync();
    if(!a.authenticated)return failure('SESSION_REQUIRED');
    const result=a.expiresAt-clock()<=60000?await auth.refresh():await auth.verifySession();
    if(!result.ok)return result;await bridge.start();if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');sync();if(mappingStatus!=='resolved')await refreshMapping();
    if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');return sync()?Object.freeze({ok:true,status:'ready'}):failure('SESSION_REQUIRED');
  }
  async function logout(opts={}){if(disposed)return failure('DISPOSED');const own=++authActionSerial;clearStage();const result=await auth.signOut(opts);
    if(disposed||own!==authActionSerial)return failure('SESSION_CHANGED');sync();notify();return result;}
  return Object.freeze({start,login,logout,refresh,checkSession,refreshMapping,currentMapping,selectionForSource,sessionPort:bridge.port,getState:state,getRuntimeDataState:runtimeState,
    subscribe(fn){if(typeof fn!=='function'||disposed)fail('INPUT_INVALID');listeners.add(fn);return()=>listeners.delete(fn);},
    subscribeRuntimeData(fn){if(typeof fn!=='function'||disposed)fail('INPUT_INVALID');listeners.add(fn);return()=>listeners.delete(fn);},
    dispose({preserveContinuity=false}={}){if(disposed)return;disposed=true;authActionSerial++;epoch++;clearStage('DISPOSED');try{c.configurePhoto(null);}catch{}try{c.configureRuntime(null);}catch{}
      try{c.configureNotes?.(null);}catch{}notes?.dispose?.();try{c.configureRegistration?.(null);}catch{}registration?.dispose();registrationReader.dispose();deleteClient.dispose();offSession();runtime.dispose();bridge.dispose();auth.dispose({preserveContinuity:preserveContinuity===true});notify();listeners.clear();},
  });
}
