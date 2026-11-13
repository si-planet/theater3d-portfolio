import { renderStageEditorView } from './scene.js';
import { normalizeGeometry, createSeatList } from './geometry.js';

const RECORD_KEYS = ['informationRecordId','name','sourceDisplayName','sourceBundleVenueKey','features','capabilities','preserveExistingFullModel','currentLayoutMatch','validPeriod','identityQualification'];
const FEATURE_KEYS = ['id','kind','closed','frame','points','accuracy','sourceRefs','semanticRole','surfaceScope'];
const FRAME_KEYS = ['id','unit','originMeaning','globalTransform','seatFrame','audienceRelativeHeightM'];
const ACCURACY_KEYS = ['classification','rawUnit','mmAssumption','holdoutValidation','independentAxisFits','metricHoldoutsPassed','metricOfficial','officialMetric','status','yScaleInterpretation'];
const REFERENCE_KEYS = ['sourceId','url','sha256','page','locator','documentName'];
const SURFACE_KINDS = new Set(['stage_surface','dimension_envelope']);
const REFERENCE_KINDS = new Set(['dimension_envelope','vertical_reference_frame','opening_frame','equipment_frame']);
const CLASSIFICATIONS = new Set(['official','measured_derivation','conditional_assumption','official_source_geometry']);
const UNITS = new Set(['m','pdf_pt','pdf_point']);
const BAD_KEYS = new Set(['__proto__','constructor','prototype']);
const DEFAULT_CAMERA = Object.freeze({ yawDeg:28, elevationDeg:34, zoom:1 });
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const yaw = v => ((v+180)%360+360)%360-180;

function object(value, allowed, label, required=[]) {
  if (!value || typeof value!=='object' || Array.isArray(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: plain object required`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key!=='string' || BAD_KEYS.has(key) || !allowed.includes(key)) throw new TypeError(`${label}: unsupported field`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable) throw new TypeError(`${label}: data fields required`);
  }
  for (const key of required) if (!Object.hasOwn(value,key)) throw new TypeError(`${label}: missing field ${key}`);
}
function text(value,label,max=2000) {
  if (typeof value!=='string' || !value.trim() || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new TypeError(`${label}: bounded text required`);
  return value;
}
function identifier(value,label) {
  if (typeof value!=='string' || !/^[A-Za-z0-9][A-Za-z0-9:_.-]{0,199}$/.test(value) || BAD_KEYS.has(value)) throw new TypeError(`${label}: identifier required`);
  return value;
}
function list(value,label,min=1,max=20000) {
  if (!Array.isArray(value) || value.length<min || value.length>max) throw new TypeError(`${label}: bounded array required`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (typeof key!=='string' || key!=='length'&&!/^(0|[1-9][0-9]*)$/.test(key) || !descriptor || !Object.hasOwn(descriptor,'value')) throw new TypeError(`${label}: plain array data required`);
  }
  for(let index=0;index<value.length;index++) if(!Object.hasOwn(value,index)) throw new TypeError(`${label}: sparse array unsupported`);
}
function copyJSON(value,depth=0) {
  if (depth>20) throw new TypeError('structure: metadata nesting too deep');
  if (value===null || typeof value==='boolean' || typeof value==='string') return value;
  if (typeof value==='number') { if(!Number.isFinite(value)) throw new TypeError('structure: nonfinite metadata');return value; }
  if (Array.isArray(value)) { list(value,'metadata',0);return value.map(v=>copyJSON(v,depth+1)); }
  if (value && typeof value==='object') {
    const keys=Reflect.ownKeys(value);object(value,keys,'metadata');
    return Object.fromEntries(keys.map(key=>[key,copyJSON(value[key],depth+1)]));
  }
  throw new TypeError('structure: JSON data required');
}

function checkedFeature(feature) {
  object(feature,FEATURE_KEYS,'feature',['id','kind','closed','frame','points','accuracy','sourceRefs']);
  identifier(feature.id,'feature.id');identifier(feature.kind,'feature.kind');
  if (feature.closed!==null && typeof feature.closed!=='boolean') throw new TypeError('feature.closed: explicit boolean or null required');
  object(feature.frame,FRAME_KEYS,'feature.frame',FRAME_KEYS);
  identifier(feature.frame.id,'frame.id');
  if(!UNITS.has(feature.frame.unit)) throw new TypeError('frame.unit: unsupported unit');
  text(feature.frame.originMeaning,'frame.originMeaning');
  for(const key of ['globalTransform','seatFrame','audienceRelativeHeightM']) if(feature.frame[key]!==null) throw new TypeError(`frame.${key}: unregistered relationship must remain null`);
  object(feature.accuracy,ACCURACY_KEYS,'accuracy',['classification','rawUnit','mmAssumption']);
  if(!CLASSIFICATIONS.has(feature.accuracy.classification) || typeof feature.accuracy.mmAssumption!=='boolean') throw new TypeError('accuracy: explicit classification and assumption flag required');
  if(feature.accuracy.rawUnit!==null) text(feature.accuracy.rawUnit,'accuracy.rawUnit',100);
  for(const key of ['metricOfficial','officialMetric','independentAxisFits']) if(Object.hasOwn(feature.accuracy,key)&&typeof feature.accuracy[key]!=='boolean') throw new TypeError(`accuracy.${key}: boolean required`);
  if(Object.hasOwn(feature.accuracy,'metricHoldoutsPassed')&&(!Number.isSafeInteger(feature.accuracy.metricHoldoutsPassed)||feature.accuracy.metricHoldoutsPassed<0)) throw new TypeError('accuracy: invalid holdout count');
  list(feature.points,'feature.points',2);
  for(const point of feature.points) {
    object(point,['x','y','z'],'point',['x','y','z']);
    if(!['x','y','z'].every(key=>typeof point[key]==='number'&&Number.isFinite(point[key])&&Math.abs(point[key])<=1e8)) throw new TypeError('point: explicit finite numeric coordinates required');
  }
  if(!['x','y','z'].some(key=>feature.points.some(p=>p[key]!==feature.points[0][key]))) throw new TypeError('point: nonzero source extent required');
  list(feature.sourceRefs,'sourceRefs',1,200);
  for(const ref of feature.sourceRefs) {
    object(ref,REFERENCE_KEYS,'sourceRef');
    if(!Object.keys(ref).length) throw new TypeError('sourceRef: provenance required');
    if(ref.url!==undefined) {
      const u=new URL(text(ref.url,'sourceRef.url',4000));
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new TypeError('sourceRef: public reference URL only');
    }
    if(ref.sha256!==undefined&&!/^[0-9a-f]{64}$/.test(ref.sha256)) throw new TypeError('sourceRef: invalid digest');
    for(const key of ['documentName','locator','sourceId']) if(ref[key]!==undefined) {
      text(ref[key],'sourceRef.'+key,8000);
      if(/(?:file:\/\/|\/Users\/|\/tmp\/)/i.test(ref[key])) throw new TypeError('sourceRef: local path unsupported');
    }
    if(ref.page!==undefined && !(typeof ref.page==='number'&&Number.isSafeInteger(ref.page)&&ref.page>=0 || typeof ref.page==='string'&&ref.page.trim())) throw new TypeError('sourceRef.page: explicit locator required');
  }
  return feature;
}

/** Detached input data only. No defaults for coordinates, units or relationships. */
export function normalizeLimitedStructureRecord(record) {
  object(record,RECORD_KEYS,'structure',['informationRecordId','name','features','capabilities']);
  identifier(record.informationRecordId,'informationRecordId');text(record.name,'name',400);
  if(record.sourceDisplayName!==undefined&&record.sourceDisplayName!==null) text(record.sourceDisplayName,'sourceDisplayName',400);
  object(record.capabilities,['structureExploration','seatSelection','sightline'],'capabilities',['structureExploration','seatSelection','sightline']);
  if(record.capabilities.structureExploration!==true||record.capabilities.seatSelection!==false||record.capabilities.sightline!==false) throw new TypeError('structure: unsupported capability escalation');
  list(record.features,'features',1,1000);
  const ids=new Set();
  for(const feature of record.features) {checkedFeature(feature);if(ids.has(feature.id))throw new TypeError('structure: duplicate feature id');ids.add(feature.id);}
  return copyJSON(record);
}

export function assessFeature(feature) {
  try { checkedFeature(feature); } catch(error) { return { valid:false,issues:[String(error.message)],surfaceView:false,sourceLineView:false,conditional:false,referenceOnly:false,seatSelection:false,sightline:false }; }
  const points=feature.points;
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=(a.x*b.z-b.x*a.z)/2;}
  const surfaceView=SURFACE_KINDS.has(feature.kind)&&feature.closed!==false&&feature.frame.unit==='m'&&points.length>=3&&points.every(p=>p.y===0&&Math.max(Math.abs(p.x),Math.abs(p.z))<=1000)&&Number.isFinite(area)&&Math.abs(area)>1e-8;
  const conditional=feature.accuracy.mmAssumption===true||feature.accuracy.classification==='conditional_assumption';
  const unresolved=/holdout_unresolved|failed_holdout|failed/i.test(String(feature.accuracy.status||'')+' '+String(feature.accuracy.holdoutValidation||''));
  const referenceOnly=REFERENCE_KINDS.has(feature.kind)||unresolved;
  return { valid:true,issues:[],surfaceView,sourceLineView:true,conditional,referenceOnly,seatSelection:false,sightline:false };
}

/** y=0 is this feature's local datum, never a measured audience-floor level. */
export function stageEditorGeometry(feature,{allowConditional=false,allowDimensionEnvelope=false}={}) {
  const assessment=assessFeature(feature);
  if(!assessment.valid||!assessment.surfaceView) throw new TypeError('structure: this feature is not a metre surface');
  if(assessment.conditional&&!allowConditional) throw new TypeError('structure: explicit conditional preview required');
  if(assessment.referenceOnly&&!allowDimensionEnvelope) throw new TypeError('structure: explicit reference preview required');
  const xs=feature.points.map(p=>p.x),zs=feature.points.map(p=>p.z);
  const geometry={stagePolygon:feature.points.map(({x,z})=>({x,z})),stageWidthM:Math.max(...xs)-Math.min(...xs),stageDepthM:Math.max(...zs)-Math.min(...zs),stageHeightM:0,seats:[],rowPlatforms:[],roomBoundary:[],auditoriumBarriers:{enabled:false,items:[]}};
  if(!(geometry.stageWidthM>0&&geometry.stageDepthM>0)) throw new TypeError('structure: nonzero surface extent required');
  const normalized=normalizeGeometry(geometry);
  if(createSeatList(normalized).length||normalized.rowPlatforms.length||normalized.roomBoundary.length) throw new TypeError('structure: generated audience geometry');
  return geometry;
}

export const LIMITED_STRUCTURE_SURFACE_STYLE = Object.freeze({fill:'#70859a',stroke:'#243b50',lineWidth:2});

/** Presentation only: the existing renderer owns the camera and local datum. */
export function projectLimitedSurface(feature,projection) {
  if(!assessFeature(feature).surfaceView) throw new TypeError('structure: surface projection required');
  const finitePoint=point=>point&&['x','y','z'].every(key=>Number.isFinite(point[key]));
  if(projection?.kind==='plan') {
    if(!Number.isFinite(projection.origin?.x)||!Number.isFinite(projection.origin?.y)||!Number.isFinite(projection.scale)||projection.scale<=0) throw new TypeError('structure: finite plan projection required');
    return feature.points.map(p=>({x:projection.origin.x+p.x*projection.scale,y:projection.origin.y+p.z*projection.scale}));
  }
  const {basis,viewport,focal,near}=projection||{};
  if(projection?.kind!=='perspective'||!['position','right','up','forward'].every(key=>finitePoint(basis?.[key]))||!viewport||!['x','y','width','height'].every(key=>Number.isFinite(viewport[key]))||!Number.isFinite(focal)||focal<=0||!Number.isFinite(near)||near<=0) throw new TypeError('structure: finite perspective projection required');
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  const camera=feature.points.map(p=>{const delta={x:p.x-basis.position.x,y:p.y-basis.position.y,z:p.z-basis.position.z};return {x:dot(delta,basis.right),y:dot(delta,basis.up),depth:dot(delta,basis.forward)};});
  const clipped=[];
  for(let i=0;i<camera.length;i++) {
    const a=camera[i],b=camera[(i+1)%camera.length],insideA=a.depth>=near,insideB=b.depth>=near;
    if(insideA)clipped.push(a);
    if(insideA!==insideB){const t=(near-a.depth)/(b.depth-a.depth);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,depth:near});}
  }
  return clipped.map(p=>({x:viewport.x+viewport.width/2+p.x*focal/p.depth,y:viewport.y+viewport.height/2-p.y*focal/p.depth}));
}

export function renderLimitedStructure(canvas,feature,{view='top',allowConditional=false,allowDimensionEnvelope=false,camera={}}={}) {
  if(!['top','3d'].includes(view)) throw new TypeError('structure: top or 3d preview only');
  const geometry=stageEditorGeometry(feature,{allowConditional,allowDimensionEnvelope});
  const result=renderStageEditorView(canvas,{geometry,people:[],structures:[],selectedPersonIds:[],view,showGrid:false,camera});
  let surfacePresentation=null;
  if(!result.error&&result.editProjection) {
    const polygon=projectLimitedSurface(feature,result.editProjection),ctx=canvas.getContext('2d');
    if(ctx&&polygon.length>=3) {
      ctx.save();ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
      ctx.beginPath();polygon.forEach((p,index)=>index?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
      ctx.fillStyle=LIMITED_STRUCTURE_SURFACE_STYLE.fill;ctx.fill();
      ctx.strokeStyle=LIMITED_STRUCTURE_SURFACE_STYLE.stroke;ctx.lineWidth=LIMITED_STRUCTURE_SURFACE_STYLE.lineWidth;ctx.lineJoin='round';ctx.stroke();ctx.restore();
      surfacePresentation={...LIMITED_STRUCTURE_SURFACE_STYLE,pointCount:polygon.length};
    }
  }
  return {...result,surfacePresentation,capabilities:{stageSurface:true,seatSelection:false,sightline:false},frame:copyJSON(feature.frame),physicalStageElevationAboveAudienceM:null,featureAssessment:assessFeature(feature)};
}

function linePoints(feature) {
  let a='x',b=feature.points.some(p=>p.y!==0)?'y':'z';
  if(Math.max(...feature.points.map(p=>p.x))-Math.min(...feature.points.map(p=>p.x))<1e-9) a='z';
  return feature.points.map(p=>({x:p[a],y:b==='y'?-p[b]:p[b]}));
}
const LABELS={stage_surface:'무대 면',dimension_envelope:'제원 참고',open_polyline:'경계선',source_open_polyline:'구조선',vertical_reference_frame:'개구틀',opening_frame:'개구틀',equipment_frame:'부분구조'};

/** One feature, one local frame. No scene merge, seats, audience or sightlines. */
export function createLimitedStructureWorkspace({container}={}) {
  if(!container||typeof container.append!=='function') throw new TypeError('structure: container required');
  const doc=container.ownerDocument||globalThis.document,win=doc?.defaultView||globalThis;
  if(!doc?.createElement) throw new TypeError('structure: document required');
  const el=(tag,className,id,label)=>{const n=doc.createElement(tag);if(className)n.className=className;if(id)n.id=id;if(label!==undefined)n.textContent=label;return n;};
  const root=el('section','limited-structure-workspace');root.hidden=true;root.setAttribute('aria-label','무대 구조');
  const heading=el('div','limited-structure-heading'),title=el('h2','','','무대 구조'),badge=el('span','limited-structure-badge');heading.append(title,badge);
  const toolbar=el('div','limited-structure-toolbar'),label=el('label','','','구조'),select=el('select','','limited-structure-feature');select.setAttribute('aria-label','무대 구조 선택');label.append(select);
  const modes=el('div','segmented limited-structure-views');modes.setAttribute('role','group');modes.setAttribute('aria-label','무대 구조 보기');
  const button=(id,text)=>{const n=el('button','quiet-button',id,text);n.type='button';return n;};
  const top=button('limited-structure-view-top','평면'),three=button('limited-structure-view-3d','3D'),fitButton=button('limited-structure-fit','전체 보기');modes.append(top,three);toolbar.append(label,modes,fitButton);
  const consentBox=el('div','limited-structure-preview-gate'),consentNote=el('p','small-note'),consentButton=button('limited-structure-preview-consent','가정 비율로 보기');consentBox.append(consentNote,consentButton);
  const wrap=el('div','limited-structure-canvas-wrap'),canvas=el('canvas','','limited-structure-canvas');canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','무대 구조');wrap.append(canvas);
  const status=el('p','limited-structure-status','limited-structure-status');status.setAttribute('role','status');root.append(heading,toolbar,consentBox,wrap,status);container.append(root);
  let record=null,feature=null,assessment=null,view='top',consented=false,camera={...DEFAULT_CAMERA},pan={x:0,y:0},pointer=null,destroyed=false,scheduled=null,observer=null;
  const disposers=[];
  const on=(target,event,handler,options)=>{target.addEventListener(event,handler,options);disposers.push(()=>target.removeEventListener(event,handler,options));};
  function diagnostic(ready=false) {
    const data={informationRecordId:record?.informationRecordId||'',featureId:feature?.id||'',kind:feature?.kind||'',frameId:feature?.frame.id||'',unit:feature?.frame.unit||'',condition:String(Boolean(assessment?.conditional)),reference:String(Boolean(assessment?.referenceOnly)),consent:assessment?.conditional||assessment?.referenceOnly?(consented?'accepted':'pending'):'not-required',view,drawReady:String(ready),seatCount:'0',peopleCount:'0',sightline:'false',featureCount:String(record?.features.length||0),visibleFeatureCount:ready?'1':'0',closed:feature?.closed===null?'null':String(feature?.closed??''),yaw:String(camera.yawDeg),elevation:String(camera.elevationDeg),zoom:String(camera.zoom),panX:String(pan.x),panY:String(pan.y),physicalStageElevationAboveAudienceM:'null'};
    Object.assign(root.dataset,data);Object.assign(canvas.dataset,data);
  }
  function stopPointer() {const previous=pointer;pointer=null;if(previous&&canvas.hasPointerCapture?.(previous.id))canvas.releasePointerCapture(previous.id);}
  function clearCanvas() {const ctx=canvas.getContext('2d');if(ctx){ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);}canvas.width=1;canvas.height=1;}
  function schedule() {if(scheduled!==null||destroyed)return;const raf=win.requestAnimationFrame||((fn)=>win.setTimeout(fn,0));scheduled=raf(()=>{scheduled=null;draw();});}
  function drawLine() {
    const rect=canvas.getBoundingClientRect(),width=Math.max(1,rect.width||800),height=Math.max(1,rect.height||440),dpr=clamp(win.devicePixelRatio||1,1,3);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);const ctx=canvas.getContext('2d');if(!ctx)return false;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#f4f5f7';ctx.fillRect(0,0,width,height);
    const points=linePoints(feature),xs=points.map(p=>p.x),ys=points.map(p=>p.y),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
    const scale=Math.min((width-48)/Math.max(1e-9,xmax-xmin),(height-48)/Math.max(1e-9,ymax-ymin))*camera.zoom;
    ctx.beginPath();points.forEach((point,index)=>{const x=width/2+(point.x-(xmin+xmax)/2)*scale+pan.x,y=height/2+(point.y-(ymin+ymax)/2)*scale+pan.y;index?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    if(feature.closed===true)ctx.closePath();ctx.strokeStyle='#3d566c';ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();return true;
  }
  function draw() {
    if(destroyed||!record||!feature){diagnostic(false);return;}
    const pending=(assessment.conditional||assessment.referenceOnly)&&!consented;
    canvas.hidden=pending;wrap.hidden=pending;consentBox.hidden=!(assessment.conditional||assessment.referenceOnly);consentNote.hidden=!pending;three.hidden=!assessment.surfaceView;
    top.disabled=pending;three.disabled=pending;fitButton.disabled=pending;top.textContent=assessment.surfaceView?'평면':'선 보기';
    top.setAttribute('aria-pressed',String(view!=='3d'));three.setAttribute('aria-pressed',String(view==='3d'));
    badge.textContent=(assessment.referenceOnly?'제원 참고':assessment.conditional?'가정 비율':assessment.surfaceView?'무대 면':'구조선')+' · '+(feature.frame.unit==='m'?(assessment.conditional?'단위 가정':'m'):'도면 단위');
    consentButton.textContent=consented?'미리보기 해제':assessment.referenceOnly?'제원 참고 보기':'가정 비율로 보기';
    consentNote.textContent=assessment.referenceOnly?'실제 무대 외곽과 구별해 참고합니다.':'치수 해석을 가정한 비율로 확인합니다.';
    status.textContent=pending?'미리보기를 선택해 구조를 확인하세요.':assessment.surfaceView?'무대 구조만 표시합니다.':'선으로 표시합니다. 드래그로 이동하고 스크롤로 확대합니다.';
    if(pending){clearCanvas();diagnostic(false);return;}
    let ready=false;
    try {
      if(assessment.surfaceView){const result=renderLimitedStructure(canvas,feature,{view,camera,allowConditional:consented,allowDimensionEnvelope:consented});ready=!result.error&&!(result.personProjections?.length)&&!(result.structureProjections?.length);}
      else ready=drawLine();
    } catch {status.textContent='이 구조를 표시할 수 없습니다.';}
    diagnostic(ready);
  }
  function fit() {if(destroyed)return;stopPointer();camera={...DEFAULT_CAMERA};pan={x:0,y:0};schedule();}
  function choose() {stopPointer();feature=record?.features.find(f=>f.id===select.value)||null;assessment=feature?assessFeature(feature):null;consented=false;view=assessment?.surfaceView?'top':'line';camera={...DEFAULT_CAMERA};pan={x:0,y:0};draw();}
  on(select,'change',choose);on(fitButton,'click',fit);
  on(top,'click',()=>{if(!feature||top.disabled)return;stopPointer();view=assessment.surfaceView?'top':'line';schedule();});
  on(three,'click',()=>{if(!assessment?.surfaceView||three.disabled)return;stopPointer();view='3d';schedule();});
  on(consentButton,'click',()=>{if(!feature)return;stopPointer();consented=!consented;draw();});
  on(canvas,'pointerdown',event=>{if(!feature||canvas.hidden||event.button!==0&&event.pointerType!=='touch')return;event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});pointer={id:event.pointerId,x:event.clientX,y:event.clientY,camera:{...camera},pan:{...pan}};try{canvas.setPointerCapture(event.pointerId);}catch{}});
  on(canvas,'pointermove',event=>{if(!pointer||pointer.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;if(view==='3d')camera={...camera,yawDeg:yaw(pointer.camera.yawDeg+dx*.4),elevationDeg:clamp(pointer.camera.elevationDeg-dy*.25,10,80)};else if(!assessment.surfaceView)pan={x:pointer.pan.x+dx,y:pointer.pan.y+dy};schedule();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])on(canvas,type,event=>{if(pointer?.id===event.pointerId)stopPointer();});
  on(canvas,'wheel',event=>{if(!feature||canvas.hidden)return;event.preventDefault();event.stopPropagation();const unit=event.deltaMode===1?16:event.deltaMode===2?300:1;camera.zoom=clamp(camera.zoom*Math.exp(-clamp(event.deltaY*unit,-300,300)*.002),.5,2);if(pointer)pointer.camera.zoom=camera.zoom;schedule();},{passive:false});
  on(canvas,'keydown',event=>{if(!feature||canvas.hidden)return;const step=event.shiftKey?1:5;if(event.key==='Home')fit();else if(['+','=','-','_'].includes(event.key)){camera.zoom=clamp(camera.zoom*(['+','='].includes(event.key)?1.2:1/1.2),.5,2);schedule();}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){stopPointer();if(view==='3d'){camera.yawDeg=yaw(camera.yawDeg+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0));camera.elevationDeg=clamp(camera.elevationDeg+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0),10,80);}else if(!assessment.surfaceView){pan.x+=event.key==='ArrowLeft'?32:event.key==='ArrowRight'?-32:0;pan.y+=event.key==='ArrowUp'?32:event.key==='ArrowDown'?-32:0;}schedule();}else return;event.preventDefault();event.stopPropagation();});
  const Observer=win.ResizeObserver||globalThis.ResizeObserver;if(Observer){observer=new Observer(schedule);observer.observe(canvas);}else if(win.addEventListener)on(win,'resize',schedule);
  diagnostic(false);
  return {
    setRecord(next){if(destroyed)throw new Error('structure: workspace destroyed');stopPointer();record=null;feature=null;assessment=null;consented=false;view='top';camera={...DEFAULT_CAMERA};pan={x:0,y:0};root.hidden=true;select.replaceChildren();badge.textContent='';status.textContent='';consentNote.textContent='';canvas.hidden=true;wrap.hidden=true;consentBox.hidden=true;clearCanvas();diagnostic(false);if(next===null)return;record=normalizeLimitedStructureRecord(next);const counts=new Map();for(const f of record.features){const label=LABELS[f.kind]||'구조선',number=(counts.get(label)||0)+1;counts.set(label,number);const option=el('option','','',label+' '+number);option.value=f.id;select.append(option);}root.hidden=false;select.value=record.features[0].id;choose();},
    fit,
    destroy(){if(destroyed)return;stopPointer();destroyed=true;if(scheduled!==null){const cancel=win.cancelAnimationFrame||win.clearTimeout;cancel?.call(win,scheduled);}observer?.disconnect();for(const dispose of disposers)dispose();record=null;feature=null;root.remove();},
  };
}
