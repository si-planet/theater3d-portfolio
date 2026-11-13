import { normalizeGeometry, stageBounds, createSeatList } from './geometry.js';

/** Personal metre-based adjustments only. Source models and seat identity stay untouched. */
export const AUTHORED_GEOMETRY_VERSION = 1;
export const AUTHORED_GEOMETRY_LIMITS = Object.freeze({ maxVertices: 32, coordinateM: 100, maxHeightM: 10 });
const finite = v => typeof v === 'number' && Number.isFinite(v);
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
const plain = v => v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v));
const clone = v => JSON.parse(JSON.stringify(v));
const EPS = 1e-7;
const cross = (a,b,c) => (b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
const on = (p,a,b) => Math.abs(cross(a,b,p))<EPS && p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS && p.z>=Math.min(a.z,b.z)-EPS && p.z<=Math.max(a.z,b.z)+EPS;
function intersect(a,b,c,d){const x=cross(a,b,c),y=cross(a,b,d),u=cross(c,d,a),v=cross(c,d,b);return (x*y<0&&u*v<0)||on(a,c,d)||on(b,c,d)||on(c,a,b)||on(d,a,b);}
function fail(message){throw new TypeError(message);}

export function validateAuthoredOutline(points) {
  if (!Array.isArray(points) || points.length<3 || points.length>32) return {valid:false,error:'꼭짓점은 3~32개로 설정하세요.'};
  if(points.some(p=>!plain(p)||Object.keys(p).some(k=>!['x','z'].includes(k))||!finite(p.x)||!finite(p.z)||Math.abs(p.x)>100||Math.abs(p.z)>100))return {valid:false,error:'꼭짓점 좌표는 −100~100 m의 숫자로 입력하세요.'};
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(b.x-a.x,b.z-a.z)<.01)return {valid:false,error:'서로 붙은 꼭짓점은 1 cm 이상 떨어뜨리세요.'};
    area+=a.x*b.z-a.z*b.x;
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(intersect(a,b,points[j],points[(j+1)%points.length]))return {valid:false,error:'무대 외곽선이 교차하지 않도록 꼭짓점을 옮기세요.'};
    }
  }
  return Math.abs(area)>=.02?{valid:true,value:clone(points)}:{valid:false,error:'무대 면적은 0.01 ㎡ 이상이어야 합니다.'};
}

/** Strict JSON contract usable by persistence before a model has been loaded. */
export function normalizeAuthoredGeometry(value) {
  if(!plain(value)||Object.keys(value).some(k=>!['schemaVersion','stagePolygon','stageHeightM','seatBlockAngles'].includes(k))||value.schemaVersion!==1)fail('개인 형상 설정의 버전을 확인하세요.');
  const out={schemaVersion:1};
  if(own(value,'stagePolygon')){const v=validateAuthoredOutline(value.stagePolygon);if(!v.valid)fail(v.error);out.stagePolygon=v.value;}
  if(own(value,'stageHeightM')){if(!finite(value.stageHeightM)||value.stageHeightM<0||value.stageHeightM>10)fail('무대 높이는 0~1000 cm로 입력하세요.');out.stageHeightM=value.stageHeightM;}
  if(own(value,'seatBlockAngles')){
    if(!Array.isArray(value.seatBlockAngles)||value.seatBlockAngles.length>100)fail('객석 구역 설정이 너무 많습니다.');
    const keys=new Set();out.seatBlockAngles=value.seatBlockAngles.map(item=>{
      if(!plain(item)||Object.keys(item).some(k=>!['blockKey','rotationDeg'].includes(k))||typeof item.blockKey!=='string'||!/^block:[^\u0000-\u001f\u007f]{1,80}$/.test(item.blockKey)||keys.has(item.blockKey)||!finite(item.rotationDeg)||item.rotationDeg < -180||item.rotationDeg>180)fail('객석 구역 방향 설정을 확인하세요.');
      keys.add(item.blockKey);return {blockKey:item.blockKey,rotationDeg:item.rotationDeg};
    });
  }
  return out;
}

function blockLabel(seat,{rowMeaning}={}){
  for(const key of ['blockLabel','sectionLabel','section','zoneLabel','zone'])if(typeof seat[key]==='string'&&seat[key].trim())return seat[key].trim();
  const label=String(seat.rowLabel||'').trim(),match=label.match(/^(.+?구역)(?:\s|$)/);
  if(match)return match[1];
  if(rowMeaning==='section'&&label)return label.endsWith('구역')?label:label+'구역';
  return null;
}
export function authoredSeatBlocks(geometry,options={}){
  const map=new Map();
  for(const seat of createSeatList(geometry)){
    const label=blockLabel(seat,options);if(!label)continue;
    const key='block:'+label;let block=map.get(key);if(!block){block={key,label,seatKeys:[]};map.set(key,block);}block.seatKeys.push(`${seat.row}:${seat.number}`);
  }
  return [...map.values()];
}
export function sourceStageOutline(geometry){const g=normalizeGeometry(geometry),b=stageBounds(g);return own(g,'stagePolygon')?clone(g.stagePolygon):b?[{x:b.xMin,z:b.zMin},{x:b.xMax,z:b.zMin},{x:b.xMax,z:b.zMax},{x:b.xMin,z:b.zMax}]:[];}

/** This return value is the common geometry for rendering, picking and section. */
export function applyAuthoredGeometry(baseGeometry,value=null,options={}){
  const geometry=normalizeGeometry(baseGeometry);if(value==null)return geometry;
  const authored=normalizeAuthoredGeometry(value);
  if(authored.stagePolygon){geometry.stagePolygon=clone(authored.stagePolygon);const b=stageBounds(geometry);geometry.stageWidthM=b.widthM;geometry.stageDepthM=b.depthM;}
  if(own(authored,'stageHeightM'))geometry.stageHeightM=authored.stageHeightM;
  const blocks=new Map(authoredSeatBlocks(baseGeometry,options).map(b=>[b.key,b]));
  const seatAngles=new Map();
  for(const adjustment of authored.seatBlockAngles||[]){const block=blocks.get(adjustment.blockKey);if(!block)fail('현재 배치에 없는 객석 구역입니다.');for(const key of block.seatKeys)seatAngles.set(key,adjustment.rotationDeg);}
  if(geometry.seats)geometry.seats=geometry.seats.map(seat=>seatAngles.has(`${seat.row}:${seat.number}`)?{...seat,rotationDeg:((seat.rotationDeg+seatAngles.get(`${seat.row}:${seat.number}`)+180)%360+360)%360-180,authoredRotationApplied:true}:seat);
  return geometry;
}
export function authoredAudienceDirections(audience,geometry){const seats=new Map(createSeatList(geometry).map(s=>[`${s.row}:${s.number}`,s]));return audience.map(person=>{const s=seats.get(`${person.seat?.row}:${person.seat?.number}`);return s?.authoredRotationApplied?{...person,rotationDeg:s.rotationDeg}:person;});}

export function stageShapeOutline(shape,bounds,widthM,depthM){
  if(!bounds||!finite(widthM)||!finite(depthM)||widthM<.1||depthM<.1||widthM>100||depthM>100)fail('폭·깊이는 10~10000 cm로 입력하세요.');
  const x=(bounds.xMin+bounds.xMax)/2,z=(bounds.zMin+bounds.zMax)/2,w=widthM/2,d=depthM/2;
  let points;
  if(shape==='rectangle')points=[{x:x-w,z:z-d},{x:x+w,z:z-d},{x:x+w,z:z+d},{x:x-w,z:z+d}];
  else if(shape==='trapezoid')points=[{x:x-w*.7,z:z-d},{x:x+w*.7,z:z-d},{x:x+w,z:z+d},{x:x-w,z:z+d}];
  else if(shape==='ellipse')points=Array.from({length:16},(_,i)=>({x:x+Math.cos(i*Math.PI/8)*w,z:z+Math.sin(i*Math.PI/8)*d}));
  else fail('도형을 선택하세요.');
  const checked=validateAuthoredOutline(points);if(!checked.valid)fail(checked.error);return checked.value;
}
