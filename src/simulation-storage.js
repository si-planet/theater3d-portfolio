import { STORED_CAMERA_ASPECTS, normalizeCameraAspectForApply } from './camera-config.js';
import { normalizeAuthoredGeometry } from './authored-geometry.js';
import { validatePresetLensDefinition } from './lens-config.js';
/** Local personal presets only. No official geometry, files, URLs or cloud writes.
 * Stored document: {schemaVersion:3,items:[preset]}; v1/v2 remain readable. Import allocates a new
 * ID. Unsupported record versions may be exported for recovery, never applied.
 */
export const SIMULATION_STORAGE_KEY = 'theater3d-portfolio.simulations.v1';
export const SIMULATION_SCHEMA_VERSION = 3;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_PRESET_BYTES = 256 * 1024;
const MAX_PRESETS = 100;
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (max=160) => v => typeof v==='string' && v.trim().length>0 && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v)
  && !/^(?:blob:|data:|https?:|file:)/i.test(v);
const id = v => string()(v) && /^[a-zA-Z0-9][a-zA-Z0-9:_.-]*$/.test(v) && !['__proto__','constructor','prototype'].includes(v);
const number = (min,max) => v => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const integer = (min,max=1000000) => v => Number.isSafeInteger(v) && v>=min && v<=max;
const boolean = v => typeof v==='boolean';
const nullable = validator => ({nullable:validator});
const enumeration = values => v => values.includes(v);
const shape = (fields,required=[]) => ({fields,required});
const array = (item,max) => ({array:item,max});
const seat = shape({row:integer(1),number:integer(1)},['row','number']);
const contextShape = shape({venueId:id,layoutVersionId:id,seatId:nullable(id)},['venueId','layoutVersionId']);
const color = v => typeof v==='string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(v);
const coordinate = number(-1000,1000);
const person = shape({id,name:string(60),x:coordinate,z:coordinate,heightM:number(.3,3),bodyPreset:enumeration(['male','female']),
  color,position:enumeration(['center','front','back','left','right','custom']),facingDeg:number(-180,360),pose:enumeration(['standing','chair','floor','cross-legged'])},['id','x','z','heightM']);
const structure = shape({id,name:string(60),type:enumeration(['box','cylinder']),x:coordinate,z:coordinate,widthM:number(.05,100),
  depthM:number(.05,100),diameterM:number(.05,100),heightM:number(.05,100),rotationDeg:number(-360,360),color},['id','type','x','z','heightM']);
const layoutShape = shape({people:array(person,128),structures:array(structure,20),selectedPersonId:nullable(id),selectedStructureId:nullable(id),
  nextPersonId:integer(1,Number.MAX_SAFE_INTEGER),nextStructureId:integer(1,Number.MAX_SAFE_INTEGER)},['people','structures']);
const audiencePerson = shape({id,name:string(100),seat,preset:enumeration(['male','female'])},['seat','preset']);
const audienceShape = shape({people:array(audiencePerson,1000),excludedSeats:array(seat,10000),visible:boolean,fullPreset:enumeration(['male','female','mixed']),editSeat:nullable(seat)},['people']);
const cameraShape = shape({focalLength35Mm:number(18,400),sightFocalLength35Mm:integer(5,20),sightViewEnabled:boolean,
  aspect:enumeration(STORED_CAMERA_ASPECTS),eyeHeightM:number(0,5),viewYawDeg:number(-360,360),viewPitchDeg:number(-90,90),
  followSelectedPerson:boolean,aimFraming:enumeration(['full','upper'])});
const editorShape = shape({yawDeg:number(-360,360),elevationDeg:number(10,80),zoom:number(.5,2)});
const arrangementShape = shape({spacingMode:enumeration(['fixed','endpoints']),axis:enumeration(['x','z','diagonal']),
  spacingCm:v=>typeof v==='number'&&Number.isFinite(v)&&v>0},['spacingMode','axis']);
const heightShape = shape({minCm:number(0,150),maxCm:number(0,150),offsetCm:number(0,150)},['minCm','maxCm','offsetCm']);
const lensShape = shape({mode:enumeration(['full','custom','lens']),minMm:number(18,400),maxMm:number(18,400),lensId:nullable(id),cropFactor:number(.1,10)});
const wallSidesShape = shape({back:boolean,left:boolean,right:boolean},['back','left','right']);
const settingsShape = shape({showGrid:boolean,stageWallsEnabled:boolean,stageWallSides:wallSidesShape,stageWallHeightM:number(.1,20),auditoriumBarriersEnabled:boolean,
  obstructionEnabled:boolean,obstructionWidthM:number(.05,100),obstructionHeightM:number(.05,100),obstructionX:coordinate,obstructionDepthM:number(0,100)});
const authoredGeometry = value => {try{normalizeAuthoredGeometry(value);return true;}catch{return false;}};
const stateShape = shape({authoredGeometry,seat,layout:layoutShape,audienceLayout:audienceShape,camera:cameraShape,editorCamera:editorShape,
  cameraHeightConfig:heightShape,lensConfig:lensShape,lensDefinition:object,settings:settingsShape,selectedPersonIds:array(id,128),
  personEditView:enumeration(['top','front','3d']),modelView:enumeration(['isometric','side']),personArrangement:arrangementShape});
const timestamp = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(Date.parse(v)).toISOString().slice(0,19)===v.slice(0,19);
const without = (fields,key) => Object.fromEntries(Object.entries(fields).filter(([k])=>k!==key));
const legacyLayout = shape({...layoutShape.fields,people:array(shape(without(person.fields,'pose'),person.required),128)},layoutShape.required);
const legacyAudience = shape(without(audienceShape.fields,'excludedSeats'),audienceShape.required);
const legacyCamera = shape({...cameraShape.fields,focalLength35Mm:number(8,400),sightFocalLength35Mm:number(8,24)},cameraShape.required);
const version2Person = shape({...person.fields,pose:enumeration(['standing','chair','floor'])},person.required);
const version2Layout = shape({...layoutShape.fields,people:array(version2Person,128)},layoutShape.required);
const version2State = shape({...without(without(stateShape.fields,'authoredGeometry'),'lensDefinition'),layout:version2Layout});
const legacyState = shape({...without(version2State.fields,'personArrangement'),layout:legacyLayout,audienceLayout:legacyAudience,camera:legacyCamera});
const presetShape = shape({schemaVersion:v=>[1,2,SIMULATION_SCHEMA_VERSION].includes(v),id,name:string(100),context:contextShape,state:stateShape,
  createdAt:timestamp,updatedAt:timestamp},['schemaVersion','id','name','context','state','createdAt','updatedAt']);
const issue = (code,path,message,severity='error') => ({code,path,severity,message});
function failure(code,path,message){const e=new Error(message);e.issue=issue(code,path,message);throw e;}
const bytes = text => new TextEncoder().encode(text).length;
const copy = value => JSON.parse(JSON.stringify(value));

// Check descriptors before reading fields: reject getters, prototype objects,
// cycles, symbols, undefined, holes and non-JSON values without coercion.
function jsonInput(v,path='',ancestors=new Set(),depth=0) {
  if(depth>24)failure('INVALID_INPUT',path,'입력 중첩이 너무 깊습니다.');
  if(v===null||typeof v==='boolean'||typeof v==='string')return;
  if(typeof v==='number'){if(!Number.isFinite(v))failure('INVALID_INPUT',path,'유한한 숫자가 필요합니다.');return;}
  if(typeof v!=='object')failure('INVALID_INPUT',path,'JSON 값만 허용합니다.');
  if(ancestors.has(v))failure('INVALID_INPUT',path,'순환 참조는 저장할 수 없습니다.');
  const proto=Object.getPrototypeOf(v);
  if(Array.isArray(v)?proto!==Array.prototype:proto!==Object.prototype&&proto!==null)failure('INVALID_INPUT',path,'일반 JSON 객체만 허용합니다.');
  const keys=Reflect.ownKeys(v);if(keys.length>10000)failure('INVALID_INPUT',path,'입력 필드가 너무 많습니다.');
  ancestors.add(v);
  for(const k of keys){if(Array.isArray(v)&&k==='length')continue;if(typeof k!=='string'||['__proto__','constructor','prototype'].includes(k))failure('UNSAFE_FIELD',path,'오염된 객체 키를 거부했습니다.');
    const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!own(d,'value')||!d.enumerable)failure('INVALID_INPUT',path+'.'+k,'접근자 필드는 저장할 수 없습니다.');
    if(Array.isArray(v)&&(!/^\d+$/.test(k)||Number(k)>=v.length))failure('INVALID_INPUT',path,'배열 외부 필드는 허용하지 않습니다.');
    jsonInput(d.value,path+'.'+k,ancestors,depth+1);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)failure('INVALID_INPUT',path,'빈 배열 요소는 허용하지 않습니다.');
  ancestors.delete(v);
}
function validate(v,spec,path) {
  if(typeof spec==='function'){if(!spec(v))failure('INVALID_INPUT',path,'저장 필드의 값이나 범위를 확인하세요.');return;}
  if(spec.nullable){if(v!==null)validate(v,spec.nullable,path);return;}
  if(spec.array){if(!Array.isArray(v)||v.length>spec.max)failure('INVALID_INPUT',path,'배열 크기를 확인하세요.');v.forEach((item,i)=>validate(item,spec.array,`${path}[${i}]`));return;}
  if(!object(v))failure('INVALID_INPUT',path,'객체가 필요합니다.');
  for(const k of Object.keys(v)){if(!own(spec.fields,k))failure('UNSAFE_FIELD',path+'.'+k,'사진·URL·공식 모델 등 허용하지 않은 필드입니다.');validate(v[k],spec.fields[k],path+'.'+k);}
  for(const k of spec.required)if(!own(v,k))failure('INVALID_INPUT',path+'.'+k,'필수 저장 필드가 없습니다.');
}
function checkState(s,version=SIMULATION_SCHEMA_VERSION) {
  validate(s,version===1?legacyState:version===2?version2State:stateShape,'state');if(!Object.keys(s).length)failure('INVALID_INPUT','state','저장할 개인 설정이 없습니다.');
  if(s.layout){const l=s.layout;for(const k of ['people','structures']){const ids=l[k].map(v=>v.id);if(new Set(ids).size!==ids.length)failure('INVALID_INPUT','state.layout.'+k,'중복된 인물/구조물 ID입니다.');}
    for(const [k,list]of [['selectedPersonId','people'],['selectedStructureId','structures']])if(l[k]!=null&&!l[list].some(v=>v.id===l[k]))failure('INVALID_INPUT','state.layout.'+k,'선택한 객체가 없습니다.');
    if(s.selectedPersonIds&&s.selectedPersonIds.some(v=>!l.people.some(p=>p.id===v)))failure('INVALID_INPUT','state.selectedPersonIds','선택한 인물이 없습니다.');
  }
  if(s.selectedPersonIds&&new Set(s.selectedPersonIds).size!==s.selectedPersonIds.length)failure('INVALID_INPUT','state.selectedPersonIds','중복된 선택입니다.');
  if(s.audienceLayout){const seats=s.audienceLayout.people.map(v=>`${v.seat.row}:${v.seat.number}`);if(new Set(seats).size!==seats.length)failure('INVALID_INPUT','state.audienceLayout.people','같은 좌석의 관객이 중복됩니다.');}
  if(s.audienceLayout?.excludedSeats){const seats=s.audienceLayout.excludedSeats.map(v=>`${v.row}:${v.number}`);if(new Set(seats).size!==seats.length)failure('INVALID_INPUT','state.audienceLayout.excludedSeats','제외 좌석이 중복됩니다.');}
  const h=s.cameraHeightConfig;if(h&&(h.minCm>h.maxCm||h.offsetCm<h.minCm||h.offsetCm>h.maxCm))failure('INVALID_INPUT','state.cameraHeightConfig','높이 범위와 현재 값을 확인하세요.');
  const lens=s.lensConfig;if(lens&&lens.minMm!==undefined&&lens.maxMm!==undefined&&lens.minMm>lens.maxMm)failure('INVALID_INPUT','state.lensConfig','렌즈 범위가 역전됐습니다.');
  if(own(s,'lensDefinition')&&!validatePresetLensDefinition(lens,s.lensDefinition))failure('INVALID_INPUT','state.lensDefinition','저장 당시 렌즈 정의와 유효 범위가 일치하지 않습니다.');
  if(s.personArrangement?.spacingMode==='fixed'&&s.personArrangement.axis==='diagonal')failure('INVALID_INPUT','state.personArrangement.axis','직접 간격 입력은 가로 또는 세로 배치를 선택하세요.');
}
function checkContext(c){jsonInput(c,'context');validate(c,contextShape,'context');}
function checkPreset(p){jsonInput(p);if(![1,2,SIMULATION_SCHEMA_VERSION].includes(p?.schemaVersion))failure('VERSION_MISMATCH','schemaVersion','지원하지 않는 배치 저장 버전입니다. 내보내기로 보존하세요.');validate(p,shape({...presetShape.fields,state:p.schemaVersion===1?legacyState:p.schemaVersion===2?version2State:stateShape},presetShape.required),'preset');checkState(p.state,p.schemaVersion);if(Date.parse(p.updatedAt)<Date.parse(p.createdAt))failure('INVALID_INPUT','updatedAt','수정 시각이 생성 시각보다 빠릅니다.');}

/** Copy-only adapter: reading/exporting never changes legacy records. */
export function prepareSimulationForApply(preset) {
  checkPreset(preset);
  const state=copy(preset.state),warnings=[];
  if(state.camera?.aspect!==undefined){
    const old=state.camera.aspect,next=normalizeCameraAspectForApply(old);
    if(old!==next)warnings.push(`이전 사진 화면비 ${old} → ${next} 적용. 저장 원본은 유지합니다.`);
    state.camera.aspect=next;
  }
  if(state.camera?.sightFocalLength35Mm!==undefined){
    const old=state.camera.sightFocalLength35Mm,next=Math.max(5,Math.min(20,Math.round(old)));
    if(old!==next)warnings.push(`이전 시야 ${old}mm → ${next}mm 적용. 저장 원본은 유지합니다.`);
    state.camera.sightFocalLength35Mm=next;
  }
  if(state.camera?.focalLength35Mm<18){warnings.push('이전 촬영값은 18mm로 적용합니다. 저장 원본은 유지합니다.');state.camera.focalLength35Mm=18;}
  if(state.layout)for(const p of state.layout.people)p.pose ||= 'standing';
  if(state.audienceLayout)state.audienceLayout.excludedSeats ||= [];
  return {state,warnings};
}
function contextMatch(actual,expected){checkContext(expected);if(actual.venueId!==expected.venueId||actual.layoutVersionId!==expected.layoutVersionId)failure('CONTEXT_MISMATCH','context','다른 극장 또는 배치 버전입니다. 적용하지 않았습니다.');if(own(expected,'seatId')&&(actual.seatId??null)!==expected.seatId)failure('SEAT_MISMATCH','context.seatId','저장 당시 좌석과 현재 좌석이 다릅니다.');}

export function createSimulationStorage({storage,clock=()=>new Date(),idFactory=()=>globalThis.crypto?.randomUUID?.()}={}) {
  function result(operation){try{return {ok:true,value:copy(operation()),issues:[]};}catch(e){return {ok:false,issues:[e?.issue??issue('STORAGE_UNAVAILABLE','','브라우저 저장소에 접근할 수 없습니다.')]};}}
  function backend(){let b;try{b=typeof storage==='function'?storage():storage===undefined?globalThis.localStorage:storage;}catch{failure('STORAGE_UNAVAILABLE','','브라우저 저장소 접근이 차단됐습니다.');}if(!b||typeof b.getItem!=='function'||typeof b.setItem!=='function')failure('STORAGE_UNAVAILABLE','','브라우저 저장소를 사용할 수 없습니다.');return b;}
  function read({recovery=false}={}){
    const b=backend();let raw;try{raw=b.getItem(SIMULATION_STORAGE_KEY);}catch{failure('STORAGE_UNAVAILABLE','','브라우저 저장소를 읽을 수 없습니다.');}
    if(raw===null)return {b,raw,document:{schemaVersion:SIMULATION_SCHEMA_VERSION,items:[]}};
    if(typeof raw!=='string'||bytes(raw)>MAX_DOCUMENT_BYTES)failure('CORRUPT_STORAGE','','저장 문서 형식 또는 크기가 잘못됐습니다.');
    let doc;try{doc=JSON.parse(raw);}catch{failure('CORRUPT_JSON','','저장된 JSON이 손상됐습니다. 기존 값을 보존했습니다.');}
    jsonInput(doc);if(!object(doc)||!Array.isArray(doc.items)||doc.items.length>MAX_PRESETS)failure('CORRUPT_STORAGE','','저장 목록이 손상됐습니다.');
    if(!recovery&&![1,2,SIMULATION_SCHEMA_VERSION].includes(doc.schemaVersion))failure('VERSION_MISMATCH','schemaVersion','지원하지 않는 저장소 버전입니다.');
    if(Object.keys(doc).some(k=>!['schemaVersion','items'].includes(k)))failure('CORRUPT_STORAGE','','알 수 없는 저장 목록 필드입니다.');
    const ids=doc.items.map(v=>v?.id);if(ids.some(v=>!id(v))||new Set(ids).size!==ids.length)failure('CORRUPT_STORAGE','','저장 ID가 손상되거나 중복됐습니다.');
    return {b,raw,document:doc};
  }
  function allValid(doc){for(const p of doc.items)checkPreset(p);}
  function write(snapshot,doc){const raw=JSON.stringify({...doc,schemaVersion:SIMULATION_SCHEMA_VERSION});if(bytes(raw)>MAX_DOCUMENT_BYTES)failure('CAPACITY_EXCEEDED','','저장 문서 용량 제한을 초과했습니다.');
    let current;try{current=snapshot.b.getItem(SIMULATION_STORAGE_KEY);}catch{failure('STORAGE_UNAVAILABLE','','저장 전 확인에 실패했습니다.');}
    if(current!==snapshot.raw)failure('STORAGE_CONFLICT','','다른 작업이 저장값을 변경했습니다. 다시 불러오세요.');
    try{snapshot.b.setItem(SIMULATION_STORAGE_KEY,raw);}catch(e){if(e?.name==='QuotaExceededError'||e?.code===22||e?.code===1014)failure('QUOTA_EXCEEDED','','브라우저 저장 용량을 초과했습니다. 기존 값을 보존했습니다.');failure('STORAGE_UNAVAILABLE','','브라우저 저장에 실패했습니다.');}
  }
  function make(name,context,state,doc,version=SIMULATION_SCHEMA_VERSION){jsonInput({name,context,state});if(!string(100)(name))failure('INVALID_INPUT','name','배치 이름은 1~100자로 입력하세요.');checkContext(context);checkState(state,version);
    let ident;try{ident=idFactory();}catch{failure('ID_UNAVAILABLE','id','저장 ID를 만들 수 없습니다.');}if(!id(ident))failure('ID_UNAVAILABLE','id','유효한 저장 ID가 필요합니다.');if(doc.items.some(p=>p.id===ident))failure('ID_COLLISION','id','기존 저장 ID와 충돌합니다. 덮어쓰지 않았습니다.');
    let time;try{const value=clock();const date=value instanceof Date?value:new Date(value);time=date.toISOString();}catch{failure('INVALID_CLOCK','','저장 시각을 만들 수 없습니다.');}if(!timestamp(time))failure('INVALID_CLOCK','','유효한 저장 시각이 필요합니다.');
    const p={schemaVersion:version,id:ident,name,context:copy(context),state:copy(state),createdAt:time,updatedAt:time};checkPreset(p);if(bytes(JSON.stringify(p))>MAX_PRESET_BYTES)failure('CAPACITY_EXCEEDED','state','개인 배치 용량 제한을 초과했습니다.');return p;
  }
  function add(name,context,state,version=SIMULATION_SCHEMA_VERSION){const snapshot=read();allValid(snapshot.document);if(snapshot.document.items.length>=MAX_PRESETS)failure('CAPACITY_EXCEEDED','','저장 개수 제한을 초과했습니다.');const p=make(name,context,state,snapshot.document,version);const doc={...snapshot.document,items:[...snapshot.document.items,p]};write(snapshot,doc);return p;}
  function located(snapshot,ident){if(!id(ident))failure('INVALID_INPUT','id','저장 ID를 확인하세요.');const p=snapshot.document.items.find(v=>v.id===ident);if(!p)failure('NOT_FOUND','id','저장한 배치를 찾을 수 없습니다.');return p;}
  return Object.freeze({
    list(context){return result(()=>{checkContext(context);const {document}=read();allValid(document);return document.items.filter(p=>p.context.venueId===context.venueId&&p.context.layoutVersionId===context.layoutVersionId).map(p=>({id:p.id,name:p.name,context:copy(p.context),schemaVersion:p.schemaVersion,createdAt:p.createdAt,updatedAt:p.updatedAt}));});},
    save(input){return result(()=>{jsonInput(input);validate(input,shape({name:string(100),context:contextShape,state:stateShape},['name','context','state']),'save');return add(input.name,input.context,input.state);});},
    load(ident,expectedContext){return result(()=>{const p=located(read(),ident);checkPreset(p);contextMatch(p.context,expectedContext);return p;});},
    remove(ident){return result(()=>{const snapshot=read();allValid(snapshot.document);located(snapshot,ident);write(snapshot,{...snapshot.document,items:snapshot.document.items.filter(p=>p.id!==ident)});return {id:ident};});},
    export(ident){const out=result(()=>{const snapshot=read({recovery:true});const p=located(snapshot,ident);return JSON.stringify(p,null,2);});if(out.ok){try{checkPreset(JSON.parse(out.value));}catch(e){out.issues.push({...e.issue,severity:'warning'});}}return out;},
    import(jsonText,expectedContext){return result(()=>{if(typeof jsonText!=='string'||bytes(jsonText)>MAX_PRESET_BYTES)failure('CAPACITY_EXCEEDED','','가져올 JSON의 크기를 확인하세요.');let p;try{p=JSON.parse(jsonText);}catch{failure('CORRUPT_JSON','','가져올 JSON이 손상됐습니다.');}checkPreset(p);contextMatch(p.context,expectedContext);return add(p.name,p.context,p.state,p.schemaVersion);});},
  });
}
