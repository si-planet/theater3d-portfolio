import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const opt={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Expected paired --option value');opt[process.argv[i].slice(2)]=process.argv[i+1];}
const project=path.resolve(opt.project??path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const candidate=path.resolve(opt.candidate??project);
const verification=opt.verification;
const load=n=>JSON.parse(fs.readFileSync(path.join(candidate,'data/demo/synthetic-'+n+'.json')));
const venue=load('venue'),model=load('model'),before=JSON.stringify({venue,model});
const {normalizeGeometry,createSeatList,seatPosition,stageBounds,isPointOnStage}=await import(pathToFileURL(path.join(project,'src/geometry.js')));
const {reconcileStageLayout,isStructureWithinStage}=await import(pathToFileURL(path.join(project,'src/stage-layout.js')));
const {renderSeatView,renderModelView,renderOverview}=await import(pathToFileURL(path.join(project,'src/scene.js')));
const checks=[],projections=[];const check=(name,ok)=>checks.push({name,passed:!!ok});const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9;const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);const clone=x=>JSON.parse(JSON.stringify(x));
check('schema1',venue.schemaVersion===1&&model.schemaVersion===1);
check('explicit synthetic identity',venue.synthetic===true&&model.synthetic===true&&/^synthetic-/.test(venue.id)&&model.venueId===venue.id&&model.modelId===venue.modelId&&/가상|합성/.test(venue.displayName));
check('synthetic status distinct from plan_interpreted',model.status==='synthetic_fixture'&&venue.geometryStatus==='fully_synthetic_no_physical_authority');
for(const [name,d] of [['venue',venue],['model',model]]){
 check(name+' non-authority provenance',d.provenance.kind==='fully_synthetic_fixture'&&d.provenance.measuredVenue===false&&d.provenance.officialAuthority===false&&d.provenance.externalSourcesUsed===false&&d.provenance.realVenueCoordinateReuse===false&&d.provenance.photoOrEXIFUsed===false&&d.provenance.physicalEffectiveDate===null);
 check(name+' authored units axes',d.coordinateSystem.unit==='m'&&d.coordinateSystem.worldGeographicRegistration===null&&d.coordinateSystem.x.includes('right')&&d.coordinateSystem.y.includes('up')&&d.coordinateSystem.z.includes('audience'));
}
check('no real identity/address',venue.officialName===null&&Object.values(venue.address).every(x=>x===null)&&venue.aliases.length===0&&venue.nameHistory.length===0&&venue.historicalRelations.length===0);
check('official raw nulls',Object.values(venue.officialGeometry).every(x=>x===null)&&venue.officialMeasurements.length===0&&venue.officialSeatLayout.seatCount===null&&venue.officialSeatLayout.seatIds.length===0&&venue.officialSeatLayout.verified===false);
check('no real sources',venue.sources.length===1&&venue.sources[0].kind==='synthetic_authorship'&&venue.sources[0].url===null&&model.source.sourceType==='synthetic_authorship'&&['url','document','sha256','documentDate','rawUnit'].every(k=>model.source[k]===null)&&venue.sources[0].id===model.source.id);
check('authored m not source unit assumption',model.unitAssumption===null&&model.unitStatus==='explicit_authored_metres_no_source_conversion');
check('calibration absent',model.calibration.status==='not_applicable_synthetic'&&['scale','sourceToWorldTransform','physicalSurveyTransform'].every(k=>model.calibration[k]===null));
check('physical unknowns remain null',Object.values(model.unknowns).every(x=>x===null));
check('official mapping absent',model.seatMapping.status==='synthetic_only'&&model.seatMapping.officialSeatCorrespondences.length===0);
check('venue/model geometry same authored input',eq(venue.demoGeometry,model.geometry));
const g=normalizeGeometry(model.geometry),seats=createSeatList(g),bounds=stageBounds(g);
for(const key of ['stageWidthM','stageDepthM','rowSpacingM','seatSpacingM','firstRowDistanceM','eyeHeightM'])check('positive finite '+key,Number.isFinite(model.geometry[key])&&model.geometry[key]>0&&near(g[key],model.geometry[key]));
for(const key of ['stageHeightM','rowRiseM'])check('nonnegative finite '+key,Number.isFinite(model.geometry[key])&&model.geometry[key]>=0&&near(g[key],model.geometry[key]));
check('18 seats3 rows6 addresses',seats.length===18&&g.rowCount===3&&g.seatsPerRow===6&&model.seatMapping.syntheticSeatCount===18);
check('explicit aisle retained',eq(g.seats.map(s=>s.x),model.geometry.seats.map(s=>s.x))&&g.seats.filter(s=>s.row===1).every(s=>s.x!==0));
const ids=[venue.id,model.modelId,model.source.id,...model.geometry.seats.map(s=>s.id),...model.geometry.rowPlatforms.map(p=>p.id),...model.stageLayout.people.map(p=>p.id),...model.stageLayout.structures.map(s=>s.id)];
check('definition IDs unique synthetic namespace',new Set(ids).size===ids.length&&ids.every(id=>id.startsWith('synthetic-')));
check('seat address unique',new Set(seats.map(s=>s.row+':'+s.number)).size===18);
for(const s of seats){
 const prefix=s.row+':'+s.number;const raw=model.geometry.seats.find(t=>t.row===s.row&&t.number===s.number),p=seatPosition(g,s,model.rendererOptions.camera.eyeHeightM),platform=g.rowPlatforms.find(x=>x.row===s.row);
 check(prefix+' labels not official',s.label.includes('가상')&&s.rowLabel.startsWith('SYN-')&&s.officialSeatId===null&&s.evidenceKind==='synthetic_assumption');
 check(prefix+' explicit values survive',near(s.x,raw.x)&&near(s.z,raw.z)&&near(s.floorY,raw.floorY));
 check(prefix+' finite viewpoint and floor',p&&[p.x,p.y,p.z,p.floorY].every(Number.isFinite)&&near(p.y,s.floorY+model.rendererOptions.camera.eyeHeightM));
 check(prefix+' authored row formula',near(s.z,2.3+(s.row-1)*1.1)&&near(s.floorY,(s.row-1)*.18));
 check(prefix+' platform inclusion',platform&&s.x>=platform.xMin&&s.x<=platform.xMax&&s.z>=platform.zStart&&s.z<=platform.zEnd&&near(s.floorY,platform.y));
 check(prefix+' audience outside stage',!isPointOnStage(g,s.x,s.z));
}
check('stage dimensions polygon consistent',bounds&&near(bounds.widthM,g.stageWidthM)&&near(bounds.depthM,g.stageDepthM)&&bounds.zMax===0&&bounds.zMin<0);
check('room contains stage and seats',model.geometry.roomBoundary.length>=3&&model.geometry.roomBoundary.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z))&&seats.every(s=>s.x>=Math.min(...g.roomBoundary.map(p=>p.x))&&s.x<=Math.max(...g.roomBoundary.map(p=>p.x))&&s.z>=Math.min(...g.roomBoundary.map(p=>p.z))&&s.z<=Math.max(...g.roomBoundary.map(p=>p.z))));
for(const p of g.rowPlatforms)check('platform ordered '+p.id,[p.y,p.zStart,p.zEnd,p.xMin,p.xMax].every(Number.isFinite)&&p.zStart<p.zEnd&&p.xMin<p.xMax);
check('default seat consistent',eq(venue.defaultSeat,model.defaultSeat)&&seatPosition(g,model.defaultSeat)!==null);
check('two invented mannequins/two structures',model.stageLayout.people.length===2&&model.stageLayout.structures.length===2);
for(const p of model.stageLayout.people){check('mannequin within stage '+p.id,Number.isFinite(p.heightM)&&p.heightM>0&&isPointOnStage(g,p.x,p.z)&&near(p.floorY,g.stageHeightM));}
for(const s of model.stageLayout.structures)check('full footprint within stage '+s.id,isStructureWithinStage(g,s)&&s.heightM>0&&near(s.floorY,g.stageHeightM));
const reconciled=reconcileStageLayout(clone(model.stageLayout),g);
check('reconcile retains positions',eq(reconciled.people.map(p=>[p.id,p.x,p.z,p.heightM]),model.stageLayout.people.map(p=>[p.id,p.x,p.z,p.heightM]))&&eq(reconciled.structures.map(s=>[s.id,s.x,s.z]),model.stageLayout.structures.map(s=>[s.id,s.x,s.z])));
check('raw null selection vs consumer fallback',model.stageLayout.selectedStructureId===null&&reconciled.selectedStructureId===model.stageLayout.structures[0].id);
check('unverified enclosure disabled',model.rendererOptions.stageEnclosure.enabled===false&&model.rendererOptions.stageEnclosure.heightM===null&&model.rendererOptions.auditoriumBarriersEnabled===false);
check('empty seats do not fabricate',createSeatList({...model.geometry,seats:[]}).length===0&&seatPosition({...model.geometry,seats:[]},model.defaultSeat)===null);
check('null explicit coordinate filtered',normalizeGeometry({...model.geometry,seats:[{...model.geometry.seats[0],x:null}]}).seats.length===0);
check('explicit empty stage has no bounds',stageBounds({...model.geometry,stagePolygon:[]})===null);
check('unknown explicit seat returns null',seatPosition(g,{row:499,number:499})===null);
const forbidden=[];
function scan(o,at=''){
 if(Array.isArray(o)){o.forEach((x,i)=>scan(x,at+'/'+i));return;}
 if(o&&typeof o==='object'){for(const [k,x] of Object.entries(o)){if(/^(exif|gps|password|access.?token|refresh.?token|private.?key|service.?role|originalFilename|originalObjectKey|imageBytes|photoBytes)$/i.test(k)&&x!==null)forbidden.push(at+'/'+k);scan(x,at+'/'+k);}return;}
 if(typeof o==='number'&&!Number.isFinite(o))forbidden.push(at+' nonfinite');
 if(typeof o==='string'&&(/https?:\/\/|file:\/\/|\/Users\/|data:image\/|-----BEGIN|AKIA[A-Z0-9]{16}|sb_secret_/.test(o)||/이티씨어터|정동극장|링크아트센터|스콘1관|synthetic stage|예스24스테이지/.test(o)))forbidden.push(at+' external/private/real venue payload');
}
scan({venue,model});check('no private/external source payload',forbidden.length===0);
const methods='setTransform clearRect beginPath moveTo lineTo quadraticCurveTo closePath arc clip fill fillRect fillText rect restore rotate save stroke strokeRect translate'.split(' ');
function canvas(width,height){const calls={},bad=[];const ctx={};for(const name of methods)ctx[name]=(...args)=>{calls[name]=(calls[name]??0)+1;for(const x of args)if(typeof x==='number'&&!Number.isFinite(x))bad.push(name);};ctx.measureText=text=>({width:String(text).length*7});for(const key of ['createLinearGradient','createRadialGradient'])ctx[key]=(...args)=>{for(const x of args)if(!Number.isFinite(x))bad.push(key);return{addColorStop(){}};};return{width,height,clientWidth:width,clientHeight:height,getBoundingClientRect:()=>({width,height}),getContext:kind=>{if(kind!=='2d')throw Error('unexpected context');return ctx;},calls,bad};}
function numbersFinite(o){if(typeof o==='number')return Number.isFinite(o);if(Array.isArray(o))return o.every(numbersFinite);if(o&&typeof o==='object')return Object.values(o).every(numbersFinite);return true;}
for(const [w,h] of [[1280,720],[390,600]])for(const mode of ['seat','isometric','side','overview']){
 const c=canvas(w,h),args={geometry:g,seat:model.defaultSeat,people:clone(model.stageLayout.people),structures:clone(model.stageLayout.structures),...clone(model.rendererOptions)};let out;
 try{out=mode==='seat'?renderSeatView(c,args):mode==='overview'?renderOverview(c,args):renderModelView(c,{...args,view:mode});}catch(e){check(mode+' '+w+' renderer no throw',false);projections.push({mode,width:w,height:h,error:String(e)});continue;}
 check(mode+' '+w+' projection finite',!out.error&&numbersFinite(out));check(mode+' '+w+' draw coordinates finite',c.bad.length===0&&(c.calls.moveTo??0)>0&&(c.calls.fill??0)>0);check(mode+' '+w+' two structure projections',out.structureProjections?.length===2&&new Set(out.structureProjections.map(x=>x.id)).size===2);
 if(mode!=='overview')check(mode+' '+w+' mannequins projected',out.personProjections?.length===2&&out.personProjections.every(p=>model.stageLayout.people.some(x=>x.id===p.id)&&p.feet&&p.top&&Number.isFinite(p.heightPx)));
 else check('overview '+w+' all18 seats hit-testable',out.seatHits?.length===18);
 projections.push({mode,width:w,height:h,returnedKeys:Object.keys(out),drawCalls:c.calls,invalidNumericDrawArguments:c.bad,seatHits:out.seatHits?.length??null,people:out.personProjections?.map(p=>({id:p.id,feet:p.feet,top:p.top,bounds:p.bounds}))??null,structures:out.structureProjections?.map(s=>({id:s.id,floorY:s.floorY,bounds:s.bounds}))});
}
check('input bytes/official nulls untouched',JSON.stringify({venue,model})===before);
const result={suite:'independent synthetic fixture QA',passed:checks.filter(x=>x.passed).length,failed:checks.filter(x=>!x.passed).length,checks,privacyFindings:forbidden,projectionMode:'mock canvas numeric execution only',browserExecuted:false,appWiringVerifiedByThisSuite:false};
if(verification){fs.mkdirSync(verification,{recursive:true});fs.writeFileSync(path.join(verification,'independent-results.json'),JSON.stringify(result,null,2)+'\n');fs.writeFileSync(path.join(verification,'independent-projections.json'),JSON.stringify(projections,null,2)+'\n');}
console.log(JSON.stringify({passed:result.passed,failed:result.failed,failures:checks.filter(x=>!x.passed)}));if(result.failed)process.exitCode=1;
