import { createSeatList } from './geometry.js';
import { getEffectiveAudience } from './audience-layout.js';
import { renderOverview } from './scene.js';

const keyOf = seat => `${seat.row}:${seat.number}`;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const primitive = value => ['string','number'].includes(typeof value) ? String(value) : '';
const metadata = (seat, keys) => keys.map(key => primitive(seat[key])).find(Boolean) || '';

/** Transactional audience exclusions. Selection and the draft mask are separate;
 * nothing modifies seat geometry, and only Apply calls the host's mask action. */
export function createOpSeatEditor({ getSnapshot, onApply }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'op-seat-dialog'; dialog.className = 'workspace-dialog op-seat-dialog';
  dialog.setAttribute('aria-labelledby','op-seat-title');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="op-seat-title">OP석 편집</h2><button id="op-seat-close" type="button" class="icon-button" aria-label="변경을 취소하고 닫기">×</button></div>
    <p class="small-note">객석을 드래그해 선택한 뒤 관객을 제외하거나 복원하세요. 적용 전에는 현재 배치가 바뀌지 않습니다.</p>
    <div class="op-seat-toolbar"><div class="segmented" role="group" aria-label="좌석 선택과 화면 이동"><button id="op-seat-select-mode" type="button" aria-pressed="true">좌석 선택</button><button id="op-seat-pan-mode" type="button" aria-pressed="false">화면 이동</button></div>
    <label>선택 방식<select id="op-seat-selection-action"><option value="replace">새로 선택</option><option value="add">선택 추가</option><option value="remove">선택 해제</option></select></label>
    <div class="op-seat-zoom" role="group" aria-label="객석 미리보기 확대"><button id="op-seat-zoom-out" type="button" aria-label="객석 축소">−</button><output id="op-seat-zoom-value">100%</output><button id="op-seat-zoom-in" type="button" aria-label="객석 확대">＋</button><button id="op-seat-fit" type="button">전체 보기</button></div></div>
    <div class="op-seat-filters"><label id="op-seat-floor-field" hidden>층<select id="op-seat-floor"><option value="">전체</option></select></label><label id="op-seat-section-field" hidden>구역<select id="op-seat-section"><option value="">전체</option></select></label><label>열·구역<select id="op-seat-row"><option value="">전체</option></select></label></div>
    <div class="op-seat-canvas-wrap"><canvas id="op-seat-canvas" tabindex="0" role="img" aria-label="현재 모델의 무대와 객석. 선택 모드에서 드래그하거나 클릭해 선택합니다."></canvas></div>
    <div class="op-seat-selection-actions"><span id="op-seat-selection-status" role="status" aria-live="polite">0석 선택</span><button id="op-seat-selection-clear" type="button" class="quiet-button">선택 모두 해제</button><button id="op-seat-exclude-selected" type="button" class="quiet-button">선택 관객 제외</button><button id="op-seat-restore-selected" type="button" class="quiet-button">선택 관객 복원</button></div>
    <p id="op-seat-status" role="status" class="small-note"></p>
    <details id="op-seat-list-details" class="op-seat-list-details"><summary>번호 목록으로 관객 제외 편집</summary><div id="op-seat-list" class="op-seat-list" aria-label="관객 제외 좌석"></div></details>
    <p class="small-note">검정 테두리는 선택, 붉은 테두리는 제외 예정입니다. Shift/Ctrl/Cmd로 선택 추가, Alt로 해제합니다. 위치가 확인된 좌석만 지원합니다.</p>
    <div class="dialog-actions"><button id="op-seat-clear" type="button" class="quiet-button">제외 모두 해제</button><button id="op-seat-cancel" type="button" class="quiet-button">취소</button><button id="op-seat-apply" type="button" class="primary-button">적용</button></div>
    <p class="small-note">닫기·ESC는 미적용 변경을 취소합니다. 제외 상태는 개인 배치와 함께 저장되며 좌석 원본은 유지됩니다.</p>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#'+id), canvas=$('op-seat-canvas');
  canvas.style.touchAction='none';
  const buffer=document.createElement('canvas');
  const contextKey=s=>JSON.stringify(s?.context||null);
  const modeKey=s=>JSON.stringify([s?.state?.modelMode,s?.state?.editMode,s?.stageView]);
  let current=null,seats=[],hits=[],draft=new Set(),selection=new Set(),openingContext='',openingMode='';
  let pointer=null,mode='select',view={zoom:1,x:0,y:0},scheduled=false;
  const filtered=()=>seats.filter(s=>(!$('op-seat-row').value||String(s.row)===$('op-seat-row').value)&&(!$('op-seat-floor').value||metadata(s,['floorLabel','floorId','levelLabel','floor'])===$('op-seat-floor').value)&&(!$('op-seat-section').value||metadata(s,['sectionLabel','sectionId','zoneLabel','section'])===$('op-seat-section').value));
  const eligibleKeys=()=>new Set(filtered().map(keyOf));
  function diagnostics(){const eligible=eligibleKeys();return {open:dialog.open,contextKey:openingContext,mode,view:{...view},selectedKeys:[...selection],excludedKeys:[...draft],filteredKeys:[...eligible],hits:hits.map(h=>({key:keyOf(h),row:h.row,number:h.number,label:h.displayLabel||h.label||keyOf(h),x:h.x,y:h.y,radius:h.radius,eligible:eligible.has(keyOf(h))})),dragging:Boolean(pointer)};}
  Object.defineProperty(canvas,'getOpSeatDiagnostics',{value:diagnostics,writable:false,configurable:false});
  function requestPaint(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;paint();});}
  function cancelPointer(){if(!pointer)return;const id=pointer.id;pointer=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);requestPaint();}
  function updateMode(next){cancelPointer();mode=next;dialog.classList.toggle('op-seat-pan-mode',mode==='pan');canvas.classList.toggle('op-seat-pan-mode',mode==='pan');canvas.style.cursor=mode==='pan'?'grab':'crosshair';$('op-seat-select-mode').setAttribute('aria-pressed',String(mode==='select'));$('op-seat-pan-mode').setAttribute('aria-pressed',String(mode==='pan'));}
  function paint(){
    if(!dialog.open||!current)return;
    const r=canvas.getBoundingClientRect(),width=Math.max(1,r.width),height=Math.max(1,r.height),dpr=Math.max(1,Math.min(3,devicePixelRatio||1));
    buffer.getBoundingClientRect=()=>({width,height});
    const audience=getEffectiveAudience({people:current.audienceLayout?.people||[],excludedSeats:seats.filter(s=>draft.has(keyOf(s)))});
    const result=renderOverview(buffer,{geometry:{...current.geometry,seats},seat:current.state.seat,people:current.people,structures:current.structures,audience,stageEnclosure:{enabled:current.state.stageWallsEnabled,sides:current.state.stageWallSides,heightM:current.state.stageWallHeightM}});
    const offsetX=width*(1-view.zoom)/2+view.x,offsetY=height*(1-view.zoom)/2+view.y;
    hits=(result?.seatHits||[]).map(h=>({...h,x:h.x*view.zoom+offsetX,y:h.y*view.zoom+offsetY,radius:(h.radius||5)*view.zoom}));
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#f5f6f8';ctx.fillRect(0,0,width,height);
    ctx.save();ctx.translate(offsetX,offsetY);ctx.scale(view.zoom,view.zoom);ctx.drawImage(buffer,0,0,buffer.width,buffer.height,0,0,width,height);ctx.restore();
    const eligible=eligibleKeys();
    for(const h of hits){const k=keyOf(h),radius=Math.max(4,h.radius);
      if(!eligible.has(k)){ctx.fillStyle='rgba(245,246,248,.78)';ctx.beginPath();ctx.arc(h.x,h.y,radius+2,0,2*Math.PI);ctx.fill();}
      if(draft.has(k)){ctx.strokeStyle='#b74555';ctx.lineWidth=2;ctx.beginPath();ctx.arc(h.x,h.y,radius+3,0,2*Math.PI);ctx.stroke();}
      if(selection.has(k)){ctx.fillStyle='rgba(28,34,44,.17)';ctx.strokeStyle='#1c222c';ctx.lineWidth=3;ctx.beginPath();ctx.arc(h.x,h.y,radius+1,0,2*Math.PI);ctx.fill();ctx.stroke();}
    }
    if(pointer?.kind==='select'){const a=pointer.start,b=pointer.end;ctx.fillStyle='rgba(28,34,44,.08)';ctx.strokeStyle='#1c222c';ctx.lineWidth=1.5;ctx.setLineDash([5,3]);ctx.fillRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));ctx.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(b.x-a.x),Math.abs(b.y-a.y));ctx.setLineDash([]);}
    $('op-seat-selection-status').textContent=`${selection.size}석 선택 · 표시 대상 ${eligible.size}석`;
    $('op-seat-status').textContent=seats.length?`${draft.size}석 관객 제외 예정 · 좌석 원본 유지`:'위치가 확인된 좌석이 없어 편집할 수 없습니다.';
    for(const id of ['op-seat-exclude-selected','op-seat-restore-selected','op-seat-selection-clear'])$(id).disabled=!selection.size;
    $('op-seat-zoom-value').textContent=`${Math.round(view.zoom*100)}%`;
    $('op-seat-zoom-out').disabled=view.zoom<=1;$('op-seat-zoom-in').disabled=view.zoom>=4;
    Object.assign(canvas.dataset,{selectedCount:String(selection.size),excludedCount:String(draft.size),filteredSeatCount:String(eligible.size),zoom:String(view.zoom),panX:String(view.x),panY:String(view.y),mode});
  }
  function list(){
    $('op-seat-list').replaceChildren();
    for(const seat of filtered()){
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=keyOf(seat);input.checked=draft.has(keyOf(seat));
      input.addEventListener('change',()=>{if(input.checked)draft.add(keyOf(seat));else draft.delete(keyOf(seat));paint();});
      label.append(input,document.createTextNode(seat.displayLabel||seat.label||keyOf(seat)));$('op-seat-list').append(label);
    }
    paint();
  }
  function filterOptions(id,values){$(id).replaceChildren(new Option('전체',''));for(const value of [...new Set(values.filter(Boolean))])$(id).add(new Option(value,value));}
  function cancel(){cancelPointer();if(dialog.open)dialog.close('cancel');}
  $('op-seat-close').onclick=cancel;$('op-seat-cancel').onclick=cancel;
  dialog.addEventListener('cancel',e=>{e.preventDefault();cancel();});
  dialog.addEventListener('close',()=>{cancelPointer();draft.clear();selection.clear();current=null;seats=[];hits=[];openingContext='';openingMode='';});
  $('op-seat-select-mode').onclick=()=>updateMode('select');$('op-seat-pan-mode').onclick=()=>updateMode('pan');
  for(const id of ['op-seat-row','op-seat-floor','op-seat-section'])$(id).onchange=()=>{cancelPointer();selection.clear();list();};
  $('op-seat-selection-clear').onclick=()=>{cancelPointer();selection.clear();paint();};
  $('op-seat-exclude-selected').onclick=()=>{for(const key of selection)draft.add(key);list();};
  $('op-seat-restore-selected').onclick=()=>{for(const key of selection)draft.delete(key);list();};
  $('op-seat-clear').onclick=()=>{draft.clear();list();};
  $('op-seat-apply').onclick=()=>{const latest=getSnapshot();if(contextKey(latest)!==openingContext||modeKey(latest)!==openingMode){cancel();return;}const exclusions=seats.filter(s=>draft.has(keyOf(s))).map(s=>({row:s.row,number:s.number}));if(onApply(exclusions)!==false)dialog.close('apply');else $('op-seat-status').textContent='현재 좌석과 일치하지 않습니다. 다시 열어 주세요.';};
  function zoom(factor){cancelPointer();const next=Math.max(1,Math.min(4,view.zoom*factor)),ratio=next/view.zoom;view={zoom:next,x:view.x*ratio,y:view.y*ratio};paint();}
  $('op-seat-zoom-in').onclick=()=>zoom(1.4);$('op-seat-zoom-out').onclick=()=>zoom(1/1.4);$('op-seat-fit').onclick=()=>{cancelPointer();view={zoom:1,x:0,y:0};paint();};
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  canvas.addEventListener('pointerdown',e=>{
    if(e.button!==0||pointer)return;
    const start=point(e),action=e.altKey?'remove':e.shiftKey||e.ctrlKey||e.metaKey?'add':$('op-seat-selection-action').value;
    pointer={id:e.pointerId,kind:mode,start,end:start,previous:new Set(selection),action,view:{...view}};
    canvas.setPointerCapture(e.pointerId);canvas.focus({preventScroll:true});e.preventDefault();if(mode==='pan')canvas.style.cursor='grabbing';requestPaint();
  });
  canvas.addEventListener('pointermove',e=>{if(pointer?.id!==e.pointerId)return;pointer.end=point(e);if(pointer.kind==='pan'){const r=canvas.getBoundingClientRect();view.x=Math.max(-3*r.width,Math.min(3*r.width,pointer.view.x+pointer.end.x-pointer.start.x));view.y=Math.max(-3*r.height,Math.min(3*r.height,pointer.view.y+pointer.end.y-pointer.start.y));}e.preventDefault();requestPaint();});
  canvas.addEventListener('pointerup',e=>{
    if(pointer?.id!==e.pointerId)return;
    const drag=pointer,end=point(e);cancelPointer();canvas.style.cursor=mode==='pan'?'grab':'crosshair';e.preventDefault();
    if(drag.kind==='pan'){paint();return;}
    const allowed=eligibleKeys(),r=canvas.getBoundingClientRect();
    const candidates=hits.filter(h=>allowed.has(keyOf(h))&&h.x>=0&&h.y>=0&&h.x<=r.width&&h.y<=r.height);
    let found;
    if(Math.hypot(end.x-drag.start.x,end.y-drag.start.y)<4){const hit=candidates.filter(h=>Math.hypot(h.x-end.x,h.y-end.y)<=Math.max(8,h.radius)).sort((a,b)=>Math.hypot(a.x-end.x,a.y-end.y)-Math.hypot(b.x-end.x,b.y-end.y))[0];found=hit?[keyOf(hit)]:[];}
    else found=candidates.filter(h=>h.x>=Math.min(drag.start.x,end.x)&&h.x<=Math.max(drag.start.x,end.x)&&h.y>=Math.min(drag.start.y,end.y)&&h.y<=Math.max(drag.start.y,end.y)).map(keyOf);
    selection=drag.action==='replace'?new Set():new Set(drag.previous);
    for(const key of found)if(drag.action==='remove')selection.delete(key);else selection.add(key);
    paint();
  });
  canvas.addEventListener('pointercancel',()=>{cancelPointer();canvas.style.cursor=mode==='pan'?'grab':'crosshair';});
  canvas.addEventListener('lostpointercapture',e=>{if(pointer?.id===e.pointerId)cancelPointer();});
  new ResizeObserver(()=>{if(dialog.open){cancelPointer();requestPaint();}}).observe(canvas);
  return {
    open(){
      const snapshot=getSnapshot();if(!snapshot?.context)return;
      current=snapshot;openingContext=contextKey(current);openingMode=modeKey(current);
      // Explicit positions only. Unlocated OP identifiers never acquire demo coordinates.
      const located=(Array.isArray(current.geometry?.seats)?current.geometry.seats:[]).filter(s=>Number.isInteger(s.row)&&Number.isInteger(s.number)&&finite(s.x)&&finite(s.z)&&finite(s.floorY));
      seats=createSeatList({...current.geometry,seats:located});
      draft=new Set((current.audienceLayout?.excludedSeats||[]).map(keyOf).filter(key=>seats.some(s=>keyOf(s)===key)));selection.clear();
      view={zoom:1,x:0,y:0};updateMode('select');$('op-seat-selection-action').value='replace';$('op-seat-list-details').open=false;
      filterOptions('op-seat-row',seats.map(s=>String(s.row)));for(const option of $('op-seat-row').options)if(option.value)option.textContent=seats.find(s=>String(s.row)===option.value)?.rowLabel||option.value;
      filterOptions('op-seat-floor',seats.map(s=>metadata(s,['floorLabel','floorId','levelLabel','floor'])));$('op-seat-floor-field').hidden=$('op-seat-floor').options.length<=1;
      filterOptions('op-seat-section',seats.map(s=>metadata(s,['sectionLabel','sectionId','zoneLabel','section'])));$('op-seat-section-field').hidden=$('op-seat-section').options.length<=1;
      $('op-seat-apply').disabled=!seats.length;dialog.showModal();list();requestPaint();
    },
    sync(){if(dialog.open){const s=getSnapshot();if(contextKey(s)!==openingContext||modeKey(s)!==openingMode)cancel();}},
    close:cancel,
    getDiagnostics:diagnostics,
  };
}
