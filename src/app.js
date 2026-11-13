import { seedPortfolioSamplePhoto } from './portfolio-sample-photo.js';
import {createPublicSeatPhotoCatalog} from './public-seat-photo-catalog.js';
import {publicSeatPhotoSettings} from './public-seat-photo-settings.js';
import {createPrivatePhotoSeatCatalog} from './private-photo-seat-catalog.js';
import {createPrivateAuthContinuityStore} from './private-auth-continuity-store.js';
import { applyAuthoredGeometry, normalizeAuthoredGeometry, authoredSeatBlocks, authoredAudienceDirections } from './authored-geometry.js';
import { renderOverview, renderSeatView, renderModelView, renderStageEditorView } from './scene.js';
import { seatPosition, createSeatList, normalizeGeometry, stageBounds, isPointOnStage } from './geometry.js';
import { horizontalFovDeg, focalLengthForFraming35Mm, distance3D, framingMetrics } from './math.js';
import { createPhotoManager } from './photos.js';
import { createLocalPhotoStore } from './local-photo-store.js';
import { MAX_STAGE_PEOPLE, createStageLayout, addPerson, removePerson, updatePerson, addStructure, removeStructure, updateStructure, reconcileStageLayout, isStructureWithinStage } from './stage-layout.js';
import { CAMERA_FOCAL_MIN_MM, CAMERA_FOCAL_MAX_MM, DEFAULT_CAMERA_FOCAL_MM, DEFAULT_CAMERA_ASPECT, CAPTURE_ASPECTS, focalControlMm, getFocalControlRange, focalFromControlMm, SIGHT_FOCAL_MIN_MM, SIGHT_FOCAL_MAX_MM, DEFAULT_SIGHT_FOCAL_MM } from './camera-config.js';
import { LENS_PRESETS, sanitizeLensConfig, updateLensConfig, getCameraFocalRange, getCameraFocalPresets, getCameraStartingFocalMm, clampCameraFocalMm, getLensAperture, createFavoriteLens, sanitizeFavoriteLenses, capturePresetLensDefinition, restorePresetLensDefinition } from './lens-config.js';
import { getEffectiveAudience, setAudienceExclusions, createAudienceLayout, setAudienceAtSeat, removeAudienceAtSeat, clearAudience, getAudienceAtSeat, fillAllAudience, changeAudiencePreset, AUDIENCE_PRESETS } from './audience-layout.js';
import { pickAudience } from './audience-picking.js';
import { renderPhotoSlider } from './photo-slider.js';
import { normalizeSignedAngle, normalizePitch, dragViewAngles, seatViewDirection, retargetSeatDirection, personFacingFromSeatDeg } from './view-direction.js';
import { DEFAULT_CAMERA_HEIGHT_CONFIG, DEFAULT_SEAT_HEIGHT_M, updateCameraHeightConfig, effectiveFloorHeight } from './camera-height.js';
import { planPersonArrangement, planPersonTranslation } from './person-arrangement.js';
import { pickStageObject, createStageDrag, moveStageDrag } from './stage-editing.js';
import { getAuditoriumBarriers } from './auditorium-barriers.js';
import { resolveBodyProfile } from './body-profile.js';
import { loadVenuePreference, saveVenuePreference } from './venue-preferences.js';
import { createWorkspaceUI } from './workspace-ui.js';
import { createPersonalWorkspace } from './personal-workspace.js';
import { resolveStageWallSettings } from './stage-wall-settings.js';
import { createModelOrbitControls } from './model-orbit-controls.js';
import { renderSightSection } from './sight-section.js';
import { normalizeTheaterModelRegistry, validateRenderableTheaterModel } from './theater-model-registry.js';
import { createCatalogUI } from './catalog-ui.js';
import { createPublicSeatPostMount, publicPostSelection } from './public-seat-post-mount.js';
import { createPublicSeatPostsV2UI } from './private-seat-notes-ui.js';
import { publicPostSettings } from './public-post-settings.js';
import { normalizePhotoMetadataSources } from './catalog-repository.js';
import { createSupabaseCatalogTransport } from './supabase-catalog-transport.js';
import { publicCatalogSettings } from './public-catalog-settings.js';
import { normalizePublicCatalogSettings, normalizeHostedPublicCatalogSettings } from './public-catalog-config.js';
import { createPublicCatalogHttpTransport } from './public-catalog-http.js';
import { createSupabaseConnectionUI } from './supabase-connection-config.js';
import { prepareSimulationForApply, createSimulationStorage, SIMULATION_STORAGE_KEY } from './simulation-storage.js';
import { createPrivatePhotoHostedMount } from './private-photo-hosted-mount.js';
import { createPrivateStageSaveController } from './private-stage-save-controller.js';
import { createPrivateAppRuntime } from './private-app-runtime.js';
import { createPrivateHostedSession } from './private-hosted-session.js';
import { createPrivateHostedControls, createPrivateAdminRoute } from './private-hosted-controls.js';
import { privateHostedSettings } from './private-hosted-settings.js';
import { createPrivatePhotoRegistrationUI } from './private-photo-registration-ui.js';
import { privateRegisteredPhotoMatchesSelection } from './private-photo-registration-read-contract.js';
import { createPrivateLensSettingsClient } from './private-lens-settings-client.js';
import { createPrivateLensSettingsSession } from './private-lens-settings-session.js';

const $ = (id) => document.getElementById(id);
const LENS_SETTINGS_KEY = 'theater3d-portfolio.camera-lens-settings.v1';
const DEFAULT_GEOMETRY = { stageWidthM: 10, stageDepthM: 7, stageHeightM: 0.6, rowCount: 10, seatsPerRow: 12, rowSpacingM: 0.9, seatSpacingM: 0.55, firstRowDistanceM: 3, rowRiseM: 0.16, eyeHeightM: 1.2 };
const defaults = { focalLength35Mm: DEFAULT_CAMERA_FOCAL_MM, sightViewEnabled: true, sightFocalLength35Mm: DEFAULT_SIGHT_FOCAL_MM, stagePhotoId: null, photoOpacity: 50, aspect: DEFAULT_CAMERA_ASPECT, eyeHeightM: 1.2, viewYawDeg: 0, viewPitchDeg: 0, followSelectedPerson: true, stageWallsEnabled: true, stageWallHeightM: 3, auditoriumBarriersEnabled: true, aimFraming: 'full', showGrid: true, obstructionEnabled: false, obstructionWidthM: 1.5, obstructionHeightM: 1.2, obstructionX: 1, obstructionDepthM: 0.5 };
let VENUE_CATALOG = [
  { id: 'synthetic-portfolio-orbit-042', name: '가상 공연장 · 포트폴리오 예제', venuePath: './data/demo/synthetic-venue.json', modelPath: './data/demo/synthetic-model.json', defaultSeat: { row: 2, number: 3 } },
];
let theaterModelRegistry = [];
const state = { ...defaults, venueId: VENUE_CATALOG[0].id, modelMode: 'plan', modelView: 'isometric', editMode: 'view', editorSelection: null, selectedPersonIds: [], personEditView: 'top', editorCamera: { yawDeg: 28, elevationDeg: 34, zoom: 1 }, seat: { row: 5, number: 13 } };
const VENUE_ELEMENT_SETTING_KEYS = Object.freeze(['stageWallHeightM','auditoriumBarriersEnabled','obstructionEnabled','obstructionWidthM','obstructionHeightM','obstructionX','obstructionDepthM']);
const venueProfiles = new Map();
const venueElementSettings = new Map();
const seatHeightOverrides = new Map();
let activeVenueProfile = null;
let venueLoadRequest = 0;
let cameraHeightConfig = { ...DEFAULT_CAMERA_HEIGHT_CONFIG };
let venue = null;
let planModel = null;
let demoGeometry = { ...DEFAULT_GEOMETRY };
let geometry = { ...DEFAULT_GEOMETRY };
let sourceGeometry = geometry;
let authoredGeometry = null;
let authoredGeometryEditEpoch = 0;
let modeAuthoredGeometry = { plan: null, demo: null };
let modeLayouts = { plan: null, demo: null };
let modeAudienceLayouts = { plan: null, demo: null };
let layout = null;
let audienceLayout = null;
let modeSeats = { plan: { row: 5, number: 13 }, demo: { row: 5, number: 6 } };
let seatHits = [];
let audienceHits = [];
let modelAudienceHits = [];
let lastAudienceRows = '';
let lastAudienceNumbers = '';
let renderQueued = false;
let auxiliaryRenderRequested = true;
let ready = false;
let lastPhotoSelection = null;
let lastPhotoList = '';
let lastStripSelection = null;
let lastStripSeatKey = '';
let lastStripRangeKey = '';
const pendingPhotoContexts = new Map();
let photoUploadError = '';
let dialogPhotoId = null;
let pendingPhotoProjection = null;
let privateRegistrationUI = null;
let privateRegistrationMounted = false;
let managedLocalPhoto = null;
let managedLocalPreviewUrl = null;
let lastSeatPhotoList = '';
const editingScenes = { overview: null, seat: null, model: null };
let stagePointer = null;
let workspaceUI = null;
let personalWorkspace = null;
let stageView = 'seat';
let sectionTargetMode = 'stage';
let modelOrbitControls = null;
let catalogUI = null;
let publicPostMount = null;
let publicPostPlaceholder = null;
let privatePhotoLibraryUI = null;
let publicSeatCatalog=null,publicHostedSeatPhoto=null;
let privateSeatCatalog=null,privateSeatCatalogTimer=null,lastPrivateSeatContext=null;
function listedSeatPhotos(context){
  const records=[...(publicSeatCatalog?.list(context)??[]),...(privateSeatCatalog?.list(context)??[])];
  return records.filter((p,i)=>records.findIndex(q=>q.photoId===p.photoId)===i);
}
function seatCatalogStatus(){const a=publicSeatCatalog?.getState().status,b=privateSeatCatalog?.getState().status;return a==='loading'||b==='loading'?'loading':a==='ready'||b==='ready'?'ready':a==='error'||b==='error'?'error':b??a??'unconfigured';}
async function readSeatPhoto(id,context){if(publicSeatCatalog?.list(context).some(p=>p.photoId===id))return publicSeatCatalog.read(id,context);if(privateSeatCatalog)return privateSeatCatalog.read(id,context);throw Error('PHOTO_UNAVAILABLE');}
function clearPublishedSeatPhoto(){const old=publicHostedSeatPhoto;publicHostedSeatPhoto=null;if(!old)return;if(state.stagePhotoId===old.id)state.stagePhotoId=null;URL.revokeObjectURL(old.displayUrl);if(old.seatContext.kind==='source2d')personalWorkspace?.clearPrivateSourcePhoto?.();}
function publishedSeatPhotoIsCurrent(photo){return photo===publicHostedSeatPhoto&&publicSeatCatalog?.getState().status==='ready'&&privateRegisteredPhotoMatchesSelection(photo.seatContext,currentPrivatePhotoContext())&&publicSeatCatalog.list(photo.seatContext).some(item=>item.photoId===photo.id);}
function applyPublishedSeatPhoto(payload){
  if(payload?.source!=='published-seat-photo'||!privateRegisteredPhotoMatchesSelection(payload.seatContext,currentPrivatePhotoContext())||!publicSeatCatalog?.list(payload.seatContext).some(p=>p.photoId===payload.photoId))return false;
  const d=payload.display;if(!(d?.bytes instanceof Uint8Array)||d.bytes.byteLength!==d.byteSize)return false;
  clearPublishedSeatPhoto();clearPrivateHostedPhoto();
  const photo={id:payload.photoId,name:payload.originalFilename,publicSeatRecord:true,displayUrl:URL.createObjectURL(new Blob([d.bytes],{type:d.mediaType})),metadata:{...payload.metadata},seatContext:structuredClone(payload.seatContext),processingStatus:'ready',assets:{display:{pixelWidth:d.pixelWidth,pixelHeight:d.pixelHeight}}};
  publicHostedSeatPhoto=photo;
  if(!publishedSeatPhotoIsCurrent(photo)){clearPublishedSeatPhoto();return false;}
  if(photo.seatContext.kind==='source2d'){let applied=false;try{applied=personalWorkspace?.applyPrivateSourcePhoto(photo,{isCurrent:()=>publishedSeatPhotoIsCurrent(photo),onClear:()=>{if(publicHostedSeatPhoto===photo)clearPublishedSeatPhoto();}})===true;}catch{}if(!applied)clearPublishedSeatPhoto();return applied;}
  applyPhotoToView(photo,true);personalWorkspace?.sync();return state.stagePhotoId===photo.id;
}
function applySelectedServerPhoto(payload){return payload?.source==='published-seat-photo'?applyPublishedSeatPhoto(payload):applyPrivateRegisteredPhoto(payload,{},true);}
function refreshPublishedSeatPhotos(){clearPublishedSeatPhoto();if(ready)syncStagePhotoPreview();void publicSeatCatalog?.start();}
function startPublishedSeatPhotos(){
 if(publicSeatPhotoSettings.enabled!==true)return;
 const refresh=()=>{if(publicHostedSeatPhoto&&!publishedSeatPhotoIsCurrent(publicHostedSeatPhoto))clearPublishedSeatPhoto();if(ready){syncStagePhotoPreview();renderSeatPhotoThumbnails(photoManager.getSnapshot().items.filter(photoMatchesCurrentSeat));}personalWorkspace?.refreshSourcePhotos?.();};
 publicSeatCatalog=createPublicSeatPhotoCatalog({enabled:true,onChange:refresh});void publicSeatCatalog.start();let key=null;
 const timer=setInterval(()=>{const next=JSON.stringify(currentPrivatePhotoContext());if(next!==key){key=next;if(publicHostedSeatPhoto&&!publishedSeatPhotoIsCurrent(publicHostedSeatPhoto))clearPublishedSeatPhoto();refresh();}},500);
 window.addEventListener('pagehide',()=>{clearInterval(timer);clearPublishedSeatPhoto();publicSeatCatalog?.dispose();},{once:true});
}
function configurePrivateSeatCatalog(provider){
  privateSeatCatalog?.dispose();privateSeatCatalog=null;if(privateSeatCatalogTimer!==null)clearInterval(privateSeatCatalogTimer);privateSeatCatalogTimer=null;lastPrivateSeatContext=null;
  const refresh=()=>{if(ready)renderSeatPhotoThumbnails(photoManager.getSnapshot().items.filter(photoMatchesCurrentSeat));personalWorkspace?.refreshSourcePhotos?.();};
  if(provider?.kind==='configured-private'){privateSeatCatalog=createPrivatePhotoSeatCatalog({provider,onChange:refresh});void privateSeatCatalog.start();privateSeatCatalogTimer=setInterval(()=>{const key=JSON.stringify(currentPrivatePhotoContext());if(key!==lastPrivateSeatContext){lastPrivateSeatContext=key;refresh();}},500);}
  refresh();
}
const runtimeData = createPrivateAppRuntime({ readPublicJSON: async (path, { signal } = {}) => {
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Runtime data unavailable'); return response.json();
} });
let hostedSession = null, hostedControls = null, runtimeStarted = false;
const adminRoute=createPrivateAdminRoute({window,document,panel:$('private-admin-panel'),returnButton:$('private-admin-return')});
let privateLensSession = null, privateLensClient = null;
let privateHostedMode = privateHostedSettings.enabled === true;
// Public theater geometry and private account data are independent services.
// This opt-in is emitted only by the reviewed public-model build.
const publicModelMode = privateHostedSettings.publicModels === true;
const adminRuntimeData = createPrivateAppRuntime({ readPublicJSON: async () => { throw Error('Private admin runtime required'); } });
const lockedPrivateRuntime = Object.freeze({getSession:()=>null,subscribeSession:()=>()=>{},readJSON:async()=>{throw Error('Private runtime requires a current session');}});
export function configurePrivateRuntimeData(connection = null) {
  if(publicModelMode)return adminRuntimeData.configure(connection??lockedPrivateRuntime);
  return runtimeData.configure(connection===null&&privateHostedMode?lockedPrivateRuntime:connection);
}

// Explicit host injection only. No URL/global/localStorage credential lookup.
// Page restoration starts unconfigured and requires a fresh host attachment.
export function configurePrivatePhotoLibrary(connection = null) {
  // Unconfigured connection panels are not mounted in the product DOM.
  if (connection == null) {
    privatePhotoLibraryUI?.dispose(); privatePhotoLibraryUI = null;
    return Promise.resolve(Object.freeze({ status: 'unconfigured' }));
  }
  privatePhotoLibraryUI ??= createPrivatePhotoHostedMount({ container: $('private-photo-library'),onProviderChanged:configurePrivateSeatCatalog,onCatalogChanged:refreshPublishedSeatPhotos });
  return privatePhotoLibraryUI.enable(connection);
}
export function configurePrivatePhotoRegistration(client = null) {
  privateRegistrationUI?.dispose(); privateRegistrationUI = null;
  const container = $('private-photo-registration');
  if (!container || !privateRegistrationMounted) return { ok:false, code:'NOT_MOUNTED' };
  if (client == null) return { ok:true, status:'unconfigured' };
  privateRegistrationUI = createPrivatePhotoRegistrationUI({ container, manager:photoManager, client,onConfirmed:()=>{if(privatePhotoLibraryUI?.refresh()!==true)throw Error('LIBRARY_REFRESH_UNAVAILABLE');},
    // Only a current, explicitly selected public catalog seat. Local source
    // claims/labels are not canonical IDs; the server rechecks catalog/admission.
    getContext:() => {
      const selected=state.modelMode==='plan'?publicPostSelection(activeCatalogContext):null;
      const mapped=selected?catalogMappedSeat(activeCatalogContext,geometry):null;
      if(!selected||!mapped||mapped.row!==state.seat.row||mapped.number!==state.seat.number)return null;
      const {projectRef,...scope}=selected.canonicalScope;return {...scope,postId:null};
    } });
  return { ok:true };
}
let publicPhoto = null;
let privateHostedPhoto = null;
let activeCatalogContext = null;
const catalogProfiles = new Map();
const simulationStorage = createSimulationStorage();
const restoredSimulationContexts = new Set();
let simulationContextKey = '';
let simulationImportRequest = 0;
let privateStageController = createPrivateStageSaveController();
let privateStageUnsubscribe = null;
let privateStageConfigured = false;
let privateStageListRequest = 0;
let privateStageViewEpoch = 0;
let privateStageListCursor = null;
// Session-scoped UI receipts only; no localStorage or inferred remote state.
const privateStageDeleteOptions = new Map();
let privateStageSessionSnapshot = () => null;
let privateStageRenderedSessionKey = null;
function privateStageSessionKey() {
  try {
    const session=privateStageSessionSnapshot();
    return session && typeof session.accountId==='string' && Number.isSafeInteger(session.epoch)
      ? JSON.stringify([session.projectRef,session.accountId,session.epoch]) : null;
  } catch { return null; }
}
function syncPrivateStageDeleteOptions() {
  const status=privateStageController.getState(), key=privateStageSessionKey();
  if(status.status!=='ready'||!key||key!==privateStageRenderedSessionKey){
    privateStageDeleteOptions.clear();privateStageRenderedSessionKey=status.status==='ready'?key:null;
  }
  const pending=new Set(status.uncertainDeleteIds||[]);
  for(const [id,entry]of privateStageDeleteOptions)if(entry.sessionKey!==key||!pending.has(id))privateStageDeleteOptions.delete(id);
  return key;
}
function showPrivateStageDeleteOptions() {
  const key=syncPrivateStageDeleteOptions(), context=JSON.stringify(simulationContext()), select=$('simulation-select');
  if(!select||!key)return;
  for(const entry of privateStageDeleteOptions.values()){
    if(entry.contextJSON!==context)continue;
    let option=[...select.options].find(item=>item.dataset.stageId===entry.remoteId);
    if(!option){option=new Option('',`private-server:${entry.remoteId}`);select.add(option);}
    option.textContent=`${entry.label} · 서버 삭제 상태 확인 필요`;
    option.dataset.privateStage='record';option.dataset.stageId=entry.remoteId;
    option.dataset.stageRevision=String(entry.revision);option.dataset.stageCompatible='false';option.dataset.stageDeletePending='true';
  }
}
const PRIVATE_STAGE_MORE = '__private_stage_next_page__';
function clearPrivateStageOptions() {
  privateStageListRequest++; privateStageListCursor = null;
  const select = $('simulation-select');
  if (select) for (const option of [...select.options]) if (option.dataset.privateStage) option.remove();
}
// The host supplies a verified session port, v2 workspace and explicit registry
// mapping. Import/page restoration never reads credentials or enables a provider.
export function configurePrivateStageWorkspace(connection = null) {
  privateStageUnsubscribe?.(); privateStageUnsubscribe = null;
  privateStageDeleteOptions.clear();privateStageSessionSnapshot=()=>null;privateStageRenderedSessionKey=null;
  privateStageController.dispose(); privateStageConfigured = false; clearPrivateStageOptions();
  privateStageController = createPrivateStageSaveController();
  if (connection !== null) {
    try {
      if (!connection || Object.getPrototypeOf(connection) !== Object.prototype
          || Reflect.ownKeys(connection).length !== 3
          || !['workspace','sessionPort','getMapping'].every(k => {
            const d=Object.getOwnPropertyDescriptor(connection,k); return d?.enumerable && Object.hasOwn(d,'value');
          })) throw new TypeError('INVALID_CONFIGURATION');
      privateStageController = createPrivateStageSaveController({ enabled: true,
        workspace: connection.workspace, sessionPort: connection.sessionPort, getMapping: connection.getMapping,
        getSelectionStamp: () => JSON.stringify({ epoch: privateStageViewEpoch, loadRequest: venueLoadRequest, context: simulationContext(),
          seat: state.seat, modelMode: state.modelMode, modelVersion: planModel?.version ?? null }),
        applyPreset: preset => applySimulation(preset) });
      privateStageConfigured = true;
      privateStageSessionSnapshot=()=>connection.sessionPort.getSession();
      privateStageRenderedSessionKey=privateStageSessionKey();
      privateStageUnsubscribe = privateStageController.subscribe(() => {
        const valid=privateStageController.checkSession(),key=valid?privateStageSessionKey():null;
        if (!valid||key!==privateStageRenderedSessionKey) {
          privateStageDeleteOptions.clear();privateStageRenderedSessionKey=key;clearPrivateStageOptions();
        }
      });
    } catch { return Object.freeze({ ok: false, code: 'INVALID_CONFIGURATION' }); }
  }
  if (ready) refreshSimulation();
  return Object.freeze({ ok: true, status: privateStageConfigured ? 'host-attached' : 'unconfigured' });
}
function privateStageMessage(result, success) {
  if (result.ok) { simulationStatus(success); return true; }
  const descriptions = {
    UNCONFIGURED: '서버 저장이 설정되지 않았습니다.', SESSION_REQUIRED: '계정 인증을 다시 확인하세요.',
    SESSION_CHANGED: '계정이 바뀌어 결과를 적용하지 않았습니다.', SESSION_EXPIRED: '인증이 만료됐습니다.',
    SELECTION_CHANGED: '작업 중 선택이 바뀌어 결과를 적용하지 않았습니다.',
    OUTCOME_UNKNOWN: '서버 저장 결과가 불확실합니다. 다시 저장하기 전에 서버 목록에서 불러와 확인하세요.',
    RECONCILIATION_REQUIRED: '이전 저장 결과를 먼저 서버에서 불러와 확인하세요.',
    REVISION_CONFLICT: '다른 기기에서 변경됐습니다. 서버 배치를 다시 불러오세요.',
    NO_EXPLICIT_MAPPING: '현재 홀·판본의 확인된 서버 대응이 없습니다.',
    SEAT_MAPPING_UNAVAILABLE: '현재 좌석의 확인된 서버 대응이 없습니다.',
    APPLY_REJECTED: '현재 모델에 적용할 수 없습니다. 기존 화면을 유지했습니다.' };
  simulationStatus(descriptions[result.code] || '서버 작업을 완료하지 못했습니다. 로컬 저장은 유지됩니다.', true);
  return false;
}
async function refreshPrivateStageList(append = false) {
  if (!privateStageConfigured || !ready) return;
  const controller = privateStageController, context = JSON.stringify(simulationContext());
  if (!append) clearPrivateStageOptions();
  showPrivateStageDeleteOptions();
  const serial = ++privateStageListRequest, after = append ? privateStageListCursor : null;
  const result = await controller.list({ limit: 24, after_id: after });
  if (controller !== privateStageController || serial !== privateStageListRequest
      || context !== JSON.stringify(simulationContext())) return;
  if (!result.ok) { privateStageMessage(result, ''); return; }
  if (!controller.isResultCurrent(result)) return;
  const select = $('simulation-select');
  for (const option of [...select.options]) if (option.dataset.privateStage === 'more') option.remove();
  const existing = new Set([...select.options].filter(o => o.dataset.privateStage === 'record').map(o => o.dataset.stageId));
  for (const item of result.items) {
    if (existing.has(item.id)) continue;
    const option = new Option(`${item.name} · 서버${item.compatible ? '' : ' · 현재 모델과 연결 안 됨'}`, `private-server:${item.id}`);
    option.dataset.privateStage = 'record'; option.dataset.stageId = item.id; option.dataset.stageRevision=String(item.revision); option.dataset.stageCompatible=String(item.compatible);
    select.add(option); existing.add(item.id);
  }
  showPrivateStageDeleteOptions();
  privateStageListCursor = result.next_after_id;
  if (privateStageListCursor !== null) {
    const option = new Option('서버 배치 더 보기…', PRIVATE_STAGE_MORE); option.dataset.privateStage = 'more'; select.add(option);
  }
}
function selectedPrivateStageId() {
  const option = $('simulation-select').selectedOptions[0];
  return option?.dataset.privateStage === 'record' ? option.dataset.stageId : null;
}
let lensStorageUnavailable = false;
const storedLensSettings = loadLensSettings();
let favoriteLenses = sanitizeFavoriteLenses(storedLensSettings.favorites);
let lensConfig = sanitizeLensConfig(storedLensSettings.config, favoriteLenses);
let preservedLocalLensSettings = { version:1, config:structuredClone(lensConfig), favorites:structuredClone(favoriteLenses) };
let restoredPresetLens = null;
const effectiveFavoriteLenses = () => restoredPresetLens ? [...favoriteLenses.filter(lens=>lens.id!==restoredPresetLens.id),restoredPresetLens] : favoriteLenses;
let favoriteEditingId = null;
let lensOptionsSignature = '';
state.focalLength35Mm = lensConfig.mode === 'lens' ? getCameraStartingFocalMm(lensConfig, favoriteLenses) : normalizeInitialFocal();
function normalizeInitialFocal() { return clampCameraFocalMm(DEFAULT_CAMERA_FOCAL_MM,lensConfig,favoriteLenses); }
let photoUIBound = false;
const photoManager = createPhotoManager({ onChange: snapshot => { if (photoUIBound) renderPhotos(snapshot); }, localStore: createLocalPhotoStore() });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rowLabel = (row) => isPlan() ? createSeatList(geometry).find(seat => seat.row === row)?.rowLabel || venue?.officialSeatLayout?.rows?.[row - 1]?.label || `${row}` : row >= 1 && row <= 26 ? String.fromCharCode(64 + row) : `${row}`;
const isPlan = () => state.modelMode === 'plan' && Boolean(planModel);
const rowMeaning = () => isPlan() && venue?.officialSeatLayout?.rowMeaning === 'section' ? '구역' : '열';
const rowDisplayLabel = (row) => {const label=String(rowLabel(row)),meaning=rowMeaning();return label.endsWith(meaning)?label:`${label}${meaning}`;};
const seatDisplayLabel = (seat) => {
  const item=isPlan()?createSeatList(geometry).find(item=>item.row===seat.row&&item.number===seat.number):null;
  return planModel?.approximate&&isPlan()?item?.label||'도면 위치':item?.displayLabel||`${rowDisplayLabel(seat.row)} ${seat.number}번`;
};
const unpositionedSeats = () => isPlan() && Array.isArray(planModel.seatMapping?.unpositionedOfficialSeats) ? planModel.seatMapping.unpositionedOfficialSeats : [];
const unpositionedNote = () => {
  const reasons = new Map();
  for (const seat of unpositionedSeats()) {
    const reason = seat.reason || '좌석표와 평면도의 좌석 수가 달라 배치 위치를 확인하지 못했습니다.';
    const labels = reasons.get(reason) || [];
    labels.push(seat.label || `${seat.rowLabel || rowLabel(Number(seat.row))}${seat.number}`);
    reasons.set(reason, labels);
  }
  return [...reasons].map(([reason, labels]) => `${labels.join('·')}: ${reason}`).join(' ');
};
const unmatchedPhysicalNote = () => isPlan() && Array.isArray(planModel.seatMapping?.unmatchedPhysicalSeats) ? planModel.seatMapping.unmatchedPhysicalSeats.map(seat => seat.reason || `${seat.planRow || '해당'}열 ${seat.position === 'leftmost' ? '최좌측의' : '해당 위치의'} 번호 없는 추가 좌석 기호는 선택 대상에서 제외했습니다.`).join(' ') : '';
const seatMappingNote = () => [unpositionedNote(), unmatchedPhysicalNote()].filter(Boolean).join(' ');
const seatLabel = () => `${isPlan() ? '도면 ' : '샘플 '}${seatDisplayLabel(state.seat)}`;
const aspectRatio = () => { const [width, height] = state.aspect.split(':').map(Number); return width / height; };
const finite = (value, fallback) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback;
const normalizeFocalLength = (value) => clampCameraFocalMm(value, lensConfig, effectiveFavoriteLenses(), state.focalLength35Mm);
const normalizeSightFocalLength = (value) => Math.round(clamp(finite(value, DEFAULT_SIGHT_FOCAL_MM), SIGHT_FOCAL_MIN_MM, SIGHT_FOCAL_MAX_MM));
const cameraFocalRange = () => getCameraFocalRange(lensConfig, effectiveFavoriteLenses());
const photoFocalTarget = (value, source = 'auto') => {
  if (!Number.isFinite(value)) return null;
  const range = cameraFocalRange();
  if (source === 'camera') return value >= range.minMm && value <= range.maxMm ? 'camera' : null;
  if (source === 'sight') return value >= SIGHT_FOCAL_MIN_MM && value <= SIGHT_FOCAL_MAX_MM ? 'sight' : null;
  if (lensConfig.mode === 'full' && value >= SIGHT_FOCAL_MIN_MM && value <= CAMERA_FOCAL_MAX_MM) return value < CAMERA_FOCAL_MIN_MM ? 'sight' : 'camera';
  if (state.sightViewEnabled && value >= SIGHT_FOCAL_MIN_MM && value <= SIGHT_FOCAL_MAX_MM) return 'sight';
  return !state.sightViewEnabled && value >= range.minMm && value <= range.maxMm ? 'camera' : null;
};
const isAllowedPhotoFocal = (value) => photoFocalTarget(value) !== null;
const photoFocalLocked = () => Boolean(state.stagePhotoId && Number.isFinite(state.lockedPhotoFocalMm));
const activeFocalLength = () => state.stagePhotoId && Number.isFinite(state.lockedPhotoFocalMm) ? state.lockedPhotoFocalMm : state.sightViewEnabled ? state.sightFocalLength35Mm : state.focalLength35Mm;
const activeAspectRatio = () => state.stagePhotoId && state.lockedPhotoAspect || (state.sightViewEnabled ? 16 / 9 : aspectRatio());
const getAudience = () => authoredAudienceDirections(getEffectiveAudience(audienceLayout).filter(person => person.seat?.row !== state.seat.row || person.seat?.number !== state.seat.number),geometry);
const getVisibleAudience = () => audienceLayout?.visible ? getAudience() : [];
const getStageEnclosure = () => ({ enabled: state.stageWallsEnabled, heightM: state.stageWallHeightM, sides: state.stageWallSides });
function applyStageWallSettings(settings = {}) {
  Object.assign(state, resolveStageWallSettings(state.venueId, settings));
  if (activeVenueProfile) activeVenueProfile.stageWallSettings = structuredClone({ stageWallSides: state.stageWallSides, stageWallsEnabled: state.stageWallsEnabled });
}
// Personal visibility/obstruction controls belong to the active venue profile.
// Source geometry and arrangement schemas remain separate and unchanged.
function rememberVenueElementSettings() {
  if (activeVenueProfile) venueElementSettings.set(state.venueId, Object.fromEntries(VENUE_ELEMENT_SETTING_KEYS.map(key => [key, state[key]])));
}
function restoreVenueElementSettings(venueId) {
  const saved = venueElementSettings.get(venueId) || {};
  for (const key of VENUE_ELEMENT_SETTING_KEYS) state[key] = Object.prototype.hasOwnProperty.call(saved,key) ? saved[key] : defaults[key];
}
const auditoriumBarriersAvailable = () => false; // No real-venue barrier model is shipped.
const auditoriumBarriersEnabled = () => auditoriumBarriersAvailable() && state.auditoriumBarriersEnabled;
const auditoriumBarrierControlNote = () => planModel?.uiNotes?.auditoriumBarrierControlNote || '사용자 관찰: 두께 약 30cm · 무릎 앞 약 5cm. 높이는 무대 높이 기준의 임시 가정이며 실제 높이·끊김은 미확인입니다.';
const auditoriumBarrierNote = () => planModel?.uiNotes?.auditoriumBarrierNote || '사용자 관찰: 두께 약 30cm · 무릎 앞 약 5cm. 높이는 무대 높이 기준의 임시 가정이며 실제 높이·끊김은 미확인입니다.';
const getAuditoriumBarrierContext = () => ({ available: auditoriumBarriersAvailable(), enabled: auditoriumBarriersEnabled(), evidence: auditoriumBarriersAvailable() ? planModel.auditoriumBarrierEvidence || null : null });

function loadLensSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(LENS_SETTINGS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    lensStorageUnavailable = true;
    return {};
  }
}

function syncLensStorageNote() {
  const remote=privateLensSession?.getState();
  const message=remote?.status==='loading'?'로그인한 계정의 렌즈 설정을 불러오는 중입니다.'
    :remote?.status==='signed-out'?'서버 렌즈 설정은 로그인 후 사용할 수 있습니다. 기존 브라우저 설정은 보존됩니다.'
    :remote?.status==='saving'?'렌즈 설정을 서버에 저장하는 중입니다.'
    :remote?.status==='blocked'?'다른 기기의 변경 또는 저장 결과를 확인해야 합니다. 로그아웃 후 다시 로그인해 확인해 주세요. 현재 편집은 화면에 유지됩니다.'
    :remote?.status==='error'?'서버 렌즈 설정을 확인하거나 저장하지 못했습니다. 현재 편집과 기존 브라우저 설정은 보존됩니다.'
    :remote?.enabled?'범위·크롭 적용 또는 즐겨찾기 저장·삭제를 누르면 로그인한 계정에 저장합니다. 기존 브라우저 설정은 보존됩니다.'
    :lensStorageUnavailable?'이 브라우저에서 렌즈 설정 저장을 사용할 수 없어 현재 탭에서만 유지됩니다. 사진과 EXIF는 저장하지 않습니다.'
    :'렌즈 설정·즐겨찾기를 이 브라우저에 저장합니다. 사진과 EXIF는 저장하지 않습니다.';
  if($('lens-storage-note'))$('lens-storage-note').textContent=message;
}
function applySessionLensSettings(settings) {
  favoriteLenses=structuredClone(settings.favorites);lensConfig=structuredClone(settings.config);restoredPresetLens=null;
  favoriteEditingId=null;if($('favorite-lens-dialog')?.open)$('favorite-lens-dialog').close('cancel');
  state.focalLength35Mm=normalizeFocalLength(state.focalLength35Mm);
  if(runtimeStarted){fillLensSetup();syncControls();renderPhotoSliders(photoManager.getSnapshot());syncSeatPhotoRegistration();scheduleRender();}
}
function saveLensSettings({remote=false}={}) {
  if(privateLensSession?.enabled){
    privateLensSession.markEdited();if(remote)void privateLensSession.save();syncLensStorageNote();return;
  }
  preservedLocalLensSettings={version:1,config:structuredClone(lensConfig),favorites:structuredClone(favoriteLenses)};
  try {
    localStorage.setItem(LENS_SETTINGS_KEY, JSON.stringify({ version: 1, config: lensConfig, favorites: favoriteLenses }));
    lensStorageUnavailable = false;
  } catch {
    lensStorageUnavailable = true;
  }
  syncLensStorageNote();
}

function lensError(id, error = '') {
  $(id).textContent = error;
  $(id).hidden = !error;
}

const focalLabel = value => Number(Number(value).toFixed(3)).toString();
const allLenses = () => [...LENS_PRESETS, ...effectiveFavoriteLenses()];

function syncLensReadout() {
  const range = cameraFocalRange();
  const aperture = getLensAperture(lensConfig, state.focalLength35Mm, effectiveFavoriteLenses());
  $('camera-focal-min-label').textContent = `${focalControlMm(range.minMm)} mm · 넓게`;
  $('camera-focal-max-label').textContent = range.minMm === range.maxMm ? `${focalControlMm(range.maxMm)} mm · 고정` : `${focalControlMm(range.maxMm)} mm · 가깝게`;
  $('lens-current-details').textContent = range.lens ? `실제 ${focalLabel(aperture.actualFocalMm)} mm × ${focalLabel(range.cropFactor)} → 환산 ${focalControlMm(state.focalLength35Mm)} mm (반올림). 사용 범위 ${focalControlMm(range.minMm)}–${focalControlMm(range.maxMm)} mm 환산.` : `35mm 환산 ${focalControlMm(range.minMm)}–${focalControlMm(range.maxMm)} mm · 실제 렌즈 미설정`;
  const provenance = { manufacturer: '제조사', user: '사용자 입력', estimate: '구간 추정', unknown: '미확인' }[aperture.confidence] || '미확인';
  const apertureLabel = aperture.confidence === 'estimate' ? `약 F${Number(aperture.fNumber?.toFixed(1))}` : `F${focalLabel(aperture.fNumber)}`;
  $('lens-aperture-value').value = aperture.fNumber === null ? '최대개방 —' : `최대개방 ${apertureLabel} · ${provenance}`;
  $('lens-aperture-value').dataset.confidence = aperture.confidence;
  $('lens-aperture-note').textContent = `${range.lens ? `선택 렌즈의 실제 범위는 ${focalLabel(range.lens.minFocalMm)}–${focalLabel(range.lens.maxFocalMm)}mm입니다. ` : ''}${aperture.confidence === 'estimate' ? '현재 F값은 광각·망원 최대개방 사이를 단순 보간한 구간 추정입니다. 실제 렌즈의 중간 구간과 다를 수 있습니다. ' : ''}최대개방 F값은 참고 정보이며 노출·심도 시뮬레이션에 반영하지 않습니다.`;
  $('lens-source-link').hidden = !range.lens?.sourceUrl;
  if (range.lens?.sourceUrl) {
    $('lens-source-link').href = range.lens.sourceUrl;
    $('lens-source-link').textContent = range.lens.sourceLabel || '제조사 렌즈 자료';
  } else $('lens-source-link').removeAttribute('href');
}

function syncLensControls() {
  const signature = JSON.stringify(allLenses().map(lens => [lens.id, lens.name]));
  if (signature !== lensOptionsSignature) {
    $('lens-select').replaceChildren(new Option('전체 범위 · 18–400mm 환산', 'full'), new Option('직접 정한 환산 범위', 'custom'));
    for (const [label, lenses] of [['제조사 렌즈', LENS_PRESETS], ['내 즐겨찾기', favoriteLenses.filter(lens=>lens.id!==restoredPresetLens?.id)], ['저장 배치 렌즈', restoredPresetLens?[restoredPresetLens]:[]]]) {
      if (!lenses.length) continue;
      const group = document.createElement('optgroup'); group.label = label;
      for (const lens of lenses) group.append(new Option(lens.name, `lens:${lens.id}`));
      $('lens-select').append(group);
    }
    lensOptionsSignature = signature;
  }
  $('lens-select').value = lensConfig.mode === 'lens' ? `lens:${lensConfig.lensId}` : lensConfig.mode;
  $('edit-favorite-lens').disabled = !!restoredPresetLens || !favoriteLenses.some(lens => lens.id === lensConfig.lensId) || lensConfig.mode !== 'lens';
  const range = cameraFocalRange();
  const presets = getCameraFocalPresets(lensConfig, effectiveFavoriteLenses());
  const presetRoot = document.querySelector('.camera-focal-presets');
  const presetSignature = JSON.stringify(presets);
  if (presetRoot.dataset.signature !== presetSignature) {
    presetRoot.replaceChildren(...presets.map((preset, index) => {
      const button = document.createElement('button'); button.type = 'button';
      if (index === 0) button.id = 'focal-default';
      button.dataset.focalPreset = String(preset.equivalentMm);
      button.textContent = `${preset.actualMm === null ? focalControlMm(preset.labelMm) : focalLabel(preset.labelMm)} mm`;
      button.title = preset.actualMm === null ? '35mm 환산 초점거리' : `실제 ${focalLabel(preset.actualMm)} mm · 35mm 환산 ${focalControlMm(preset.equivalentMm)} mm`;
      button.setAttribute('aria-label', button.title); button.setAttribute('aria-pressed','false'); return button;
    }));
    presetRoot.dataset.signature = presetSignature;
  }
  presetRoot.setAttribute('aria-label', range.lens ? '선택 렌즈 실제 초점거리 바로가기' : '35mm 환산 초점거리 바로가기');
  const controlRange = getFocalControlRange(range);
  for (const id of ['focal-range', 'focal-number']) {
    $(id).min = String(controlRange.minMm); $(id).max = String(controlRange.maxMm); $(id).step = '1';
    $(id).disabled = state.sightViewEnabled || controlRange.isFixed;
  }
  syncFocalPresets();
  syncLensStorageNote();
  syncLensReadout();
}

function syncFocalPresets() {
  const locked = photoFocalLocked(), range = cameraFocalRange();
  const cameraFocal = locked && !state.sightViewEnabled ? state.lockedPhotoFocalMm : state.focalLength35Mm;
  const sightFocal = locked && state.sightViewEnabled ? state.lockedPhotoFocalMm : state.sightFocalLength35Mm;
  for (const button of document.querySelectorAll('[data-focal-preset]')) {
    const focal = Number(button.dataset.focalPreset), outside = focal < range.minMm || focal > range.maxMm;
    const active = focal === cameraFocal;
    button.disabled = state.sightViewEnabled || locked || outside;
    button.title = locked ? '사진 환산 mm 고정을 해제하면 초점거리를 바꿀 수 있습니다.' : outside ? '현재 렌즈의 환산 범위 밖입니다.' : '';
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  for (const button of document.querySelectorAll('[data-sight-focal-preset]')) {
    const active = Number(button.dataset.sightFocalPreset) === sightFocal;
    button.disabled = !state.sightViewEnabled || locked;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
}

function fillFavoriteEditor(lens = null, asNew = false) {
  favoriteEditingId = !asNew && favoriteLenses.some(item => item.id === lens?.id) ? lens.id : null;
  $('favorite-lens-heading').textContent = favoriteEditingId ? '렌즈 수정' : '렌즈 추가';
  $('favorite-lens-name').value = asNew ? '' : lens?.name || '';
  $('favorite-lens-min').value = String(lens?.minFocalMm ?? 24);
  $('favorite-lens-max').value = String(lens?.maxFocalMm ?? 105);
  $('favorite-lens-aperture-min').value = lens?.apertureAtMinFocal === null || lens?.apertureAtMinFocal === undefined ? '' : String(lens.apertureAtMinFocal);
  $('favorite-lens-aperture-max').value = lens?.apertureAtMaxFocal === null || lens?.apertureAtMaxFocal === undefined ? '' : String(lens.apertureAtMaxFocal);
  $('favorite-lens-crop-factor').value = String(lens?.defaultCropFactor ?? 1);
  $('save-favorite-lens').textContent = favoriteEditingId ? '즐겨찾기 변경 저장' : '즐겨찾기 저장';
  $('remove-favorite-lens').disabled = !favoriteEditingId;
  lensError('favorite-lens-error');
}

let favoriteLensReturnFocus = null;
function openFavoriteLensDialog(asNew, trigger) {
  fillFavoriteEditor(cameraFocalRange().lens, asNew);
  favoriteLensReturnFocus = trigger;
  $('favorite-lens-dialog').showModal();
  $('favorite-lens-name').focus();
}

function fillLensSetup() {
  const range = cameraFocalRange();
  $('camera-focal-min').value = String(range.minMm);
  $('camera-focal-max').value = String(range.maxMm);
  const standardCrop = [1, 1.5, 1.6, 2].includes(lensConfig.cropFactor);
  $('lens-crop-factor').value = standardCrop ? String(lensConfig.cropFactor) : 'custom';
  $('lens-crop-custom').value = String(lensConfig.cropFactor);
  $('lens-crop-custom').hidden = standardCrop;
  fillFavoriteEditor(range.lens);
}

function applyLensConfig(patch,{remote=false}={}) {
  const temporary=restoredPresetLens;
  // Editing crop uses the saved optical definition, not a same-ID favorite or
  // sanitize's full-range fallback. Leaving this temporary lens is explicit.
  const nextPatch=temporary&&patch.mode&&patch.mode!=='lens'&&!Object.hasOwn(patch,'lensId')?{...patch,lensId:null}:patch;
  const result = updateLensConfig(lensConfig, nextPatch, effectiveFavoriteLenses());
  lensError('camera-focal-error', result.error || '');
  if (!result.valid) return false;
  restoredPresetLens = temporary&&result.config.lensId===temporary.id?temporary:null; lensConfig = result.config;
  state.focalLength35Mm = patch.mode === 'lens' || patch.lensId ? getCameraStartingFocalMm(lensConfig, effectiveFavoriteLenses()) : normalizeFocalLength(state.focalLength35Mm);
  // A temporary dependency is not written into this device's favorite/config store.
  if(!restoredPresetLens)saveLensSettings({remote}); fillLensSetup(); syncControls();
  renderPhotoSliders(photoManager.getSnapshot()); syncSeatPhotoRegistration(); scheduleRender();
  return true;
}

function saveFavoriteLens() {
  const id = favoriteEditingId || `user-lens-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
  const result = createFavoriteLens({ name: $('favorite-lens-name').value, minFocalMm: $('favorite-lens-min').value, maxFocalMm: $('favorite-lens-max').value, apertureAtMinFocal: $('favorite-lens-aperture-min').value, apertureAtMaxFocal: $('favorite-lens-aperture-max').value, defaultCropFactor: $('favorite-lens-crop-factor').value }, id);
  if (!result.valid) { lensError('favorite-lens-error', result.error); return; }
  const nextFavorites = favoriteEditingId ? favoriteLenses.map(lens => lens.id === favoriteEditingId ? result.lens : lens) : [...favoriteLenses, result.lens];
  const selection = updateLensConfig(lensConfig, { mode: 'lens', lensId: result.lens.id, cropFactor: result.lens.defaultCropFactor }, nextFavorites);
  if (!selection.valid) { lensError('favorite-lens-error', selection.error); return; }
  restoredPresetLens = null; favoriteLenses = nextFavorites; lensConfig = selection.config;
  state.focalLength35Mm = getCameraStartingFocalMm(lensConfig, favoriteLenses);
  lensError('camera-focal-error'); saveLensSettings({remote:true}); fillLensSetup(); syncControls();
  renderPhotoSliders(photoManager.getSnapshot()); syncSeatPhotoRegistration(); scheduleRender();
  $('favorite-lens-dialog').close('save');
}

function currentSeatHeight() {
  if (seatHeightOverrides.has(state.venueId)) return { valueM: seatHeightOverrides.get(state.venueId), source: '사용자 입력' };
  const official = venue?.cameraSeatHeight?.officialValueM;
  if (typeof official === 'number' && Number.isFinite(official) && official >= 0) return { valueM: official, source: '공식 좌면 높이' };
  return { valueM: finite(venue?.cameraSeatHeight?.assumptionM, DEFAULT_SEAT_HEIGHT_M), source: '모델 가정 · 공식 좌면 높이 미확인' };
}

function syncCameraHeightControls() {
  const chair = currentSeatHeight();
  state.eyeHeightM = effectiveFloorHeight(cameraHeightConfig, chair.valueM);
  for (const id of ['camera-height', 'camera-height-number']) {
    const input = $(id);
    input.min = String(cameraHeightConfig.minCm);
    input.max = String(cameraHeightConfig.maxCm);
    if (id === 'camera-height' || document.activeElement !== input) input.value = String(cameraHeightConfig.offsetCm);
  }
  if (document.activeElement !== $('seat-height-cm')) $('seat-height-cm').value = String(Number((chair.valueM * 100).toFixed(2)));
  $('camera-height-value').value = `${cameraHeightConfig.offsetCm} cm`;
  $('camera-height-note').textContent = `좌면 ${Number((chair.valueM * 100).toFixed(2))}cm + 들기 ${cameraHeightConfig.offsetCm}cm = 객석 바닥에서 ${state.eyeHeightM.toFixed(2)}m. ${chair.source}.`;
  $('camera-height').disabled = cameraHeightConfig.minCm === cameraHeightConfig.maxCm;
}

function applyCameraHeightRange() {
  const result = updateCameraHeightConfig(cameraHeightConfig, { minCm: $('camera-height-min').value, maxCm: $('camera-height-max').value });
  $('camera-height-error').hidden = result.valid;
  $('camera-height-error').textContent = result.error || '';
  if (!result.valid) return;
  cameraHeightConfig = result.config;
  $('camera-height-min').value = String(cameraHeightConfig.minCm);
  $('camera-height-max').value = String(cameraHeightConfig.maxCm);
  syncCameraHeightControls();
  scheduleRender();
}

function syncAudienceSeatPickers() {
  if (!audienceLayout) return;
  const seats = createSeatList(geometry).filter(seat => seat.row !== state.seat.row || seat.number !== state.seat.number);
  const selected = audienceLayout.editSeat;
  if (!seats.some(seat => seat.row === selected?.row && seat.number === selected?.number)) {
    const eye = seatPosition(geometry,state.seat,0);
    const ahead = seats.filter(seat => seat.z < eye.z);
    const nearest = (ahead.length ? ahead : seats).sort((a,b) => Math.hypot(a.x-eye.x,a.z-eye.z)-Math.hypot(b.x-eye.x,b.z-eye.z))[0];
    audienceLayout.editSeat = nearest ? {row:nearest.row,number:nearest.number} : null;
  }
  const rowsKey = `${state.venueId}:${state.modelMode}:${state.seat.row}:${state.seat.number}`;
  if (rowsKey !== lastAudienceRows) {
    $('audience-edit-row').replaceChildren();
    for (const row of [...new Set(seats.map(seat=>seat.row))].sort((a,b)=>a-b)) $('audience-edit-row').add(new Option(rowDisplayLabel(row),String(row)));
    lastAudienceRows = rowsKey;
  }
  const editSeat = audienceLayout.editSeat;
  const numbersKey = `${rowsKey}:${editSeat?.row}`;
  if (numbersKey !== lastAudienceNumbers) {
    $('audience-edit-number').replaceChildren();
    for (const seat of seats.filter(seat=>seat.row===editSeat?.row).sort((a,b)=>a.number-b.number)) $('audience-edit-number').add(new Option(`${seat.number}번`,String(seat.number)));
    lastAudienceNumbers = numbersKey;
  }
  $('audience-edit-row').value = String(editSeat?.row || '');
  $('audience-edit-number').value = String(editSeat?.number || '');
}

function visualPersonHeight(person) {
  const crotch=resolveBodyProfile(person).shapeRatios.crotchY;
  return person.heightM * (person.pose==='chair' ? 1+.282-crotch-.025 : person.pose==='floor' ? 1+.065-crotch-.025 : person.pose==='cross-legged' ? 1+.085-crotch-.025 : 1);
}

function getPerson() {
  const person = layout?.people.find(person => person.id === layout.selectedPersonId);
  if (!person) return null;
  const bodyProfile = resolveBodyProfile(person);
  return { ...person, visualHeightM:visualPersonHeight(person), bodyPreset: bodyProfile.bodyPreset, bodyProfile, floorY: geometry.stageHeightM, selected: true };
}

function getPeople() {
  return (layout?.people || []).map(person => {
    const bodyProfile = resolveBodyProfile(person);
    return { ...person, bodyPreset: bodyProfile.bodyPreset, bodyProfile, floorY: geometry.stageHeightM, selected: state.editMode === 'person' ? state.selectedPersonIds.includes(person.id) : person.id === layout.selectedPersonId };
  });
}

let personPanel = 'selected';
function editPeople() {
  if (!layout) return [];
  return state.editMode === 'person' ? layout.people.filter(person => state.selectedPersonIds.includes(person.id)) : layout.people.filter(person => person.id === layout.selectedPersonId);
}
function updateSelectedPeople(patch) {
  if (personalWorkspace && state.editMode !== 'person') return false;
  for (const person of editPeople()) updatePerson(layout, person.id, patch, geometry);
}
function syncPersonTabs() {
  const enabled = state.editMode === 'person';
  const tabs = $('person-edit-tabs'); if (tabs) tabs.hidden = !enabled;
  if ($('person-multiselect')) $('person-multiselect').hidden = !enabled;
  for (const button of document.querySelectorAll('[data-person-panel]')) {
    const active = button.dataset.personPanel === personPanel;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  if (enabled) {
    $('person-group-controls').hidden = false;
    $('editor-person-fields').hidden = true;
  }
}
function syncBulkFields() {
  const people = editPeople();
  for (const [id,key,invert] of [['person-height','heightM',false],['person-height-number','heightM',false],['person-x','x',false],['person-depth','z',true],['person-facing','facingDeg',false]]) {
    const input = $(id); if (!input) continue;
    const mixed = people.length > 1 && people.some(person => person[key] !== people[0][key]);
    input.disabled = !people.length; input.dataset.mixed = String(mixed);
    input.placeholder = mixed ? '혼합값' : '';
    if (document.activeElement !== input) input.removeAttribute('aria-invalid'); input.title = mixed ? '선택 인물의 값이 다릅니다. 입력하면 모두 같은 값으로 변경합니다.' : '';
    if (document.activeElement !== input) input.value = mixed && input.type !== 'range' ? '' : people.length ? String(people[0][key] * (invert ? -1 : 1)) : '';
  }
  $('person-position').disabled = !people.length;
  for (const button of document.querySelectorAll('[data-person-facing]')) button.disabled = !people.length;
  const body = people.length && resolveBodyProfile(people[0]).bodyPreset;
  const mixedBody = people.some(person => resolveBodyProfile(person).bodyPreset !== body);
  for (const radio of document.querySelectorAll('[name="person-body-choice"]')) { radio.disabled = !people.length; radio.checked = !mixedBody && radio.value === body; }
  if ($('person-height-value') && people.length > 1 && people.some(person => person.heightM !== people[0].heightM)) $('person-height-value').value = '혼합값 · m';
  if (people.length > 1 && (mixedBody || people.some(person => person.heightM !== people[0].heightM))) $('person-reference-weight').value = '혼합값';
  if ($('person-body-note') && mixedBody) $('person-body-note').textContent = '혼합 체형 · 선택하면 체크한 인물 모두에 적용합니다. 체형 비율은 모델 가정입니다.';
  $('person-selection-summary').textContent = `${state.selectedPersonIds.length}명 선택 · 체크한 인물에 속성을 일괄 적용합니다.`;
}
function syncBodyProfileControls(person = getPerson()) {
  const profile = person?.bodyProfile;
  $('person-body-preset').disabled = !profile;
  $('person-body-preset').value = profile?.bodyPreset || 'male';
  $('person-reference-weight').value = Number.isFinite(profile?.referenceWeightKg) ? `약 ${profile.referenceWeightKg.toFixed(1)} kg` : '미확인';
  $('person-body-note').textContent = '한국인 20–69세 조사 평균 BMI로 선택 키의 참고 체중을 추정합니다. 키별 실측 평균은 아니며 체형 비율은 모델 가정입니다.';
  const sourceUrl = profile?.source?.url;
  $('person-body-source').hidden = !sourceUrl;
  if (sourceUrl) $('person-body-source').href = sourceUrl;
  else $('person-body-source').removeAttribute('href');
}

function getStructures() {
  return (layout?.structures || []).map(structure => ({ ...structure, floorY: geometry.stageHeightM, selected: structure.id === layout.selectedStructureId }));
}

function syncAudienceControls() {
  syncAudienceSeatPickers();
  const person = audienceLayout && getAudienceAtSeat(audienceLayout, audienceLayout.editSeat);
  $('audience-fill-enabled').checked = Boolean(audienceLayout?.visible);
  $('audience-fill-preset').disabled = !audienceLayout;
  $('audience-fill-preset').value = audienceLayout?.fullPreset || 'mixed';
  $('audience-count').textContent = `${getAudience().length}명 배치${audienceLayout?.visible ? '' : ' · 숨김'}`;
  $('remove-audience').disabled = !person;
  $('clear-audience').disabled = !audienceLayout?.people.length;
  $('add-audience').disabled = !audienceLayout?.editSeat;
  $('add-audience').textContent = person ? '선택 좌석 관객 바꾸기' : '선택 좌석에 앉히기';
  const editSeat = audienceLayout?.editSeat;
  $('audience-selected-label').textContent = editSeat ? `${seatDisplayLabel(editSeat)} · ${person ? AUDIENCE_PRESETS[person.preset].label : '빈 좌석'}` : '편집할 좌석 없음';
  if (person && document.activeElement !== $('audience-preset')) $('audience-preset').value = person.preset;
  const preset = AUDIENCE_PRESETS[$('audience-preset').value] || AUDIENCE_PRESETS.male;
  $('audience-note').textContent = '관객 새로고침은 남녀를 새로 무작위 배치합니다. 관객 표시는 배치를 유지한 채 켜고 끕니다. OP 제외 좌석과 내 자리 선택은 바뀌지 않습니다.';
  $('audience-reset').disabled = !audienceLayout;
}

function syncDirectionControls() {
  const yaw = Math.round(state.viewYawDeg * 10) / 10;
  const pitch = Math.round(state.viewPitchDeg * 10) / 10;
  $('view-yaw-range').value = String(yaw);
  if (document.activeElement !== $('view-yaw-number')) $('view-yaw-number').value = String(yaw);
  $('view-heading-angle').textContent = `${yaw > 0 ? '+' : ''}${yaw.toFixed(1)}°`;
  $('view-pitch').value = String(pitch);
  if (document.activeElement !== $('view-pitch-number')) $('view-pitch-number').value = String(pitch);
  $('view-pitch-label').textContent = `${pitch > 0 ? '+' : ''}${pitch.toFixed(1)}°`;
  $('stage-walls-enabled').checked = state.stageWallsEnabled;
  for (const side of ['back','left','right']) $('stage-wall-' + side).checked = state.stageWallSides?.[side] !== false;
  if (document.activeElement !== $('stage-wall-height')) $('stage-wall-height').value = String(state.stageWallHeightM);
  $('stage-wall-height').disabled = !state.stageWallsEnabled;
  $('stage-wall-note').textContent = `벽 높이는 무대 바닥에서 ${state.stageWallHeightM.toFixed(1)}m로 둔 가정입니다. 무대 외곽은 ${isPlan() ? '도면 해석값' : '가상값'}이며 실제 벽 두께·출입구는 생략합니다.`;
  syncAuditoriumBarrierControls();
}

function syncAuditoriumBarrierControls() {
  const available = auditoriumBarriersAvailable();
  $('auditorium-barrier-section').hidden = !available;
  $('auditorium-barriers-enabled').disabled = !available;
  $('auditorium-barriers-enabled').checked = state.auditoriumBarriersEnabled;
  $('auditorium-barrier-note').textContent = auditoriumBarrierControlNote();
  $('model-auditorium-barrier-note').hidden = !available;
  $('model-auditorium-barrier-note').textContent = available ? `객석 앞 낮은 벽 · ${auditoriumBarrierNote()}` : '';
  $('model-auditorium-barrier-legend').hidden = !auditoriumBarriersEnabled();
}

function syncCropGuide() {
  const image = $('stage-photo-image'), guide = $('stage-photo-crop-guide');
  if (!guide || !image.naturalWidth || !image.naturalHeight) { if (guide) guide.hidden = true; return; }
  const width = image.clientWidth, height = image.clientHeight;
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const sourceWidth = image.naturalWidth * scale, sourceHeight = image.naturalHeight * scale;
  const ratio = state.sightViewEnabled ? 16 / 9 : aspectRatio();
  const cropWidth = Math.min(sourceWidth, sourceHeight * ratio), cropHeight = cropWidth / ratio;
  Object.assign(guide.style, { width: `${cropWidth}px`, height: `${cropHeight}px`, left: `${(width-cropWidth)/2}px`, top: `${(height-cropHeight)/2}px` });
  guide.hidden = false; guide.dataset.aspect = state.sightViewEnabled ? '16:9' : state.aspect;
}

function syncStagePhotoPreview() {
  privatePhotoSnapshot(); // Purge a former account/seat before reading the preview.
  const photo = publicHostedSeatPhoto?.id===state.stagePhotoId&&photoMatchesCurrentSeat(publicHostedSeatPhoto)?publicHostedSeatPhoto:privateHostedPhoto?.id === state.stagePhotoId && photoMatchesCurrentSeat(privateHostedPhoto) ? privateHostedPhoto : managedLocalPhoto?.id === state.stagePhotoId && photoMatchesCurrentSeat(managedLocalPhoto) ? managedLocalPhoto : publicPhoto?.id === state.stagePhotoId && photoMatchesCurrentSeat(publicPhoto) ? publicPhoto : photoManager.getSnapshot().items.find(item => item.id === state.stagePhotoId && item.processingStatus === 'ready' && photoMatchesCurrentSeat(item));
  $('stage-photo-preview').hidden = !photo || state.editMode !== 'view' || stageView !== 'seat';
  $('seat-view').style.visibility = '';
  $('stage-photo-opacity').value = String(state.photoOpacity);
  $('stage-photo-opacity-value').value = `${state.photoOpacity}%`;
  if (photo) {
    const image = $('stage-photo-image'); const imageUrl = photo.publicRecord ? photo.url : photo.displayUrl;
    if (image.getAttribute('src') !== imageUrl) { image.onload = () => { syncCropGuide(); }; image.src = imageUrl; }
    syncCropGuide();
    $('stage-photo-image').alt = `${photo.name} ${(photo.publicRecord||photo.publicSeatRecord) ? '공개 표시본 전체 구도' : photo.privateRecord ? '개인 계정 표시본 전체 구도' : '로컬 표시본 전체 구도'}`;
    $('stage-photo-image').style.opacity = String(state.photoOpacity / 100);
    const photoFocal = Number(photo.metadata.focalLength35Mm);
    const knownFocal = Number.isFinite(photoFocal) && photoFocal > 0;
    const focalMatches = knownFocal && isAllowedPhotoFocal(photoFocal) && Math.abs(photoFocal - activeFocalLength()) < 1e-8;
    const focalNote = knownFocal ? `${focalControlMm(photo.metadata.focalLength35Mm)}mm 환산${focalMatches ? ' · 3D 환산값 동일' : ` · 현재 3D ${focalControlMm(activeFocalLength())}mm 유지`}` : '환산 화각 미확인 · 현재 3D 화각 유지';
    $('stage-photo-label').textContent = `${photo.name} · 원본 비율 ${photo.metadata.aspectRatio || '미확인'} · 비교 프레임 ${state.aspect} · 원본 전체 유지 · ${focalNote} · ${(photo.publicRecord||photo.publicSeatRecord) ? '공개 표시본' : photo.privateRecord ? '개인 계정 표시본' : '로컬 표시본 · 전송 안 함'}`;
    const mismatch = knownFocal && !isAllowedPhotoFocal(photoFocal) ? `사진 ${focalControlMm(photoFocal)}mm는 현재 ${state.sightViewEnabled ? '시야 비교' : '렌즈 환산'} 범위 밖이므로 ${focalControlMm(activeFocalLength())}mm 시야를 유지합니다. 화각이 일치하는 비교가 아닙니다. ` : knownFocal && !focalMatches ? focalControlMm(photoFocal) === focalControlMm(activeFocalLength()) ? '반올림 표기가 같아도 사진과 현재 3D의 정밀 환산값은 다릅니다. ' : `사진 화각과 현재 3D ${focalControlMm(activeFocalLength())}mm가 다릅니다. ` : '';
    $('framing-note').textContent = `${mismatch}${(photo.publicRecord||photo.publicSeatRecord) ? '공개 표시본 전체 구도를' : photo.privateRecord ? '개인 계정 표시본 전체를' : '방향을 맞춘 로컬 표시본 전체를'} 3D 위에 겹쳐 비교합니다. 촬영위치: ${photo.metadata.captureLocation || '미입력'}. 좌석·화면비·조준점의 자동 정렬은 아직 없습니다.`;
    $('framing-status').textContent = mismatch ? '사진·3D 화각 다름 · 수동 비교' : knownFocal ? '표시본 겹침 · 자동 정렬 전' : '표시본 겹침 · 화각 미확인';
  } else {
    state.stagePhotoId = null;
    $('stage-photo-image').removeAttribute('src');
    if ($('stage-photo-crop-guide')) $('stage-photo-crop-guide').hidden = true;
    $('framing-note').textContent = `${state.sightViewEnabled ? '개인 시야 비교값으로 넓이를 확인합니다. ' : ''}${isPlan() ? '도면 해석값으로 계산한 근사 시야입니다.' : '가상 배치로 계산한 기능 샘플입니다.'} 실제 시야는 촬영위치·자세·가림에 따라 달라집니다.`;
    $('framing-status').textContent = state.sightViewEnabled ? '넓은 무대 비교 · 인간 시야 재현 아님' : isPlan() ? '도면 해석 시야 · 보정 전' : '가상 배치 · 기능 샘플';
  }
}

function clearPhotoProjection() {
  privatePhotoSnapshot(); // A valid private selection survives comparison off.
  pendingPhotoProjection = null;
  state.stagePhotoId = null;
  publicPhoto = null;
  clearManagedLocalPhoto();
  syncStagePhotoPreview();
  renderPhotoSliders(photoManager.getSnapshot());
  scheduleRender();
}

function applyPhotoToView(photo, showOriginal = true, source = 'auto') {
  if (!photoMatchesCurrentSeat(photo)) return;
  if (showOriginal && !photo.publicRecord && (photo.processingStatus !== 'ready' || !photo.displayUrl)) {
    if (photo.processingStatus === 'processing') {
      pendingPhotoProjection = { id: photo.id, source, context: JSON.stringify(currentSeatPhotoContext()), camera: photoProjectionCamera() };
      photoManager.select(photo.id);
    }
    return;
  }
  pendingPhotoProjection = null;
  if (showOriginal) setEditMode('view');
  const focal = Number(photo?.metadata.focalLength35Mm);
  const target = photoFocalTarget(focal, source);
  if (target) {
    if (target === 'sight') {
      state.sightViewEnabled = true;
      state.sightFocalLength35Mm = normalizeSightFocalLength(focal);
    } else {
      state.sightViewEnabled = false;
      state.focalLength35Mm = normalizeFocalLength(focal);
    }
  } else if (!showOriginal) {
    return;
  }
  state.stagePhotoId = showOriginal ? photo.id : null;
  if (showOriginal && state.photoOpacity === 0) state.photoOpacity = 50;
  if (!photo.publicRecord && !photo.managedRecord && !photo.privateRecord && !photo.publicSeatRecord) { publicPhoto = null; clearManagedLocalPhoto(); photoManager.select(photo.id); }
  syncControls();
  syncStagePhotoPreview();
  scheduleRender();
}

function photoProjectionCamera() {
  return JSON.stringify([state.editMode, state.focalLength35Mm, state.sightViewEnabled, state.sightFocalLength35Mm, state.viewYawDeg, state.viewPitchDeg, state.eyeHeightM]);
}

function renderPhotoSliders(snapshot) {
  const range = cameraFocalRange();
  lastStripRangeKey = `${range.minMm}:${range.maxMm}`;
  lastStripSelection = state.stagePhotoId;
  lastStripSeatKey = `${state.venueId}:${state.modelMode}:${state.seat.row}:${state.seat.number}`;
  const common = { photos: snapshot.items.filter(photoMatchesCurrentSeat).map(photo => ({ ...photo, url: photo.thumbnailUrl || '' })), selectedPhotoId: state.stagePhotoId };
  renderPhotoSlider({ ...common, container: $('photo-focal-strip'), min: range.minMm, max: range.maxMm, onApply: photo => applyPhotoToView(photo, true, 'camera') });
  renderPhotoSlider({ ...common, container: $('sight-photo-focal-strip'), min: SIGHT_FOCAL_MIN_MM, max: SIGHT_FOCAL_MAX_MM, onApply: photo => applyPhotoToView(photo, true, 'sight') });
  for (const id of ['photo-focal-strip', 'sight-photo-focal-strip']) {
    const empty = $(id).querySelector('.photo-focal-empty');
    if (empty) empty.setAttribute('aria-describedby', 'help-focal');
  }
}

function getObstruction() {
  return { enabled: state.obstructionEnabled, widthM: state.obstructionWidthM, heightM: state.obstructionHeightM, depthM: 0.35, x: state.obstructionX, z: -state.obstructionDepthM };
}

function scheduleRender(auxiliary = true) {
  privateStageViewEpoch++;
  if (renderQueued) { auxiliaryRenderRequested ||= auxiliary !== false; return; }
  auxiliaryRenderRequested = auxiliary !== false;
  renderQueued = true;
  requestAnimationFrame(() => { const refreshAuxiliary = auxiliaryRenderRequested; renderQueued = false; render(refreshAuxiliary); });
}

function render(refreshAuxiliary = true) {
  if (!ready) return;
  // Clear a photo from the previous seat before deriving this frame's camera.
  syncStagePhotoPreview();
  syncCameraHeightControls();
  syncLensReadout();
  const selectedPerson = getPerson();
  const stage = stageBounds(geometry);
  const person = selectedPerson || {id:null,x:(stage.xMin+stage.xMax)/2,z:(stage.zMin+stage.zMax)/2,heightM:1.75,name:'무대 중앙'};
  syncAudienceSeatPickers();
  const aspect = activeAspectRatio();
  const eye = seatPosition(geometry, state.seat, state.eyeHeightM);
  if (!eye) {
    $('app-error').hidden = false;
    $('app-error').textContent = '모델에서 선택 좌석이나 무대 위치를 확인할 수 없습니다. 기능 샘플로 전환해 주세요.';
    return;
  }
  const fullCenter = { x: person.x, y: geometry.stageHeightM + (person.visualHeightM || person.heightM) / 2, z: person.z };
  const upperCenter = { x: person.x, y: geometry.stageHeightM + (person.visualHeightM || person.heightM) * 0.725, z: person.z };
  const subjectCenter = selectedPerson && state.aimFraming === 'upper' ? upperCenter : fullCenter;
  const bounds = stageBounds(geometry);
  const stageCenter = { x: (bounds.xMin + bounds.xMax) / 2, y: subjectCenter.y, z: (bounds.zMin + bounds.zMax) / 2 };
  const direction = seatViewDirection({ eye, stageCenter, target: subjectCenter, yawDeg: state.viewYawDeg, pitchDeg: state.viewPitchDeg, followSelected: state.followSelectedPerson && state.editMode !== 'person' });
  // Editor/orbit inspection must not overwrite the seat camera's saved aim.
  if (state.editMode === 'view' && stageView === 'seat') { state.viewYawDeg = direction.yawDeg; state.viewPitchDeg = direction.pitchDeg; }
  const distance = distance3D(eye, subjectCenter);
  const focalLength = activeFocalLength();
  const metrics = framingMetrics({ distanceM: distance, subjectHeightM: person.visualHeightM || person.heightM, focalLength35Mm: focalLength, aspectRatio: aspect });
  const camera = { horizontalFovDeg: horizontalFovDeg(focalLength, aspect), aspectRatio: aspect, eyeHeightM: state.eyeHeightM, aimX: direction.target.x, aimY: direction.target.y, aimZ: direction.target.z };
  let subjectFillFraction = metrics.subjectFillFraction;
  let selectedProjection = null;
  try {
    const people = getPeople(), structures = getStructures();
    const audience = getVisibleAudience();
    const audienceSelectedId = document.body.classList.contains('personal-app') ? null : getAudienceAtSeat(audienceLayout,audienceLayout.editSeat)?.id;
    const stageEnclosure = getStageEnclosure();
    const barriersEnabled = auditoriumBarriersEnabled();
    const inspection={geometry,seat:state.seat,people,structures,audience,audienceSelectedId,stageEnclosure,auditoriumBarriersEnabled:barriersEnabled,obstruction:getObstruction(),showGrid:state.showGrid,camera};
    const scene = state.editMode !== 'view' ? renderStageEditorView($('seat-view'), { geometry, people, structures, view: state.personEditView, selectedPersonIds: state.selectedPersonIds, camera: state.editorCamera, showGrid: state.showGrid })
      : stageView==='plan'?renderSightSection($('seat-view'),{geometry,seat:state.seat,eyeHeightM:state.eyeHeightM,people:people.map(person=>({...person,visualHeightM:visualPersonHeight(person)})),audience,targetPersonId:sectionTargetMode==='person'&&people.some(p=>p.id===layout.selectedPersonId)?layout.selectedPersonId:null})
      : stageView==='orbit'?renderModelView($('seat-view'),{...inspection,camera:{...camera,...modelOrbitControls.getCamera()}})
      : renderSeatView($('seat-view'),inspection);
    const orbit=modelOrbitControls?.getCamera();
    Object.assign($('seat-view').dataset,{stageView:state.editMode==='view'?stageView:'edit',sectionActive:String(state.editMode==='view'&&stageView==='plan'),orbitYaw:String(orbit?.yawDeg??28),orbitElevation:String(orbit?.elevationDeg??34),orbitZoom:String(orbit?.zoom??1)});
    if (scene.error) arrangementFeedback(scene.error.message || String(scene.error), true);
    editingScenes.seat = scene;
    audienceHits = scene.audienceHits || [];
    selectedProjection = scene.personProjections?.find(projection => projection.id === person.id);
    if (scene?.viewport?.height > 0 && Number.isFinite(selectedProjection?.heightPx)) subjectFillFraction = selectedProjection.heightPx / scene.viewport.height;
    // Keep the active drag canvas current; refresh auxiliary views on release.
    if (refreshAuxiliary && (!stagePointer?.active || stagePointer.canvas === $('overview'))) {
    const overview = renderOverview($('overview'), { geometry, seat: state.seat, camera, people, structures, audience, audienceSelectedId, stageEnclosure, auditoriumBarriersEnabled: barriersEnabled, obstruction: getObstruction() });
    seatHits = overview?.seatHits || [];
    editingScenes.overview = overview;
    }
    if (refreshAuxiliary && (!stagePointer?.active || stagePointer.canvas === $('model-view'))) {
    const modelScene = renderModelView($('model-view'), { geometry, seat: state.seat, people, structures, audience, audienceSelectedId, stageEnclosure, auditoriumBarriersEnabled: barriersEnabled, obstruction: getObstruction(), view: state.modelView, showGrid: state.showGrid, camera });
    modelAudienceHits = modelScene.audienceHits || [];
    editingScenes.model = modelScene;
    }
  } catch (error) {
    $('app-error').hidden = false;
    $('app-error').textContent = '무대 화면을 그리지 못했습니다. 페이지를 새로고침해 주세요.';
    console.error('Scene rendering failed', error);
  }
  $('selected-seat-label').textContent = seatLabel();
  $('selected-seat-label').dataset.venueId = state.venueId;
  $('selected-seat-label').dataset.modelMode = state.modelMode;
  $('selected-seat-label').dataset.sourceGeometryId = createSeatList(geometry).find(seat=>seat.row===state.seat.row&&seat.number===state.seat.number)?.sourceGeometryId || '';
  $('view-seat-label').textContent = seatLabel();
  $('seat-distance').textContent = `무대 인물까지 ${isPlan() ? '도면 해석 거리 근사' : '가상 거리'} ${distance.toFixed(1)} m`;
  $('seat-floor-note').textContent = isPlan() ? `무대 바닥 기준 ${signedHeight(eye.floorY - geometry.stageHeightM)} m · 렌즈 ${signedHeight(eye.y - geometry.stageHeightM)} m` : `객석 바닥 높이 ${eye.floorY.toFixed(2)} m`;
  $('fov-value').textContent = `${metrics.horizontalFovDeg.toFixed(1)}°`;
  const subjectOutside = selectedProjection && (!selectedProjection.frontVisible || !selectedProjection.intersectsViewport);
  const subjectSize = subjectOutside ? '화면 밖' : `${(subjectFillFraction * 100).toFixed(0)}%`;
  $('fill-value').textContent = subjectSize;
  $('fill-value').title = '선택 인물의 투영 높이입니다. 관객·벽·구조물의 가림을 뺀 면적 비율은 아닙니다.';
  $('aspect-value').textContent = state.sightViewEnabled ? '넓은 시야 16:9' : state.aspect;
  $('canvas-focal').textContent = `${state.sightViewEnabled ? '시야 비교 · ' : ''}${focalControlMm(focalLength)} mm`;
  $('person-height-value').value = `${person.heightM.toFixed(2)} m`;
  syncBodyProfileControls(selectedPerson);
  $('aim-selected-person').disabled = !selectedPerson;
  if (!selectedPerson) $('fill-value').textContent = '—';
  $('seat-view').setAttribute('aria-label', state.editMode === 'person' ? `무대 인물 편집, ${state.personEditView === 'top' ? '위에서 보는 2D' : state.personEditView === 'front' ? '정면' : '3D'}. ${state.selectedPersonIds.length}명 선택. 인물 클릭 또는 체크박스로 선택합니다. 빈 곳을 드래그하면 범위 선택, 빈 곳 클릭은 선택 해제, 인물 드래그는 이동입니다.` : `${seatLabel()}에서 ${focalControlMm(focalLength)}mm 환산 ${state.sightViewEnabled ? '개인 시야 비교' : '카메라 화각'}. 무대 중앙 기준 좌우 ${state.viewYawDeg.toFixed(1)}도, 수평선 기준 상하 ${state.viewPitchDeg.toFixed(1)}도. 인물 ${layout.people.length}명, 구조물 ${layout.structures.length}개, 좌석 관객 ${getVisibleAudience().length}명. 조준 대상 ${person.name}, ${subjectOutside ? '화면 밖' : `화면 높이의 ${subjectSize} 크기`}. ${isPlan() ? '도면 해석 근사 시야.' : '가상 시야.'}`);
  if(state.editMode==='stage'){
    const selectedStructure=layout.structures.find(structure=>structure.id===layout.selectedStructureId);
    $('seat-view').setAttribute('aria-label',`무대 오브젝트 편집, ${state.personEditView==='top'?'위에서 보는 2D':state.personEditView==='front'?'정면':'3D'}. 구조물 ${layout.structures.length}개. ${selectedStructure?`${selectedStructure.name} 선택.`:'선택한 구조물 없음.'}`);
  }
  if(state.editMode==='view'&&stageView==='plan'){
    const section=editingScenes.seat;$('canvas-focal').textContent='수직 단면 · 모델 기준';
    $('seat-view').setAttribute('aria-label',section?.eligible?`${seatLabel()}에서 ${section.targetKind==='person_center'?'선택 배우 중심':'무대 중심 바닥'}까지의 수직 단면. 시점 높이 ${section.eyeY.toFixed(2)} 미터, 모델 기준 시선 각도 ${section.angleDeg.toFixed(2)}도. 카메라 화각과 별도입니다.`:`수직 단면 사용 불가. ${section?.reason||'단면을 준비하고 있습니다.'}`);
  }
  if(state.editMode==='view'&&stageView==='orbit'){
    $('seat-view').setAttribute('aria-label',`전체 3D 극장 구조. ${seatLabel()} 선택. 인물 ${layout.people.length}명, 구조물 ${layout.structures.length}개, 좌석 관객 ${getVisibleAudience().length}명. 좌석 시점의 카메라 화각과 별도입니다. ${isPlan()?'도면 기반 구조입니다.':'가상 구조입니다.'}`);
  }
  $('model-view').setAttribute('aria-label', `${isPlan() ? '도면 기반' : '가상'} 극장의 ${state.modelView === 'side' ? '단면과 객석 단차' : '입체 구조'}. ${seatLabel()} 선택, 조준 대상 ${person.name}, 인물 ${layout.people.length}명, 구조물 ${layout.structures.length}개. 최전열 바닥 기준 높이 ${signedHeight(eye.floorY)} 미터.`);
  $('obstruction-fields').hidden = !state.obstructionEnabled;
  $('model-grid-note').textContent = state.showGrid ? `격자 1 m${isPlan() ? ' · 단위 해석 기준' : ' · 가상값'}` : '격자 숨김';
  updateFramingRange('full-body-range', distance3D(eye, fullCenter), person.heightM, aspect);
  updateFramingRange('upper-body-range', distance3D(eye, upperCenter), person.heightM * 0.55, aspect);
  renderLayoutStatus();
  syncAudienceControls();
  syncDirectionControls();
  syncSeatPhotoRegistration();
  $('person-relative-facing').textContent = `내 좌석과 인물 정면의 방향 차이 ${personFacingFromSeatDeg(person, eye).toFixed(1)}° · 0°면 나를 향함, ±180°면 등`;
  syncStagePhotoPreview();
  syncEditorPanel();
  syncPhotoDialog();
  personalWorkspace?.sync();
  if (lastStripSeatKey !== `${state.venueId}:${state.modelMode}:${state.seat.row}:${state.seat.number}`) renderPhotos(photoManager.getSnapshot());
  else if (lastStripSelection !== state.stagePhotoId || lastStripRangeKey !== `${cameraFocalRange().minMm}:${cameraFocalRange().maxMm}`) renderPhotoSliders(photoManager.getSnapshot());
}

function currentSeatPhotoContext() {
  if (!ready || !isPlan()) return null;
  const seat = createSeatList(geometry).find(seat => seat.row === state.seat.row && seat.number === state.seat.number);
  if (!seat?.label || !venue?.id || !planModel?.modelId) return null;
  return {venueId:venue.id,venueName:venue.displayName,modelId:planModel.modelId,modelVersion:planModel.modelId,seatId:`${venue.id}:${planModel.approximate&&seat.sourceGeometryId?seat.sourceGeometryId:seat.label}`,seatLabel:seat.label,source:'user_selected', ...(activeCatalogContext && state.modelMode === 'plan' ? {layoutVersionId: activeCatalogContext.layout.id, ...(activeCatalogContext.run ? {productionRunId: activeCatalogContext.run.id} : {})} : {})};
}

function photoMatchesCurrentSeat(photo) {
  if (photo?.publicSeatRecord) return privateRegisteredPhotoMatchesSelection(photo.seatContext,currentSeatPhotoContext());
  if (photo?.privateRecord) return privateRegisteredPhotoMatchesSelection(photo.seatContext,currentSeatPhotoContext());
  if (photo?.managedRecord) return Boolean(isPlan() && state.venueId === photo.managedRecord.venueId && planModel.modelId === photo.managedRecord.layoutVersionId && state.seat.row === photo.localSeat.row && state.seat.number === photo.localSeat.number);
  if (photo?.publicRecord) return Boolean(activeCatalogContext && state.modelMode === 'plan' && photo.publicRecord.venueId === activeCatalogContext.venue.id && photo.publicRecord.layoutVersionId === activeCatalogContext.layout.id && photo.publicRecord.seatId === activeCatalogContext.seat.id && state.seat.row === photo.localSeat.row && state.seat.number === photo.localSeat.number);
  if (!photo?.seatContext) return false;
  const current = currentSeatPhotoContext(),capture = photo.seatContext;
  return Boolean(current && (!capture.layoutVersionId || capture.layoutVersionId === current.layoutVersionId) && (!capture.productionRunId || capture.productionRunId === current.productionRunId) && capture.venueId === current.venueId && capture.modelId === current.modelId && capture.modelVersion === current.modelVersion && capture.seatId === current.seatId);
}

function syncSeatPhotoRegistration() {
  const context = currentSeatPhotoContext();
  $('add-seat-photos').disabled = !context;
  $('add-photos').disabled = !context;
  $('photo-input').disabled = !context;
  $('seat-photo-input').disabled = !context;
  $('seat-photo-registration-note').textContent = context ? `${context.venueName} · ${context.seatLabel}에 등록합니다. 원래 파일명 그대로 선택하고 작품명만 보완할 수 있습니다.` : '공식 도면 모델의 좌석을 선택하면 파일명 변경 없이 등록할 수 있습니다.';
  $('photo-registration-status').textContent = context ? `${context.venueName} · ${seatLabel()} · 사진 표기 ${context.seatLabel}` : '사진을 추가할 좌석을 선택하세요.';
  if (context && planModel?.uiNotes?.registrationNote) $('seat-photo-registration-note').textContent += ` ${planModel.uiNotes.registrationNote}`;
  const photo = photoManager.getSnapshot().selected;
  syncPhotoFocalAction(photo);
  if (photo?.seatContext) {
    $('photo-seat-context').textContent = `등록 좌석: ${photo.seatContext.venueName} · ${photo.seatContext.seatLabel}${photoMatchesCurrentSeat(photo) ? '' : ' · 해당 좌석을 선택하면 시야에 적용할 수 있습니다.'}`;
  }
}

function syncPhotoFocalAction(photo) {
  const focal = Number(photo?.metadata.focalLength35Mm);
  const allowed = isAllowedPhotoFocal(focal);
  const range = state.sightViewEnabled ? { minMm: SIGHT_FOCAL_MIN_MM, maxMm: SIGHT_FOCAL_MAX_MM } : cameraFocalRange();
  $('apply-photo-focal').disabled = !allowed || !photoMatchesCurrentSeat(photo);
  $('apply-photo-focal').title = !photoMatchesCurrentSeat(photo) ? photo?.seatContext ? `등록한 ${photo.seatContext.seatLabel} 좌석을 먼저 선택하세요.` : '사진을 등록한 좌석을 먼저 선택하세요.' : !allowed ? `현재 ${state.sightViewEnabled ? '시야 비교' : '렌즈 환산'} 범위는 ${focalControlMm(range.minMm)}–${focalControlMm(range.maxMm)}mm입니다. 원본 겹쳐 보기는 현재 화각을 유지합니다.` : '';
}

function updateFramingRange(id, distance, subjectHeight, aspect) {
  const lower = focalLengthForFraming35Mm({ distanceM: distance, subjectHeightM: subjectHeight, aspectRatio: aspect, fillFraction: 0.7 });
  const upper = focalLengthForFraming35Mm({ distanceM: distance, subjectHeightM: subjectHeight, aspectRatio: aspect, fillFraction: 0.85 });
  $(id).textContent = `${Math.round(lower)}–${Math.round(upper)} mm`;
  $(id).title = `35mm 환산 · 대각 화각 기준. 단순 인물의 크기와 ${isPlan() ? '도면 해석 거리' : '가상 거리'}에 따른 근사 예측.`;
}

function signedHeight(value) { return `${value > 0 ? '+' : ''}${value.toFixed(2)}`; }

function populateSeats() {
  const rowSelect = $('seat-row');
  const numberSelect = $('seat-number');
  rowSelect.replaceChildren();
  const seats = createSeatList(geometry);
  const rows = [...new Set(seats.map(seat => seat.row))].sort((a, b) => a - b);
  for (const row of rows) rowSelect.add(new Option(rowDisplayLabel(row), String(row)));
  $('seat-row-label').textContent = rowMeaning();
  if (!rows.includes(state.seat.row)) state.seat.row = rows[0];
  rowSelect.value = String(state.seat.row);
  populateSeatNumbers();
  rowSelect.disabled = !rows.length;
  numberSelect.disabled = !seats.length;
}

function populateSeatNumbers() {
  const numberSelect = $('seat-number');
  numberSelect.replaceChildren();
  const rowSeats = createSeatList(geometry).filter(seat => seat.row === state.seat.row);
  const numbers = rowSeats.map(seat => seat.number).sort((a, b) => a - b);
  const unavailable = unpositionedSeats().filter(seat => Number(seat.row) === state.seat.row || seat.rowLabel === rowLabel(state.seat.row));
  const options = [...numbers.map(number => ({ number, available: true })), ...unavailable.filter(seat => !numbers.includes(Number(seat.number))).map(seat => ({ number: Number(seat.number), available: false }))].sort((a, b) => a.number - b.number);
  for (const item of options) {
    const approximate=planModel?.approximate&&isPlan();
    const sourceNumber=approximate&&planModel.seatMapping?.source2022IdentityMappingConfirmed===true&&rowSeats.some(seat=>seat.number===item.number&&seat.officialLabel&&seat.sourcePlanSelectionId);
    const option = new Option(`${sourceNumber?'원문 ':approximate?'기호 ':''}${item.number}${!approximate||sourceNumber?'번':''}${item.available ? '' : ' · 위치 미확인'}`, String(item.number));
    option.disabled = !item.available;
    numberSelect.add(option);
  }
  if (!numbers.includes(state.seat.number)) state.seat.number = numbers.reduce((closest, number) => closest === undefined || Math.abs(number - state.seat.number) < Math.abs(closest - state.seat.number) ? number : closest, undefined);
  numberSelect.value = String(state.seat.number);
}

function syncControls() {
  syncLensControls();
  $('focal-range').value = String(focalControlMm(state.focalLength35Mm));
  $('focal-number').value = String(focalControlMm(state.focalLength35Mm));
  $('sight-view-enabled').checked = state.sightViewEnabled;
  $('sight-view-controls').hidden = !state.sightViewEnabled;
  const sightFocal = state.sightViewEnabled && state.stagePhotoId && Number.isFinite(state.lockedPhotoFocalMm) ? state.lockedPhotoFocalMm : state.sightFocalLength35Mm;
  $('sight-focal-number').value = String(focalControlMm(sightFocal));
  $('sight-focal-range').value = String(focalControlMm(sightFocal));
  syncPhotoFocalAction(photoManager.getSnapshot().selected);
  syncCameraHeightControls();
  $('aim-framing').value = state.aimFraming;
  $('show-grid').checked = state.showGrid;
  $('obstruction-enabled').checked = state.obstructionEnabled;
  $('obstruction-width').value = String(state.obstructionWidthM);
  $('obstruction-height').value = String(state.obstructionHeightM);
  $('obstruction-x').value = String(state.obstructionX);
  $('obstruction-depth').value = String(state.obstructionDepthM);
  document.querySelectorAll('[data-aspect]').forEach((button) => {
    const active = button.dataset.aspect === state.aspect;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('model-mode').value = state.modelMode;
  syncAuditoriumBarrierControls();
  document.querySelectorAll('[data-model-view]').forEach((button) => {
    const active = button.dataset.modelView === state.modelView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  syncLayoutControls();
}

function arrangementFeedback(message, error = false) {
  $('person-arrangement-feedback').textContent = message || '';
  $('person-arrangement-feedback').dataset.error = String(error);
}

function syncPersonArrangementControls() {
  const endpoints = $('person-arrangement-mode').value === 'endpoints';
  const axisControl = $('person-line-axis');
  axisControl.querySelector('option[value="diagonal"]').disabled = !endpoints;
  if (!endpoints && axisControl.value === 'diagonal') axisControl.value = 'x';
  const axis = axisControl.value;
  const endpointNotes = {
    x: '선택 인물의 좌우 끝 범위를 유지하고, 앞뒤 위치는 가장 앞·뒤의 중간에 맞춰 가로 일직선으로 배치합니다. 키와 높이는 바뀌지 않습니다.',
    z: '선택 인물의 앞뒤 끝 범위를 유지하고, 좌우 위치는 가장 왼쪽·오른쪽의 중간에 맞춰 무대 앞뒤 일직선으로 배치합니다. 세로는 높이가 아닌 무대 앞뒤 방향입니다.',
    diagonal: '가장 멀리 떨어진 두 인물의 실제 위치를 유지합니다. 거리가 같은 쌍은 좌우·앞뒤 좌표와 인물 ID 순으로 정하고, 나머지는 그 선에 투영한 순서대로 같은 간격에 배치합니다.',
  };
  $('person-spacing-cm').disabled = endpoints;
  $('person-arrangement-gap').hidden = !endpoints;
  $('person-arrangement-note').textContent = endpoints ? endpointNotes[axis] : '선택 인물의 기존 공간 순서를 유지하며 현재 중심을 기준으로 줄을 만듭니다. 간격은 인물 중심 간 거리입니다. 무대 경계를 넘으면 적용하지 않습니다.';
  $('arrange-people').textContent = endpoints ? ({ x: '좌우 범위 유지 · 동일 간격 배치', z: '앞뒤 범위 유지 · 동일 간격 배치', diagonal: '양끝 유지 · 동일 간격 배치' })[axis] : '선택 인물 일직선 배치';
  if (!endpoints) return;
  const result = planPersonArrangement({ people: layout?.people || [], ids: state.selectedPersonIds, geometry, axis: $('person-line-axis').value, spacingMode: 'endpoints' });
  $('person-arrangement-gap').textContent = result.ok ? `배치 후 중심 간 간격: ${focalLabel(result.measuredSpacingCm)} cm` : state.selectedPersonIds.length < 2 ? '인물 두 명 이상을 선택하면 양끝 사이 간격을 계산합니다.' : result.message;
  $('person-arrangement-gap').dataset.error = String(!result.ok && state.selectedPersonIds.length >= 2);
}

function syncPersonSelection() {
  state.selectedPersonIds = state.selectedPersonIds.filter(id => layout?.people.some(person => person.id === id));
  const list = $('person-selection-list');
  const signature = JSON.stringify((layout?.people || []).map(person => [person.id, person.name, person.bodyPreset]));
  if (list.dataset.signature !== signature) {
    list.replaceChildren();
    for (const person of layout?.people || []) {
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = person.id;
      checkbox.addEventListener('change', () => {
        cancelStagePointer(true);
        selectStageItem({ kind: 'person', id: person.id }, !personalWorkspace, true);
        arrangementFeedback('');
      });
      label.dataset.sex = person.bodyPreset; label.append(checkbox, document.createTextNode(person.name + ' · ' + (person.bodyPreset === 'female' ? '여성' : '남성'))); list.append(label);
    }
    list.dataset.signature = signature;
  }
  for (const checkbox of list.querySelectorAll('input')) checkbox.checked = state.selectedPersonIds.includes(checkbox.value);
  syncBulkFields();
  $('arrange-people').disabled = state.selectedPersonIds.length < 2;
  syncPersonArrangementControls();
  for (const button of document.querySelectorAll('[data-person-edit-view]')) {
    const active = button.dataset.personEditView === state.personEditView;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  $('editor-yaw').disabled = $('editor-elevation').disabled = state.personEditView !== '3d';
}

function syncLayoutControls() {
  const person = getPerson();
  syncBodyProfileControls(person);
  syncPersonSelection();
  $('person-select').replaceChildren();
  for (const item of layout?.people || []) $('person-select').add(new Option(item.name, item.id));
  if (person) {
    $('person-select').value = person.id;
    $('person-height').value = String(person.heightM);
    $('person-position').value = person.position || 'custom';
    $('person-x').value = person.x.toFixed(2);
    $('person-depth').value = (-person.z).toFixed(2);
    $('person-facing').value = String(person.facingDeg || 0);
    for (const button of document.querySelectorAll('[data-person-facing]')) {
      const active = normalizeSignedAngle(Number(button.dataset.personFacing)) === (person.facingDeg || 0);
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    }
  }
  $('add-person').disabled = !layout || layout.people.length >= MAX_STAGE_PEOPLE;
  $('remove-person').disabled = !layout || !editPeople().length;
  $('structure-select').replaceChildren();
  for (const item of layout?.structures || []) $('structure-select').add(new Option(`${item.name} · ${item.type === 'cylinder' ? '원통' : '상자'}`, item.id));
  const structure = layout?.structures.find(item => item.id === layout.selectedStructureId);
  $('structure-fields').hidden = !structure;
  $('structure-empty').hidden = Boolean(structure);
  $('structure-select').disabled = !structure;
  $('remove-structure').disabled = !structure;
  for (const id of ['add-box','add-cylinder']) $(id).disabled = !layout || layout.structures.length >= 20;
  if (structure) {
    $('structure-select').value = structure.id;
    $('box-dimensions').hidden = structure.type !== 'box';
    $('cylinder-dimensions').hidden = structure.type !== 'cylinder';
    const fields = { name: structure.name, width: structure.widthM, depth: structure.depthM, height: structure.heightM, diameter: structure.diameterM, rotation: structure.rotationDeg, x: structure.x, distance: -structure.z, color: structure.color };
    for (const [field,value] of Object.entries(fields)) $(`structure-${field}`).value = typeof value === 'number' ? String(Math.round(value * 100) / 100) : value;
  }
  syncBulkFields();
  renderLayoutStatus();
}

function renderLayoutStatus() {
  $('person-count').textContent = layout ? `${layout.people.length}명 / 최대 ${MAX_STAGE_PEOPLE}명 · ${state.followSelectedPerson ? '선택 인물을 조준 중입니다.' : '시야 방향을 직접 조절 중입니다.'}` : '모델을 준비하고 있습니다.';
  $('structure-count').textContent = layout ? `${layout.structures.length}개 / 최대 20개` : '모델 준비 중';
  const outside = layout?.structures.filter(structure => !isStructureWithinStage(geometry,structure)) || [];
  $('layout-status').textContent = outside.length ? `${outside.map(s=>s.name).join(', ')}의 외곽이 무대 경계를 넘습니다. 크기 또는 위치를 조절해 주세요.` : layout ? '위치·체형·구조물은 모델 가정' : '모델을 준비하고 있습니다.';
  syncFocalPresets();
}

function selectedEditorItem() {
  const selection = state.editorSelection;
  if (!selection || !layout) return null;
  return (selection.kind === 'person' ? layout.people : layout.structures).find(item => item.id === selection.id) || null;
}

function syncEditorPanel() {
  const item = selectedEditorItem();
  const editing = state.editMode !== 'view';
  $('stage-object-editor').hidden = !editing;
  $('person-group-controls').hidden = state.editMode !== 'person';
  $('person-edit-view-controls').hidden = state.editMode === 'view';
  $('camera-direction-panel').hidden = state.editMode === 'person';
  document.querySelector('.view-stats').hidden = state.editMode === 'person';
  $('canvas-focal').hidden = state.editMode === 'person';
  $('view-panel-title').textContent = state.editMode === 'person' ? '무대 인물 편집' : state.editMode === 'stage' ? '무대 오브젝트 편집' : '좌석에서 보는 무대';
  $('layout-title').textContent = state.editMode === 'person' ? '선택 인물 편집' : '선택 오브젝트 편집';
  $('view-seat-label').hidden = state.editMode === 'person';
  syncPersonSelection();
  $('editor-stage-actions').hidden = state.editMode !== 'stage';
  $('editor-empty').hidden = Boolean(item);
  $('editor-person-fields').hidden = !item || state.editorSelection.kind !== 'person';
  $('editor-structure-fields').hidden = !item || state.editorSelection.kind !== 'structure';
  $('editor-selection-title').textContent = item ? item.name : '무대에서 선택하세요';
  syncPersonTabs();
  workspaceUI?.syncEditMode(state.editMode);
  for (const id of ['seat-view', 'overview', 'model-view']) $(id).dataset.editMode = state.editMode;
  $('view-direction-note').textContent = editing ? '인물이나 구조물을 클릭하고 드래그해 무대 위 위치를 옮깁니다. 빈 화면 드래그는 카메라 조준입니다. 위치는 좌석 선택의 평면도에서도 옮길 수 있습니다.' : '좌우 0°는 내 좌석→무대 중앙, 상하 0°는 수평입니다. 왼쪽·아래− / 오른쪽·위+. 모든 화각에서 화면을 드래그하거나 방향키로 조준하세요. Shift+방향키는 정밀 조절입니다.';
}

function setEditMode(mode) {
  pendingPhotoProjection = null;
  cancelStagePointer(true);
  state.editMode = ['person', 'stage'].includes(mode) ? mode : 'view';
  state.editorSelection = null;
  if (state.editMode === 'person' && !state.selectedPersonIds.length && layout?.selectedPersonId) state.selectedPersonIds = [layout.selectedPersonId];
  if (state.editMode === 'person' && layout?.selectedPersonId) state.editorSelection = { id: layout.selectedPersonId, kind: 'person' };
  arrangementFeedback('');
  syncStagePhotoPreview();
  syncEditorPanel();
  scheduleRender();
}

function selectStageItem(hit, automatic = false, additive = false) {
  const items = hit?.kind === 'person' ? layout?.people : hit?.kind === 'structure' ? layout?.structures : null;
  const item = items?.find(candidate => candidate.id === hit.id);
  if (!item) return null;
  if (automatic && (state.editMode === 'view' || (hit.kind === 'structure' && state.editMode === 'person'))) setEditMode(hit.kind === 'structure' ? 'stage' : 'person');
  if ((state.editMode === 'view' && hit.kind !== 'person') || (state.editMode === 'person' && hit.kind !== 'person')) return null;
  state.editorSelection = { id: item.id, kind: hit.kind };
  if (hit.kind === 'person') {
    layout.selectedPersonId = item.id;
    {
      if (additive) state.selectedPersonIds = state.selectedPersonIds.includes(item.id) ? state.selectedPersonIds.filter(id => id !== item.id) : [...state.selectedPersonIds, item.id];
      else if (!state.selectedPersonIds.includes(item.id)) state.selectedPersonIds = [item.id];
      layout.selectedPersonId=state.selectedPersonIds.at(-1)||null;
      state.editorSelection=layout.selectedPersonId?{kind:'person',id:layout.selectedPersonId}:null;
    }
  }
  else layout.selectedStructureId = item.id;
  syncLayoutControls();
  syncEditorPanel();
  workspaceUI?.openPanel('object-panel');
  scheduleRender();
  return item;
}

function pointerInCanvas(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function beginStagePointer(event, canvas, sceneKey, automatic = false) {
  if (state.editMode === 'view') return false;
  if (!ready || !event.isPrimary || event.button !== 0 || stagePointer) return false;
  const scene = editingScenes[sceneKey], pointer = pointerInCanvas(event, canvas);
  const hit = pickStageObject(scene?.stageObjectHits, pointer.x, pointer.y);
  const targetKind = state.editMode === 'person' ? 'person' : 'structure';
  if (hit && hit.kind !== targetKind) return false;
  const item = selectStageItem(hit, automatic, event.shiftKey || event.metaKey || event.ctrlKey);
  if (!item) return false;
  pendingPhotoProjection = null;
  const groupMove = hit.kind === 'person' && state.editMode === 'person';
  if (groupMove && !state.selectedPersonIds.includes(item.id)) { event.preventDefault(); return true; }
  const floorY = geometry.stageHeightM;
  let math = createStageDrag({ projection: scene.editProjection, pointer, object: item, planeY: floorY + item.heightM / 2 });
  // A low body point and a head can sit on opposite sides of the floor horizon.
  // Keep a horizontal plane through a valid part of the selected object.
  for (const fraction of [0.15, 0.85]) if (!math) math = createStageDrag({ projection: scene.editProjection, pointer, object: item, planeY: floorY + item.heightM * fraction });
  stagePointer = { id: event.pointerId, canvas, math, selection: { ...state.editorSelection }, layout, geometry,
    start: { x: item.x, z: item.z, position: item.position }, peopleStart: layout.people.map(person => ({ ...person })), groupMove, ids: groupMove ? [...state.selectedPersonIds] : [], pointer, active: false };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus?.({ preventScroll: true });
  event.preventDefault();
  return true;
}

function moveStagePointer(event) {
  if (!stagePointer || event.pointerId !== stagePointer.id) return;
  const targetMode = stagePointer.selection.kind === 'person' ? 'person' : 'stage';
  if (state.editMode !== targetMode) { cancelStagePointer(true); return; }
  const pointer = pointerInCanvas(event, stagePointer.canvas);
  if (!stagePointer.active && Math.hypot(pointer.x - stagePointer.pointer.x, pointer.y - stagePointer.pointer.y) > 3) {
    stagePointer.active = true;
  }
  if (!stagePointer.active || !stagePointer.math) return;
  const position = moveStageDrag(stagePointer.math, pointer);
  if (!position) return;
  const update = stagePointer.selection.kind === 'person' ? updatePerson : updateStructure;
  if (stagePointer.groupMove) {
    const result = planPersonTranslation({ people: stagePointer.peopleStart, ids: stagePointer.ids, geometry: stagePointer.geometry, delta: { x: position.x - stagePointer.start.x, z: position.z - stagePointer.start.z } });
    if (!result.ok) { arrangementFeedback(result.message, true); return; }
    for (const target of result.positions) updatePerson(stagePointer.layout, target.id, target, stagePointer.geometry);
    arrangementFeedback('');
  } else update(stagePointer.layout, stagePointer.selection.id, position, stagePointer.geometry);
  // The animation frame updates live numeric fields; lists need no rebuild here.
  scheduleRender();
}

function cancelStagePointer(restore = false) {
  const pointer = stagePointer;
  stagePointer = null;
  if (!pointer) return;
  if (restore && pointer.active) {
    const update = pointer.selection.kind === 'person' ? updatePerson : updateStructure;
    if (pointer.groupMove) {
      for (const original of pointer.peopleStart.filter(person => pointer.ids.includes(person.id))) {
        const restored = updatePerson(pointer.layout, original.id, { x: original.x, z: original.z }, pointer.geometry);
        if (restored) restored.position = original.position;
      }
      arrangementFeedback('이동을 취소했습니다.');
    } else {
      const restored = update(pointer.layout, pointer.selection.id, pointer.start, pointer.geometry);
      if (restored && pointer.selection.kind === 'person') restored.position = pointer.start.position;
    }

  }
  syncLayoutControls();
  scheduleRender();
  if (pointer.canvas.hasPointerCapture(pointer.id)) pointer.canvas.releasePointerCapture(pointer.id);
}

function bindMapEditing(canvas, sceneKey, automatic) {
  let click = null;
  canvas.addEventListener('pointerdown', event => {
    if (!ready || !event.isPrimary || event.button !== 0 || stagePointer) return;
    if (beginStagePointer(event, canvas, sceneKey, automatic)) { click = null; return; }
    click = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', moveStagePointer);
  const release = event => {
    if (stagePointer?.canvas === canvas && stagePointer.id === event.pointerId) { cancelStagePointer(event.type !== 'pointerup'); return; }
    if (!click || click.id !== event.pointerId) return;
    const smallClick = event.type === 'pointerup' && Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 6;
    click = null;
    if (!smallClick) return;
    if (sceneKey === 'overview') selectSeatAtPointer(event, canvas);
    else if (state.editMode === 'view') selectAudienceAtPointer(event, canvas, modelAudienceHits);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release);
  window.addEventListener('pointerup', release);
}

function selectSeatAtPointer(event, canvas, hits=seatHits) {
  const { x, y } = pointerInCanvas(event, canvas);
  const hit = hits.reduce((nearest, candidate) => {
    const distance = Math.hypot(candidate.x - x, candidate.y - y);
    if (distance > Math.max(candidate.radius || 5, 7)) return nearest;
    return !nearest || distance < nearest.distance ? { ...candidate, distance } : nearest;
  }, null);
  if (hit) { catalogUI?.clearProjection(); setComparisonSeat({row:hit.row,number:hit.number}); scheduleRender(); }
}

function bindLayoutControls() {
  for (const button of document.querySelectorAll('[data-person-panel]')) {
    button.addEventListener('click', () => { personPanel = button.dataset.personPanel; syncEditorPanel(); syncLayoutControls(); });
    button.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const tabs = [...document.querySelectorAll('[data-person-panel]')]; const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs.find(item => item !== button); target.click(); target.focus(); });
  }
  for (const radio of document.querySelectorAll('[name="person-body-choice"]')) radio.addEventListener('change', () => { if (radio.checked) { updateSelectedPeople({ bodyPreset: radio.value }); syncLayoutControls(); scheduleRender(); } });
  for (const button of document.querySelectorAll('[data-person-edit-view]')) button.addEventListener('click', () => {
    cancelStagePointer(true); state.personEditView = button.dataset.personEditView;
    syncPersonSelection(); arrangementFeedback(''); scheduleRender();
  });
  for (const [id, key] of [['editor-yaw', 'yawDeg'], ['editor-elevation', 'elevationDeg'], ['editor-zoom', 'zoom']]) $(id).addEventListener('input', event => {
    cancelStagePointer(true); state.editorCamera[key] = Number(event.target.value); scheduleRender(false);
  });
  $('select-all-people').addEventListener('click', () => {
    cancelStagePointer(true); state.selectedPersonIds = (layout?.people || []).map(person => person.id);
    if(layout)layout.selectedPersonId=state.selectedPersonIds.at(-1)||null;
    state.editorSelection=layout?.selectedPersonId?{kind:'person',id:layout.selectedPersonId}:null;
    // Selection is available while viewing; it never changes edit mode.
    syncPersonSelection(); arrangementFeedback(''); scheduleRender();
  });
  $('clear-person-selection').addEventListener('click', () => {
    cancelStagePointer(true); state.selectedPersonIds = []; if(layout)layout.selectedPersonId=null;state.editorSelection=null;syncPersonSelection(); arrangementFeedback(''); scheduleRender();
  });
  for (const id of ['person-arrangement-mode', 'person-line-axis']) $(id).addEventListener('change', () => {
    cancelStagePointer(true); arrangementFeedback(''); syncPersonArrangementControls(); scheduleRender();
  });
  $('arrange-people').addEventListener('click', () => {
    if (personalWorkspace && state.editMode !== 'person') return;
    cancelStagePointer(true);
    const raw = $('person-spacing-cm').value;
    const spacingMode = $('person-arrangement-mode').value;
    const options = { people: layout?.people || [], ids: state.selectedPersonIds, geometry, axis: $('person-line-axis').value, spacingMode };
    if (spacingMode === 'fixed') options.spacingCm = raw.trim() === '' ? NaN : Number(raw);
    const result = planPersonArrangement(options);
    if (!result.ok) { arrangementFeedback(result.message, true); return; }
    for (const position of result.positions) {
      const person = layout.people.find(item => item.id === position.id);
      if (person && (person.x !== position.x || person.z !== position.z)) updatePerson(layout, position.id, position, geometry);
    }
    arrangementFeedback(`${result.positions.length}명을 ${spacingMode === 'endpoints' ? ({ x: '좌우 범위를 유지하고 ', z: '앞뒤 범위를 유지하고 ', diagonal: '양끝 위치를 유지하고 ' })[options.axis] : ''}중심 간 ${focalLabel(result.measuredSpacingCm)} cm 간격으로 배치했습니다.`);
    syncLayoutControls(); scheduleRender();
  });
  $('person-select').addEventListener('change', event => selectStageItem({ id: event.target.value, kind: 'person' }, !personalWorkspace));
  $('add-person').addEventListener('click', () => { if (personalWorkspace && state.editMode !== 'person') return; const item = layout && addPerson(layout,geometry,{ bodyPreset: document.querySelector('[name="person-body-choice"]:checked')?.value || 'male' }); if (item) selectStageItem({ id: item.id, kind: 'person' }, true); });
  $('remove-person').addEventListener('click', () => {
    if (!layout || personalWorkspace && state.editMode !== 'person') return;
    for (const person of editPeople()) removePerson(layout,person.id);
    state.selectedPersonIds = state.selectedPersonIds.filter(id => layout.people.some(person => person.id === id));
    state.editorSelection = layout.selectedPersonId?{ id: layout.selectedPersonId, kind: 'person' }:null; syncLayoutControls(); syncEditorPanel(); scheduleRender();
  });
  $('person-body-preset').addEventListener('change', event => {
    if (!layout) return;
    updateSelectedPeople({ bodyPreset: event.target.value });
    syncBodyProfileControls(); scheduleRender();
  });
  $('person-position').addEventListener('change', event => {
    if (!layout || event.target.value === 'custom') return;
    updateSelectedPeople({position:event.target.value}); syncLayoutControls(); scheduleRender();
  });
  for (const [id,key,invert] of [['person-height','heightM',false],['person-height-number','heightM',false],['person-x','x',false],['person-depth','z',true],['person-facing','facingDeg',false]]) {
    $(id).addEventListener('input', event => {
      if (!layout || event.target.value === '' || !Number.isFinite(Number(event.target.value))) return;
      const value = Number(event.target.value);
      if (key === 'heightM' && (value < 1.3 || value > 2.1)) { event.target.setAttribute('aria-invalid','true'); return; }
      event.target.removeAttribute('aria-invalid'); updateSelectedPeople({[key]:value*(invert?-1:1)});
      if (key === 'heightM') $(id === 'person-height' ? 'person-height-number' : 'person-height').value = String(value);
      syncBodyProfileControls();
      $('person-position').value = getPerson()?.position || 'custom'; scheduleRender();
    });
    $(id).addEventListener('change', () => { syncLayoutControls(); scheduleRender(); });
  }
  for (const button of document.querySelectorAll('[data-person-facing]')) button.addEventListener('click', () => {
    if (!layout) return;
    updateSelectedPeople({facingDeg:Number(button.dataset.personFacing)});
    syncLayoutControls(); scheduleRender();
  });
  $('structure-select').addEventListener('change', event => selectStageItem({ id: event.target.value, kind: 'structure' }, true));
  for (const type of ['box','cylinder']) $(`add-${type}`).addEventListener('click', () => { if (state.editMode !== 'stage') return; const item = layout && addStructure(layout,geometry,type); if (item) selectStageItem({ id: item.id, kind: 'structure' }, true); });
  $('remove-structure').addEventListener('click', () => { if (state.editMode !== 'stage') return; if (layout && removeStructure(layout,layout.selectedStructureId)) { state.editorSelection = layout.selectedStructureId ? { id: layout.selectedStructureId, kind: 'structure' } : null; syncLayoutControls(); syncEditorPanel(); scheduleRender(); } });
  const structureFields = { width:'widthM',depth:'depthM',height:'heightM',diameter:'diameterM',rotation:'rotationDeg',x:'x',distance:'z',name:'name',color:'color' };
  for (const [field,key] of Object.entries(structureFields)) {
    const input = $(`structure-${field}`);
    input.addEventListener('input', event => {
      if (state.editMode !== 'stage' || !layout || !layout.selectedStructureId) return;
      let value = event.target.value;
      if (!['name','color'].includes(key)) {
        if (value === '' || !Number.isFinite(Number(value))) return;
        value = Number(value) * (key === 'z' ? -1 : 1);
      }
      updateStructure(layout,layout.selectedStructureId,{[key]:value},geometry); scheduleRender();
    });
    input.addEventListener('change', () => { syncLayoutControls(); scheduleRender(); });
  }
  document.querySelector('.camera-focal-presets').addEventListener('click', event => { const button = event.target.closest('[data-focal-preset]'); if (!button || button.disabled || photoFocalLocked()) return; state.focalLength35Mm = normalizeFocalLength(button.dataset.focalPreset); syncControls(); scheduleRender(); });
}

function bindControls() {
  $('lens-select').addEventListener('change', event => {
    const value = event.target.value;
    if (value.startsWith('lens:')) {
      const lens = allLenses().find(item => item.id === value.slice(5));
      if (!lens || !applyLensConfig({ mode: 'lens', lensId: lens.id, cropFactor: lens.defaultCropFactor })) syncLensControls();
    } else {
      const patch = { mode: value, lensId: null };
      if (value === 'custom') { patch.minMm = $('camera-focal-min').value; patch.maxMm = $('camera-focal-max').value; $('lens-settings').open = true; }
      if (!applyLensConfig(patch)) syncLensControls();
    }
  });
  $('apply-camera-focal-range').addEventListener('click', () => applyLensConfig({ mode: 'custom', lensId: null, minMm: $('camera-focal-min').value, maxMm: $('camera-focal-max').value },{remote:true}));
  $('lens-crop-factor').addEventListener('change', () => { privateLensSession?.markEdited();$('lens-crop-custom').hidden = $('lens-crop-factor').value !== 'custom'; });
  for(const id of ['camera-focal-min','camera-focal-max','lens-crop-custom'])$(id).addEventListener('input',()=>privateLensSession?.markEdited());
  $('apply-lens-crop').addEventListener('click', () => applyLensConfig({ cropFactor: $('lens-crop-factor').value === 'custom' ? $('lens-crop-custom').value : $('lens-crop-factor').value },{remote:true}));
  $('new-favorite-lens').addEventListener('click', event => openFavoriteLensDialog(true, event.currentTarget));
  $('edit-favorite-lens').addEventListener('click', event => openFavoriteLensDialog(false, event.currentTarget));
  for (const id of ['favorite-lens-close', 'favorite-lens-cancel']) $(id).addEventListener('click', () => $('favorite-lens-dialog').close('cancel'));
  $('favorite-lens-dialog').addEventListener('input', () => {privateLensSession?.markEdited();lensError('favorite-lens-error');});
  $('favorite-lens-dialog').addEventListener('cancel', event => { event.preventDefault(); $('favorite-lens-dialog').close('cancel'); });
  $('favorite-lens-dialog').addEventListener('close', () => {
    favoriteEditingId = null; lensError('favorite-lens-error');
    const target = favoriteLensReturnFocus?.disabled ? $('new-favorite-lens') : favoriteLensReturnFocus;
    target?.focus({ preventScroll: true }); favoriteLensReturnFocus = null;
  });
  $('save-favorite-lens').addEventListener('click', saveFavoriteLens);
  $('remove-favorite-lens').addEventListener('click', () => {
    if (!favoriteEditingId) return;
    const removingId = favoriteEditingId;
    favoriteLenses = favoriteLenses.filter(lens => lens.id !== removingId);
    if (lensConfig.lensId === removingId) lensConfig = sanitizeLensConfig({ ...lensConfig, mode: 'full', lensId: null }, favoriteLenses);
    state.focalLength35Mm = normalizeFocalLength(state.focalLength35Mm);
    lensError('camera-focal-error'); saveLensSettings({remote:true}); fillLensSetup(); syncControls();
    renderPhotoSliders(photoManager.getSnapshot()); syncSeatPhotoRegistration(); scheduleRender();
    $('favorite-lens-dialog').close('delete');
  });
  $('audience-fill-enabled').addEventListener('change', event => {
    if (!audienceLayout) return;
    audienceLayout.visible = event.target.checked;
    scheduleRender();
  });
  const applyAllAudience = () => {
    if (!audienceLayout) return;
    audienceLayout.fullPreset = $('audience-fill-preset').value;
    changeAudiencePreset(audienceLayout,geometry,audienceLayout.fullPreset); scheduleRender();
  };
  $('audience-fill-preset').addEventListener('change',applyAllAudience);
  $('audience-apply-all').addEventListener('click',applyAllAudience);
  $('audience-reset').addEventListener('click', () => { if (audienceLayout) { audienceLayout.fullPreset='mixed';fillAllAudience(audienceLayout,geometry,'mixed'); } scheduleRender(); });
  $('add-audience').addEventListener('click', () => { if (audienceLayout) setAudienceAtSeat(audienceLayout, geometry, audienceLayout.editSeat, $('audience-preset').value); scheduleRender(); });
  $('remove-audience').addEventListener('click', () => { if (audienceLayout) removeAudienceAtSeat(audienceLayout, audienceLayout.editSeat); scheduleRender(); });
  $('clear-audience').addEventListener('click', () => { if (audienceLayout) clearAudience(audienceLayout); scheduleRender(); });
  $('audience-preset').addEventListener('change', () => {
    if (audienceLayout && getAudienceAtSeat(audienceLayout,audienceLayout.editSeat)) setAudienceAtSeat(audienceLayout,geometry,audienceLayout.editSeat,$('audience-preset').value);
    scheduleRender();
  });
  $('audience-edit-row').addEventListener('change', event => {
    if (!audienceLayout) return;
    const row=Number(event.target.value),seats=createSeatList(geometry).filter(seat=>seat.row===row&&(seat.row!==state.seat.row||seat.number!==state.seat.number));
    const number=seats.some(seat=>seat.number===audienceLayout.editSeat?.number)?audienceLayout.editSeat.number:seats[0]?.number;
    audienceLayout.editSeat={row,number};scheduleRender();
  });
  $('audience-edit-number').addEventListener('change', event => { if (audienceLayout) audienceLayout.editSeat.number=Number(event.target.value);scheduleRender(); });
  bindMapEditing($('model-view'), 'model', false);
  $('stage-walls-enabled').addEventListener('change', event => { applyStageWallSettings({ stageWallsEnabled: event.target.checked }); scheduleRender(); });
  for (const side of ['back','left','right']) $('stage-wall-' + side).addEventListener('change', event => {
    applyStageWallSettings({ stageWallSides: { ...state.stageWallSides, [side]: event.target.checked } });
    syncControls(); scheduleRender();
  });
  $('auditorium-barriers-enabled').addEventListener('change', event => { if (!auditoriumBarriersAvailable()) return; state.auditoriumBarriersEnabled = event.target.checked; scheduleRender(); });
  $('stage-wall-height').addEventListener('input', event => { if (event.target.value === '') return; state.stageWallHeightM = Math.round(clamp(finite(event.target.value,3),0.5,10)*10)/10; scheduleRender(); });
  $('stage-wall-height').addEventListener('change', () => { $('stage-wall-height').value = String(state.stageWallHeightM); });
  for (const id of ['view-yaw-range','view-yaw-number']) {
    $(id).addEventListener('input', event => { if (event.target.value === '') return; state.followSelectedPerson = false; state.viewYawDeg = normalizeSignedAngle(clamp(finite(event.target.value,0),-180,180)); scheduleRender(); });
    $(id).addEventListener('change', () => { $('view-yaw-number').value = String(Math.round(state.viewYawDeg*10)/10); });
  }
  for (const id of ['view-pitch','view-pitch-number']) {
    $(id).addEventListener('input', event => { if (event.target.value === '') return; state.followSelectedPerson = false; state.viewPitchDeg = normalizePitch(finite(event.target.value,state.viewPitchDeg)); scheduleRender(); });
    $(id).addEventListener('change', () => { $('view-pitch-number').value = String(Math.round(state.viewPitchDeg*10)/10); });
  }
  for (const button of document.querySelectorAll('[data-view-nudge]')) button.addEventListener('click',event => nudgeView(button.dataset.viewNudge,event.shiftKey));
  $('reset-heading').addEventListener('click', resetHeading);
  $('aim-selected-person').addEventListener('click', () => { state.followSelectedPerson = true; scheduleRender(); });
  bindViewDragging();
  bindMapEditing($('overview'), 'overview', true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') cancelStagePointer(true); });
  $('sight-view-enabled').addEventListener('change', event => { state.sightViewEnabled = event.target.checked; syncControls(); scheduleRender(); });
  for (const id of ['sight-focal-range', 'sight-focal-number']) {
    $(id).addEventListener('input', event => { if (event.target.value === '') return; state.sightFocalLength35Mm = normalizeSightFocalLength(event.target.value); $(id === 'sight-focal-range' ? 'sight-focal-number' : 'sight-focal-range').value = String(state.sightFocalLength35Mm); scheduleRender(); });
    $(id).addEventListener('change', syncControls);
  }
  for (const button of document.querySelectorAll('[data-sight-focal-preset]')) button.addEventListener('click', () => { if (button.disabled || !state.sightViewEnabled || photoFocalLocked()) return; state.sightFocalLength35Mm = normalizeSightFocalLength(button.dataset.sightFocalPreset); syncControls(); scheduleRender(); });
  $('show-model-view').addEventListener('click', clearPhotoProjection);
  $('stage-photo-opacity').addEventListener('input', event => { state.photoOpacity = Math.round(clamp(finite(event.target.value, 50),0,100)); syncStagePhotoPreview(); });
  $('seat-row').addEventListener('change', (event) => { catalogUI?.clearProjection(); setComparisonSeat({row:Number(event.target.value),number:state.seat.number}); scheduleRender(); });
  $('seat-number').addEventListener('change', (event) => { catalogUI?.clearProjection(); setComparisonSeat({row:state.seat.row,number:Number(event.target.value)}); scheduleRender(); });
  for (const id of ['focal-range', 'focal-number']) {
    $(id).addEventListener('input', (event) => {
      if (!event.target.value) return;
      const focal = focalFromControlMm(event.target.value, cameraFocalRange(), state.focalLength35Mm);
      if (focal === null) return;
      state.focalLength35Mm = focal;
      $(id === 'focal-range' ? 'focal-number' : 'focal-range').value = String(focalControlMm(focal));
      scheduleRender();
    });
    $(id).addEventListener('change', syncControls);
  }
  for (const id of ['camera-height', 'camera-height-number']) {
    $(id).addEventListener('input', event => {
      const requested = id === 'camera-height' ? Number(Number(event.target.value).toFixed(2)) : event.target.value;
      const result = updateCameraHeightConfig(cameraHeightConfig, { offsetCm: requested });
      if (!result.valid) return;
      cameraHeightConfig = result.config;
      syncCameraHeightControls();
      scheduleRender();
    });
    $(id).addEventListener('change', () => { $(id).value = String(cameraHeightConfig.offsetCm); });
  }
  $('apply-camera-height-range').addEventListener('click', applyCameraHeightRange);
  for (const id of ['camera-height-min', 'camera-height-max']) $(id).addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); applyCameraHeightRange(); }
  });
  $('seat-height-cm').addEventListener('input', event => {
    const input = event.target.value;
    if (!input.trim() || !Number.isFinite(Number(input)) || Number(input) < 0 || Number(input) > 100) return;
    seatHeightOverrides.set(state.venueId, Number(input) / 100);
    syncCameraHeightControls(); scheduleRender();
  });
  $('seat-height-cm').addEventListener('change', () => { $('seat-height-cm').value = String(currentSeatHeight().valueM * 100); });
  const numberControls = [ ['obstruction-width', 'obstructionWidthM', 0.1, 8], ['obstruction-height', 'obstructionHeightM', 0.1, 6], ['obstruction-x', 'obstructionX', -8, 8], ['obstruction-depth', 'obstructionDepthM', 0, 10] ];
  for (const [id, key, min, max] of numberControls) {
    $(id).addEventListener('input', (event) => { if (event.target.value !== '') { state[key] = clamp(finite(event.target.value, state[key]), min, max); scheduleRender(); } });
    $(id).addEventListener('change', () => { $(id).value = String(state[key]); });
  }
  $('aim-framing').addEventListener('change', (event) => { state.aimFraming = event.target.value; scheduleRender(); });
  $('show-grid').addEventListener('change', (event) => { state.showGrid = event.target.checked; scheduleRender(); });
  $('obstruction-enabled').addEventListener('change', (event) => { state.obstructionEnabled = event.target.checked; scheduleRender(); });
  document.querySelectorAll('[data-aspect]').forEach((button) => button.addEventListener('click', () => { state.aspect = button.dataset.aspect; syncControls(); scheduleRender(); }));
  $('model-mode').addEventListener('change', (event) => { setModelMode(event.target.value); });
  $('venue-select').addEventListener('change', event => { setVenue(event.target.value); });
  document.querySelectorAll('[data-model-view]').forEach((button) => button.addEventListener('click', () => {
    state.modelView = button.dataset.modelView; syncControls(); scheduleRender();
    $('model-view-caption').textContent = state.modelView === 'side' ? '옆 단면 · 열별 바닥 높이' : '고정 시점 · 선택 좌석 강조';
  }));
  $('reset-view').addEventListener('click', () => { Object.assign(state, defaults); applyStageWallSettings(); state.focalLength35Mm = lensConfig.mode === 'lens' ? getCameraStartingFocalMm(lensConfig,effectiveFavoriteLenses()) : normalizeFocalLength(DEFAULT_CAMERA_FOCAL_MM); cameraHeightConfig = updateCameraHeightConfig(cameraHeightConfig, { offsetCm: DEFAULT_CAMERA_HEIGHT_CONFIG.offsetCm }).config; syncControls(); scheduleRender(); });
  const resizeObserver = new ResizeObserver(scheduleRender);
  resizeObserver.observe($('view-surface'));
  resizeObserver.observe($('overview').parentElement);
  resizeObserver.observe($('model-view').parentElement);
  $('open-sources').addEventListener('click', () => $('sources-dialog').showModal());
  $('close-sources').addEventListener('click', () => $('sources-dialog').close());
  $('sources-dialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close(); } });
}

function bindViewDragging() {
  const canvas = $('seat-view');
  let drag = null;
  canvas.addEventListener('pointerdown', event => {
    if (!ready || !event.isPrimary || event.button !== 0 || drag || stagePointer) return;
    if (state.editMode !== 'view' && beginStagePointer(event, canvas, 'seat')) return;
    if (state.editMode !== 'view' || stageView !== 'seat') return;
    const rect = canvas.getBoundingClientRect();
    // Use the fitted camera viewport, including portrait/letterboxed layouts.
    const cameraAspect = activeAspectRatio(), aspect = clamp(cameraAspect,0.2,5);
    const width = Math.min(rect.width,rect.height*aspect);
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,yaw:state.viewYawDeg,pitch:state.viewPitchDeg,width,height:width/aspect,fov:clamp(horizontalFovDeg(activeFocalLength(),cameraAspect),2,150),active:false};
    canvas.focus({preventScroll:true});
  });
  canvas.addEventListener('pointermove', event => {
    if (stagePointer?.canvas === canvas) { moveStagePointer(event); return; }
    if (!drag || event.pointerId !== drag.id) return;
    if (state.editMode !== 'view' || stageView !== 'seat') {
      const id=drag.id;drag=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);return;
    }
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (!drag.active && Math.hypot(dx,dy)>6) {
      drag.active = true; canvas.setPointerCapture(event.pointerId);
    }
    if (!drag.active) return;
    state.followSelectedPerson = false;
    const angles = dragViewAngles({yawDeg:drag.yaw,pitchDeg:drag.pitch,deltaX:dx,deltaY:dy,width:drag.width,height:drag.height,horizontalFovDeg:drag.fov});
    state.viewYawDeg = angles.yawDeg;
    state.viewPitchDeg = angles.pitchDeg;
    scheduleRender();
  });
  const release = event => {
    if (stagePointer?.canvas === canvas && stagePointer.id === event.pointerId) { cancelStagePointer(event.type !== 'pointerup'); return; }
    if (!drag || event.pointerId !== drag.id) return;
    const click = event.type === 'pointerup' && event.target === canvas && !drag.active && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<=6;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (click && state.editMode === 'view') selectAudienceAtPointer(event,canvas,audienceHits);
  };
  for (const event of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(event,release);
  window.addEventListener('pointerup',release);
  canvas.addEventListener('keydown', event => {
    if (state.editMode !== 'view' || stageView !== 'seat') return;
    const directions = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
    if (!(event.key in directions) && event.key !== 'Home') return;
    event.preventDefault();
    if (event.key === 'Home') resetHeading();
    else nudgeView(directions[event.key],event.shiftKey);
  });
}

function nudgeView(direction, fine = false) {
  if (state.editMode !== 'view' || stageView !== 'seat') return;
  const step = Math.min(5,clamp(horizontalFovDeg(activeFocalLength(),activeAspectRatio()),2,150)*0.05) * (fine ? 0.2 : 1);
  state.followSelectedPerson = false;
  if (direction === 'left' || direction === 'right') state.viewYawDeg = normalizeSignedAngle(state.viewYawDeg+(direction==='right'?step:-step));
  else if (direction === 'up' || direction === 'down') state.viewPitchDeg = normalizePitch(state.viewPitchDeg+(direction==='up'?step:-step));
  scheduleRender();
}

function retargetCurrentSeatView() {
  const eye=seatPosition(geometry,state.seat,state.eyeHeightM),bounds=stageBounds(geometry);
  if(!eye||!bounds)return false;
  const person=getPerson(),stageCenter={x:(bounds.xMin+bounds.xMax)/2,y:geometry.stageHeightM+0.875,z:(bounds.zMin+bounds.zMax)/2};
  const personTarget=person?{x:person.x,y:geometry.stageHeightM+(person.visualHeightM||person.heightM)*(state.aimFraming==='upper'?0.725:0.5),z:person.z}:null;
  const direction=retargetSeatDirection({eye,stageCenter,personTarget,followSelected:state.followSelectedPerson});
  state.viewYawDeg=direction.yawDeg;state.viewPitchDeg=direction.pitchDeg;
  syncDirectionControls();return true;
}

// Only explicit seat comparison enters this path. Arrangement loading keeps
// its saved camera values, and photo/context handling remains with its owner.
function setComparisonSeat(seat) {
  const previous=state.seat;
  state.seat={row:seat.row,number:seat.number};$('seat-row').value=String(seat.row);populateSeatNumbers();
  if(previous.row!==state.seat.row||previous.number!==state.seat.number)retargetCurrentSeatView();
}

function resetHeading() {
  state.followSelectedPerson=false;retargetCurrentSeatView();scheduleRender();
}

function selectAudienceAtPointer(event,canvas,hits) {
  if (document.body.classList.contains('personal-app') || !audienceLayout?.visible) return;
  const rect=canvas.getBoundingClientRect(),hit=pickAudience(hits,event.clientX-rect.left,event.clientY-rect.top);
  if (!hit?.seat || (hit.seat.row===state.seat.row && hit.seat.number===state.seat.number)) return;
  audienceLayout.editSeat={...hit.seat};syncAudienceControls();workspaceUI?.openPanel('audience-panel');scheduleRender();
}

function renderSources() {
  const sources = venue?.sources || [];
  const list = $('sources-list');
  list.replaceChildren();
  $('source-intro').textContent = `${venue?.displayName || '선택 극장'} · ${$('geometry-status').textContent}. 아래 자료의 확보 여부와 화면에 반영된 치수는 구분해 확인하세요.`;
  if (isPlan() && seatMappingNote()) $('source-intro').textContent += ` ${seatMappingNote()}`;
  if (!sources.length) { const note = document.createElement('p'); note.className = 'small-note'; note.textContent = '공식 도면과 치수를 아직 확인하지 못했습니다. 자료가 확인되면 출처와 적용 범위를 기록합니다.'; list.append(note); }
  for (const source of sources) {
    const item = document.createElement('article'); item.className = 'source-item';
    const kindLabels = { official: '공식 자료', operator_official: '공식 운영사 자료', operator_official_document: '공식 도면·문서', public_cultural_record: '공공 공연 기록', public_venue_database: '공공 공연장 정보', secondary_press_report: '언론 보도', secondary_database_copy: '참고 공연장 정보', ticketing_record: '예매처 정보' };
    const statusLabels = { page_read: '내용 확인', zip_read: '원본 자료 확인', search_index_only: '검색 기록 확인 · 원문 재확인 필요', package_read: '원본 자료 확인' };
    const kind = document.createElement('span'); kind.className = 'source-kind'; kind.textContent = kindLabels[source.kind] || '참고 자료'; item.append(kind);
    let safeUrl = null;
    try { const url = new URL(source.url); if (['https:', 'http:'].includes(url.protocol)) safeUrl = url.href; } catch { /* Invalid or absent URLs are rendered as text. */ }
    const title = document.createElement(safeUrl ? 'a' : 'strong'); title.textContent = `${source.title || source.label || '자료'}${safeUrl ? ' ↗' : ''}`;
    if (safeUrl) { title.href = safeUrl; title.target = '_blank'; title.rel = 'noopener noreferrer'; }
    item.append(title);
    if (source.note || source.status) { const note = document.createElement('small'); note.textContent = [statusLabels[source.status], source.note].filter(Boolean).join(' · '); item.append(note); }
    list.append(item);
  }
}

function configureGeometryNotice() {
  if (isPlan()) {
    $('geometry-status').textContent = planModel.uiNotes?.statusTitle || '도면 기반 · 단위 해석 포함';
    $('geometry-description').textContent = planModel.uiNotes?.description || '공식 도면의 치수·형상을 해석했습니다. 미터 단위 환산과 좌표는 실측 확인 전입니다.';
    $('model-mode-note').textContent = planModel.uiNotes?.modelModeNote || '공식 도면의 무대 외곽·객석 배치를 해석한 모델입니다. 단위와 좌표는 실측 확인 전입니다.';
    $('seat-picker-description').textContent = planModel.approximate ? planModel.seatMapping?.source2022IdentityMappingConfirmed===true?'2022 원문 좌석번호를 선택하세요. 현재 공연 배치는 미확인입니다.':'도면의 의자 위치를 선택하세요. 표시한 내부 순번은 판매 좌석번호와 다릅니다.' : '공식 좌석표에 표기된 좌석을 선택하세요.';
    const officialCount = venue?.officialSeatLayout?.numberedSeatCount ?? planModel.seatMapping?.numberedSeatCount;
    const missing = unpositionedSeats().map(seat => `${seat.label || `${seat.rowLabel || rowLabel(Number(seat.row))}${seat.number}`} 위치 미확인`).join(' · ');
    $('seat-layout-note').textContent = planModel.uiNotes?.seatLayoutNote || `${Number.isInteger(officialCount) ? `공식 번호 ${officialCount}개 · ` : ''}모델 배치 ${createSeatList(geometry).length}개${missing ? ` · ${missing}` : ''}. 공연별 판매 여부와 좌석표의 회색 표시는 선택에 반영하지 않습니다.`;
    $('framing-note').textContent = '도면 해석값으로 계산한 근사 시야입니다. 촬영위치·자세·가림을 보정하기 전이며 실제 렌즈 선택은 사진 비교 후 확인합니다.';
    $('canvas-caption').textContent = 'PLAN INTERPRETATION';
    $('lens-estimate-note').textContent = '도면 해석 거리와 기준 키로 화면 높이의 70–85%를 채우는 근사 예측입니다. 가림 요소는 계산에 반영하지 않습니다.';
  } else {
    $('geometry-status').textContent = '공식 치수 미적용 · 가상 배치 샘플';
    $('geometry-description').textContent = '이 화면의 치수와 좌석 번호는 시제품용입니다. 실제 극장 배치와 다를 수 있습니다.';
    $('model-mode-note').textContent = `화각과 인물 크기를 확인하는 가상 배치입니다. ${venue?.displayName || '선택 극장'}의 실제 좌석과 연결하지 않습니다.`;
    $('seat-picker-description').textContent = '가상 객석에서 기능을 확인할 자리를 선택하세요.';
    $('seat-layout-note').textContent = '좌석 번호는 기능 시연용입니다. 공식 좌석이나 사진의 촬영 좌석에 자동 대응하지 않습니다.';
    $('framing-note').textContent = '단순 인물과 가상 치수로 계산한 시야입니다. 실제 시야는 촬영위치·자세·가림에 따라 달라집니다.';
    $('canvas-caption').textContent = 'SIMULATED VIEW';
    $('lens-estimate-note').textContent = '화면 높이의 70–85%를 채우는 가상 예측입니다. 가림 요소는 계산에 반영하지 않습니다.';
  }
  $('overview').setAttribute('aria-label', '합성 무대와 가상 18좌석 평면도. 좌석은 위의 열과 번호로도 선택할 수 있습니다.');
  renderModelEvidence();
}

function renderModelEvidence() {
  const bounds = stageBounds(geometry);
  const seats = createSeatList(geometry);
  const rows = new Set(seats.map(seat => seat.row));
  const floors = seats.map(seat => seat.floorY);
  const list = $('model-dimensions');
  list.replaceChildren();
  const values = [
    ['무대 외곽 경계 폭', bounds ? `${bounds.widthM.toFixed(2)} m` : '미확인'],
    ['무대 외곽 경계 깊이', bounds ? `${bounds.depthM.toFixed(2)} m` : '미확인'],
    ['무대 바닥 · 최전열 기준', `${signedHeight(geometry.stageHeightM)} m`],
    ['객석 바닥 · 무대 기준', floors.length ? `${signedHeight(Math.min(...floors) - geometry.stageHeightM)} ~ ${signedHeight(Math.max(...floors) - geometry.stageHeightM)} m` : '미확인'],
    ['모델에 배치한 좌석', `${rows.size}개 ${rowMeaning()} · ${seats.length}개 번호 좌석`],
  ];
  for (const [label, value] of values) {
    const term = document.createElement('dt'); term.textContent = label;
    const description = document.createElement('dd'); description.textContent = value;
    list.append(term, description);
  }
  $('model-evidence-kind').textContent = isPlan() ? '도면 해석값 · 실측 미확인' : '기능 시연용 가정';
  $('model-info').textContent = isPlan() ? planModel.uiNotes?.description || '공식 평면·단면 도면과 좌석표를 근거로 구성했습니다. 외곽 경계 폭·깊이는 무대를 둘러싼 범위이며, 전체를 사용 가능한 직사각형으로 뜻하지 않습니다.' : '무대·좌석·단차의 모든 값은 기능 시연용 가정입니다. 실제 극장 치수나 좌석 위치를 뜻하지 않습니다.';
  const defaultLimits = `원문 치수를 mm로 읽어 m로 환산한 해석입니다. 구조 보기의 높이는 최전열 객석 바닥 0 기준이며, 무대 바닥은 ${geometry.stageHeightM.toFixed(2)} m입니다. 좌석 중심·방향·단차는 도면에서 읽은 근사값입니다. 통로·난간의 세부 형상은 생략했습니다.`;
  $('model-limits').textContent = isPlan() ? `${planModel.uiNotes?.limits || defaultLimits}${seatMappingNote() ? ` ${seatMappingNote()}` : ''}` : '기능 샘플과 도면 기반 모델의 좌석은 별도로 관리합니다. 모델을 바꿔도 사진의 촬영정보는 바뀌지 않습니다.';
  $('model-grid-note').textContent = state.showGrid ? `격자 1 m${isPlan() ? ' · 단위 해석 기준' : ' · 가상값'}` : '격자 숨김';
}

function authoredGeometryOptions(){return {rowMeaning:venue?.officialSeatLayout?.rowMeaning};}
function applyPersonalGeometry(value,{preserveShapeDraft=false}={}){
  if(!ready||!planModel||state.modelMode!=='plan')return {valid:false,error:'이 화면에서는 무대 형상을 편집할 수 없습니다.'};
  try{
    const normalized=value===null?null:normalizeAuthoredGeometry(value);
    const next=applyAuthoredGeometry(sourceGeometry,normalized,authoredGeometryOptions());
    if([...layout.people,...layout.structures].some(item=>!isPointOnStage(next,item.x,item.z)))return {valid:false,error:'무대 밖으로 나가는 인물이나 무대 객체가 있습니다. 위치를 옮긴 후 형상을 적용하세요.'};
    cancelStagePointer(true);if(!preserveShapeDraft)authoredGeometryEditEpoch++;authoredGeometry=normalized;modeAuthoredGeometry[state.modelMode]=normalized;geometry=next;
    populateSeats();syncControls();syncEditorPanel();scheduleRender();return {valid:true};
  }catch(error){return {valid:false,error:error.message||'개인 형상 설정을 확인하세요.'};}
}

function setModelMode(mode) {
  clearPublicPhoto();
  cancelStagePointer(true);
  state.editMode = 'view';
  state.editorSelection = null;
  state.selectedPersonIds = [];
  arrangementFeedback('');
  state.stagePhotoId = null;
  modeSeats[state.modelMode] = { ...state.seat };
  state.modelMode = mode === 'plan' && planModel ? 'plan' : 'demo';
  authoredGeometryEditEpoch++;
  sourceGeometry = state.modelMode === 'plan' ? planModel.geometry : demoGeometry;
  authoredGeometry = modeAuthoredGeometry[state.modelMode] || null;
  geometry = applyAuthoredGeometry(sourceGeometry,authoredGeometry,authoredGeometryOptions());
  const syntheticLayout = state.modelMode === 'plan' && planModel?.synthetic === true && planModel.stageLayout
    ? { ...createStageLayout(geometry), ...structuredClone(planModel.stageLayout) } : null;
  layout = modeLayouts[state.modelMode] || syntheticLayout || createStageLayout(geometry);
  modeLayouts[state.modelMode] = layout;
  audienceLayout = modeAudienceLayouts[state.modelMode] || createAudienceLayout(geometry);
  if (!modeAudienceLayouts[state.modelMode]) fillAllAudience(audienceLayout,geometry,'mixed');
  modeAudienceLayouts[state.modelMode] = audienceLayout;
  if (audienceLayout.visible === undefined) audienceLayout.visible = true;
  if (!audienceLayout.fullPreset) audienceLayout.fullPreset = 'mixed';
  reconcileStageLayout(layout,geometry);
  state.seat = { ...modeSeats[state.modelMode] };
  populateSeats();
  configureGeometryNotice();
  syncControls();
  renderSources();
  ready = true;
  syncSeatPhotoRegistration();
  renderPhotos(photoManager.getSnapshot());
  syncEditorPanel();
  refreshSimulation(true);
  scheduleRender();
}

function renderSeatPhotoThumbnails(items) {
  const context=currentPrivatePhotoContext(),cloud=listedSeatPhotos(context),localIds=new Set(items.map(p=>p.id));
  items=[...items,...cloud.filter(p=>!localIds.has(p.photoId)).map(p=>({id:p.photoId,name:p.originalFilename,cloudRecord:true,processingStatus:'ready',metadata:p.sourceMetadata?.metadata??{},thumbnailUrl:publicHostedSeatPhoto?.id===p.photoId?publicHostedSeatPhoto.displayUrl:privateHostedPhoto?.id===p.photoId?privateHostedPhoto.displayUrl:null}))];
  const catalogState=seatCatalogStatus();
  const countText=catalogState==='loading'?`${items.length}장 · 서버 조회 중`:catalogState==='error'?`${items.length}장 · 서버 조회 실패`:`${items.length}장`;
  $('seat-photo-count').textContent = countText;
  $('photo-panel-count').textContent = countText;
  $('seat-photo-empty').hidden = items.length > 0;
  const key = `${state.venueId}:${state.modelMode}:${state.seat.row}:${state.seat.number}:${items.map(photo => `${photo.id}:${photo.metadata.focalLength35Mm}:${photo.thumbnailUrl || ''}:${photo.processingStatus}`).join('|')}`;
  if (key === lastSeatPhotoList) return;
  $('seat-photo-thumbnails').replaceChildren();
  for (const photo of items) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.photoId = photo.id; button.disabled = photo.processingStatus !== 'ready';
    button.className = 'seat-photo-thumb'; button.title = photo.name;
    button.setAttribute('aria-label', `${photo.name} 전체보기와 무대 투영 선택`);
    const img = document.createElement('img'); if (photo.thumbnailUrl) img.src = photo.thumbnailUrl; img.alt = ''; img.loading = 'lazy';
    const caption = document.createElement('span');
    caption.textContent = photo.cloudRecord ? photo.name : photo.metadata.focalLength35Mm ? `${focalControlMm(photo.metadata.focalLength35Mm)}mm` : '화각 미확인';
    button.append(img, caption);
    button.addEventListener('click', async () => {
      if(!photo.cloudRecord){openPhotoDialog(photo.id);return;}
      const selected=JSON.stringify(currentPrivatePhotoContext());button.disabled=true;
      try{const payload=await readSeatPhoto(photo.id,context);if(selected===JSON.stringify(currentPrivatePhotoContext()))applySelectedServerPhoto(payload);}
      catch{button.title='사진을 불러오지 못했습니다. 다시 선택해 주세요.';}
      finally{button.disabled=false;lastSeatPhotoList=null;renderSeatPhotoThumbnails(photoManager.getSnapshot().items.filter(photoMatchesCurrentSeat));}
    });
    $('seat-photo-thumbnails').append(button);
  }
  lastSeatPhotoList = key;
}

function syncPhotoDialog() {
  if (!dialogPhotoId) return;
  const photo = photoManager.getSnapshot().items.find(item => item.id === dialogPhotoId && photoMatchesCurrentSeat(item));
  if (!photo) { $('photo-dialog').close(); dialogPhotoId = null; $('photo-dialog-image').removeAttribute('src'); return; }
  $('photo-dialog-name').textContent = photo.name;
  $('project-seat-photo').disabled = photo.processingStatus !== 'ready';
  $('photo-dialog-note').textContent = `${photo.seatContext.venueName} · ${photo.seatContext.seatLabel} · 원본 전체보기. 무대에는 방향을 맞춘 로컬 표시본을 겹치며 실제 전송하지 않습니다. ${isAllowedPhotoFocal(Number(photo.metadata.focalLength35Mm)) ? `${focalControlMm(photo.metadata.focalLength35Mm)}mm 환산 화각을 함께 적용합니다.` : '환산 화각이 없어 현재 카메라 화각을 유지하고 사진만 겹칩니다.'}`;
}

function openPhotoDialog(id) {
  const photo = photoManager.getSnapshot().items.find(item => item.id === id && photoMatchesCurrentSeat(item));
  if (!photo || photo.processingStatus !== 'ready') return;
  photoManager.select(id);
  dialogPhotoId = id;
  $('photo-dialog-image').src = photo.url;
  $('photo-dialog-image').alt = `${photo.name} 무크롭 원본 전체`;
  syncPhotoDialog();
  $('photo-dialog').showModal();
}

function photoSourceTitle(source) {
  return ({exif:'원본 EXIF에서 읽은 값',file:'파일 header에서 읽은 치수·비율',filename:'파일명·폴더명에서 읽은 값',seat_selection:'등록할 때 직접 선택한 좌석',manual:'직접 보완한 값'})[source] || '';
}
function renderManagedPhotoMetadata(photo) {
  $('photo-empty').hidden = true; $('photo-content').hidden = false;
  document.querySelector('#photo-content .photo-view-column').hidden = true;
  $('original-photo').removeAttribute('src'); $('remove-photo').disabled = true;
  $('photo-file-name').textContent = '비공개 저장 촬영정보';
  $('photo-file-details').textContent = '저장된 값·출처 조회 · 원본 HTTP 제공 없음';
  $('photo-seat-context').hidden = false;
  $('photo-seat-context').textContent = `${photo.metadata.venueName || '극장 미확인'} · ${photo.metadata.seatLabel || '좌석 미확인'}`;
  $('photo-exif-status').textContent = '제출된 촬영정보 출처를 보존한 기록입니다. 서버가 원본 EXIF를 독립 재판독한 결과가 아닙니다.';
  $('cancel-photo-processing').hidden = true; $('retry-photo-processing').hidden = true;
  document.querySelectorAll('[data-meta]').forEach(input => { input.value = photo.metadata[input.dataset.meta] ?? ''; input.readOnly = true; input.title = photoSourceTitle(photo.metadataSources?.[input.dataset.meta]); });
  syncPhotoFocalAction(photo);
}

function renderPhotos(snapshot) {
  personalWorkspace?.sync();
  privateRegistrationUI?.sync();
  if (pendingPhotoProjection) {
    const request = pendingPhotoProjection, candidate = snapshot.items.find(item => item.id === request.id);
    if (snapshot.selectedId !== request.id || !candidate || !photoMatchesCurrentSeat(candidate) || request.context !== JSON.stringify(currentSeatPhotoContext()) || request.camera !== photoProjectionCamera() || ['failed','cancelled'].includes(candidate.processingStatus)) pendingPhotoProjection = null;
    else if (candidate.processingStatus === 'ready') { pendingPhotoProjection = null; applyPhotoToView(candidate, true, request.source); }
  }
  const items = snapshot.items.filter(photoMatchesCurrentSeat);
  const sourceSeatActive = ['source_seat_plan','historical_source_seat_plan'].includes(document.body.dataset.theaterView);
  if (items.length && (!sourceSeatActive || snapshot.selected?.seatContext?.kind !== 'source2d') && !photoMatchesCurrentSeat(snapshot.selected)) { photoManager.select(items[0].id); return; }
  const hasPhotos = items.length > 0;
  $('photo-empty').hidden = hasPhotos;
  $('photo-content').hidden = !hasPhotos;
  $('export-photos').disabled = !snapshot.items.length;
  const errors = [photoUploadError, ...snapshot.errors, ...(snapshot.localStorageIssues || []).map(issue => issue.message)].filter(Boolean);
  $('photo-errors').hidden = !errors.length;
  $('photo-errors').textContent = errors.join(' ');
  renderPhotoSliders(snapshot);
  renderSeatPhotoThumbnails(items);
  syncSeatPhotoRegistration();
  syncStagePhotoPreview();
  syncPhotoDialog();
  const item = photoMatchesCurrentSeat(snapshot.selected) ? snapshot.selected : null;
  const listKey = items.map((photo) => `${photo.id}:${photo.thumbnailUrl || ''}`).join('|');
  if (listKey !== lastPhotoList) {
    $('photo-thumbnails').replaceChildren();
    items.forEach((photo, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.photoId = photo.id; button.title = photo.name; button.setAttribute('aria-label', `${index + 1}번 사진: ${photo.name}`);
      const thumb = document.createElement('img'); if (photo.thumbnailUrl) thumb.src = photo.thumbnailUrl; thumb.alt = ''; thumb.loading = 'lazy';
      const number = document.createElement('span'); number.className = 'thumb-number'; number.textContent = String(index + 1);
      button.append(thumb, number); button.addEventListener('click', () => photoManager.select(photo.id)); $('photo-thumbnails').append(button);
    });
    lastPhotoList = listKey;
  }
  for (const button of $('photo-thumbnails').children) { const selected = button.dataset.photoId === snapshot.selectedId; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); }
  if (!item && managedLocalPhoto && photoMatchesCurrentSeat(managedLocalPhoto)) { renderManagedPhotoMetadata(managedLocalPhoto); return; }
  document.querySelector('#photo-content .photo-view-column').hidden = false; $('remove-photo').disabled = false;
  if (!item) { $('cancel-photo-processing').hidden = true; $('retry-photo-processing').hidden = true; lastPhotoSelection = null; $('original-photo').removeAttribute('src'); $('photo-seat-context').hidden = true; return; }
  const selectionChanged = lastPhotoSelection !== item.id;
  if (selectionChanged || (item.processingStatus === 'ready' && !$('original-photo').getAttribute('src'))) {
    $('photo-load-error').hidden = true;
    $('original-photo').hidden = item.processingStatus !== 'ready';
    if (item.processingStatus === 'ready') $('original-photo').src = item.url;
    else $('original-photo').removeAttribute('src');
    $('original-photo').alt = `${item.name} 원본 사진. 크롭 없이 전체 이미지 표시.`;
    lastPhotoSelection = item.id;
  }
  $('photo-file-name').textContent = item.name;
  $('photo-file-details').textContent = `${(item.size / (1024 * 1024)).toFixed(2)} MB · ${item.type || '이미지'} · 원본 파일 유지`;
  $('photo-seat-context').hidden = false;
  $('photo-seat-context').textContent = item.seatContext ? `등록 좌석: ${item.seatContext.venueName} · ${item.seatContext.seatLabel}${photoMatchesCurrentSeat(item) ? '' : ' · 해당 좌석을 선택하면 시야에 적용할 수 있습니다.'}` : '좌석 연결 없음 · 파일명이나 EXIF만으로 촬영 좌석을 확정하지 않습니다.';
  const autoFields = [item.metadata.device,item.metadata.captureDateTime,item.metadata.focalLengthMm ? `실제 ${item.metadata.focalLengthMm}mm` : '',item.metadata.focalLength35Mm ? `환산 ${focalControlMm(item.metadata.focalLength35Mm)}mm (반올림)` : '',item.metadata.pixelWidth && item.metadata.pixelHeight ? `${item.metadata.pixelWidth}×${item.metadata.pixelHeight}` : ''].filter(Boolean);
  const statusText = {loading:'원본 촬영정보를 읽는 중입니다.',parsed:'원본 촬영정보를 읽었습니다.',absent:'이 파일에 읽을 수 있는 EXIF 촬영정보가 없습니다.',invalid:'촬영정보 일부를 읽지 못했습니다.',read_failed:'이 파일의 촬영정보를 읽지 못했습니다.'};
  const processingText = { processing: '로컬 표시본·썸네일 처리 중 · 전송 안 함', ready: '로컬 표시본·썸네일 준비됨 · 원본 보존 · 전송 안 함', failed: '표시본 처리 실패 · 원본·촬영정보 유지', cancelled: '표시본 처리 취소 · 원본·촬영정보 유지' };
  $('cancel-photo-processing').hidden = item.processingStatus !== 'processing';
  $('retry-photo-processing').hidden = !['failed','cancelled'].includes(item.processingStatus);
  $('photo-exif-status').textContent = [processingText[item.processingStatus], ...(item.processingIssues || []).map(issue => issue.message), statusText[item.metadataStatus] || '',autoFields.join(' · '),...(item.metadataNotes || [])].filter(Boolean).join(' ');
  document.querySelectorAll('[data-meta]').forEach((input) => {
    if (selectionChanged || document.activeElement !== input) input.value = item.metadata[input.dataset.meta] ?? '';
    input.readOnly = ['venueName', 'seatLabel'].includes(input.dataset.meta);
    const source = item.metadataSources?.[input.dataset.meta];
    input.title = photoSourceTitle(source);
  });
  syncPhotoFocalAction(item);
}

function bindLocalPhotoControls() {
  const root = document.createElement('section'); root.className = 'local-photo-controls';
  const save = document.createElement('button'); save.type = 'button'; save.id = 'photo-local-save'; save.className = 'quiet-button'; save.textContent = '이 브라우저에 보관';
  const remove = document.createElement('button'); remove.type = 'button'; remove.id = 'photo-local-delete'; remove.className = 'text-button danger-button'; remove.textContent = '보관본 삭제';
  const original = document.createElement('a'); original.id = 'photo-local-original'; original.textContent = '원본 다운로드'; original.className = 'quiet-button';
  const status = document.createElement('p'); status.id = 'photo-local-status'; status.className = 'small-note'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const confirmation = document.createElement('div'); confirmation.id = 'photo-local-delete-confirmation'; confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-labelledby', 'photo-local-delete-question');
  const question = document.createElement('p'); question.id = 'photo-local-delete-question';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'quiet-button'; cancel.id = 'photo-local-delete-cancel'; cancel.textContent = '취소';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'text-button danger-button'; confirm.id = 'photo-local-delete-confirm'; confirm.textContent = '보관본 삭제';
  confirmation.append(question, cancel, confirm); remove.setAttribute('aria-controls', confirmation.id); remove.setAttribute('aria-expanded', 'false');
  let pendingDelete = null, deleting = false;
  const closeConfirmation = (restoreFocus = false) => { pendingDelete = null; confirmation.hidden = true; remove.setAttribute('aria-expanded', 'false'); if (restoreFocus && !remove.disabled && !root.hidden) remove.focus(); };
  root.append(save, remove, original, status, confirmation); $('photo-file-details').after(root);
  $('remove-photo').textContent = '현재 목록에서 빼기';
  const sync = snapshot => {
    const photo = photoMatchesCurrentSeat(snapshot.selected) ? snapshot.selected : null;
    root.hidden = !photo;
    if (pendingDelete && (!photo || photo.id !== pendingDelete.id || !photo.hasLocalCopy || snapshot.localStorageStatus !== 'ready' || pendingDelete.context !== JSON.stringify(currentSeatPhotoContext()))) closeConfirmation();
    if (!photo) return;
    const busy = deleting || photo.localStatus === 'saving';
    save.disabled = busy || !!pendingDelete || snapshot.localStorageStatus !== 'ready';
    remove.disabled = busy || !photo.hasLocalCopy || snapshot.localStorageStatus !== 'ready';
    original.href = photo.url; original.download = photo.name;
    status.textContent = [...(snapshot.localStorageIssues || []), ...(photo.localIssues || [])].map(value => value.message).join(' ') ||
      (busy ? '브라우저 보관 작업 중입니다.' : photo.localStatus === 'saved' ? '이 브라우저에 보관했습니다. 재접속해도 유지됩니다.' :
      photo.hasLocalCopy ? '수정 내용을 보관하면 이전 보관본을 갱신합니다.' : '아직 보관하지 않았습니다. 보관 버튼을 누르면 재접속 후 복원됩니다.');
    status.textContent += ' 이 기기에만 보관되며, 원본 파일은 별도로 백업해 주세요.';
  };
  photoManager.subscribe(sync); sync(photoManager.getSnapshot());
  save.onclick = async () => { const photo = photoManager.getSnapshot().selected; if (!photoMatchesCurrentSeat(photo)) return; const result = await photoManager.saveLocal(photo.id); if (!result?.ok && photoManager.getSnapshot().selectedId === photo.id) status.textContent = result?.issues?.map(value => value.message).join(' ') || '보관하지 못했습니다. 현재 원본은 유지했습니다.'; };
  remove.onclick = () => {
    if (deleting || pendingDelete || remove.disabled) return;
    const snapshot = photoManager.getSnapshot(), photo = snapshot.selected;
    if (!photoMatchesCurrentSeat(photo) || !photo.hasLocalCopy || snapshot.localStorageStatus !== 'ready') return;
    pendingDelete = Object.freeze({ id: photo.id, context: JSON.stringify(currentSeatPhotoContext()) });
    question.textContent = `“${photo.name}”의 이 브라우저 보관본을 삭제할까요? 현재 페이지의 원본과 다른 사진은 유지됩니다.`;
    confirmation.hidden = false; remove.setAttribute('aria-expanded', 'true'); sync(snapshot); cancel.focus();
  };
  cancel.onclick = () => { if (deleting) return; closeConfirmation(true); sync(photoManager.getSnapshot()); };
  confirmation.addEventListener('keydown', event => { if (event.key === 'Escape' && !deleting) { event.preventDefault(); cancel.onclick(); } });
  confirm.onclick = async () => {
    if (!pendingDelete || deleting) return;
    const target = pendingDelete, snapshot = photoManager.getSnapshot(), photo = snapshot.selected;
    if (!photoMatchesCurrentSeat(photo) || photo.id !== target.id || !photo.hasLocalCopy || snapshot.localStorageStatus !== 'ready' || photo.localStatus === 'saving' || target.context !== JSON.stringify(currentSeatPhotoContext())) { closeConfirmation(); sync(snapshot); return; }
    deleting = true; confirm.disabled = true; cancel.disabled = true; sync(snapshot);
    let result;
    try { result = await photoManager.deleteLocal(target.id); }
    catch { result = { ok: false }; }
    finally { deleting = false; confirm.disabled = false; cancel.disabled = false; closeConfirmation(); sync(photoManager.getSnapshot()); }
    if (photoManager.getSnapshot().selectedId === target.id) {
      status.textContent = result?.ok ? '이 브라우저의 보관본만 삭제했습니다. 현재 페이지의 원본과 다른 사진은 유지됩니다.' : result?.issues?.map(value => value.message).join(' ') || '보관본을 지우지 못했습니다. 다시 시도해 주세요.';
      if (!root.hidden) save.focus();
    }
  };
}

function bindPhotos() {
  bindLocalPhotoControls();
  window.addEventListener('pagehide', event => { if (!event.persisted) photoManager.dispose(); });
  for (const [id, label, method] of [['cancel-photo-processing','표시본 처리 취소','cancelProcessing'], ['retry-photo-processing','표시본 다시 처리','retryProcessing']]) {
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.className = 'quiet-button'; button.hidden = true; button.textContent = label;
    $('photo-exif-status').after(button);
    button.addEventListener('click', () => { const selected = photoManager.getSnapshot().selectedId; if (selected) photoManager[method](selected); });
  }
  $('stage-photo-image').addEventListener('error', () => { if (!publicPhoto) { state.stagePhotoId = null; syncStagePhotoPreview(); scheduleRender(); } });
  syncSeatPhotoRegistration();
  for (const [buttonId, inputId] of [['add-photos', 'photo-input'], ['add-seat-photos', 'seat-photo-input']]) {
    $(buttonId).addEventListener('click', () => {
      const context = currentSeatPhotoContext();
      if (!context) return;
      pendingPhotoContexts.set(inputId, context);
      $(inputId).click();
    });
    $(inputId).addEventListener('change', event => {
      const context = pendingPhotoContexts.has(inputId) ? pendingPhotoContexts.get(inputId) : currentSeatPhotoContext();
      pendingPhotoContexts.delete(inputId);
      addPhotosAtSeat(event.target.files, context);
      event.target.value = '';
    });
    $(inputId).addEventListener('cancel', () => pendingPhotoContexts.delete(inputId));
  }
  const dropTarget = document.querySelector('.photo-card');
  dropTarget.addEventListener('dragover', (event) => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); $('photo-empty').classList.add('drag-over'); } });
  dropTarget.addEventListener('dragleave', (event) => { if (!dropTarget.contains(event.relatedTarget)) $('photo-empty').classList.remove('drag-over'); });
  dropTarget.addEventListener('drop', (event) => { event.preventDefault(); $('photo-empty').classList.remove('drag-over'); if (event.dataTransfer?.files) addPhotosAtSeat(event.dataTransfer.files, currentSeatPhotoContext()); });
  $('close-photo-dialog').addEventListener('click', () => $('photo-dialog').close());
  $('photo-dialog').addEventListener('close', () => { dialogPhotoId = null; $('photo-dialog-image').removeAttribute('src'); });
  $('project-seat-photo').addEventListener('click', () => {
    const photo = photoManager.getSnapshot().items.find(item => item.id === dialogPhotoId && photoMatchesCurrentSeat(item));
    if (!photo) return;
    applyPhotoToView(photo, true);
    $('photo-dialog').close();
    $('seat-view').scrollIntoView({ block: 'center' });
  });
  $('original-photo').addEventListener('error', () => { $('original-photo').hidden = true; $('photo-load-error').hidden = false; });
  document.querySelectorAll('[data-meta]').forEach((input) => input.addEventListener('input', () => {
    if (!['venueName', 'seatLabel'].includes(input.dataset.meta)) photoManager.updateSelected({ [input.dataset.meta]: input.value });
  }));
  $('remove-photo').addEventListener('click', () => { const snapshot = photoManager.getSnapshot(); if (snapshot.selectedId) photoManager.remove(snapshot.selectedId); });
  $('apply-photo-focal').addEventListener('click', () => {
    const item = photoManager.getSnapshot().selected;
    applyPhotoToView(item, false);
  });
  $('export-photos').addEventListener('click', () => {
    const data = JSON.parse(photoManager.exportJson());
    data.venue = { id: venue?.id || venue?.venueId || 'unverified-sample', displayName: venue?.displayName || '합성 공연장' };
    data.sampleContext = { note: '현재 화면의 참고 설정입니다. 사진 촬영 좌석은 사진별 seatContext에 명시 등록한 경우만 연결합니다. 관객은 저장한 배치이며 내 좌석은 렌더링에서 제외합니다.', modelId: isPlan() ? planModel.modelId : `${venue?.id || 'unverified'}-demo`, modelMode: state.modelMode, seat: { ...state.seat }, focalLength35Mm: state.focalLength35Mm, sightViewEnabled: state.sightViewEnabled, sightFocalLength35Mm: state.sightFocalLength35Mm, aspectRatio: state.aspect, viewYawDeg:state.viewYawDeg,viewPitchDeg:state.viewPitchDeg,followSelectedPerson:state.followSelectedPerson,stageEnclosure:getStageEnclosure(),audienceVisible:audienceLayout?.visible,audienceEditSeat:audienceLayout?.editSeat,aimFraming: state.aimFraming, selectedPersonId:layout?.selectedPersonId, people:getPeople(),structures:getStructures(),audience:getEffectiveAudience(audienceLayout),audienceExcludedSeats:structuredClone(audienceLayout?.excludedSeats || []) };
    const chair = currentSeatHeight();
    const viewpoint = seatPosition(geometry, state.seat, state.eyeHeightM);
    data.sampleContext.cameraHeight = { ...cameraHeightConfig, seatHeightM: chair.valueM, seatHeightSource: chair.source, floorHeightM: state.eyeHeightM, rowFloorY: viewpoint?.floorY ?? null, cameraY: viewpoint?.y ?? null };
    data.sampleContext.photoComparison = {projectedPhotoId:state.stagePhotoId,lockedFocalLength35Mm:state.lockedPhotoFocalMm??null,lockedAspectRatio:state.lockedPhotoAspect??null,effectiveFocalLength35Mm:activeFocalLength(),effectiveAspectRatio:state.stagePhotoId&&state.lockedPhotoAspect|| (state.sightViewEnabled?16/9:aspectRatio())};
    data.sampleContext.cameraLens = { ...lensConfig, range: cameraFocalRange(), aperture: getLensAperture(lensConfig, activeFocalLength(), effectiveFavoriteLenses()) };
    data.sampleContext.auditoriumBarriers = getAuditoriumBarrierContext();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'theater3D-photo-records.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('pagehide', (event) => { if (!event.persisted) photoManager.dispose(); });
  // A denied/unsupported IndexedDB getter can resolve before dynamic photo
  // controls are bound. Render its retained status only after those nodes exist.
  photoUIBound = true;
  renderPhotos(photoManager.getSnapshot());
}

function addPhotosAtSeat(files, context) {
  if (!context) {
    photoUploadError = '사진을 등록할 공식 좌석을 먼저 선택하세요.';
    renderPhotos(photoManager.getSnapshot());
    return;
  }
  photoUploadError = '';
  workspaceUI?.openPanel('photo-panel');
  photoManager.addFiles(files, { seatContext: context });
}

async function loadVenueProfile(definition) {
  const results = await Promise.allSettled([definition.venuePath, definition.modelPath].map(path => runtimeData.readJSON(path)));
  if (runtimeData.getState().status !== 'ready') throw new Error('Runtime session unavailable');
  let loadedVenue;
  let errorMessage = '';
  const venueMatches = results[0].status === 'fulfilled' && results[0].value?.id === definition.id;
  if (venueMatches) loadedVenue = results[0].value;
  else {
    loadedVenue = { id: definition.id, displayName: definition.name };
    errorMessage = '공연장 자료를 불러오지 못해 기본 가상 배치를 표시합니다. 로컬 서버에서 열고 있는지 확인해 주세요.';
  }
  const candidate = { ...DEFAULT_GEOMETRY, ...loadedVenue.demoGeometry };
  for (const [key, fallback] of Object.entries(DEFAULT_GEOMETRY)) candidate[key] = finite(candidate[key], fallback);
  candidate.rowCount = Math.max(1, Math.min(50, Math.round(candidate.rowCount)));
  candidate.seatsPerRow = Math.max(1, Math.min(50, Math.round(candidate.seatsPerRow)));
  let loadedModel = null;
  try {
    if (results[1].status !== 'fulfilled') throw results[1].reason;
    const candidate = results[1].value;
    validateRenderableTheaterModel(candidate, definition);
    if (!venueMatches || !(candidate.status === 'plan_interpreted' || (candidate.status === 'synthetic_fixture' && candidate.synthetic === true && candidate.venueId === 'synthetic-portfolio-orbit-042')) || candidate.venueId !== loadedVenue.id || !candidate.modelId || !Array.isArray(candidate.geometry?.stagePolygon) || !Array.isArray(candidate.geometry?.seats) || !Array.isArray(candidate.geometry?.rowPlatforms)) throw new Error('Unverified or mismatched model data');
    for (const field of ['stageWidthM', 'stageDepthM', 'stageHeightM']) {
      const value = candidate.geometry[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || (field !== 'stageHeightM' && value <= 0)) throw new Error(`Invalid interpreted dimension: ${field}`);
    }
    const normalized = normalizeGeometry(candidate.geometry);
    const bounds = stageBounds(normalized);
    if (!bounds || bounds.widthM <= 0 || bounds.depthM <= 0 || !createSeatList(normalized).length || normalized.seats.length !== candidate.geometry.seats.length || normalized.stagePolygon.length !== candidate.geometry.stagePolygon.length || (definition.modelKind !== 'approximate' && !normalized.rowPlatforms.length) || normalized.rowPlatforms.length !== candidate.geometry.rowPlatforms.length) throw new Error('Incomplete model geometry');
    loadedModel = { ...candidate, geometry: normalized };
  } catch (error) {
    errorMessage ||= '도면 기반 모델을 불러오지 못해 기능 샘플을 표시합니다. 이 배치는 실제 극장 좌석이 아닙니다.';
    console.error('Plan model failed', error);
  }
  const defaultSeat = loadedModel?.defaultSeat || loadedVenue.defaultSeat || definition.defaultSeat;
  return { venue: loadedVenue, planModel: loadedModel, demoGeometry: normalizeGeometry(candidate), errorMessage,
    authoredGeometries: { plan: null, demo: null },
    modelMode: loadedModel ? 'plan' : 'demo', layouts: { plan: null, demo: null }, audienceLayouts: { plan: null, demo: null },
    seats: { plan: { ...defaultSeat }, demo: { row: 5, number: 6 } } };
}

async function setVenue(id) {
  const definition = VENUE_CATALOG.find(item => item.id === id);
  if (!definition) return;
  const request = ++venueLoadRequest;
  catalogUI?.clearProjection();
  activeCatalogContext = null; clearPublicPhoto();
  cancelStagePointer(true);
  if (activeVenueProfile) {
    rememberVenueElementSettings();
    modeSeats[state.modelMode] = { ...state.seat };
    activeVenueProfile.modelMode = state.modelMode;
  }
  ready = false;
  state.stagePhotoId = null;
  syncStagePhotoPreview();
  $('venue-select').disabled = true;
  $('model-mode').disabled = true;
  $('add-seat-photos').disabled = true;
  $('venue-load-note').hidden = false;
  try {
    const profile = venueProfiles.get(id) || await loadVenueProfile(definition);
    if (request !== venueLoadRequest) return;
    venueProfiles.set(id, profile);
    activeVenueProfile = profile;
    restoreVenueElementSettings(id);
    state.venueId = id;
    applyStageWallSettings(profile.stageWallSettings);
    venue = profile.venue;
    planModel = profile.planModel;
    demoGeometry = profile.demoGeometry;
    modeLayouts = profile.layouts;
    modeAuthoredGeometry = profile.authoredGeometries ||= { plan: null, demo: null };
    modeAudienceLayouts = profile.audienceLayouts;
    modeSeats = profile.seats;
    state.modelMode = profile.planModel?'plan':profile.modelMode;
    state.seat = { ...modeSeats[state.modelMode] };
    state.viewYawDeg = 0;
    state.viewPitchDeg = 0;
    state.followSelectedPerson = true;
    lastAudienceRows = ''; lastAudienceNumbers = ''; lastStripSeatKey = '';
    $('venue-select').value = id;
    $('venue-name').textContent = venue.displayName || definition.name;
    document.title = `theater3D · ${venue.displayName || definition.name}`;
    $('app-error').hidden = !profile.errorMessage;
    $('app-error').textContent = profile.errorMessage;
    $('model-mode').querySelector('[value="plan"]').disabled = !planModel;
    setModelMode(state.modelMode);
    renderPhotos(photoManager.getSnapshot());
    saveVenuePreference({ venueId: id, allowedVenueIds: VENUE_CATALOG.map(item => item.id) });
  } catch (error) {
    if (request !== venueLoadRequest) return;
    // A failed profile application may leave mixed venue/model state. Keep it
    // out of subsequent layout renders so the original failure stays visible.
    ready = false;
    $('venue-select').value = state.venueId;
    $('app-error').textContent = '공연장 전환을 완료하지 못했습니다. 페이지를 새로고침해 주세요.';
    $('app-error').hidden = false;
    console.error('Venue switch failed', error);
  } finally {
    if (request === venueLoadRequest) {
      $('venue-select').disabled = false;
      $('model-mode').disabled = false;
      $('venue-load-note').hidden = true;
    }
  }
}

function catalogConnectionConfig() {
 return { baseUrl: location.origin, connected: false, synthetic: true, connectionKind: 'catalog', configurationError: '' };
}


function clearPublicPhoto() {
  clearManagedLocalPhoto();
  if (publicPhoto) { if (state.stagePhotoId === publicPhoto.id) state.stagePhotoId = null; publicPhoto = null; }
  if (ready) { syncStagePhotoPreview(); scheduleRender(); }
}

function catalogMappedSeat(context, candidateGeometry) {
  if (!context?.seat?.projectionEligible || !context.layout || context.seat.position?.layoutVersionId !== context.layout.id) return null;
  const position = context.seat.position;
  return createSeatList(candidateGeometry).find(seat => seat.label === context.seat.officialLabel && ['x', 'z', 'floorY'].every(key => Number.isFinite(position[key]) && Math.abs(seat[key] - position[key]) < 1e-7)) || null;
}

async function activateCatalogContext(context, { signal } = {}) {
  cancelStagePointer(true); clearPublicPhoto();
  const raw = context.layout?.geometry;
  if (!context.venue || !raw || !['stageWidthM', 'stageDepthM', 'stageHeightM'].every(key => Number.isFinite(raw[key]) && raw[key] >= (key === 'stageHeightM' ? 0 : .01))
      || !Array.isArray(raw.seats) || !raw.seats.length || raw.seats.some(seat => !Number.isFinite(seat.x) || !Number.isFinite(seat.z) || !Number.isFinite(seat.floorY))) return false;
  const definition = VENUE_CATALOG.find(item => item.id === context.venue.id);
  if (!definition) return false; // Unreviewed coordinate systems remain gallery-only.
  const sourceProfile = venueProfiles.get(definition.id) || await loadVenueProfile(definition);
  if (signal?.aborted || sourceProfile.planModel?.modelId !== context.layout.legacyModelId || context.layout.id !== sourceProfile.planModel.modelId) return false;
  const reviewed = sourceProfile.planModel.geometry;
  const candidate = normalizeGeometry(raw);
  const reviewedSeats = createSeatList(reviewed);
  const stable = ['stageWidthM','stageDepthM','stageHeightM'].every(key => candidate[key] === reviewed[key])
    && JSON.stringify(candidate.stagePolygon) === JSON.stringify(reviewed.stagePolygon)
    && createSeatList(candidate).length === reviewedSeats.length
    && createSeatList(candidate).every(seat => reviewedSeats.some(original => original.row === seat.row && original.number === seat.number && original.label === seat.label && ['x','z','floorY','rotationDeg'].every(key => original[key] === seat[key])));
  if (!stable) return false;
  venueProfiles.set(definition.id, sourceProfile);
  const mapped = catalogMappedSeat(context, candidate);
  if (!mapped || !stageBounds(candidate)) return false;
  const key = `${context.venue.id}:${context.layout.id}`;
  if (activeCatalogContext?.venue.id !== context.venue.id || activeCatalogContext?.layout.id !== context.layout.id) {
    ++venueLoadRequest;
    if (activeVenueProfile) { rememberVenueElementSettings(); modeSeats[state.modelMode] = { ...state.seat }; activeVenueProfile.modelMode = state.modelMode; }
    let profile = catalogProfiles.get(key);
    if (!profile) {
      const publicModel = { ...sourceProfile.planModel, modelId: context.layout.legacyModelId, venueId: context.venue.id, geometry: reviewed,
        uiNotes: { statusTitle: catalogConnectionConfig().synthetic ? '합성 조회 모델 · 실제 극장 아님' : '게시 배치 · 출처와 해석 범위 확인', description: `배치 ${context.layout.id} · 출처 참조 ${(context.layout.sourceRefs || []).map(source => source.sourceId).join(', ') || '미확인'}. 실제 시야의 자동 보정은 없습니다.`, limits: '게시된 배치 버전의 좌표를 사용합니다. 미확인 좌석은 투영하지 않습니다.' } };
      profile = { venue: { ...sourceProfile.venue, id: context.venue.id, displayName: context.venue.displayName }, planModel: publicModel,
        get stageWallSettings() { return sourceProfile.stageWallSettings; },
        set stageWallSettings(settings) { sourceProfile.stageWallSettings = settings; },
        demoGeometry: sourceProfile.demoGeometry, authoredGeometries: sourceProfile.authoredGeometries, modelMode: 'plan', layouts: sourceProfile.layouts, audienceLayouts: sourceProfile.audienceLayouts, seats: sourceProfile.seats };
      catalogProfiles.set(key, profile);
    }
    activeVenueProfile = profile; venue = profile.venue; planModel = profile.planModel; demoGeometry = profile.demoGeometry;
    modeLayouts = profile.layouts;
    modeAuthoredGeometry = profile.authoredGeometries ||= { plan: null, demo: null }; modeAudienceLayouts = profile.audienceLayouts; modeSeats = profile.seats;
    activeCatalogContext = structuredClone(context); state.venueId = context.venue.id;
    restoreVenueElementSettings(context.venue.id);
    applyStageWallSettings(profile.stageWallSettings);
    $('venue-select').value = VENUE_CATALOG.some(item => item.id === context.venue.id) ? context.venue.id : '';
    $('venue-name').textContent = context.venue.displayName;
    $('model-mode').querySelector('[value="plan"]').disabled = false;
    setModelMode('plan');
  }
  activeCatalogContext = structuredClone(context);
  setComparisonSeat({row:mapped.row,number:mapped.number});
  populateSeats(); syncSeatPhotoRegistration(); syncControls(); scheduleRender(); refreshSimulation(true);
  return true;
}

function projectPublicPhoto({ record, delivery, context }) {
  if (!record.projectionEligible || !context.layout || !context.seat || !activeCatalogContext || delivery.photoId !== record.id
      || context.venue.id !== state.venueId || context.layout.id !== activeCatalogContext.layout.id) return false;
  const mapped = catalogMappedSeat(context, geometry);
  if (!mapped || mapped.row !== state.seat.row || mapped.number !== state.seat.number) return false;
  publicPhoto = { id: record.id, name: record.caption || '공개 표시본', url: delivery.deliveryUrl, metadata: record.metadata, metadataSources: record.metadataSources,
    publicRecord: record, localSeat: { row: mapped.row, number: mapped.number } };
  applyPhotoToView(publicPhoto, true);
  $('stage-photo-image').referrerPolicy = 'no-referrer';
  $('seat-view').scrollIntoView({ block: 'center' });
  return state.stagePhotoId === record.id;
}

function simulationContext() {
  if (!ready) return null;
  return { venueId: state.venueId, layoutVersionId: activeCatalogContext && state.modelMode === 'plan' ? activeCatalogContext.layout.id : isPlan() ? planModel.modelId : `${state.venueId}-demo` };
}
const simulationPick = (source, keys) => Object.fromEntries(keys.filter(key => source?.[key] !== undefined).map(key => [key, structuredClone(source[key])]));
function simulationSnapshot() {
  syncCameraHeightControls();
  const capturedLens=capturePresetLensDefinition(lensConfig,effectiveFavoriteLenses());
  if(!capturedLens.ok)throw Error('저장할 렌즈 정의를 확인할 수 없습니다.');
  const stageLayout = structuredClone(layout);
  stageLayout.people = layout.people.map(person => simulationPick(person, ['id','name','x','z','heightM','bodyPreset','color','position','facingDeg','pose']));
  stageLayout.structures = layout.structures.map(item => simulationPick(item, ['id','name','type','x','z','widthM','depthM','heightM','diameterM','rotationDeg','color']));
  const audience = simulationPick(audienceLayout, ['visible', 'fullPreset', 'editSeat', 'excludedSeats']);
  audience.people = (audienceLayout?.people || []).map(person => ({ seat: { ...person.seat }, preset: person.preset }));
  const camera = simulationPick(state, ['focalLength35Mm','sightFocalLength35Mm','sightViewEnabled','aspect','eyeHeightM','viewYawDeg','viewPitchDeg','followSelectedPerson','aimFraming']);
  return { seat: { ...state.seat }, layout: stageLayout, audienceLayout: audience, camera,
    ...(authoredGeometry?{authoredGeometry:structuredClone(authoredGeometry)}:{}),
    editorCamera: { ...state.editorCamera }, cameraHeightConfig: { ...cameraHeightConfig }, lensConfig: simulationPick(lensConfig, ['mode','minMm','maxMm','lensId','cropFactor']),
    ...(capturedLens.lensDefinition?{lensDefinition:structuredClone(capturedLens.lensDefinition)}:{}),
    settings: simulationPick(state, ['showGrid','stageWallsEnabled','stageWallSides','stageWallHeightM','auditoriumBarriersEnabled','obstructionEnabled','obstructionWidthM','obstructionHeightM','obstructionX','obstructionDepthM']),
    personArrangement: { spacingMode: $('person-arrangement-mode').value, axis: $('person-line-axis').value,
      ...(Number($('person-spacing-cm').value) > 0 && Number.isFinite(Number($('person-spacing-cm').value))
        ? { spacingCm: Number($('person-spacing-cm').value) } : {}) },
    selectedPersonIds: [...state.selectedPersonIds], personEditView: state.personEditView, modelView: state.modelView };
}
function simulationStatus(message, error = false) { $('simulation-status').textContent = message; $('simulation-status').dataset.error = String(error); }
function simulationResult(result, success) { simulationStatus(result.ok ? success : result.issues.map(issue => issue.message).join(' '), !result.ok); return result.ok; }

function applySimulation(preset) {
  const prepared = prepareSimulationForApply(preset);
  const value = prepared.state;
  let nextAuthoredGeometry,nextGeometry;
  try{nextAuthoredGeometry=value.authoredGeometry?normalizeAuthoredGeometry(value.authoredGeometry):null;nextGeometry=applyAuthoredGeometry(sourceGeometry,nextAuthoredGeometry,authoredGeometryOptions());}
  catch(error){simulationStatus(error.message||'저장한 개인 형상을 적용할 수 없습니다.',true);return false;}
  const seats = createSeatList(nextGeometry), validSeat = selected => selected && seats.some(seat => seat.row === selected.row && seat.number === selected.number);
  if (!value.seat || !validSeat(value.seat) || !Array.isArray(value.layout?.people) || value.layout.people.some(person => !isPointOnStage(nextGeometry, person.x, person.z)) || value.layout.structures.some(item => !isPointOnStage(nextGeometry, item.x, item.z))
      || value.audienceLayout?.excludedSeats?.some(seat => !validSeat(seat)) || value.audienceLayout?.people.some(person => !validSeat(person.seat)) || (value.audienceLayout?.editSeat && !validSeat(value.audienceLayout.editSeat))) {
    simulationStatus('저장 배치의 좌석·인물·무대 객체 위치가 현재 모델과 일치하지 않습니다. 적용을 보류했습니다. JSON 내보내기는 가능합니다.', true); return false;
  }
  const restoredLens = value.lensConfig ? restorePresetLensDefinition(value.lensConfig,value.lensDefinition,favoriteLenses) : null;
  if(restoredLens && !restoredLens.ok){simulationStatus('저장 당시 렌즈 정의를 확인할 수 없어 적용을 보류했습니다. 기존 배치는 보존됩니다.',true);return false;}
  const nextLens = restoredLens ? restoredLens.config : lensConfig;
  // Stored eye height is chair + chair-relative lift, never row-floor elevation.
  const chairHeight = value.cameraHeightConfig && value.camera?.eyeHeightM !== undefined ? value.camera.eyeHeightM - value.cameraHeightConfig.offsetCm / 100 : null;
  if (chairHeight !== null && (!Number.isFinite(chairHeight) || chairHeight < -1e-8 || chairHeight > 1 + 1e-8)) { simulationStatus('저장한 카메라 높이와 좌면 기준이 일치하지 않습니다. 적용하지 않았습니다.', true); return false; }
  cancelStagePointer(true); clearPublicPhoto(); state.stagePhotoId = null;
  state.lockedPhotoFocalMm = null; state.lockedPhotoAspect = null; state.migrationWarnings = prepared.warnings;
  authoredGeometryEditEpoch++;
  authoredGeometry=nextAuthoredGeometry;modeAuthoredGeometry[state.modelMode]=nextAuthoredGeometry;geometry=nextGeometry;
  layout = structuredClone(value.layout); modeLayouts[state.modelMode] = layout;
  if (value.audienceLayout) {
    const restored = createAudienceLayout(geometry);
    for (const person of value.audienceLayout.people) setAudienceAtSeat(restored, geometry, person.seat, person.preset);
    Object.assign(restored, simulationPick(value.audienceLayout, ['visible','fullPreset','editSeat','excludedSeats']));
    audienceLayout = restored; modeAudienceLayouts[state.modelMode] = restored;
  }
  if (value.camera) { Object.assign(state, value.camera);  }
  if (value.settings) Object.assign(state, value.settings);
  applyStageWallSettings(value.settings);
  if (value.editorCamera) state.editorCamera = { ...value.editorCamera };
  // Restore controls only; loading or changing a mode never rearranges actors.
  // Older layouts omit this field and keep the user's current control choice.
  if (value.personArrangement) {
    $('person-arrangement-mode').value = value.personArrangement.spacingMode;
    $('person-line-axis').value = value.personArrangement.axis;
    if (value.personArrangement.spacingCm !== undefined) $('person-spacing-cm').value = String(value.personArrangement.spacingCm);
  }
  if (value.cameraHeightConfig) cameraHeightConfig = { ...value.cameraHeightConfig };
  if (chairHeight !== null && Math.abs(chairHeight - currentSeatHeight().valueM) > 1e-8) seatHeightOverrides.set(state.venueId, Math.max(0, Math.min(1, chairHeight)));
  if(restoredLens)restoredPresetLens=restoredLens.lensDefinition?restoredLens.favorites.find(lens=>lens.id===restoredLens.config.lensId):null;
  lensConfig = nextLens;
  if(restoredLens)privateLensSession?.markEdited();
  state.seat = { ...value.seat }; state.selectedPersonIds = [...(value.selectedPersonIds || [])];
  state.personEditView = value.personEditView || 'top'; state.modelView = value.modelView || 'isometric';
  state.editMode = 'view'; state.editorSelection = null; lastAudienceRows = ''; lastAudienceNumbers = '';
  populateSeats(); syncControls(); syncEditorPanel(); syncStagePhotoPreview(); renderPhotos(photoManager.getSnapshot()); scheduleRender();
  return true;
}

function setupPersonalWorkspace() {
  const refresh = () => { syncLayoutControls(); syncControls(); syncEditorPanel(); scheduleRender(); };
  modelOrbitControls=createModelOrbitControls({canvas:$('seat-view'),onChange:()=>scheduleRender(),onSeatPick:event=>selectSeatAtPointer(event,$('seat-view'),editingScenes.seat?.seatHits||[]),getMode:()=>state.editMode==='view'?stageView:'seat'});
  personalWorkspace = createPersonalWorkspace({
    getSnapshot: () => ({state,layout,geometry,sourceGeometry,authoredGeometry,authoredGeometryEditEpoch,authoredSeatBlocks:authoredSeatBlocks(sourceGeometry,authoredGeometryOptions()),audienceLayout,people:getPeople(),structures:getStructures(),venue,stageView,sectionTargetMode:sectionTargetMode==='person'&&layout?.people.some(p=>p.id===layout.selectedPersonId)?'person':'stage',planAvailable:Boolean(planModel),modelAccuracy:planModel?.approximate?'approximate':'interpreted',modelSummary:planModel?.uiNotes?.approximationSummary||'',ready,context:simulationContext(),focalRange:cameraFocalRange(),stageScene:editingScenes.seat,seatLabel:seatLabel()}),
    getPrivateNoteSelection: async context => {
      const host=hostedSession;if(!host)return null;
      const result=context?.kind==='source2d'
        ?await host.selectionForSource(Object.fromEntries(['kind','informationRecordId','layoutVersionId','configurationKey','frameId','seatId'].map(k=>[k,context[k]])))
        :await host.currentMapping(null);
      if(host!==hostedSession||!result||result.status==='unresolved'||!result.selection||!result.registry)return null;
      return {selection:result.selection,registry:result.registry};
    },
    getModelRegistry: () => theaterModelRegistry,
    readRuntimeJSON: (path, options) => runtimeData.readJSON(path, options),
    getRuntimeDataState: () => runtimeData.getState(),
    subscribeRuntimeData: listener => runtimeData.subscribe(listener),
    onAuthoredGeometry: (value,options) => applyPersonalGeometry(value,options),
    getPersonalSettings: () => ({context:simulationContext(),cameraHeightConfig:{...cameraHeightConfig},seatHeightOverrideM:seatHeightOverrides.has(state.venueId)?seatHeightOverrides.get(state.venueId):null}),
    onPersonalSettingsApply: input => {
      const result=updateCameraHeightConfig(cameraHeightConfig,{minCm:input.minCm,maxCm:input.maxCm,offsetCm:input.offsetCm});
      const chair=input.seatHeightEdited?(String(input.seatHeightCm).trim()===''?NaN:Number(input.seatHeightCm)):currentSeatHeight().valueM*100;
      if(!result.valid)return result;
      if(!Number.isFinite(chair)||chair<0||chair>100)return {valid:false,error:'좌면 높이는 0~100 cm로 입력하세요.'};
      cameraHeightConfig=result.config;if(input.seatHeightEdited&&Math.abs(chair/100-currentSeatHeight().valueM)>1e-8)seatHeightOverrides.set(state.venueId,chair/100);refresh();return {valid:true};
    },
    onPersonalSettingsRestore: saved => {
      if(JSON.stringify(saved?.context)!==JSON.stringify(simulationContext()))return false;
      cameraHeightConfig={...saved.cameraHeightConfig};
      if(saved.seatHeightOverrideM===null)seatHeightOverrides.delete(state.venueId);else seatHeightOverrides.set(state.venueId,saved.seatHeightOverrideM);
      $('camera-height-min').value=String(cameraHeightConfig.minCm);$('camera-height-max').value=String(cameraHeightConfig.maxCm);$('camera-height-error').hidden=true;refresh();return true;
    },
    onViewOptionsRestore: saved => {
      if(JSON.stringify(saved?.context)!==JSON.stringify(simulationContext()))return false;
      state.showGrid=saved.showGrid;state.aimFraming=saved.aimFraming;refresh();return true;
    },
    hasLegacyLayout: () => {const saved=simulationStorage.list({venueId:state.venueId,layoutVersionId:`${state.venueId}-demo`});return Boolean(modeLayouts.demo||(saved.ok&&saved.value.length));},
    onModelMode: mode => {if(mode==='demo'||(mode==='plan'&&planModel))setModelMode(mode);},
    getHostedSeatPhotos:context=>({status:seatCatalogStatus(),items:listedSeatPhotos(context)}),
    onSelectHostedSeatPhoto:async(id,context)=>{const expected=JSON.stringify(currentPrivatePhotoContext());const payload=await readSeatPhoto(id,context);if(expected!==JSON.stringify(currentPrivatePhotoContext()))return false;return applySelectedServerPhoto(payload);},
    getPhotos: () => privatePhotoSnapshot(), photoMatches: photoMatchesCurrentSeat, localPhotoManager: photoManager,
    onRefresh: () => scheduleRender(),
    onMode: mode => { setEditMode(mode); refresh(); },
    onStageView: mode => { if(!['seat','plan','orbit'].includes(mode))return;cancelStagePointer(true);stageView=mode;modelOrbitControls.setMode(mode);setEditMode('view');refresh(); },
    onSectionTarget: mode => {if(!['stage','person'].includes(mode)||mode==='person'&&!layout?.people.some(p=>p.id===layout.selectedPersonId))return false;sectionTargetMode=mode;refresh();return true;},
    onCapture: enabled => { state.sightViewEnabled=!enabled;state.lockedPhotoFocalMm=null;syncControls();scheduleRender(); },
    onAspect: aspect => { if(CAPTURE_ASPECTS.includes(aspect)){state.aspect=aspect;syncControls();scheduleRender();} },
    onVenue: id => setVenue(id),
    onSeat: seat => {
      if(!ready||!seat||!createSeatList(geometry).some(item=>item.row===seat.row&&item.number===seat.number))return false;
      catalogUI?.clearProjection();setComparisonSeat({row:seat.row,number:seat.number});scheduleRender();return true;
    },
    onSourceSeat: sourceGeometryId => {
      if(!ready||typeof sourceGeometryId!=='string')return false;
      const matches=createSeatList(geometry).filter(seat=>seat.sourceGeometryId===sourceGeometryId||(planModel?.approximate&&seat.sourcePlanSelectionId===sourceGeometryId));if(matches.length!==1)return false;
      const seat=matches[0];catalogUI?.clearProjection();setComparisonSeat({row:seat.row,number:seat.number});scheduleRender();return true;
    },
    onBrowseInformation: () => { ++venueLoadRequest; cancelStagePointer(true); $('venue-select').disabled=false; $('model-mode').disabled=false; $('venue-load-note').hidden=true; },
    onCount: (sex,count) => {
      if(!layout || state.editMode!=='person' || !Number.isInteger(count) || count<0 || count>MAX_STAGE_PEOPLE)return;
      const group=layout.people.filter(p=>p.bodyPreset===sex);
      if(count+layout.people.length-group.length>MAX_STAGE_PEOPLE)return;
      if(count<group.length)for(const p of group.slice(count))removePerson(layout,p.id);
      else for(let n=group.length;n<count;n++){const p=addPerson(layout,geometry,{bodyPreset:sex});if(p)state.selectedPersonIds.push(p.id);}
      state.selectedPersonIds=[...new Set(state.selectedPersonIds)].filter(id=>layout.people.some(p=>p.id===id));
      setEditMode('person');refresh();
    },
    onPeople: (ids,patch) => {if(state.editMode!=='person')return false;for(const id of ids)updatePerson(layout,id,patch,geometry);refresh();},
    onSelection: ids => {state.selectedPersonIds=[...new Set(ids)].filter(id=>layout.people.some(p=>p.id===id));layout.selectedPersonId=state.selectedPersonIds.at(-1)||null;state.editorSelection=layout.selectedPersonId?{kind:'person',id:layout.selectedPersonId}:null;refresh();},
    onStructure: patch => {if (state.editMode !== 'stage') return;updateStructure(layout,layout.selectedStructureId,patch,geometry);refresh();},
    onExclusions: seats => {const ok=setAudienceExclusions(audienceLayout,geometry,seats);if(ok){syncAudienceControls();scheduleRender();}return ok;},
    onPhotoSelect: (id,project) => {
      const photo=privatePhotoSnapshot().items.find(p=>p.id===id&&photoMatchesCurrentSeat(p));
      if(!photo?.privateRecord&&!photo?.publicSeatRecord){clearPublishedSeatPhoto();clearPrivateHostedPhoto();state.lockedPhotoFocalMm=null;state.lockedPhotoAspect=null;}
      if(project&&photo)applyPhotoToView(photo,true);else{clearPhotoProjection();if(photo&&!photo.privateRecord&&!photo.publicSeatRecord)photoManager.select(photo.id);}
    },
    onPhotoLocks: ({aspect,focal}) => {
      const target=focal===null?null:photoFocalTarget(focal);
      const valid=focal===null||target!==null;
      const next=valid?focal:null,ratio=Number.isFinite(aspect)&&aspect>0?aspect:null;
      const nextSight=target?target==='sight':state.sightViewEnabled;
      if(state.lockedPhotoFocalMm!==next||state.lockedPhotoAspect!==ratio||state.sightViewEnabled!==nextSight){state.lockedPhotoFocalMm=next;state.lockedPhotoAspect=ratio;state.sightViewEnabled=nextSight;scheduleRender();}
      return valid;
    },
  });
}

function refreshSimulation(restore = false) {
  const context = simulationContext(); if (!context) return;
  clearPrivateStageOptions();
  const key = `${context.venueId}:${context.layoutVersionId}`;
  $('simulation-context').textContent = `${venue?.displayName || context.venueId} · ${context.layoutVersionId} · 개인 배치`;
  if (key !== simulationContextKey) simulationStatus('현재 극장·배치의 개인 저장 목록입니다.');
  const previous = key === simulationContextKey ? $('simulation-select').value : '';
  simulationContextKey = key;
  const result = simulationStorage.list(context);
  $('simulation-select').replaceChildren(new Option('배치 선택', ''));
  if (!result.ok) {
    simulationResult(result, '');
    // Recovery choices are export-only; load/import still go through validation.
    try {
      const recovery = JSON.parse(localStorage.getItem(SIMULATION_STORAGE_KEY));
      if (Array.isArray(recovery?.items)) for (const item of recovery.items.slice(0,100)) {
        if (item?.context?.venueId === context.venueId && item.context?.layoutVersionId === context.layoutVersionId && typeof item?.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_.-]*$/.test(item.id)) $('simulation-select').add(new Option(`${String(item.name || item.id).slice(0,100)} · 보관용 내보내기`, item.id));
      }
    } catch { /* Corrupt JSON stays untouched until explicit reset confirmation. */ }
    void refreshPrivateStageList(); return;
  }
  for (const item of result.value) $('simulation-select').add(new Option(item.name, item.id));
  if (result.value.some(item => item.id === previous)) $('simulation-select').value = previous;
  if (restore && !restoredSimulationContexts.has(key)) {
    restoredSimulationContexts.add(key);
    const latest = [...result.value].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).at(0);
    if (latest) {
      const loaded = simulationStorage.load(latest.id, context);
      if (loaded.ok && applySimulation(loaded.value)) { $('simulation-select').value = latest.id; simulationStatus(`저장 배치 '${latest.name}'를 복원했습니다.`); }
      else if (!loaded.ok) simulationResult(loaded, '');
    } else simulationStatus('저장한 배치가 없습니다. 현재 상태에 이름을 붙여 저장하세요.');
  }
  void refreshPrivateStageList();
}

function downloadSimulation(json, name = 'theater3D-personal-layout.json') {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bindSimulationControls() {
  $('simulation-save').addEventListener('click', async () => {
    cancelStagePointer(true); const context = simulationContext(); if (!context) return;
    const result = simulationStorage.save({ name: $('simulation-name').value.trim(), context, state: simulationSnapshot() });
    if (simulationResult(result, '이 브라우저에 개인 배치를 저장했습니다.')) {
      refreshSimulation(); $('simulation-select').value = result.value.id;
      if (hostedSession) {
        const host = hostedSession, stamp = JSON.stringify([venueLoadRequest,simulationContext(),state.seat]);
        await host.refreshMapping(result.value);
        if (host !== hostedSession || stamp !== JSON.stringify([venueLoadRequest,simulationContext(),state.seat])) return;
      }
      if (privateStageConfigured) {
        const controller = privateStageController, saved = await controller.save(result.value);
        if (controller === privateStageController && (!saved.ok || controller.isResultCurrent(saved))) {
          privateStageMessage(saved, '이 브라우저와 계정의 서버에 개인 배치를 저장했습니다.');
          void refreshPrivateStageList();
        }
      }
    }
  });
  $('simulation-load').addEventListener('click', async () => {
    const remoteId = selectedPrivateStageId();
    if (remoteId) {
      const controller = privateStageController, loaded = await controller.load(remoteId);
      if (controller === privateStageController && (!loaded.ok || controller.isResultCurrent(loaded))) privateStageMessage(loaded, '서버의 개인 배치를 불러왔습니다.');
      return;
    }
    const result = simulationStorage.load($('simulation-select').value, simulationContext());
    if (result.ok) { if (applySimulation(result.value)) simulationStatus(`'${result.value.name}' 배치를 불러왔습니다.`); }
    else simulationResult(result, '');
  });
  $('simulation-export').addEventListener('click', async () => {
    const remoteId = selectedPrivateStageId();
    if (remoteId) {
      const controller = privateStageController, loaded = await controller.getVerifiedPreset(remoteId);
      if (controller !== privateStageController || loaded.ok && !controller.isResultCurrent(loaded)) return;
      if (privateStageMessage(loaded, '서버 배치를 확인했습니다. JSON으로 내보냅니다.')) downloadSimulation(JSON.stringify(loaded.preset, null, 2));
      return;
    }
    const result = simulationStorage.export($('simulation-select').value);
    if (simulationResult(result, '개인 배치를 JSON으로 내보냈습니다. 사진 원본은 포함하지 않습니다.')) downloadSimulation(result.value);
  });
  let pendingImportContext = null;
  $('simulation-import').addEventListener('click', () => { pendingImportContext = simulationContext(); $('simulation-file').value = ''; $('simulation-file').click(); });
  $('simulation-file').addEventListener('cancel', () => { pendingImportContext = null; });
  $('simulation-file').addEventListener('change', async event => {
    const file = event.target.files[0], context = pendingImportContext || simulationContext(), serial = ++simulationImportRequest;
    pendingImportContext = null;
    if (!file || !context) return;
    if (file.size > 256 * 1024) { simulationStatus('가져올 JSON은 256KB 이하여야 합니다.', true); return; }
    try {
      const json = await file.text();
      if (serial !== simulationImportRequest) return;
      if (JSON.stringify(context) !== JSON.stringify(simulationContext())) { simulationStatus('가져오는 동안 극장·배치가 바뀌었습니다. 다시 선택하세요.', true); return; }
      const result = simulationStorage.import(json, context);
      if (simulationResult(result, '개인 배치를 가져왔습니다. 불러오기를 눌러 적용하세요.')) { refreshSimulation(); $('simulation-select').value = result.value.id; }
    } catch {
      if (serial !== simulationImportRequest) return;
      if (JSON.stringify(context) !== JSON.stringify(simulationContext())) { simulationStatus('가져오는 동안 극장·배치가 바뀌었습니다. 다시 선택하세요.', true); return; }
      simulationStatus('파일을 읽을 수 없습니다. 기존 저장 배치는 유지했습니다.', true);
    }
  });
  let pendingDelete = null, pendingReset = false;
  const clearSimulationConfirmations = () => {
    pendingDelete = null; pendingReset = false;
    $('simulation-confirm').hidden = true; $('simulation-reset-confirm').hidden = true;
  };
  $('simulation-select').addEventListener('change', () => {
    privateStageViewEpoch++; clearSimulationConfirmations();
    if ($('simulation-select').selectedOptions[0]?.dataset.privateStage === 'more') {
      $('simulation-select').value = ''; void refreshPrivateStageList(true);
    }
  });
  // The workspace creates this dialog after bindSimulationControls runs.
  for (const type of ['close', 'cancel']) document.addEventListener(type, event => {
    if (event.target?.id === 'simulation-dialog') clearSimulationConfirmations();
  }, true);
  $('simulation-remove').addEventListener('click', () => {
    clearSimulationConfirmations();
    const remoteId=selectedPrivateStageId();
    const id = $('simulation-select').value, context = simulationContext();
    if (!id || !context) { simulationStatus('삭제할 저장 배치를 선택하세요.', true); return; }
    const revision=remoteId?Number($('simulation-select').selectedOptions[0]?.dataset.stageRevision):null;
    if(remoteId&&(!Number.isSafeInteger(revision)||revision<1)){simulationStatus('서버 배치 판본을 다시 확인하세요.',true);return;}
    pendingDelete = { id, remoteId, revision, recheck:remoteId&&privateStageController.getState().uncertainDeleteIds?.includes(remoteId), contextJSON: JSON.stringify(context), sessionKey:privateStageSessionKey(), label:($('simulation-select').selectedOptions[0]?.textContent||'선택한 저장 배치').replace(/ · 서버 삭제 상태 확인 필요$/, '') };
    const label = $('simulation-select').selectedOptions[0]?.textContent || '선택한 저장 배치';
    $('simulation-confirm').querySelector('p').textContent = pendingDelete.recheck?`'${label}'의 이전 서버 삭제 결과를 확인할까요? 삭제 요청을 다시 보내지 않습니다.`:remoteId?`'${label}' 서버 저장본을 목록에서 삭제할까요? 현재 화면과 이 브라우저의 로컬 사본은 유지됩니다.`:`'${label}' 배치를 삭제할까요? 현재 화면과 다른 저장 배치는 유지됩니다.`;
    $('simulation-confirm').hidden = false;
  });
  $('simulation-cancel-remove').addEventListener('click', clearSimulationConfirmations);
  $('simulation-confirm-remove').addEventListener('click', async () => {
    const target = pendingDelete; clearSimulationConfirmations();
    if (!target) return;
    if (target.id !== $('simulation-select').value || target.contextJSON !== JSON.stringify(simulationContext())) {
      simulationStatus('삭제할 배치 선택이나 극장이 바뀌었습니다. 다시 선택하세요.', true); return;
    }
    if(target.remoteId){
      if(!privateStageController.checkSession()||target.sessionKey!==privateStageSessionKey()){simulationStatus('인증 계정이 바뀌었습니다. 서버 배치를 다시 확인하세요.',true);return;}
      const controller=privateStageController;
      // The controller owns the intent and authenticated revision. A pending UI
      // item may only perform status reconciliation, never repeat the mutation.
      const recheck=target.recheck||controller.getState().uncertainDeleteIds?.includes(target.remoteId);
      const result=await (recheck?controller.reconcileDelete(target.remoteId):controller.remove(target.remoteId,target.revision));
      if(controller===privateStageController&&target.sessionKey===privateStageSessionKey()){
        if(controller.getState().uncertainDeleteIds?.includes(target.remoteId))privateStageDeleteOptions.set(target.remoteId,{...target});
        else privateStageDeleteOptions.delete(target.remoteId);
      }
      if(controller!==privateStageController||target.id!==$('simulation-select').value||target.contextJSON!==JSON.stringify(simulationContext()))return;
      if(result.ok&&controller.isResultCurrent(result)){
        if(result.deleted){simulationStatus('서버 배치 삭제를 확인했습니다. 로컬 사본과 현재 화면은 유지됩니다.');await refreshPrivateStageList();}
        else {simulationStatus('서버에 배치가 남아 있습니다. 삭제하려면 다시 선택해 확인하세요.');await refreshPrivateStageList();}
      }else if(result.code==='OUTCOME_UNKNOWN'||result.code==='RECONCILIATION_REQUIRED'){showPrivateStageDeleteOptions();simulationStatus('삭제 결과를 확인하지 못했습니다. 삭제 버튼을 다시 눌러 상태만 확인하세요.',true);}
      else privateStageMessage(result,'');
      return;
    }
    const result = simulationStorage.remove(target.id);
    if (simulationResult(result, '선택한 저장 배치를 삭제했습니다.')) refreshSimulation();
  });
  $('simulation-reset').addEventListener('click', () => {
    clearSimulationConfirmations(); pendingReset = true; $('simulation-reset-confirm').hidden = false;
  });
  $('simulation-reset-no').addEventListener('click', clearSimulationConfirmations);
  $('simulation-reset-yes').addEventListener('click', () => {
    if (!pendingReset) return;
    clearSimulationConfirmations();
    try { localStorage.removeItem(SIMULATION_STORAGE_KEY); restoredSimulationContexts.clear(); refreshSimulation(); simulationStatus('확인한 개인 배치 저장소를 초기화했습니다. 현재 화면은 유지합니다.'); }
    catch { simulationStatus('초기화에 실패했습니다. 기존 저장소를 유지했습니다.', true); }
  });
  refreshSimulation();
}

function clearManagedLocalPhoto() {
  if (managedLocalPreviewUrl && managedLocalPreviewUrl !== managedLocalPhoto?.displayUrl) URL.revokeObjectURL(managedLocalPreviewUrl);
  managedLocalPreviewUrl = null;
  if (!managedLocalPhoto) return;
  if (state.stagePhotoId === managedLocalPhoto.id) state.stagePhotoId = null;
  URL.revokeObjectURL(managedLocalPhoto.displayUrl); managedLocalPhoto = null;
}

// Network registration is omitted from the static portfolio build.

async function reloadRuntimeModels() {
  if (!runtimeStarted) return;
  const dataState = runtimeData.getState(), epoch = dataState.epoch;
  ++venueLoadRequest; privateStageViewEpoch++; ready = false;
  cancelStagePointer(true); clearPublicPhoto(); clearManagedLocalPhoto(); clearPrivateStageOptions();
  activeCatalogContext = null; catalogProfiles.clear(); venueProfiles.clear();
  venueElementSettings.clear(); seatHeightOverrides.clear(); cameraHeightConfig = { ...DEFAULT_CAMERA_HEIGHT_CONFIG };
  demoGeometry = normalizeGeometry({ ...DEFAULT_GEOMETRY });
  Object.assign(state, defaults, { editMode:'view', editorCamera:{yawDeg:28,elevationDeg:34,zoom:1},stageWallSides:{back:true,left:true,right:true} });
  activeVenueProfile = null; theaterModelRegistry = []; VENUE_CATALOG = [];
  venue = null; planModel = null; layout = null; audienceLayout = null; authoredGeometry = null;
  sourceGeometry = normalizeGeometry({ ...DEFAULT_GEOMETRY }); geometry = sourceGeometry;
  modeLayouts = { plan: null, demo: null }; modeAudienceLayouts = { plan: null, demo: null };
  modeAuthoredGeometry = { plan: null, demo: null }; modeSeats = { plan: null, demo: null };
  state.stagePhotoId = null; syncStagePhotoPreview(); state.venueId = ''; state.editorSelection = null; state.selectedPersonIds = [];
  for (const key of Object.keys(editingScenes)) editingScenes[key] = null;
  audienceHits = []; modelAudienceHits = []; lastAudienceRows = ''; lastAudienceNumbers = '';
  for (const id of ['sources-list','model-dimensions','venue-select','seat-row','seat-number','person-select','person-selection-list','structure-select']) $(id)?.replaceChildren();
  for (const id of ['venue-name','source-intro','geometry-status','geometry-description','model-mode-note','seat-layout-note','seat-picker-description','canvas-caption','framing-note','lens-estimate-note']) if ($(id)) $(id).textContent = '';
  for (const id of ['overview','seat-view','model-view']) { const canvas = $(id); const context = canvas?.getContext('2d'); context?.clearRect(0,0,canvas.width,canvas.height); }
  // Clear transient inspector values even when their dialogs are closed. Do
  // not touch persisted local presets, notes, photos or lens favourites.
  for (const id of ['camera-height-note','camera-height-error','simulation-context','simulation-status','model-info','model-limits','model-auditorium-barrier-note','view-seat-label','view-distance','view-width','layout-status','person-count','structure-count','person-selection-summary','editor-selection-title']) if ($(id)) $(id).textContent = '';
  for (const selector of ['#camera-details input','#stage-object-editor input','#stage-object-editor output','#simulation-name','#seat-height-cm']) for (const input of document.querySelectorAll(selector)) {
    if (['checkbox','radio'].includes(input.type)) input.checked = input.defaultChecked;
    else input.value = input.defaultValue ?? '';
  }
  for (const id of ['sources-dialog','simulation-dialog']) if ($(id)?.open) $(id).close();
  document.title = 'theater3D'; $('venue-select').disabled = true; $('model-mode').disabled = true; $('add-seat-photos').disabled = true;
  $('venue-load-note').hidden = true; $('app-error').hidden = false;
  $('app-error').textContent = dataState.status === 'ready' ? '공연장 자료를 불러오고 있습니다.' : '개인 자료 계정 연결이 필요합니다.';
  if (dataState.status !== 'ready') return;
  try {
    const parsed = normalizeTheaterModelRegistry(await runtimeData.readJSON('./data/catalog/theater-model-registry.json'));
    if (runtimeData.getState().epoch !== epoch) return;
    theaterModelRegistry = parsed.entries; VENUE_CATALOG = parsed.definitions;
    $('venue-select').replaceChildren(...VENUE_CATALOG.map(d => new Option(d.name,d.id)));
    if (VENUE_CATALOG.length) await setVenue(VENUE_CATALOG[0].id);
  } catch { if (runtimeData.getState().epoch === epoch) $('app-error').textContent = '공연장 자료를 읽지 못했습니다. 계정 상태를 확인한 뒤 다시 연결해 주세요.'; }
}
runtimeData.subscribe(() => { void reloadRuntimeModels(); });

function privatePhotoSnapshot() {
  let local=photoManager.getSnapshot();
  if(publicHostedSeatPhoto&&!publishedSeatPhotoIsCurrent(publicHostedSeatPhoto))clearPublishedSeatPhoto();
  if(publicHostedSeatPhoto&&publicHostedSeatPhoto.seatContext.kind!=='source2d')local={...local,items:[...local.items,publicHostedSeatPhoto],selectedId:publicHostedSeatPhoto.id,selected:publicHostedSeatPhoto};
  if(!privateHostedPhoto)return local;
  const photo=privateHostedPhoto;
  if(!isCurrentPrivateHostedPhoto(photo)){clearPrivateHostedPhoto();return local;}
  // A source2D display belongs only to the source photo panel, never the 3D picker.
  if(photo.seatContext.kind==='source2d')return local;
  return {...local,items:[...local.items,photo],selectedId:photo.id,selected:photo};
}
function currentPrivatePhotoContext() {
  try {
    if(personalWorkspace?.isPrivateSourcePhotoActive?.())return personalWorkspace.getPrivateSourcePhotoContext?.()??null;
    return currentSeatPhotoContext();
  } catch {return null;}
}
function isCurrentPrivateHostedPhoto(photo) {
  if(!photo||privateHostedPhoto!==photo)return false;
  let session;try{session=hostedSession?.sessionPort.getSession();}catch{return false;}
  const bound=photo.session;
  return privateHostedPhoto===photo&&(ready||photo.seatContext.kind==='source2d')&&Boolean(session&&bound)
    &&session.projectRef===bound.projectRef&&session.accountId===bound.accountId&&session.epoch===bound.epoch
    &&privateRegisteredPhotoMatchesSelection(photo.seatContext,currentPrivatePhotoContext());
}
function clearPrivateHostedPhoto() {
  const photo=privateHostedPhoto; privateHostedPhoto=null;
  if(photo){
    const projected=state.stagePhotoId===photo.id;
    if(projected)state.stagePhotoId=null;
    state.lockedPhotoFocalMm=null;state.lockedPhotoAspect=null;
    URL.revokeObjectURL(photo.displayUrl);
    if(photo.seatContext.kind==='source2d')personalWorkspace?.clearPrivateSourcePhoto?.();
    const image=$('stage-photo-image');
    if(projected||!state.stagePhotoId||image?.getAttribute('src')===photo.displayUrl){
      image?.removeAttribute('src');if(image){image.onload=null;image.alt='';}
      if($('stage-photo-preview'))$('stage-photo-preview').hidden=true;
      if($('stage-photo-label'))$('stage-photo-label').textContent='';
      if($('stage-photo-crop-guide'))$('stage-photo-crop-guide').hidden=true;
      if($('framing-note'))$('framing-note').textContent='';
      if($('framing-status'))$('framing-status').textContent='';
    }
    const choice=$('selected-photo'),wasSelected=choice?.value===photo.id;
    for(const option of [...(choice?.options||[])])if(option.value===photo.id)option.remove();
    if(wasSelected){
      choice.value='';
      for(const id of ['photo-project-toggle','photo-lock-aspect','photo-lock-focal'])if($(id)){$(id).checked=false;$(id).disabled=true;}
      if($('photo-lock-note'))$('photo-lock-note').textContent='';
    }
    if(ready){syncStagePhotoPreview();personalWorkspace?.sync();scheduleRender();}
  }
}
function applyPrivateRegisteredPhoto(payload,{signal}={},compare=true) {
  const source2D=payload?.seatContext?.kind==='source2d';
  if(signal?.aborted||(!ready&&!source2D)||!['registered-private','imported-private'].includes(payload?.source)
    ||!privateRegisteredPhotoMatchesSelection(payload.seatContext,currentPrivatePhotoContext()))return false;
  if(source2D&&(!compare||typeof personalWorkspace?.applyPrivateSourcePhoto!=='function'))return false;
  let session;try{session=hostedSession?.sessionPort.getSession();}catch{return false;}
  if(!session||session.projectRef!==payload.session?.projectRef||session.accountId!==payload.session?.accountId||session.epoch!==payload.session?.epoch)return false;
  const d=payload.display;
  if(!(d?.bytes instanceof Uint8Array)||d.bytes.byteLength!==d.byteSize||!['image/jpeg','image/png','image/webp'].includes(d.mediaType))return false;
  if(!compare){
    const focal=Number(payload.metadata?.focalLength35Mm);
    if(!photoFocalTarget(focal))return false;
    applyPhotoToView({id:payload.photoId,privateRecord:true,seatContext:payload.seatContext,metadata:payload.metadata},false);
    return true;
  }
  clearPrivateHostedPhoto();
  const displayUrl=URL.createObjectURL(new Blob([d.bytes],{type:d.mediaType}));
  let current;try{current=hostedSession?.sessionPort.getSession();}catch{URL.revokeObjectURL(displayUrl);return false;}
  if(signal?.aborted||(!ready&&!source2D)||!current||current.projectRef!==session.projectRef||current.accountId!==session.accountId||current.epoch!==session.epoch||!privateRegisteredPhotoMatchesSelection(payload.seatContext,currentPrivatePhotoContext())){URL.revokeObjectURL(displayUrl);return false;}
  privateHostedPhoto={id:payload.photoId,name:payload.originalFilename,privateRecord:true,displayUrl,
    session:{projectRef:session.projectRef,accountId:session.accountId,epoch:session.epoch},
    metadata:structuredClone(payload.metadata),...(Object.hasOwn(payload,'metadataSources')?{metadataSources:structuredClone(payload.metadataSources)}:{}),
    seatContext:structuredClone(payload.seatContext),processingStatus:'ready',assets:{display:{pixelWidth:d.pixelWidth,pixelHeight:d.pixelHeight}}};
  if(source2D){
    const photo=privateHostedPhoto;
    let accepted=false;try{accepted=personalWorkspace.applyPrivateSourcePhoto(photo,{isCurrent:()=>isCurrentPrivateHostedPhoto(photo),onClear:()=>{if(privateHostedPhoto===photo)clearPrivateHostedPhoto();}})===true;}catch{}
    if(!accepted||!isCurrentPrivateHostedPhoto(photo)){clearPrivateHostedPhoto();return false;}
    state.stagePhotoId=null;if(ready)syncStagePhotoPreview();
    return true;
  }
  applyPhotoToView(privateHostedPhoto,true);personalWorkspace?.sync();
  return state.stagePhotoId===payload.photoId;
}

function hostedSelectionInput(preset = null) {
  if (!ready || !planModel || !simulationContext()) return null;
  const context = preset?.context ?? simulationContext();
  if (JSON.stringify(context) !== JSON.stringify(simulationContext())) return null;
  const selected = preset?.state?.seat ?? state.seat;
  const raw = planModel.geometry?.seats?.find(s => s.row === selected.row && s.number === selected.number);
  const hasSource = raw && typeof raw.id === 'string' && Object.hasOwn(planModel,'version') && planModel.version !== null;
  const seats = new Map();
  const add = seat => { if (seat && Number.isSafeInteger(seat.row) && Number.isSafeInteger(seat.number)) seats.set(`${seat.row}:${seat.number}`,{row:seat.row,number:seat.number}); };
  add(selected); const audience = preset?.state?.audienceLayout ?? audienceLayout;
  for (const person of audience?.people ?? []) add(person.seat);
  for (const seat of audience?.excludedSeats ?? []) add(seat); add(audience?.editSeat);
  return { sourceScheme:hasSource?'legacy3d':null, sourceIdentity:hasSource?{kind:'legacy3d',venueId:planModel.venueId,modelId:planModel.modelId,modelVersion:planModel.version,seatId:raw.id}:null,
    localContext:structuredClone(context),localSeats:[...seats.values()],selectedLocalSeat:{row:selected.row,number:selected.number} };
}
export async function configurePrivateHostedConnection(settings = { enabled: false }) {
  if (settings?.enabled === true) return { ok:false, code:'HOSTED_DISABLED_IN_PORTFOLIO' };
  privateHostedMode=settings?.enabled===true;

  privateLensSession?.dispose();privateLensSession=null;privateLensClient?.dispose();privateLensClient=null;
  syncLensStorageNote();
  hostedControls?.dispose(); hostedControls = null; hostedSession?.dispose(); hostedSession = null;
  if (settings?.enabled !== true) return { ok:true, status:'disabled' };
  try {
    let continuityStore;try{continuityStore=createPrivateAuthContinuityStore(window.sessionStorage);}catch{}
    hostedSession = createPrivateHostedSession({ enabled:true,config:settings.config,fetchImpl:fetch,...(continuityStore?{continuityStore}:{}),
      configurePhoto:configurePrivatePhotoLibrary,configureStage:configurePrivateStageWorkspace,
      configureRuntime:configurePrivateRuntimeData,getSelectionInput:hostedSelectionInput,
      configureRegistration:configurePrivatePhotoRegistration,
      configureNotes:client=>personalWorkspace?.configureHostedNotes(client)??{ok:false,code:"NOT_MOUNTED"},
      getCurrentPhotoSelection:currentPrivatePhotoContext,
      onCompareRegisteredPhoto:(payload,options)=>applyPrivateRegisteredPhoto(payload,options,true),
      onApplyRegisteredPhotoFocus:(payload,options)=>applyPrivateRegisteredPhoto(payload,options,false),
      onPrivatePhotosCleared:clearPrivateHostedPhoto });
    privateLensClient=createPrivateLensSettingsClient({enabled:true,config:settings.config,sessionPort:hostedSession.sessionPort,fetchImpl:fetch,clock:Date.now});
    privateLensSession=createPrivateLensSettingsSession({enabled:true,client:privateLensClient,
      getSettings:()=>({version:1,config:lensConfig,favorites:favoriteLenses}),applySettings:applySessionLensSettings,
      restoreLocal:()=>applySessionLensSettings(preservedLocalLensSettings),createRequestId:()=>crypto.randomUUID(),onState:syncLensStorageNote});
    void privateLensSession.start();
    hostedControls = createPrivateHostedControls({ container:$('private-account-controls'),host:hostedSession,
      verifyAccess:async()=>{const data=await (publicModelMode?adminRuntimeData:runtimeData).readJSON('./data/catalog/theater-model-registry.json');normalizeTheaterModelRegistry(data);return true;},
      isActive:()=>adminRoute.isAdmin(),subscribeActive:adminRoute.subscribe });
    return await hostedSession.start();
  } catch { privateLensSession?.dispose();privateLensSession=null;privateLensClient?.dispose();privateLensClient=null;hostedSession?.dispose(); hostedSession=null; hostedControls?.dispose();hostedControls=null;
    syncLensStorageNote();(publicModelMode?adminRuntimeData:runtimeData).configure({}); return {ok:false,code:'INVALID_CONFIGURATION'}; }
}

async function start() {
  const privateBoot=privateHostedSettings.enabled===true&&!publicModelMode;
  if(privateBoot)configurePrivateRuntimeData(null);
  privateRegistrationMounted=true; configurePrivatePhotoRegistration(null);
  window.addEventListener('pagehide', () => { privateRegistrationMounted=false; privateRegistrationUI?.dispose(); privateRegistrationUI=null; });
  window.addEventListener('pageshow', event => { if(event.persisted&&!privateRegistrationUI){privateRegistrationMounted=true;configurePrivatePhotoRegistration(null);} });
  window.addEventListener('pagehide', () => { privatePhotoLibraryUI?.dispose(); privatePhotoLibraryUI = null; });
  window.addEventListener('pageshow', event => { if (event.persisted && privateHostedSettings.enabled === true) void configurePrivateHostedConnection(privateHostedSettings); });
  window.addEventListener('pagehide', () => configurePrivateStageWorkspace(null));
  window.addEventListener('pagehide', () => { privateLensSession?.dispose();privateLensSession=null;privateLensClient?.dispose();privateLensClient=null;hostedControls?.dispose();hostedControls=null;hostedSession?.dispose({preserveContinuity:true});hostedSession=null;(publicModelMode?adminRuntimeData:runtimeData).configure({}); });
  window.addEventListener('focus', () => privateStageController.checkSession());
  window.addEventListener('focus', () => { void hostedSession?.checkSession(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void hostedSession?.checkSession(); });
  document.addEventListener('visibilitychange', () => privateStageController.checkSession());
  window.addEventListener('focus', () => privatePhotoLibraryUI?.checkSession());
  document.addEventListener('visibilitychange', () => privatePhotoLibraryUI?.checkSession());
  if(!privateBoot)try {
    const parsed=normalizeTheaterModelRegistry(await runtimeData.readJSON('./data/catalog/theater-model-registry.json'));theaterModelRegistry=parsed.entries;
    if(parsed.definitions.length)VENUE_CATALOG=parsed.definitions;
    $('venue-select').replaceChildren(...VENUE_CATALOG.map(definition=>new Option(definition.name,definition.id)));
  } catch(error) { console.error('Model registry failed',error); }
  workspaceUI = createWorkspaceUI({ onModeChange: setEditMode, onLayoutChange: scheduleRender });
  fillLensSetup();
  bindControls();
  bindLayoutControls();
  bindPhotos();
  syncControls();
  if(!privateBoot)await setVenue(loadVenuePreference({ allowedVenueIds: VENUE_CATALOG.map(item => item.id) }));
  renderPhotos(photoManager.getSnapshot());
  bindSimulationControls();
  const config = catalogConnectionConfig();
  if (config.connected && config.connectionKind === 'supabase') {
    // Fixed synthetic marker, not a user credential. Never read real keys from
    // URL/meta/storage, and never select a non-loopback service in this bundle.
    config.transport = createSupabaseCatalogTransport(config.supabaseSettings || { supabaseUrl: config.baseUrl, publishableKey: 'sb_publishable_theater3d_synthetic_mock_only' });
    if (config.transport.getConnectionState().state !== 'configured') {
      config.connected = false;
      config.configurationError = 'Supabase 모의 조회 구성이 올바르지 않습니다. 실제 서비스에는 연결하지 않았습니다.';
    }
  }
  const mountPublicPosts=()=>{
    publicPostMount?.dispose();
    publicPostPlaceholder?.destroy(); publicPostPlaceholder=null;
    let container=$('public-seat-posts-host');
    if(!container){container=document.createElement('div');container.id='public-seat-posts-host';$('catalog-panel').querySelector('.catalog-content').append(container);}
    publicPostMount=createPublicSeatPostMount({container,
      settings:publicPostSettings,catalogSettings:publicCatalogSettings,fetchImpl:fetch,
      createId:()=>crypto.randomUUID()});
    publicPostMount.setContext(catalogUI?.getContext()??null);
    // The static demo offers browser-only notes, not an inactive server form.
  };
  mountPublicPosts();
  catalogUI = createCatalogUI({ ...config, onContext: activateCatalogContext, onClear: clearPublicPhoto, onProject: projectPublicPhoto,
    onSelection:context=>publicPostMount?.setContext(context) });
  window.addEventListener('pagehide',()=>{publicPostMount?.dispose();publicPostMount=null;publicPostPlaceholder?.destroy();publicPostPlaceholder=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted)mountPublicPosts();});
  catalogUI.start();
  setupPersonalWorkspace();
  runtimeStarted = true;
  try { await seedPortfolioSamplePhoto(photoManager, currentSeatPhotoContext()); }
  catch { /* Optional example must not prevent the stage or local files from working. */ }
  if (privateHostedSettings.enabled === true) await configurePrivateHostedConnection(privateHostedSettings);
  scheduleRender();
}

start().catch((error) => {
  $('app-error').textContent = '샘플을 시작하지 못했습니다. 로컬 서버에서 페이지를 다시 열어 주세요.';
  $('app-error').hidden = false;
  console.error('Sample initialization failed', error);
});

startPublishedSeatPhotos();
