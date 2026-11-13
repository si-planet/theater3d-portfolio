import { focalControlMm, getFocalControlRange } from './camera-config.js';
import { createAuthoredGeometryEditor } from './authored-geometry-editor.js';
import { createActorMarquee } from './actor-marquee.js';
import { createOpSeatEditor } from './op-seat-editor.js';
import { createSeatNotes } from './seat-notes.js';
import { createPersonalDataExportUI } from './personal-data-export-ui.js';
import { createSeatMediaPanel } from './seat-media-panel.js';
import { createSeatMapExplorer } from './seat-map-explorer.js';
import { createStructureExplorer, normalizeStructureAsset } from './structure-explorer.js';
import { createLimitedStructureWorkspace, normalizeLimitedStructureRecord } from './limited-structure-workspace.js';
import { createSourcePlanWorkspace } from './source-plan-workspace.js';
import { normalizeHistoricalSourceRegistry, createHistoricalSourceLoader, sourceProductionPresentation } from './historical-source-plans.js';
import { createTheaterAvailability, theaterSelectionIntent } from './theater-availability.js';
import { normalizeTheaterModelRegistry } from './theater-model-registry.js';

const $ = id => document.getElementById(id);
const node = (tag, html, cls) => { const n=document.createElement(tag);if(html)n.innerHTML=html;if(cls)n.className=cls;return n; };
const value = (id,v) => {const e=$(id);if(e&&document.activeElement!==e)e.value=v;};
const button = (id,text) => `<button id="${id}" type="button" class="quiet-button">${text}</button>`;
// User supplied a performance-specific GS map; only that dated capture is listed.
// No GS login, reservation access or permanent-layout claim is introduced.
const excludedInformationIds = new Set();

export const WORKSPACE_RUNTIME_CATALOG_PATHS = Object.freeze([
  './data/catalog/portfolio-venue-information.json',
  './data/catalog/theater-structure-registry.json',
  './data/catalog/theater-seat-plan-registry.json',
  './data/catalog/theater-historical-seat-plan-registry.json',
  './data/catalog/theater-selection-availability.json',
  './data/catalog/theater-model-registry.json',
]);

const runtimeFailure = code => Object.assign(new Error('Runtime data unavailable'), { code });
const runtimeStateKey = state => `${state.mode}:${state.status}:${state.epoch}`;

/** Optional authenticated runtime boundary. No storage, credentials or cache.
 * A configured private runtime never falls through to a public fetch. Host
 * epochs are opaque safe integers, not account IDs, access tokens or claims.
 * Call start() after the UI is constructed; import/construction does no IO.
 */
export function createWorkspaceRuntimeData(api, { onInvalidate = () => {}, onReady = () => {}, onError = () => {} } = {}) {
  const configured = ['readRuntimeJSON', 'getRuntimeDataState', 'subscribeRuntimeData'].some(name => typeof api[name] === 'function');
  const complete = !configured || ['readRuntimeJSON', 'getRuntimeDataState', 'subscribeRuntimeData'].every(name => typeof api[name] === 'function');
  let current = null, serial = 0, started = false, disposed = false, subscriptionFailed = false, failed = false, unsubscribe = null, pending = Promise.resolve();
  const requests = new Set();
  function state() {
    if (!configured) return { mode: 'public', status: 'ready', epoch: 0 };
    if (subscriptionFailed) return { mode: 'private', status: 'error', epoch: 0 };
    let value; try { value = complete ? api.getRuntimeDataState() : null; } catch {}
    if (!value || !['public', 'private'].includes(value.mode) || !['ready', 'locked', 'loading', 'error'].includes(value.status)
      || !Number.isSafeInteger(value.epoch) || value.epoch < 0) return { mode: 'private', status: 'error', epoch: 0 };
    return { mode: value.mode, status: value.status, epoch: value.epoch };
  }
  function abortRequests() { for (const controller of requests) controller.abort(); requests.clear(); }
  function active(request, key) { return !disposed && request === serial && current && runtimeStateKey(current) === key && runtimeStateKey(state()) === key; }
  async function readJSON(path, { signal } = {}) {
    if (!started || disposed || !current) throw runtimeFailure('RUNTIME_UNAVAILABLE');
    const key = runtimeStateKey(current), request = serial;
    if (runtimeStateKey(state()) !== key) { reconcile(); throw runtimeFailure('RUNTIME_SESSION_CHANGED'); }
    if (current.status !== 'ready' || failed) throw runtimeFailure('RUNTIME_UNAVAILABLE');
    if (typeof path !== 'string' || !/^\.\/data\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/.test(path)
      || path.slice(2).split('/').some(part => !part || part === '.' || part === '..')) throw runtimeFailure('RUNTIME_PATH_REJECTED');
    const own = new AbortController(), cancel = () => own.abort();
    if (signal?.aborted) own.abort(); else signal?.addEventListener('abort', cancel, { once: true });
    requests.add(own);
    try {
      if (own.signal.aborted) throw runtimeFailure('RUNTIME_CANCELLED');
      let value;
      if (configured) value = await api.readRuntimeJSON(path, { signal: own.signal });
      else { const response = await fetch(path, { cache: 'no-cache', signal: own.signal }); if (!response.ok) throw runtimeFailure('RUNTIME_READ_FAILED'); value = await response.json(); }
      if (!active(request, key) || own.signal.aborted) {
        if (!disposed && runtimeStateKey(state()) !== runtimeStateKey(current)) reconcile();
        throw runtimeFailure('RUNTIME_SESSION_CHANGED');
      }
      return value;
    } catch (error) {
      if (!active(request, key) || own.signal.aborted) {
        if (!disposed && current && runtimeStateKey(state()) !== runtimeStateKey(current)) reconcile();
        throw runtimeFailure('RUNTIME_SESSION_CHANGED');
      }
      // Never propagate a provider's raw URL, filename, account or token error.
      throw runtimeFailure('RUNTIME_READ_FAILED');
    } finally { requests.delete(own); signal?.removeEventListener('abort', cancel); }
  }
  function reconcile(force = false) {
    if (!started || disposed) return pending;
    const next = state(), prior = current;
    if (!force && prior && runtimeStateKey(prior) === runtimeStateKey(next)) return pending;
    const request = ++serial, key = runtimeStateKey(next); abortRequests(); current = next; failed = false;
    onInvalidate({ ...next }, prior ? 'changed' : 'initial');
    if (next.status !== 'ready') return pending = Promise.resolve();
    pending = Promise.all(WORKSPACE_RUNTIME_CATALOG_PATHS.map((path, index) => {
      const result = readJSON(path);
      // Preserve legacy public optional-registry behavior only in explicit
      // public mode. Every private registry must succeed as one epoch bundle.
      return next.mode === 'public' && index > 0 ? result.catch(() => null) : result;
    })).then(values => {
      if (active(request, key)) return onReady(values, { ...next });
    }).catch(() => {
      if (!active(request, key)) return;
      failed = true; abortRequests(); onInvalidate({ ...next, status: 'error' }, 'failed'); onError({ ...next, status: 'error' });
    });
    return pending;
  }
  return {
    readJSON,
    getState: () => disposed ? { mode: 'private', status: 'locked', epoch: 0 } : ({ ...(current || state()), ...(failed ? { status: 'error' } : {}) }),
    isCurrent: snapshot => !disposed && !failed && current && runtimeStateKey(current) === runtimeStateKey(snapshot) && runtimeStateKey(state()) === runtimeStateKey(snapshot),
    start() {
      if (disposed || started) return pending; started = true;
      if (complete && configured) { try { unsubscribe = api.subscribeRuntimeData(() => reconcile()); } catch { completeSubscriptionFailure(); return pending; } }
      return reconcile();
    },
    reload: () => reconcile(true),
    whenSettled: () => pending,
    dispose() { if (disposed) return; disposed = true; ++serial; abortRequests(); if (typeof unsubscribe === 'function') unsubscribe(); unsubscribe = null; onInvalidate({ mode: 'private', status: 'locked', epoch: current?.epoch || 0 }, 'disposed'); current = null; },
  };
  function completeSubscriptionFailure() { subscriptionFailed = true; current = { mode: 'private', status: 'error', epoch: 0 }; onInvalidate({ ...current }, 'failed'); onError({ ...current }); }
}

/** Clear only runtime presentation; never reads or deletes user storage. */
export function purgeWorkspaceRuntimeDOM(doc) {
  const byId = id => doc.getElementById(id);
  for (const id of ['current-theater-name', 'venue-name', 'unavailable-stage-name', 'historical-source-title', 'historical-source-period', 'historical-source-status', 'theater-address-popover', 'directory-status', 'directory-page', 'photo-lock-note', 'canvas-focal', 'framing-status']) {
    const element = byId(id); if (element) { element.textContent = ''; for (const key of ['informationRecordId', 'sourceUrl', 'verified']) delete element.dataset[key]; }
  }
  for (const id of ['theater-select', 'historical-source-variant', 'theater-directory-results', 'selected-photo']) { const element = byId(id); if (element) { element.replaceChildren(); element.value = ''; if (element.tagName === 'SELECT') element.disabled = true; } }
  for (const id of ['historical-source-active', 'unavailable-stage-empty']) { const element = byId(id); if (element) for (const key of Object.keys(element.dataset)) delete element.dataset[key]; }
  for (const [id, label] of [['overview', '무대 배치 보기'], ['seat-view', '좌석 시야 보기'], ['model-view', '모델 보기']]) { const element = byId(id); if (element?.setAttribute) element.setAttribute('aria-label', label); }
  const search = byId('theater-directory-search'); if (search) search.value = '';
  const popover = byId('theater-address-popover'); if (popover) popover.hidden = true;
  for (const id of ['theater-directory-dialog', 'source-seat-dialog']) { const dialog = byId(id); if (dialog?.open) dialog.close('runtime-change'); }
  if (doc.body) delete doc.body.dataset.historicalVersionKey;
  doc.title = 'theater3D';
}

/** A static omission is distinct from an empty catalog or a failed request. */
export function staticRuntimeCatalogNotice(data) {
  const scope = data?.staticAvailability;
  if (scope?.state !== 'authorization-required' || scope.reason !== 'private-runtime-required') return null;
  const count = Number.isInteger(scope.excludedRecordCount) && scope.excludedRecordCount >= 0 ? scope.excludedRecordCount : 0;
  const entries = Array.isArray(scope.unavailableEntries) ? scope.unavailableEntries.filter(entry =>
    entry?.state === 'private-runtime-required' && typeof entry.informationRecordId === 'string' &&
    typeof entry.label === 'string' && entry.label.trim()).map(entry => ({ ...entry,
      nameAsListed: entry.label, staticRuntimeRequired: true })) : [];
  return { message: `비공개 극장 목록 ${count}개는 소유자 인증 연결이 필요합니다. 현재 정적 검토본에는 포함되지 않았습니다.`, entries };
}

/** Presentation/controller for local personal work. Existing canvases/08 stay intact. */
export function createPersonalWorkspace(api) {
  document.body.classList.add('personal-app');
  document.querySelector('.workspace').classList.add('personal-workspace');
  let informationView=false;
  const oldMode=document.querySelector('.workspace-mode-bar');oldMode.classList.add('legacy-control');
  $('catalog-panel').hidden=true;
  for(const id of ['connection-panel','connection-preparation-panel','public-catalog-config-panel'])if($(id))$(id).hidden=true;
  document.querySelector('.local-label').textContent='나의 무대';
  const header=node('div',`${button('theater-directory-open','극장 목록')}${button('open-personal-settings','개인 설정')}${button('open-simulation-panel','배치 저장 · 파일')}`,'personal-header-actions');
  document.querySelector('.header-actions').prepend(header);
  $('theater-directory-open').hidden=true;
  const legacyButton=node('button','이전에 저장한 가상 배치 열기','text-button');legacyButton.id='legacy-layout-open';legacyButton.type='button';legacyButton.hidden=true;
  $('simulation-context').after(legacyButton);legacyButton.onclick=()=>{api.onModelMode('demo');};
  const storageDialog=node('dialog',`<div class="dialog-heading"><h2>배치 저장 · 파일</h2>${button('simulation-dialog-close','닫기')}</div>`,'workspace-dialog simulation-dialog');storageDialog.id='simulation-dialog';document.body.append(storageDialog);storageDialog.append($('simulation-panel'));
  $('simulation-dialog-close').onclick=()=>storageDialog.close();
  $('open-simulation-panel').onclick=()=>{legacyButton.hidden=!api.hasLegacyLayout();$('simulation-panel').open=true;storageDialog.showModal();$('simulation-name').focus({preventScroll:true});};
  $('simulation-export').textContent='선택 배치 파일 내보내기';$('simulation-import').textContent='배치 파일 불러오기';
  createPersonalDataExportUI({container:storageDialog,
    storage:{getItem:key=>window.localStorage.getItem(key)},origin:window.location.origin});
  // Keep old model controls/data for saved-layout compatibility, outside the main path.
  $('model-mode').closest('.venue-model-selectors>div').hidden=true;
  $('venue-select').closest('.venue-model-selectors>div').hidden=true;
  const theaterPicker=node('div','<span id="current-theater-name">극장 불러오는 중</span><select id="theater-select" aria-label="내부 극장 선택" hidden disabled><option>전체 극장 불러오는 중</option></select>'+'<div class="theater-address"><button id="theater-address-help" type="button" aria-label="극장 주소" aria-expanded="false" aria-controls="theater-address-popover">?</button><div id="theater-address-popover" role="tooltip" hidden></div></div>'+button('current-theater-information','극장 목록'),'theater-picker');
  // Keep the existing title and theater controls together in the compact header.
  const siteHeader=document.querySelector('.site-header'),brand=document.querySelector('.brand');
  const brandCopy=node('div',null,'personal-brand-copy');brandCopy.append(brand.lastElementChild,$('page-title'));brand.append(brandCopy);
  theaterPicker.prepend(theaterPicker.querySelector('#current-theater-information'));siteHeader.insertBefore(theaterPicker,document.querySelector('.header-actions'));
  for(const selector of ['.intro','.model-selector','#venue-name','.header-divider']){const element=document.querySelector(selector);element.hidden=true;element.classList.add('legacy-control');}
  const drawingStatus=node('div','<span id="drawing-model-status">도면 기반</span>'+button('return-to-drawing','극장 도면으로 돌아가기'),'drawing-model-status');
  document.querySelector('.venue-model-selectors').after(drawingStatus);$('return-to-drawing').onclick=()=>api.onModelMode('plan');

  const surface=node('div',`<div class="segmented workspace-primary-toggle" role="group" aria-label="시야와 편집 전환">${button('workspace-view-mode','시야')}${button('workspace-edit-mode','편집')}</div>
    <div id="edit-target-toggle" class="segmented" hidden>${button('edit-people-target','인물')}${button('edit-stage-target','무대 객체')}</div>
    <details class="inline-help"><summary aria-label="작업면 조작 도움말">?</summary><p>시야에서는 화면 드래그·방향키로 조준합니다. Shift+방향키는 정밀 조절입니다. 편집에서는 인물·객체를 선택해 드래그합니다. 체크한 인물은 함께 움직입니다. 좌표와 가림은 모델 근사입니다.</p></details>`,'personal-surface-tools');
  document.querySelector('.view-heading').after(surface);
  const aim=node('div',null,'personal-aim-actions');aim.append($('reset-heading'),$('aim-selected-person'));
  const stageViews=node('div',`${button('stage-view-seat','좌석 시점')}${button('stage-view-plan','단면 보기')}${button('stage-view-orbit','전체 3D')}`,'segmented stage-view-selector');surface.append(stageViews);
  const sectionControls=node('div','<label>시선 목표<select id="sight-section-target"><option value="stage">무대 중심 바닥</option><option value="person">선택 배우 중심</option></select></label><p id="sight-section-summary" role="status"></p>','sight-section-controls');sectionControls.hidden=true;surface.after(sectionControls);$('sight-section-target').onchange=e=>api.onSectionTarget(e.target.value);
  surface.append(node('div',button('open-view-options','보기 옵션'),'view-options-action'));
  for(const mode of ['seat','plan','orbit'])$('stage-view-'+mode).onclick=()=>api.onStageView(mode);
  const help=surface.querySelector('.inline-help');let helpPinned=false;
  help.querySelector('p').textContent+=' 인물 편집에서 빈 공간을 드래그하면 범위 안 인물의 중심이 선택되고, 빈 곳을 클릭하면 선택이 해제됩니다. Ctrl/Cmd+드래그는 선택 추가, Esc는 드래그 취소입니다. 체크박스와 전체 선택·선택 해제 버튼은 키보드로도 조작할 수 있습니다.';
  help.querySelector('summary').onclick=e=>{e.preventDefault();helpPinned=!helpPinned;help.open=helpPinned;};
  help.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')help.open=true;});
  help.addEventListener('pointerleave',()=>{if(!helpPinned&&!help.contains(document.activeElement))help.open=false;});
  help.addEventListener('focusin',()=>{help.open=true;});help.addEventListener('focusout',()=>{if(!helpPinned)help.open=false;});
  document.addEventListener('pointerdown',e=>{if(!help.contains(e.target)){helpPinned=false;help.open=false;}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){helpPinned=false;help.open=false;}});
  aim.querySelector('#reset-heading').textContent='무대 중앙';aim.querySelector('#aim-selected-person').textContent='선택 인물';
  $('camera-direction-panel').classList.add('legacy-control');
  document.querySelector('.view-toolbar').classList.add('legacy-control');
  const sight=document.querySelector('.sight-view-section');document.querySelector('.view-card').append(sight);
  sight.querySelector('.sight-view-toggle').classList.add('legacy-control');
  sight.querySelector('.sight-focal-presets').classList.add('legacy-control');
  sight.querySelector('.range-ends').innerHTML='<span>5 mm · 넓게</span><span>20 mm</span>';
  for(const id of ['sight-focal-range','sight-focal-number'])Object.assign($(id),{min:'5',max:'20',step:'1'});
  sight.querySelector('label[for=sight-focal-range]').textContent='시야 · 모델 비교';
  const sightDisabled=node('p','촬영 설정이 시야를 제어하고 있습니다.','small-note');sightDisabled.id='sight-capture-note';sight.append(sightDisabled);
  $('sight-view-controls').classList.add('personal-sight-controls');
  const capture=node('div',`<label class="check-label"><input id="capture-enabled" type="checkbox">촬영 설정 사용</label>
    <label id="capture-aspect-label">촬영 화면비<select id="capture-aspect"><option value="6:4">사진 6:4</option><option value="4:6">사진 4:6</option><option value="16:9">영상 16:9</option><option value="9:16">영상 9:16</option></select></label>`,'capture-switch');
  document.querySelector('.settings-card').prepend(capture);
  const captureFields=node('fieldset',null,'camera-control-fields');captureFields.id='camera-control-fields';
  const cameraContent=$('camera-panel').querySelector(':scope>.panel-content');captureFields.append(...cameraContent.childNodes);cameraContent.append(captureFields);
  const captureStatus=node('p','촬영 설정을 켜면 렌즈와 화면비를 조절할 수 있습니다.','small-note');captureStatus.id='capture-controls-status';capture.append(captureStatus);captureFields.setAttribute('aria-describedby',captureStatus.id);
  const personalSettings=node('dialog',`<div class="dialog-heading"><h2>개인 기준 설정</h2>${button('personal-settings-close','닫기')}</div><div class="preferences-content"></div><div class="preferences-actions">${button('personal-settings-cancel','취소')}${button('personal-settings-apply','적용')}</div>`,'workspace-dialog preferences-dialog');personalSettings.id='personal-settings-dialog';document.body.append(personalSettings);
  personalSettings.querySelector('.preferences-content').append(document.querySelector('.camera-height-section'));
  $('apply-camera-height-range').textContent='높이 범위 미리보기';
  const viewOptions=node('dialog',`<div class="dialog-heading"><h2>보기 옵션</h2>${button('view-options-close','닫기')}</div><div class="preferences-content"></div><div class="preferences-actions">${button('view-options-cancel','취소')}${button('view-options-apply','적용')}</div>`,'workspace-dialog preferences-dialog');viewOptions.id='view-options-dialog';document.body.append(viewOptions);
  viewOptions.querySelector('.preferences-content').append($('show-grid').closest('label'),document.querySelector('.framing-section'),document.querySelector('.lens-estimate'));
  const stageSpace=node('details','<summary>무대 공간 설정</summary>','stage-space-settings');stageSpace.id='stage-space-settings';stageSpace.hidden=true;
  for(const selector of ['.stage-wall-section','#auditorium-barrier-section','.obstruction-section'])stageSpace.append(document.querySelector(selector));$('stage-object-editor').append(stageSpace);
  $('camera-details').classList.add('legacy-control');$('camera-details').hidden=true;
  let personalBaseline=null,viewBaseline=null,personalSeatHeightEdited=false;
  $('seat-height-cm').addEventListener('input',()=>{if(personalSettings.open)personalSeatHeightEdited=true;});
  for(const [target,prefix]of [[personalSettings,'personal-settings'],[viewOptions,'view-options']]){target.setAttribute('aria-label',prefix==='personal-settings'?'개인 기준 설정':'보기 옵션');for(const suffix of ['close','cancel'])$(prefix+'-'+suffix).onclick=()=>target.close('cancel');target.addEventListener('cancel',e=>{e.preventDefault();target.close('cancel');});}
  $('open-personal-settings').onclick=()=>{personalBaseline=api.getPersonalSettings();personalSeatHeightEdited=false;const c=personalBaseline.cameraHeightConfig;$('camera-height-min').value=c.minCm;$('camera-height-max').value=c.maxCm;$('camera-height-error').hidden=true;personalSettings.showModal();};
  personalSettings.addEventListener('close',()=>{if(personalSettings.returnValue!=='apply'&&personalBaseline)api.onPersonalSettingsRestore(personalBaseline);personalBaseline=null;});
  $('personal-settings-apply').onclick=()=>{const result=api.onPersonalSettingsApply({minCm:$('camera-height-min').value,maxCm:$('camera-height-max').value,offsetCm:$('camera-height-number').value,seatHeightCm:$('seat-height-cm').value,seatHeightEdited:personalSeatHeightEdited});$('camera-height-error').hidden=result.valid;$('camera-height-error').textContent=result.error||'';if(result.valid){personalBaseline=null;personalSettings.close('apply');}};
  $('open-view-options').onclick=()=>{const s=api.getSnapshot();viewBaseline={context:s.context,showGrid:s.state.showGrid,aimFraming:s.state.aimFraming};viewOptions.showModal();};
  viewOptions.addEventListener('close',()=>{if(viewOptions.returnValue!=='apply'&&viewBaseline)api.onViewOptionsRestore(viewBaseline);viewBaseline=null;});
  $('view-options-apply').onclick=()=>{viewBaseline=null;viewOptions.close('apply');};
  const compactCapture=node('section',null,'mobile-capture-controls');compactCapture.id='mobile-capture-controls';compactCapture.setAttribute('aria-label','촬영 초점거리');compactCapture.hidden=true;document.querySelector('.view-surface').before(compactCapture);
  const focalHeading=$('focal-number').closest('.control-heading'),focalRange=$('focal-range'),headingHome=document.createComment('focal heading home'),rangeHome=document.createComment('focal slider home');focalHeading.before(headingHome);focalRange.before(rangeHome);
  const narrowCapture=matchMedia('(max-width:640px)');narrowCapture.addEventListener('change',()=>api.onRefresh());
  function dockCapture(active){const docked=narrowCapture.matches&&active;if(docked){if(focalHeading.parentElement!==compactCapture)compactCapture.append(focalHeading,focalRange);}else if(focalHeading.parentElement===compactCapture){headingHome.after(focalHeading);rangeHome.after(focalRange);}compactCapture.hidden=!docked;}
  for(const id of ['focal-number','focal-range'])$(id).step='1';
  $('workspace-view-mode').onclick=()=>api.onMode('view');
  $('workspace-edit-mode').onclick=()=>api.onMode('person');
  $('edit-people-target').onclick=()=>api.onMode('person');$('edit-stage-target').onclick=()=>api.onMode('stage');
  $('capture-enabled').onchange=e=>api.onCapture(e.target.checked);
  $('capture-aspect').onchange=e=>api.onAspect(e.target.value);

  // Reparent live nodes: their existing bindings and IDs survive the layout change.
  const left=document.querySelector('.seats-card');
  const mobilePages=node('nav',`${button('mobile-page-stage','보기')}${button('mobile-page-seat','좌석')}${button('mobile-page-actors','배우')}${button('mobile-page-photos','사진 · 의견')}`,'mobile-workspace-pages segmented');mobilePages.setAttribute('aria-label','작업 화면');document.querySelector('.personal-workspace').before(mobilePages);document.body.dataset.mobilePage='stage';
  for(const page of ['stage','seat','actors','photos'])$('mobile-page-'+page).onclick=()=>{if(page==='stage')setMobilePage('stage');else selectPane(page);mobilePages.scrollIntoView({block:'start'});};
  $('mobile-page-stage').setAttribute('aria-pressed','true');
  const tabs=node('div','<button type="button" data-left-pane="seat">좌석</button><button type="button" data-left-pane="actors">배우</button><button type="button" data-left-pane="photos">사진 · 의견</button>','personal-left-tabs segmented');left.prepend(tabs);
  const seatPane=node('div');seatPane.id='left-seat-pane';seatPane.append($('seat-panel'));left.append(seatPane);
  const seatMapButton=node('button','좌석표 크게 보기','quiet-button');seatMapButton.id='open-seat-map-explorer';seatMapButton.type='button';seatMapButton.setAttribute('aria-haspopup','dialog');seatMapButton.setAttribute('aria-controls','seat-map-dialog');seatPane.prepend(seatMapButton);
  const seatMap=createSeatMapExplorer({getSnapshot:()=>informationView?null:api.getSnapshot(),onSelect:seat=>api.onSeat(seat)});seatMapButton.onclick=()=>seatMap.open();
  const actorPane=node('div');actorPane.id='left-actor-pane';actorPane.hidden=true;actorPane.append($('person-multiselect'));left.append(actorPane);
  surface.append(aim);
  for(const id of ['reset-heading','aim-selected-person'])$(id).addEventListener('click',()=>{api.onStageView('seat');if(matchMedia('(max-width:640px)').matches)$('mobile-page-stage').click();});
  const photoPane=node('div');photoPane.id='left-photo-pane';photoPane.hidden=true;photoPane.append(document.querySelector('.seat-photos'),$('add-seat-photos'));left.append(photoPane);
  const photoControls=node('div',`<label>선택 사진<select id="selected-photo" aria-label="선택 좌석의 사진"></select></label><label class="check-label"><input id="photo-project-toggle" type="checkbox">선택 사진 무대 투영</label>
    <label class="check-label"><input id="photo-lock-aspect" type="checkbox">사진 화면비 고정</label><label class="check-label"><input id="photo-lock-focal" type="checkbox">사진 환산 mm 고정</label><p id="photo-lock-note" class="small-note" role="status"></p>`,'personal-photo-controls');
  photoPane.append(photoControls);
  const photoReview=node('fieldset','<legend>사진 확인 설정</legend>','photo-review-settings');photoReview.id='photo-review-settings';
  for(const id of ['photo-project-toggle','photo-lock-aspect','photo-lock-focal'])photoReview.append($(id).closest('label'));
  photoReview.append($('photo-lock-note'),document.querySelector('.stage-photo-opacity-control'));photoControls.append(photoReview);
  // Keep the legacy event endpoint for compatibility, with one visible projection control.
  $('show-model-view').hidden=true;$('show-model-view').classList.add('legacy-control');$('show-model-view').tabIndex=-1;
  const labels=[['selected-photo','선택 사진'],['photo-project-toggle','선택 사진 무대 투영'],['photo-lock-aspect','사진 화면비 고정'],['photo-lock-focal','사진 환산 mm 고정']];
  for(const [id,text]of labels){const label=$(id).closest('label');if(id==='selected-photo')label.firstChild.textContent=text;else label.lastChild.textContent=text;}
  $('selected-photo').setAttribute('aria-label','선택 좌석의 사진');
  // Photo opacity now stays with its three confirmation checkboxes.
  photoPane.append($('photo-registration-status'),$('photo-errors'),$('photo-panel'),$('export-photos'));
  const photoContent=node('section');photoContent.id='seat-media-photos';photoContent.setAttribute('aria-label','사진 등록과 목록');
  photoContent.append(...photoPane.childNodes,$('private-photo-registration'),$('private-photo-library'));
  const opinionContent=node('section');opinionContent.id='seat-media-opinions';opinionContent.setAttribute('aria-label','의견 등록과 목록');opinionContent.hidden=true;opinionContent.inert=true;
  if($('public-seat-posts-host'))opinionContent.append($('public-seat-posts-host'));
  const privateMemo=node('section','<h3>좌석 의견 체험</h3><p class="small-note">입력한 의견은 이 브라우저에만 저장됩니다.</p>');opinionContent.append(privateMemo);
  const seatNotes=createSeatNotes({container:privateMemo,getContext:()=>{const s=api.getSnapshot();return informationView?null:{...s.context,seat:s.state.seat,seatLabel:s.seatLabel};}});
  const mediaTabs=node('div','<button type="button" id="seat-media-photos-button" aria-controls="seat-media-photos" aria-pressed="true">사진</button><button type="button" id="seat-media-opinions-button" aria-controls="seat-media-opinions" aria-pressed="false">의견</button>','segmented');
  mediaTabs.setAttribute('role','group');mediaTabs.setAttribute('aria-label','사진 또는 의견 보기');
  for(const control of mediaTabs.children)control.onclick=()=>{for(const [key,content]of [['photos',photoContent],['opinions',opinionContent]]){const selected=control.id==='seat-media-'+key+'-button';content.hidden=!selected;content.inert=!selected;mediaTabs.querySelector('#seat-media-'+key+'-button').setAttribute('aria-pressed',String(selected));}api.onRefresh();};
  photoPane.append(mediaTabs,photoContent,opinionContent);
  // The main canvas now owns 2D/rotatable 3D inspection; retain old live nodes
  // for compatibility while removing duplicate and developer-only product panels.
  for(const selector of ['#layout-assumption','#stage-wall-note','#scene-note','.model-card','.photo-card','.model-evidence','.data-notice','#open-sources','#model-mode-note','.drawing-model-status','.framing-note','#seat-layout-note','#seat-floor-note','#canvas-caption','.view-surface-legend','.site-footer','.model-selector>.help-trigger'])document.querySelector(selector)?.classList.add('legacy-control');
  let pane='seat',lastPaneMode=null,restorePhotoPane=false,restoreMobilePhotos=false;
  const photoTab=tabs.querySelector('[data-left-pane="photos"]'),mobilePhotoButton=$('mobile-page-photos');
  const availablePane=next=>next==='photos'&&api.getSnapshot().state.editMode!=='view'?'actors':next;
  function showPane(next,refresh=true){next=availablePane(next);pane=next;for(const key of ['seat','actors','photos'])$('left-'+(key==='actors'?'actor':key==='photos'?'photo':key)+'-pane').hidden=key!==next;
    photoPane.inert=photoPane.hidden;
    for(const b of tabs.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.leftPane===next));
    if(next==='seat')$('seat-panel').open=true;
    if(refresh)api.onRefresh();}
  function setMobilePage(page){page=availablePane(page);document.body.dataset.mobilePage=page;for(const key of ['stage','seat','actors','photos'])$('mobile-page-'+key).setAttribute('aria-pressed',String(key===page));}
  function selectPane(next){next=availablePane(next);showPane(next);if(narrowCapture.matches)setMobilePage(next);}
  function syncPhotoPaneMode(mode){
    const view=mode==='view',focused=document.activeElement,photoDialog=$('photo-dialog');
    const moveFocus=!view&&(photoPane.contains(focused)||focused===photoTab||focused===mobilePhotoButton||Boolean(photoDialog?.open&&photoDialog.contains(focused)));
    // Remember the desktop tab and the actually displayed mobile page separately.
    if(lastPaneMode==='view'&&!view){restorePhotoPane=pane==='photos';restoreMobilePhotos=document.body.dataset.mobilePage==='photos';}
    if(!view){
      if(photoDialog?.open)photoDialog.close();
      if(pane==='photos')showPane('actors',false);
      if(document.body.dataset.mobilePage==='photos')setMobilePage('actors');
    }else if(lastPaneMode!==null&&lastPaneMode!=='view'){
      if(restorePhotoPane)showPane('photos',false);
      if(restoreMobilePhotos)setMobilePage('photos');
      restorePhotoPane=restoreMobilePhotos=false;
    }
    lastPaneMode=mode;
    for(const control of [photoTab,mobilePhotoButton]){control.hidden=!view;control.inert=!view;control.disabled=!view;if(!view)control.setAttribute('aria-pressed','false');}
    photoPane.hidden=!view||pane!=='photos';photoPane.inert=photoPane.hidden;
    return moveFocus;
  }
  function focusActivePane(){
    const target=narrowCapture.matches?$('mobile-page-'+document.body.dataset.mobilePage):tabs.querySelector('[data-left-pane="'+pane+'"]');
    if(target&&!target.hidden&&!target.disabled)target.focus({preventScroll:true});
  }
  for(const b of tabs.querySelectorAll('button'))b.onclick=()=>selectPane(b.dataset.leftPane);
  tabs.setAttribute('role','group');tabs.setAttribute('aria-label','좌석·배우·사진 선택');for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.leftPane==='seat'));
  const opButton=node('button','OP석 편집','quiet-button');opButton.id='open-op-seat-editor';opButton.type='button';
  const audienceRow=node('div',null,'personal-audience-controls');audienceRow.id='personal-audience-controls';
  const visibility=document.querySelector('.audience-visibility');visibility.before(audienceRow);
  const refreshAudience=$('audience-reset');refreshAudience.textContent='↻';refreshAudience.setAttribute('aria-label','관객 무작위 배치 새로고침');refreshAudience.title='관객을 새로 무작위 배치';
  const audienceHelp=document.querySelector('[data-help-trigger=audience]');
  if(audienceHelp)audienceHelp.setAttribute('aria-label','관객 무작위 배치 도움말');
  const popup=$('help-audience');if(popup){popup.querySelector('.help-title').textContent='관객 무작위 배치';const guide=popup.querySelector('.audience-edit-guide');if(guide)guide.textContent='새로고침할 때마다 남녀 관객을 새로 무작위 배치합니다. 표시를 꺼도 배치와 OP 제외 상태는 유지됩니다.';}
  const opAction=node('div',null,'audience-op-action');opAction.append(opButton);
  audienceRow.append(visibility,refreshAudience);if(audienceHelp)audienceRow.append(audienceHelp);audienceRow.append(opAction);
  $('audience-panel').hidden=true;$('audience-panel').classList.add('legacy-control');
  const op=createOpSeatEditor({getSnapshot:api.getSnapshot,onApply:api.onExclusions});opButton.onclick=()=>op.open();

  const editor=document.querySelector('#stage-object-editor .panel-content');
  const peopleSettings=node('section',`<h3 id="people-management-title">인원 관리</h3><div class="person-count-inline"><label><span class="sex-dot male-dot"></span>남자<input id="male-count" type="number" min="0" max="128" step="1" value="0" inputmode="numeric"></label><label><span class="sex-dot female-dot"></span>여자<input id="female-count" type="number" min="0" max="128" step="1" value="0" inputmode="numeric"></label></div>
    ${button('open-person-properties','선택 인물 설정')}<p id="personal-selection-note" class="small-note"></p>`,'personal-people-settings');
  peopleSettings.id='personal-actor-create';peopleSettings.setAttribute('aria-labelledby','people-management-title');
  const contextSettings=node('div');contextSettings.id='personal-editor-context-container';contextSettings.dataset.settingsArea='07';
  const editorHeader=node('section','<div class="personal-editor-heading"></div><p id="personal-editor-status" role="status" aria-live="polite"></p><div id="personal-editor-actions"></div><p id="personal-editor-empty" class="small-note"></p>','personal-editor-context');
  $('stage-object-editor').prepend(contextSettings);contextSettings.append(peopleSettings,editorHeader);editorHeader.firstElementChild.append($('layout-title'));
  $('object-panel').querySelector(':scope>summary').prepend(node('span','배치 · 간격','editor-detail-title'));
  const arrangementDetails=$('person-arrangement-panel'),arrangementSection=node('section',null,'person-arrangement-flat');arrangementSection.id=arrangementDetails.id;
  const arrangementHeading=node('div',null,'arrangement-heading');arrangementHeading.append(...arrangementDetails.querySelector(':scope>summary').childNodes);arrangementSection.append(arrangementHeading,...[...arrangementDetails.children].filter(child=>child.tagName!=='SUMMARY'));arrangementDetails.replaceWith(arrangementSection);
  $('personal-editor-actions').append($('open-person-properties'),$('remove-person'));
  editorHeader.append($('personal-selection-note'));
  const inspectorTabs=node('div',`${button('inspector-person-tab','인물 편집')}${button('inspector-stage-tab','무대 편집')}`,'segmented editing-inspector-tabs');inspectorTabs.setAttribute('role','tablist');inspectorTabs.setAttribute('aria-label','편집 대상');
  const inspectorContent=node('div');inspectorContent.id='editing-inspector-content';inspectorContent.setAttribute('role','tabpanel');
  for(const child of [...$('stage-object-editor').childNodes])inspectorContent.append(child);$('stage-object-editor').append(inspectorTabs,inspectorContent);
  for(const [id,mode]of [['inspector-person-tab','person'],['inspector-stage-tab','stage']]){const tab=$(id);tab.setAttribute('role','tab');tab.setAttribute('aria-controls','editing-inspector-content');tab.onclick=()=>api.onMode(mode);}
  inspectorTabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const id=['ArrowLeft','Home'].includes(e.key)?'inspector-person-tab':'inspector-stage-tab';$(id).click();$(id).focus({preventScroll:true});});
  const mobileEditor=node('div',null,'personal-mobile-editor');mobileEditor.hidden=true;surface.after(mobileEditor);
  const narrowEditor=matchMedia('(max-width:950px)');
  function dockEditor(personContext,visible){if(contextSettings.parentElement!==inspectorContent)inspectorContent.prepend(contextSettings);if(visible){if(editorHeader.parentElement!==contextSettings)contextSettings.append(editorHeader);}else if(editorHeader.parentElement!==actorPane)actorPane.append(editorHeader);mobileEditor.hidden=true;}
  narrowEditor.addEventListener('change',()=>api.onRefresh());
  $('remove-person').className='quiet-button danger-button';$('open-person-properties').className='primary-button';
  for(const sex of ['male','female']){
    const countInput=$(sex+'-count');
    countInput.oninput=countInput.onchange=e=>{const count=Number(e.target.value),other=(api.getSnapshot().layout?.people||[]).filter(p=>p.bodyPreset!==sex).length;
      if(e.target.value===''||!Number.isInteger(count)||count<0||count>128||count+other>128){e.target.setAttribute('aria-invalid','true');e.target.title=count+other>128?'무대 인물은 합계 128명까지 배치할 수 있습니다.':'인원은 0~128명의 정수로 입력하세요.';return;}
      e.target.removeAttribute('aria-invalid');e.target.removeAttribute('title');api.onCount(sex,count);};
  }
  $('editor-actions').classList.add('legacy-person-actions');
  const props=node('dialog',`<div class="dialog-heading"><h2 id="person-properties-title">선택 인물 설정</h2>${button('person-properties-close','닫기')}</div><p id="person-properties-count" class="small-note"></p>
    <label>키 (cm)<input id="person-height-cm" type="number" min="30" max="300" step="any" placeholder="혼합값"></label>
    <label>자세<select id="person-pose"><option value="">혼합값 · 유지</option><option value="standing">서기</option><option value="chair">의자 앉기</option><option value="floor">바닥 앉기</option><option value="cross-legged">아빠다리 앉기</option></select></label>
    <label>바라보는 방향 (°)<input id="person-facing-deg" type="number" min="-180" max="360" step="1" placeholder="혼합값"></label>
    <label>체형<select id="person-property-body"><option value="">유지</option><option value="male">남성 참고</option><option value="female">여성 참고</option></select></label>
    <p class="small-note">키는 서 있을 때의 신장입니다. 앉은 자세·의자 크기는 모델 가정입니다. 빈 항목은 기존 값을 유지합니다. 취소·닫기·ESC는 미적용 변경을 버립니다.</p><p id="person-properties-error" role="alert"></p><div class="dialog-actions">${button('person-properties-cancel','취소')}${button('person-properties-apply','선택 인물에 적용')}</div>`,'workspace-dialog');
  props.id='person-properties-dialog';props.setAttribute('aria-labelledby','person-properties-title');document.body.append(props);let propertyContext='',propertyIds=[];
  $('open-person-properties').onclick=()=>{const before=api.getSnapshot();if(!before.state.selectedPersonIds.length)return;if(before.state.editMode!=='person')api.onMode('person');const s=api.getSnapshot(),ps=s.layout.people.filter(p=>s.state.selectedPersonIds.includes(p.id));if(!ps.length)return;propertyContext=JSON.stringify(s.context);propertyIds=ps.map(p=>p.id);
    const common=k=>ps.every(p=>p[k]===ps[0][k])?ps[0][k]:'';
    $('person-height-cm').value=common('heightM')===''?'':common('heightM')*100;$('person-pose').value=common('pose')===''?'':common('pose')||'standing';$('person-facing-deg').value=common('facingDeg')??'';$('person-property-body').value='';
    $('person-properties-count').textContent=`${ps.length}명에 함께 적용`;$('person-properties-error').textContent='';props.showModal();};
  for(const id of ['person-properties-close','person-properties-cancel'])$(id).onclick=()=>props.close('cancel');
  props.addEventListener('cancel',e=>{e.preventDefault();props.close('cancel');});
  $('person-properties-apply').onclick=()=>{const s=api.getSnapshot();if(JSON.stringify(s.context)!==propertyContext){props.close('context-change');return;}const patch={};
    const height=$('person-height-cm').value,facing=$('person-facing-deg').value;
    if(height!==''&&(!Number.isFinite(Number(height))||Number(height)<30||Number(height)>300)){ $('person-properties-error').textContent='키는 30~300cm로 입력하세요.';return;}
    if(facing!==''&&(!Number.isFinite(Number(facing))||Number(facing)<-180||Number(facing)>360)){ $('person-properties-error').textContent='방향은 −180~360°로 입력하세요.';return;}
    if(height!=='')patch.heightM=Number(height)/100;if(facing!=='')patch.facingDeg=Number(facing);
    if($('person-pose').value)patch.pose=$('person-pose').value;if($('person-property-body').value)patch.bodyPreset=$('person-property-body').value;
    api.onPeople(propertyIds,patch);props.close('apply');};

  // A separate cm surface drives the existing metre-based structure model.
  const structure=node('section','<h3>선택 객체 · cm</h3><div class="structure-cm-fields"></div>','personal-structure-settings');
  for(const [key,label]of [['widthM','폭'],['depthM','깊이'],['diameterM','지름'],['heightM','높이'],['x','좌우'],['z','앞뒤']]){
    const labelNode=node('label',`${label} (cm)<input type="number" step="1" data-structure-cm="${key}">`);structure.lastElementChild.append(labelNode);
    labelNode.querySelector('input').onchange=e=>{if(e.target.value===''||!Number.isFinite(Number(e.target.value)))return;api.onStructure({[key]:Number(e.target.value)/100});};}
  const rotation=node('label','회전 (°)<input id="structure-angle-deg" type="number" min="-360" max="360" step="1">');structure.append(rotation);
  rotation.querySelector('input').onchange=e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))api.onStructure({rotationDeg:Number(e.target.value)});};
  editor.append(structure);
  const authoredEditor=createAuthoredGeometryEditor({api,host:inspectorContent,objectPanel:$('object-panel'),objectExtra:structure,stageSpace});

  let availablePhotos=[],selectedPhoto=null,lastPhotoKey='',photoSignature='',directoryRecords=[],lastProjectedId=null,lockWarning='',rejectedFocalKey=null;
  function photoCapabilities(photo){const a=photo?.assets?.display||photo?.publicRecord?.displayAsset;const width=Number(a?.pixelWidth),height=Number(a?.pixelHeight);const ratio=width>0&&height>0?width/height:null;const focal=Number(photo?.metadata?.focalLength35Mm);return {aspect:ratio,focal:Number.isFinite(focal)&&focal>0?focal:null};}
  const focalLockKey=(photo,caps)=>JSON.stringify([photo?.id,caps.focal,api.getSnapshot().focalRange]);
  function applyLocks(){const photo=availablePhotos.find(p=>p.id===$('selected-photo').value);const caps=photoCapabilities(photo);
    const wantsFocal=$('photo-lock-focal').checked;
    const result=api.onPhotoLocks({aspect:$('photo-lock-aspect').checked?caps.aspect:null,focal:wantsFocal?caps.focal:null});
    if(result===false){lockWarning='사진 환산값이 현재 지원 범위 밖이어서 고정하지 않았습니다. ';rejectedFocalKey=focalLockKey(photo,caps);$('photo-lock-focal').checked=false;api.onPhotoLocks({aspect:$('photo-lock-aspect').checked?caps.aspect:null,focal:null});}
    else if(wantsFocal){lockWarning='';rejectedFocalKey=null;}}
  $('selected-photo').onchange=()=>{selectedPhoto=$('selected-photo').value;lockWarning='';rejectedFocalKey=null;$('photo-lock-aspect').checked=false;$('photo-lock-focal').checked=false;api.onPhotoLocks({aspect:null,focal:null});api.onPhotoSelect(selectedPhoto,$('photo-project-toggle').checked);};
  $('photo-project-toggle').onchange=e=>{api.onPhotoSelect($('selected-photo').value,e.target.checked);applyLocks();api.onRefresh();};
  for(const id of ['photo-lock-aspect','photo-lock-focal'])$(id).onchange=()=>{applyLocks();api.onRefresh();};

  let registry=api.getModelRegistry();
  let availability=createTheaterAvailability(null);
  const registryFor=record=>registry.find(entry=>entry.informationRecordId===record.informationRecordId);
  const localDrawing=record=>{const entry=registryFor(record);return ['stage_ready','approximate_ready'].includes(entry?.status)&&availability.isAccepted(record.informationRecordId,'model',entry.venueId)?{id:entry.venueId,name:entry.hallName||record.nameAsListed,approximate:entry.status==='approximate_ready'}:null;};
  const recordForModel=id=>directoryRecords.find(record=>registryFor(record)?.venueId===id);
  const emptyStage=node('section','<h2 id="unavailable-stage-name"></h2><div class="unavailable-stage-surface"><p id="unavailable-stage-status" role="status">무대 자료를 준비하고 있습니다.</p></div>','card unavailable-stage');emptyStage.id='unavailable-stage-empty';emptyStage.hidden=true;document.querySelector('.model-selector').after(emptyStage);
  const emptySurface=emptyStage.querySelector('.unavailable-stage-surface');
  const structureExplorer=createStructureExplorer({container:emptySurface});
  const limitedStructure=createLimitedStructureWorkspace({container:emptySurface});
  let sourceMediaPanel=null;
  const runtimeChoices=new Map();
  const sourceChoiceStorage={
    getItem:key=>{if(runtimeData.getState().mode==='private')return runtimeChoices.get(key)??null;try{return localStorage.getItem(key);}catch{return null;}},
    setItem:(key,data)=>{if(runtimeData.getState().mode==='private'){runtimeChoices.set(key,data);return;}try{localStorage.setItem(key,data);}catch{}},
  };
  function configureHostedNotes(client=null){
    seatNotes.setHosted(client?{client,getSelection:()=>api.getPrivateNoteSelection?.(null)}:null);
    sourceMediaPanel?.setHostedNotes(client?{client,getSelection:()=>api.getPrivateNoteSelection?.(sourceSeatPlan.getMediaContext())}:null);
    return {ok:true};
  }
  const sourceSeatPlan=createSourcePlanWorkspace({container:emptySurface,selectionStorage:sourceChoiceStorage,onSelection:selection=>{sourceMediaPanel?.setContext(sourceSeatPlan.getMediaContext());if(selection&&!informationView&&selection.informationRecordId===selectedInformationId)api.onSourceSeat?.(selection.seat.sourceGeometryId);}});
  sourceMediaPanel=createSeatMediaPanel({container:$('source-seat-workspace').querySelector('.source-seat-sidebar'),photoManager:api.localPhotoManager,getHostedPhotos:api.getHostedSeatPhotos,onSelectHostedPhoto:api.onSelectHostedSeatPhoto,idPrefix:'source-seat-media'});
  const sourceSeatDialog=node('dialog',`<div class="dialog-heading"><h2>좌석 평면</h2>${button('source-seat-dialog-close','닫기')}</div>`,'workspace-dialog source-seat-dialog');sourceSeatDialog.id='source-seat-dialog';document.body.append(sourceSeatDialog);
  const openSourceSeats=node('button','도면 좌석표','quiet-button');openSourceSeats.type='button';openSourceSeats.id='open-source-seat-plan';openSourceSeats.hidden=true;seatMapButton.after(openSourceSeats);
  $('source-seat-dialog-close').onclick=()=>sourceSeatDialog.close();sourceSeatDialog.addEventListener('close',()=>{emptySurface.append($('source-seat-workspace'));sourceSeatPlan.resetTransient();if(!informationView)sourceMediaPanel?.clearPrivatePhoto();});
  const sourceChoices=node('div',`${button('source-choice-seats','좌석 평면')}${button('source-choice-structure','무대 구조')}`,'segmented source-seat-choices');sourceChoices.hidden=true;emptySurface.prepend(sourceChoices);
  const historicalPicker=node('section','<label for="historical-source-variant">공연별 좌석도</label><div class="historical-source-actions"><select id="historical-source-variant"><option value="">공연판 선택</option></select>'+button('historical-source-open','열기')+'</div><p id="historical-source-status" role="status"></p>','historical-source-picker');historicalPicker.id='historical-source-picker';historicalPicker.hidden=true;emptyStage.insertBefore(historicalPicker,emptySurface);
  const historicalActive=node('section','<span class="historical-source-badge">과거 공연 · 부분 좌석도 · 2D</span><strong id="historical-source-title"></strong><p id="historical-source-period"></p>'+button('historical-source-return','현재 극장으로 돌아가기'),'historical-source-active');historicalActive.id='historical-source-active';historicalActive.hidden=true;emptyStage.insertBefore(historicalActive,emptySurface);
  const historicalLoader=createHistoricalSourceLoader((path,signal)=>runtimeData.readJSON(path,{signal}));
  let structureEntries=[];
  let sourceSeatPlanEntries=[];
  let historicalVariants=[],activeHistoricalVariant=null;
  const structureFor=record=>structureEntries.find(entry=>entry.informationRecordId===record.informationRecordId);
  const sourceSeatPlanFor=record=>sourceSeatPlanEntries.find(entry=>entry.informationRecordId===record.informationRecordId&&availability.isAccepted(record.informationRecordId,'plan',entry.assetPath));
  const historicalVariantsFor=record=>historicalVariants.filter(variant=>variant.informationRecordId===record.informationRecordId&&availability.isAccepted(record.informationRecordId,'variant',variant.versionKey));
  const availabilityFor=record=>record.staticRuntimeRequired?{selectable:false,state:'private-runtime-required',reason:'소유자 인증 연결 필요'}:availability.forRecord(record,{modelEntry:registryFor(record),planEntry:sourceSeatPlanEntries.find(entry=>entry.informationRecordId===record.informationRecordId),variants:historicalVariants});
  function clearHistoricalSource(){historicalLoader.cancel();activeHistoricalVariant=null;historicalActive.hidden=true;for(const key of ['versionKey','start','end','loadState','temporalClass','variantKind','contextKind','layoutStart','layoutEnd'])delete historicalActive.dataset[key];delete document.body.dataset.historicalVersionKey;$('historical-source-variant').value='';$('historical-source-open').disabled=true;$('historical-source-status').textContent='';}
  function updateHistoricalChoices(record){const variants=historicalVariantsFor(record),reference=variants.some(variant=>variant.contextKind==='source_layout');historicalPicker.hidden=!variants.length;historicalPicker.querySelector('label').textContent=reference?'참고 좌석도':'공연별 좌석도';$('historical-source-variant').replaceChildren(new Option(reference?'도식 선택':'공연판 선택',''),...variants.map(variant=>new Option(variant.label,variant.versionKey)));$('historical-source-open').disabled=true;$('historical-source-status').textContent=variants.length?(reference?'도식을 선택한 뒤 열어 주세요.':'연도와 공연을 선택한 뒤 열어 주세요.'):'';}
  function clearStructure(){clearHistoricalSource();if(sourceSeatDialog.open)sourceSeatDialog.close('theater-change');emptySurface.append($('source-seat-workspace'));structureExplorer.setAsset(null);limitedStructure.setRecord(null);sourceSeatPlan.setPlan(null);sourceChoices.hidden=true;emptySurface.classList.remove('has-structure');$('unavailable-stage-status').hidden=false;}
  const selectionKey='theater3d-portfolio.information-selection.v1';let selectedInformationId=null,informationRequest=0,lastModelVenue=null;
  const addressHelp=$('theater-address-help'),addressPopover=$('theater-address-popover');let addressPinned=false;
  function showAddress(open){addressPopover.hidden=!open;addressHelp.setAttribute('aria-expanded',String(open));}
  addressHelp.onclick=()=>{addressPinned=!addressPinned;showAddress(addressPinned);};
  addressHelp.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')showAddress(true);});
  addressHelp.parentElement.addEventListener('pointerleave',()=>{if(!addressPinned&&document.activeElement!==addressHelp)showAddress(false);});
  addressHelp.addEventListener('focus',()=>showAddress(true));addressHelp.addEventListener('blur',()=>{if(!addressPinned)showAddress(false);});
  document.addEventListener('pointerdown',e=>{if(!addressHelp.parentElement.contains(e.target)){addressPinned=false;showAddress(false);}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){addressPinned=false;showAddress(false);}});
  function rememberSelection(){if(runtimeData.getState().mode==='private')return;try{localStorage.setItem(selectionKey,JSON.stringify({informationRecordId:selectedInformationId,view:'stage'}));}catch{/* Selection remains usable without persistence. */}}
  function displaySelection(record){
    selectedInformationId=record.informationRecordId;value('theater-select',selectedInformationId);$('current-theater-name').textContent=record.nameAsListed;$('current-theater-name').dataset.informationRecordId=selectedInformationId;$('current-theater-name').dataset.sourceUrl=record.sourceUrl;
    $('venue-name').textContent=record.nameAsListed;document.title=`theater3D · ${record.nameAsListed}`;
    const address=registryFor(record)?.address;addressPopover.textContent=address?.road||'합성 공연장 · 실제 주소 없음';addressPopover.dataset.verified=String(Boolean(address?.road&&address.sourceRefs?.length));addressPinned=false;showAddress(false);
    emptyStage.dataset.informationRecordId=selectedInformationId;$('unavailable-stage-name').textContent=record.nameAsListed;
    updateHistoricalChoices(record);
    openSourceSeats.hidden=!localDrawing(record)||!sourceSeatPlanFor(record);openSourceSeats.disabled=false;
  }
  function setStageUnavailable(active){
    clearStructure();
    informationView=active;document.body.dataset.theaterView=active?'unavailable':'drawing';emptyStage.hidden=!active;
    const privateShell=active&&api.getRuntimeDataState?.().mode==='private'&&!api.getSnapshot().ready;
    document.body.dataset.privateShell=String(privateShell);
    for(const selector of ['.personal-workspace','.model-card','.photo-card']){const el=document.querySelector(selector);if(el){el.hidden=active&&!(privateShell&&selector==='.personal-workspace');el.inert=active;}}
    if(privateShell)emptyStage.hidden=true;
    $('open-simulation-panel').disabled=active;$('open-personal-settings').disabled=active;$('open-view-options').disabled=active;$('simulation-panel').hidden=active;document.querySelector('.data-notice').hidden=true;
    $('model-mode-note').hidden=true;$('drawing-model-status').parentElement.hidden=active;
    for(const dialog of [props,personalSettings,viewOptions,$('op-seat-dialog'),$('seat-map-dialog'),$('sources-dialog'),storageDialog])if(active&&dialog?.open)dialog.close('theater-change');
    if(active)cancelSelection();
  }
  async function selectTheater(id,{remember=true,sourceMode='seats',autoOpen=true,restoreExisting=false}={}){
    const record=directoryRecords.find(r=>r.informationRecordId===id);if(!record){value('theater-select',selectedInformationId||'');return;}
    const status=availabilityFor(record),intent=theaterSelectionIntent(status,{restoring:restoreExisting});
    if(intent==='reject'){value('theater-select',selectedInformationId||'');$('directory-status').textContent=record.nameAsListed+' · '+status.reason;return false;}
    if(intent==='preserve_pending'){
      ++informationRequest;setStageUnavailable(true);displaySelection(record);emptyStage.dataset.loadState='pending';
      $('unavailable-stage-status').textContent=status.reason+' · 극장 목록에서 사용 가능한 극장을 선택해 주세요.';
      return false;
    }
    const request=++informationRequest;api.onBrowseInformation?.();setStageUnavailable(true);displaySelection(record);emptyStage.dataset.loadState='loading';$('unavailable-stage-status').textContent='무대 자료를 준비하고 있습니다.';
    if(matchMedia('(max-width:640px)').matches)$('mobile-page-stage').click();
    if(remember)rememberSelection();const drawing=localDrawing(record);
    if(!drawing){
      const variants=historicalVariantsFor(record),autoVariant=variants.length===1&&variants[0].autoOpenOnSelection===true?variants[0]:null;
      if(autoOpen&&sourceMode==='seats'&&autoVariant&&!sourceSeatPlanFor(record)){await openProductionVariant(autoVariant);return;}
      const planEntry=sourceSeatPlanFor(record),structureEntry=structureFor(record);
      const usePlan=Boolean(planEntry&&(sourceMode==='seats'||!structureEntry));
      const entry=usePlan?planEntry:structureEntry;if(!entry){emptyStage.dataset.loadState='missing';if(variants.length)$('unavailable-stage-status').textContent=variants.some(variant=>variant.contextKind==='source_layout')?'참고 도식을 선택해 좌석도를 확인하세요.':'공연판을 선택해 좌석도를 확인하세요.';return;}
      $('unavailable-stage-status').textContent='구조를 불러오고 있습니다.';
      try{
        const input=await runtimeData.readJSON(entry.assetPath);if(request!==informationRequest)return;
        if(usePlan){
          if(input.informationRecordId!==record.informationRecordId)throw Error('seat plan identity mismatch');if(!sourceSeatPlan.setPlan(input))throw Error('seat plan rejected');
          const notices=[];
          const conflict=input.source?.capacityConflict;if(Number.isInteger(conflict?.claimedTotal)&&Number.isInteger(conflict?.transcribedNumberedLabels))notices.push(`좌석표 표제 ${conflict.claimedTotal}석 · 인쇄 번호 ${conflict.transcribedNumberedLabels}개`);
        }else if(entry.format==='source_plane'){
          const asset=normalizeStructureAsset(input);if(asset.informationRecordId!==record.informationRecordId)throw Error('structure identity mismatch');structureExplorer.setAsset(asset);
        }else{
          if(input.schema!=='limited-theater-structures/v1'||!Array.isArray(input.records))throw Error('structure collection schema');
          const matches=input.records.filter(item=>item.informationRecordId===record.informationRecordId);if(matches.length!==1)throw Error('structure identity mismatch');
          limitedStructure.setRecord(normalizeLimitedStructureRecord(matches[0]));
        }
        document.body.dataset.theaterView=usePlan?'source_seat_plan':'structure';emptySurface.classList.add('has-structure');$('unavailable-stage-status').hidden=true;emptyStage.dataset.loadState='ready';
        sourceChoices.hidden=!((planEntry||autoVariant)&&structureEntry);$('source-choice-seats').setAttribute('aria-pressed',String(usePlan));$('source-choice-structure').setAttribute('aria-pressed',String(!usePlan));
      }catch(error){if(request!==informationRequest)return;clearStructure();emptyStage.dataset.loadState='error';$('unavailable-stage-status').textContent='구조를 열지 못했습니다.';}
      return;
    }
    $('unavailable-stage-status').textContent='무대를 불러오고 있습니다.';
    try{await api.onVenue(drawing.id);}catch{if(request===informationRequest){emptyStage.dataset.loadState='error';$('unavailable-stage-status').textContent='무대를 열지 못했습니다. 다시 선택해 주세요.';}return;}if(request!==informationRequest)return;
    const snapshot=api.getSnapshot();if(snapshot.state.venueId!==drawing.id||!snapshot.planAvailable||!snapshot.ready){emptyStage.dataset.loadState='error';$('unavailable-stage-status').textContent='무대를 열지 못했습니다. 극장정보에서 다시 선택해 주세요.';displaySelection(record);return;}
    lastModelVenue=drawing.id;setStageUnavailable(false);emptyStage.dataset.loadState='ready';displaySelection(record);if(remember)rememberSelection();api.onRefresh();
  }
  $('source-choice-seats').onclick=()=>selectTheater(selectedInformationId,{sourceMode:'seats'});
  $('source-choice-structure').onclick=()=>selectTheater(selectedInformationId,{sourceMode:'structure'});
  async function returnFromHistorical(message=''){
    const id=selectedInformationId;if(!id)return;const restore=selectTheater(id,{remember:false,autoOpen:false}),request=informationRequest;await restore;
    if(request===informationRequest&&selectedInformationId===id)$('historical-source-status').textContent=message;
  }
  $('historical-source-return').onclick=()=>returnFromHistorical();
  $('historical-source-variant').onchange=()=>{if(!$('historical-source-variant').value&&activeHistoricalVariant){returnFromHistorical();return;}$('historical-source-open').disabled=!$('historical-source-variant').value;};
  $('historical-source-open').disabled=true;
  async function openProductionVariant(variant){
    const record=directoryRecords.find(r=>r.informationRecordId===selectedInformationId);if(!record||!variant||variant.informationRecordId!==record.informationRecordId)return;
    if(!availabilityFor(record).selectable||!availability.isAccepted(record.informationRecordId,'variant',variant.versionKey))return false;
    const presentation=sourceProductionPresentation(variant);
    const request=++informationRequest;api.onBrowseInformation?.();setStageUnavailable(true);displaySelection(record);activeHistoricalVariant=variant;
    $('historical-source-variant').value=variant.versionKey;$('historical-source-open').disabled=true;historicalActive.hidden=false;Object.assign(historicalActive.dataset,{versionKey:variant.versionKey,loadState:'loading',temporalClass:presentation.temporalClass,variantKind:variant.variantKind||variant.contextKind||'historical_production',contextKind:variant.contextKind||'historical_production'});for(const field of ['start','end','layoutStart','layoutEnd']){if(typeof variant[field]==='string')historicalActive.dataset[field]=variant[field];else delete historicalActive.dataset[field];}
    historicalActive.querySelector('.historical-source-badge').textContent=variant.variantKind==='user_capture'?'2D만 제공':presentation.badge;historicalActive.querySelector('.historical-source-badge').hidden=variant.variantKind==='user_capture';
    $('historical-source-return').hidden=(variant.autoOpenOnSelection===true||variant.useAsDefaultPermanentLayout===false)&&!structureFor(record)&&!sourceSeatPlanFor(record)&&!localDrawing(record);$('historical-source-return').textContent=variant.variantKind==='operator_sample'&&structureFor(record)?'무대 구조로':'현재 극장으로 돌아가기';historicalActive.hidden=variant.variantKind==='user_capture'&&$('historical-source-return').hidden;
    $('historical-source-title').textContent=variant.label;$('historical-source-period').textContent=presentation.period;$('historical-source-title').hidden=variant.variantKind==='user_capture';$('historical-source-period').hidden=variant.variantKind==='user_capture';
    $('historical-source-status').textContent=`${presentation.temporalLabel} 좌석도를 불러오고 있습니다.`;emptyStage.dataset.loadState='loading';$('unavailable-stage-status').textContent=variant.contextKind==='source_layout'?'참고 도식을 불러오고 있습니다.':'공연 좌석도를 불러오고 있습니다.';
    if(matchMedia('(max-width:640px)').matches)$('mobile-page-stage').click();
    try{
      const input=await historicalLoader.load(variant,record.informationRecordId);if(!input||request!==informationRequest||selectedInformationId!==record.informationRecordId||activeHistoricalVariant?.versionKey!==variant.versionKey)return;
      if(!sourceSeatPlan.setPlan(input))throw Error('historical source plan rejected');
      if(input.presentation?.compactHeader===true&&$('historical-source-return').hidden)historicalActive.hidden=true;
      document.body.dataset.theaterView='historical_source_seat_plan';document.body.dataset.historicalVersionKey=variant.versionKey;emptySurface.classList.add('has-structure');$('unavailable-stage-status').hidden=true;emptyStage.dataset.loadState='ready';historicalActive.dataset.loadState='ready';$('historical-source-open').disabled=false;$('historical-source-status').textContent=`${presentation.temporalLabel} · 부분 좌석도`;sourceChoices.hidden=!(variant.autoOpenOnSelection===true&&structureFor(record));$('source-choice-seats').setAttribute('aria-pressed','true');$('source-choice-structure').setAttribute('aria-pressed','false');sourceSeatPlan.fit();
    }catch(error){if(request!==informationRequest||selectedInformationId!==record.informationRecordId)return;await returnFromHistorical(variant.contextKind==='source_layout'?'참고 도식을 열지 못했습니다. 다시 선택해 주세요.':'공연 좌석도를 열지 못했습니다. 다시 선택해 주세요.');}
  }
  $('historical-source-open').onclick=()=>openProductionVariant(historicalVariants.find(v=>v.versionKey===$('historical-source-variant').value&&v.informationRecordId===selectedInformationId));
  openSourceSeats.onclick=async()=>{
    const record=directoryRecords.find(r=>r.informationRecordId===selectedInformationId),entry=record&&sourceSeatPlanFor(record),request=informationRequest;if(!entry||informationView)return;
    openSourceSeats.disabled=true;
    try{const input=await runtimeData.readJSON(entry.assetPath);if(request!==informationRequest||informationView)return;if(input.informationRecordId!==selectedInformationId||!sourceSeatPlan.setPlan(input,{preserveSelection:true}))throw Error('seat plan rejected');sourceSeatDialog.append($('source-seat-workspace'));sourceSeatDialog.showModal();sourceSeatPlan.resetTransient();sourceSeatPlan.fit();}
    catch(error){if(request===informationRequest){openSourceSeats.textContent='도면을 다시 열어 주세요';}}
    finally{if(request===informationRequest)openSourceSeats.disabled=false;}
  };
  $('theater-select').onchange=e=>selectTheater(e.target.value);
  const directory=node('dialog',`<div class="dialog-heading"><h2>극장 선택</h2>${button('theater-directory-close','닫기')}</div><label>극장 검색<input id="theater-directory-search" type="search" placeholder="극장 이름"></label><nav id="theater-directory-initials" class="directory-initials" aria-label="극장 초성"></nav><div id="theater-directory-results" class="directory-results"></div><div class="directory-pagination">${button('directory-prev','이전')}<span id="directory-page"></span>${button('directory-next','다음')}</div><p id="directory-status" role="status" class="small-note"></p>`,'workspace-dialog theater-directory');directory.id='theater-directory-dialog';document.body.append(directory);
  const initials=['전체','A','ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];let initial='전체',page=0;
  const getInitial=name=>{const code=name.codePointAt(0);return code>=0xac00&&code<=0xd7a3?'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor((code-0xac00)/588)]:/[a-z]/i.test(name[0])?'A':name[0];};
  function directoryList(){const query=$('theater-directory-search').value.normalize('NFC').toLowerCase().replace(/\s/g,'');const found=directoryRecords.filter(r=>(initial==='전체'||getInitial(r.nameAsListed)===initial)&&(r.nameAsListed+' '+(r.existingVenueMatch?.candidateDisplayName||'')).toLowerCase().replace(/\s/g,'').includes(query));const pages=Math.max(1,Math.ceil(found.length/18));page=Math.min(page,pages-1);$('theater-directory-results').replaceChildren();
    for(const r of found.slice(page*18,page*18+18)){
      const availability=availabilityFor(r),item=node('article',null,'directory-item');
      item.dataset.informationRecordId=r.informationRecordId;item.dataset.availability=availability.state;item.setAttribute('aria-disabled',String(!availability.selectable));
      const title=node('strong');title.textContent=r.nameAsListed;
      const status=node('small');status.id='directory-reason-'+r.informationRecordId.replace(/[^A-Za-z0-9_-]/g,'-');
      status.textContent=availability.selectable?(localDrawing(r)?'무대 보기':sourceSeatPlanFor(r)?sourceSeatPlanFor(r).entryLabel||'좌석 평면':historicalVariantsFor(r).length?(historicalVariantsFor(r).length===1?sourceProductionPresentation(historicalVariantsFor(r)[0]).directoryLabel:'과거 공연 좌석도'):structureFor(r)?'구조 보기':'무대 보기'):availability.reason;
      const action=node('button','선택','quiet-button');action.type='button';action.disabled=!availability.selectable;action.setAttribute('aria-label',r.nameAsListed+' 선택');action.setAttribute('aria-describedby',status.id);
      action.onclick=()=>{if(!availabilityFor(r).selectable)return;directory.close();selectTheater(r.informationRecordId);};
      item.append(title,status,action);$('theater-directory-results').append(item);
    }
    $('directory-page').textContent=`${page+1} / ${pages} · ${found.length}항목`;$('directory-prev').disabled=page===0;$('directory-next').disabled=page===pages-1;for(const b of $('theater-directory-initials').children)b.setAttribute('aria-pressed',String(b.textContent===initial));}
  for(const text of initials){const b=node('button');b.textContent=text;b.type='button';b.onclick=()=>{initial=text;page=0;directoryList();};$('theater-directory-initials').append(b);}
  $('theater-directory-search').oninput=()=>{page=0;directoryList();};$('directory-prev').onclick=()=>{page--;directoryList();};$('directory-next').onclick=()=>{page++;directoryList();};$('theater-directory-close').onclick=()=>directory.close();
  const openDirectory=()=>{page=0;initial='전체';$('theater-directory-search').value='';directoryList();directory.showModal();};
  $('current-theater-information').onclick=openDirectory;$('theater-directory-open').onclick=openDirectory;
  function resetRuntimeData(runtimeState,reason){
    // First legacy/public mount preserves the pre-existing drawing while the
    // optional public catalog loads. Every configured session transition purges.
    if(reason==='initial'&&runtimeState.mode==='public')return;
    ++informationRequest;selectedInformationId=null;lastModelVenue=null;runtimeChoices.clear();
    directoryRecords=[];registry=[];structureEntries=[];sourceSeatPlanEntries=[];historicalVariants=[];availability=createTheaterAvailability(null);
    personalBaseline=null;viewBaseline=null;lastContext='';lastEditorKey='';
    setStageUnavailable(true);sourceMediaPanel?.setContext(null);seatNotes.sync();seatMap.clear();authoredEditor.clear();
    availablePhotos=[];selectedPhoto=null;lastPhotoKey='';photoSignature='';lastProjectedId=null;lockWarning='';rejectedFocalKey=null;
    $('photo-lock-aspect').checked=false;$('photo-lock-focal').checked=false;$('photo-project-toggle').checked=false;
    addressPinned=false;showAddress(false);page=0;initial='전체';
    purgeWorkspaceRuntimeDOM(document);
    historicalPicker.hidden=true;openSourceSeats.hidden=true;openSourceSeats.disabled=true;
    const message=runtimeState.status==='ready'||runtimeState.status==='loading'?'극장 자료를 불러오는 중입니다.':runtimeState.status==='error'?'극장 자료를 불러오지 못했습니다. 연결 상태를 확인해 주세요.':'소유자 인증 후 극장 자료를 볼 수 있습니다.';
    $('current-theater-name').textContent=message;$('unavailable-stage-status').textContent=message;$('unavailable-stage-status').hidden=false;
    $('directory-status').textContent=message;$('directory-status').dataset.loadState=runtimeState.status==='ready'?'loading':runtimeState.status;
    document.body.dataset.theaterView='unavailable';
  }
  function installRuntimeData([data,structures,seatPlans,historicalPlans,selectionReview,models],runtimeState){
    if(!runtimeData.isCurrent(runtimeState))return;
    if(!Array.isArray(data?.records))throw Error('catalog shape');
    registry=models?normalizeTheaterModelRegistry(models).entries:api.getModelRegistry();
    if(runtimeState.mode==='private'&&(!models||!structures||!seatPlans||!historicalPlans||!selectionReview))throw Error('private registry missing');
    const staticNotice=staticRuntimeCatalogNotice(data);
    if(runtimeState.mode==='private'&&staticNotice)throw Error('private catalog unavailable');
    if(staticNotice){
      directoryRecords=staticNotice.entries;$('theater-select').replaceChildren();$('theater-select').disabled=true;
      $('directory-status').textContent=staticNotice.message;$('directory-status').dataset.loadState='authorization-required';
      const current=registry.find(entry=>entry.venueId===api.getSnapshot().state.venueId);
      $('current-theater-name').textContent=(current?.hallName||'정적 검토')+' · 비공개 목록은 인증 필요';
      directoryList();return;
    }
    const listedRecords=data.records.filter(record=>!excludedInformationIds.has(record.informationRecordId));
    const known=new Set(listedRecords.map(r=>r.informationRecordId)),seen=new Set();
    if(structures?.schemaVersion===1&&Array.isArray(structures.entries))structureEntries=structures.entries.filter(entry=>{
      const valid=known.has(entry.informationRecordId)&&!seen.has(entry.informationRecordId)&&['source_plane','limited_features'].includes(entry.format)&&/^\.\/data\/[a-zA-Z0-9/_-]+\.json$/.test(entry.assetPath)&&!entry.assetPath.split('/').includes('..');
      if(valid)seen.add(entry.informationRecordId);return valid;
    });
    const planSeen=new Set();if(seatPlans?.schemaVersion===1&&Array.isArray(seatPlans.entries))sourceSeatPlanEntries=seatPlans.entries.filter(entry=>{const valid=known.has(entry.informationRecordId)&&!planSeen.has(entry.informationRecordId)&&/^\.\/data\/[a-zA-Z0-9/_-]+\.json$/.test(entry.assetPath)&&!entry.assetPath.split('/').includes('..');if(valid)planSeen.add(entry.informationRecordId);return valid;});
    historicalVariants=normalizeHistoricalSourceRegistry(historicalPlans,known);
    availability=createTheaterAvailability(selectionReview);
    directoryRecords=[...listedRecords].sort((a,b)=>a.nameAsListed.localeCompare(b.nameAsListed,'ko'));$('theater-select').replaceChildren();
    for(const r of directoryRecords){const availability=availabilityFor(r),option=new Option(availability.selectable?r.nameAsListed:r.nameAsListed+' · '+availability.reason,r.informationRecordId);option.disabled=!availability.selectable;option.dataset.availability=availability.state;$('theater-select').add(option);}
    $('theater-select').disabled=false;$('historical-source-variant').disabled=false;$('selected-photo').disabled=false;
    let saved;if(runtimeState.mode==='public')try{saved=JSON.parse(localStorage.getItem(selectionKey));}catch{}
    const current=recordForModel(api.getSnapshot().state.venueId),restored=directoryRecords.find(r=>r.informationRecordId===saved?.informationRecordId);lastModelVenue=api.getSnapshot().state.venueId;
    if(restored&&(!current||restored.informationRecordId!==current.informationRecordId))selectTheater(restored.informationRecordId,{remember:false,restoreExisting:true});else if(current){if(api.getSnapshot().planAvailable&&availabilityFor(current).selectable){setStageUnavailable(false);emptyStage.dataset.loadState='ready';displaySelection(current);}else selectTheater(current.informationRecordId,{remember:false,restoreExisting:true});}
    const usable=directoryRecords.filter(record=>availabilityFor(record).selectable).length;
    $('directory-status').dataset.loadState='ready';
    $('directory-status').textContent=`합성 공연장 ${usable}개 · 기타 공연장 미제공`;directoryList();
  }
  const runtimeData=createWorkspaceRuntimeData(api,{onInvalidate:resetRuntimeData,onReady:installRuntimeData});


  // Empty-space gestures share the existing checkbox/inspector selection API.
  const canvas=$('seat-view'),box=node('div',null,'personal-selection-box');box.hidden=true;canvas.parentElement.append(box);
  const marquee=createActorMarquee({canvas,box,getSnapshot:api.getSnapshot,onSelection:api.onSelection});
  const cancelSelection=()=>marquee.cancel();
  // Only independent on/off controls become switches. Actor/OP checklists stay checkboxes.
  for(const id of ['capture-enabled','audience-fill-enabled','show-grid','stage-walls-enabled','auditorium-barriers-enabled','obstruction-enabled']){
    const input=$(id);if(!input)continue;input.classList.add('switch-control');input.setAttribute('role','switch');input.closest('label')?.classList.add('switch-field');input.closest('label')?.querySelector('.toggle-track')?.remove();
  }
  surface.querySelector('.workspace-primary-toggle').addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();
    const id=['ArrowLeft','Home'].includes(e.key)?'workspace-view-mode':'workspace-edit-mode';$(id).click();$(id).focus({preventScroll:true});
  });
  let lastContext='',lastEditorKey='';
  function sync(){const runtimeState=runtimeData.getState();if(runtimeState.mode==='private'&&runtimeState.status!=='ready')return;const s=api.getSnapshot();if(!s?.layout)return;marquee.sync();seatNotes.sync();seatMap.sync();const edit=s.state.editMode!=='view',captureOn=!s.state.sightViewEnabled,key=JSON.stringify(s.context);op.sync();
    const movePhotoFocus=syncPhotoPaneMode(s.state.editMode);
    if(directoryRecords.length&&!informationView&&s.state.venueId!==lastModelVenue){lastModelVenue=s.state.venueId;const record=recordForModel(lastModelVenue);if(record){displaySelection(record);rememberSelection();}}
    if(lastContext&&lastContext!==key){for(const dialog of [props,personalSettings,viewOptions])if(dialog.open)dialog.close('context-change');cancelSelection();}lastContext=key;
    const photoContext=key+':'+s.state.seat.row+':'+s.state.seat.number;
    if(lastPhotoKey&&lastPhotoKey!==photoContext){$('photo-lock-aspect').checked=false;$('photo-lock-focal').checked=false;selectedPhoto=null;photoSignature='';lastProjectedId=null;lockWarning='';rejectedFocalKey=null;api.onPhotoLocks({aspect:null,focal:null});}lastPhotoKey=photoContext;
    if(lastProjectedId&&s.state.stagePhotoId&&lastProjectedId!==s.state.stagePhotoId){$('photo-lock-aspect').checked=false;$('photo-lock-focal').checked=false;api.onPhotoLocks({aspect:null,focal:null});}lastProjectedId=s.state.stagePhotoId;
    document.body.dataset.personalMode=edit?s.state.editMode:'view';document.body.dataset.stageView=edit?'edit':s.stageView;stageViews.hidden=edit;for(const mode of ['seat','plan','orbit'])$('stage-view-'+mode).setAttribute('aria-pressed',String(s.stageView===mode));if(edit||s.stageView!=='seat')$('stage-photo-preview').hidden=true;$('workspace-view-mode').setAttribute('aria-pressed',String(!edit));$('workspace-edit-mode').setAttribute('aria-pressed',String(edit));$('edit-target-toggle').hidden=!edit;
    sectionControls.hidden=edit||s.stageView!=='plan';value('sight-section-target',s.sectionTargetMode);$('sight-section-target').querySelector('option[value=person]').disabled=!s.layout.people.some(p=>p.id===s.layout.selectedPersonId);
    if(!sectionControls.hidden){const section=s.stageScene;if(section?.eligible){const target=section.targetKind==='person_center'?'선택 배우 중심':'무대 중심 바닥';$('sight-section-summary').textContent=`${s.seatLabel} → ${target} · 시점 높이 ${section.eyeY.toFixed(2)} m · 모델 기준 시선 각도 ${section.angleDeg>=0?'상향':'하향'} ${Math.abs(section.angleDeg).toFixed(1)}°`;}else $('sight-section-summary').textContent=section?.reason||'단면을 준비하고 있습니다.';}
    $('workspace-view-mode').tabIndex=edit?-1:0;$('workspace-edit-mode').tabIndex=edit?0:-1;
    $('drawing-model-status').textContent=s.state.modelMode==='plan'?'무대 보기':'이전 가상 배치';$('return-to-drawing').hidden=s.state.modelMode==='plan';$('return-to-drawing').disabled=!s.planAvailable;
    $('edit-people-target').setAttribute('aria-pressed',String(s.state.editMode==='person'));$('edit-stage-target').setAttribute('aria-pressed',String(s.state.editMode==='stage'));
    $('capture-enabled').checked=captureOn;$('capture-aspect-label').hidden=false;value('capture-aspect',s.state.aspect);$('camera-panel').hidden=false;captureFields.disabled=!captureOn;captureStatus.hidden=captureOn;document.querySelector('.settings-card').dataset.captureActive=String(captureOn);aim.hidden=edit||s.stageView!=='seat';for(const id of ['reset-heading','aim-selected-person'])$(id).disabled=edit||($(id).id==='aim-selected-person'&&!s.layout.people.length);
    sight.hidden=captureOn||edit||s.stageView!=='seat';dockCapture(captureOn&&!edit&&s.stageView==='seat');
    const {minMm:focalMin,maxMm:focalMax}=getFocalControlRange(s.focalRange);
    const displayFocal=captureOn&&s.state.stagePhotoId&&Number.isFinite(s.state.lockedPhotoFocalMm)?s.state.lockedPhotoFocalMm:s.state.focalLength35Mm;
    for(const id of ['focal-number','focal-range']){$(id).min=focalMin;$(id).max=Math.max(focalMin,focalMax);if(id==='focal-range')$(id).value=focalControlMm(displayFocal);else value(id,focalControlMm(displayFocal));$(id).disabled=!captureOn||focalMin>=focalMax||Boolean(s.state.stagePhotoId&&$('photo-lock-focal').checked);}
    $('capture-aspect').disabled=!captureOn||Boolean(s.state.stagePhotoId&&$('photo-lock-aspect').checked);
    let photoAspectOption=$('capture-aspect').querySelector('option[value=photo]');
    if($('capture-aspect').disabled&&s.state.lockedPhotoAspect){if(!photoAspectOption){photoAspectOption=new Option('','photo');$('capture-aspect').add(photoAspectOption);}photoAspectOption.textContent=`사진 비율 · ${s.state.lockedPhotoAspect.toFixed(4)}`;value('capture-aspect','photo');}
    else photoAspectOption?.remove();
    const focalLocked=Boolean(s.state.stagePhotoId&&$('photo-lock-focal').checked);
    const displaySightFocal=!captureOn&&s.state.stagePhotoId&&Number.isFinite(s.state.lockedPhotoFocalMm)?s.state.lockedPhotoFocalMm:s.state.sightFocalLength35Mm;
    $('sight-focal-range').value=focalControlMm(displaySightFocal);value('sight-focal-number',focalControlMm(displaySightFocal));
    $('sight-focal-range').disabled=captureOn||focalLocked;$('sight-focal-number').disabled=captureOn||focalLocked;$('sight-capture-note').hidden=!captureOn;
    $('sight-view-controls').hidden=false;
    for(const sex of ['male','female']){const input=$(sex+'-count');if(document.activeElement!==input){input.value=s.layout.people.filter(p=>p.bodyPreset===sex).length;input.removeAttribute('aria-invalid');input.removeAttribute('title');}}
    const selected=s.layout.people.filter(p=>s.state.selectedPersonIds.includes(p.id));$('open-person-properties').disabled=s.state.editMode!=='person'||!selected.length;$('remove-person').disabled=s.state.editMode!=='person'||!selected.length;
    const layoutStatus=$('layout-status');layoutStatus.hidden=layoutStatus.textContent==='위치·체형·구조물은 모델 가정';
    const personContext=s.state.editMode!=='stage';$('stage-object-editor').hidden=!edit;$('object-panel').hidden=!edit;
    dockEditor(personContext,edit);
    for(const [id,active]of [['inspector-person-tab',personContext],['inspector-stage-tab',!personContext]]){$(id).setAttribute('aria-selected',String(active));$(id).setAttribute('aria-pressed',String(active));$(id).tabIndex=active?0:-1;}
    inspectorContent.setAttribute('aria-labelledby',personContext?'inspector-person-tab':'inspector-stage-tab');
    document.body.classList.toggle('has-person-tools',personContext&&edit);
    $('personal-editor-actions').hidden=!personContext;$('personal-selection-note').hidden=!personContext;
    $('layout-title').textContent=personContext?'선택 인물 설정':'무대 객체 편집';
    $('personal-editor-status').textContent=personContext?`${s.layout.people.length}명 배치 · ${selected.length}명 선택`:`객체 ${s.layout.structures.length}개`;
    $('personal-editor-empty').textContent=!personContext?'':!s.layout.people.length?'인원 관리에서 배우를 추가하세요.':!selected.length?'왼쪽 목록이나 무대에서 인물을 선택하세요.':'';
    $('personal-selection-note').textContent=`${selected.length}명 선택${selected.length?' · 함께 적용':''}`;
    const editorKey=key+':'+s.state.editMode+':'+s.state.selectedPersonIds.join(',')+':'+s.layout.people.length;
    if(edit&&editorKey!==lastEditorKey){$('object-panel').open=true;if(s.state.editMode==='person'){$('person-arrangement-panel').open=true;showPane('actors',false);}}
    lastEditorKey=editorKey;
    peopleSettings.hidden=!edit||!personContext;structure.hidden=s.state.editMode!=='stage';stageSpace.hidden=s.state.editMode!=='stage';$('person-multiselect').hidden=false;
    $('person-group-controls').hidden=s.state.editMode!=='person'||selected.length<2;
    $('select-all-people').disabled=!s.layout.people.length;$('clear-person-selection').disabled=!selected.length;
    const selectedStructure=s.layout.structures.find(v=>v.id===s.layout.selectedStructureId);for(const input of structure.querySelectorAll('[data-structure-cm]')){input.disabled=!selectedStructure;if(selectedStructure)value(input.id||(input.id='cm-'+input.dataset.structureCm),Math.round((selectedStructure[input.dataset.structureCm]||0)*100));input.closest('label').hidden=selectedStructure&&(input.dataset.structureCm==='diameterM'?selectedStructure.type!=='cylinder':['widthM','depthM'].includes(input.dataset.structureCm)?selectedStructure.type==='cylinder':false);}
    value('structure-angle-deg',selectedStructure?.rotationDeg||0);$('structure-angle-deg').disabled=!selectedStructure;
    const snapshot=api.getPhotos();availablePhotos=snapshot.items.filter(api.photoMatches);const sig=JSON.stringify(availablePhotos.map(p=>[p.id,p.name,p.processingStatus,p.metadata.focalLength35Mm]));
    if(sig!==photoSignature){const prior=selectedPhoto||s.state.stagePhotoId||snapshot.selectedId;$('selected-photo').replaceChildren(new Option('사진 선택',''));for(const p of availablePhotos)$('selected-photo').add(new Option(p.name,p.id));selectedPhoto=availablePhotos.some(p=>p.id===prior)?prior:null;value('selected-photo',selectedPhoto||'');photoSignature=sig;}
    if(s.state.stagePhotoId&&availablePhotos.some(p=>p.id===s.state.stagePhotoId)){selectedPhoto=s.state.stagePhotoId;value('selected-photo',selectedPhoto);}
    const photo=availablePhotos.find(p=>p.id===($('selected-photo').value||selectedPhoto)),caps=photoCapabilities(photo);$('photo-project-toggle').disabled=!photo||photo.processingStatus!=='ready';$('photo-project-toggle').checked=Boolean(s.state.stagePhotoId&&photo?.id===s.state.stagePhotoId);
    if(rejectedFocalKey&&rejectedFocalKey!==focalLockKey(photo,caps)){lockWarning='';rejectedFocalKey=null;}
    $('photo-lock-aspect').disabled=!caps.aspect;$('photo-lock-focal').disabled=!caps.focal;
    if(s.state.stagePhotoId&&($('photo-lock-aspect').checked||$('photo-lock-focal').checked))applyLocks();
    $('capture-enabled').disabled=Boolean(s.state.stagePhotoId&&$('photo-lock-focal').checked);$('capture-enabled').title=$('capture-enabled').disabled?'사진 환산 mm 고정을 해제하면 촬영·시야를 전환할 수 있습니다.':'';
    $('photo-lock-note').textContent=photo?lockWarning+`화면비 ${caps.aspect?caps.aspect.toFixed(4):'미확인 · 처리된 표시본 필요'} · 35mm 환산 ${caps.focal===null?'미확인':focalControlMm(caps.focal)} mm (반올림). 원본 소수값 유지 · 자동 정렬 아님.`:'이 좌석의 사진을 추가하거나 선택하세요.';
    if(s.state.migrationWarnings?.length)$('personal-selection-note').textContent=s.state.migrationWarnings.join(' ');
    authoredEditor.sync(s);
    if(movePhotoFocus)focusActivePane();
  }
  if(!api.getSnapshot().planAvailable){setStageUnavailable(true);$('current-theater-name').textContent=api.getSnapshot().venue?.displayName||'극장을 선택하세요.';}
  sync();runtimeData.start();return {sync,showPane,configureHostedNotes,
    isPrivateSourcePhotoActive:()=>informationView||sourceSeatDialog.open,
    getPrivateSourcePhotoContext:()=>(informationView||sourceSeatDialog.open)?sourceMediaPanel?.getContext()??null:null,
    applyPrivateSourcePhoto:(photo,options)=>sourceMediaPanel?.setPrivatePhoto(photo,options),
    clearPrivateSourcePhoto:()=>sourceMediaPanel?.clearPrivatePhoto(),
    refreshSourcePhotos:()=>sourceMediaPanel?.refreshHostedPhotos(),
    reloadRuntimeData:()=>runtimeData.reload(),disposeRuntimeData:()=>runtimeData.dispose()};
}
