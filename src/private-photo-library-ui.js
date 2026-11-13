import {copyPrivatePhotoDeletionDescriptor,parsePrivatePhotoDeleteResult} from './private-photo-delete-contract.js';
import {copyPrivatePhotoSourceMetadata,SOURCE_METADATA_FIELDS} from './private-photo-source-metadata.js';
import { focalControlMm } from './camera-config.js';
import { createPrivatePhotoLibrary } from './private-photo-library.js';
import { createPrivatePhotoMemoryProvider } from './private-photo-memory-provider.js';
import {privateRegisteredPhotoMatchesSelection} from './private-photo-registration-read-contract.js';
import {PHOTO_METADATA_FIELDS} from './catalog-repository.js';

const MESSAGES = Object.freeze({
  unconfigured: '실제 연결이 설정되지 않았습니다. 개인 사진은 아직 불러오지 않습니다.',
  idle: '조회할 폴더를 선택하세요.',
  loading: '사진 자료 목록을 불러오는 중입니다.',
  error: '목록을 불러오지 못했습니다. 다시 시도해 주세요.',
  'session-required': '인증 상태를 확인할 수 없어 개인 자료를 비웠습니다.',
});
const EMPTY_TOTALS = Object.freeze({ original: 0, fhdReady: 0, unsupported: 0, uploaded: 0 });
const basename = value => typeof value === 'string' && value.length <= 500 && !/[\\/\u0000-\u001f\u007f]/.test(value) ? value : '이름 표시 불가';
const contextValue = value => value === null || value === undefined || value === '' ? '미확정' : '연결됨';

// No transport, account input, upload or public-catalog repository is created here.
// The default is inert. Private providers enforce their own authorization.
// Local validation is an explicit session binding, never login or DB access.
// Synthetic memory is created only after the separate, explicit sample action.
export function createPrivatePhotoLibraryUI({
  container, provider = null, localValidation = false, clock = Date.now, sha256,
  createLibrary = createPrivatePhotoLibrary, createSampleProvider = createPrivatePhotoMemoryProvider,
  objectURL = globalThis.URL, BlobType = globalThis.Blob,
  IntersectionObserverType = globalThis.IntersectionObserver,
  setIntervalFn = globalThis.setInterval, clearIntervalFn = globalThis.clearInterval,
  registrationReader = null, deleteClient = null, getCurrentPhotoSelection = null,
  onCompareRegisteredPhoto = null, onApplyRegisteredPhotoFocus = null, onPrivatePhotosCleared = null, onCatalogChanged = null,
} = {}) {
  if (!container?.ownerDocument?.createElement) throw new TypeError('PRIVATE_PHOTO_CONTAINER_REQUIRED');
  const doc = container.ownerDocument;
  const localValidationAllowed = localValidation === true && provider !== null
    && Object.getOwnPropertyDescriptor(provider, 'kind')?.value === 'local-validation'
    && Object.getOwnPropertyDescriptor(provider, 'source')?.value === 'local-files';
  const sessionMessage = () => localValidationAllowed && !sample
    ? '로컬 검증 연결 상태를 확인할 수 없어 자료를 비웠습니다.'
    : MESSAGES['session-required'];
  let disposed = false, library = null, ownedSample = null, unsubscribe = null, timer = null;
  let sample = false, epoch = 0, snapshot = null, viewKey = '', observer = null, reloadOnOpen = false;
  const cards = new Map(), listeners = [];
  const node = (tag, part, text = '') => {
    const element = doc.createElement(tag);
    if (part) element.dataset.privatePhoto = part;
    element.textContent = text;
    return element;
  };
  const button = (part, text) => { const element = node('button', part, text); element.type = 'button'; return element; };
  const on = (element, event, handler) => { element.addEventListener(event, handler); listeners.push([element, event, handler]); };
  const root = node('details', 'panel'); root.className = 'private-photo-library catalog-panel card';
  const summary = node('summary', 'summary', '개인 사진 자료함');
  const content = node('div', 'content'); content.className = 'private-photo-content';
  const notice = node('p', 'notice'); notice.className = 'small-note';
  const actions = node('div', 'actions'); actions.className = 'private-photo-actions';
  const sampleButton = button('sample', '샘플 화면 보기 (실제 사진 아님)');
  const stopButton = button('stop-sample', '샘플 종료'); stopButton.hidden = true;
  const status = node('p', 'status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const retry = button('retry', '목록 다시 시도'); retry.hidden = true;
  const totals = node('p', 'totals'); totals.className = 'private-photo-totals';
  const groupLabel = node('label', 'group-label', '폴더 / 자료 그룹');
  const groupSelect = node('select', 'groups'); groupSelect.setAttribute('aria-label', '폴더 또는 자료 그룹 선택');
  groupLabel.append(groupSelect);
  const groupTotals = node('p', 'group-totals'); groupTotals.className = 'small-note';
  const list = node('div', 'items'); list.className = 'private-photo-grid'; list.setAttribute('role', 'list');
  const more = button('more', '더 보기'); more.hidden = true;
  actions.append(sampleButton, stopButton, retry);
  content.append(notice, actions, status, totals, groupLabel, groupTotals, list, more);
  root.append(summary, content); container.append(root);

  function revoke(card) {
    card.controller?.abort(); card.controller = null;
    card.image.removeAttribute('src'); card.image.hidden = true;
    if (card.url) { try { objectURL.revokeObjectURL(card.url); } catch {} card.url = null; }
  }
  function removeCard(card) {
    card.sourceController?.abort();card.sourceController=null;
    card.privateController?.abort();card.privateController=null;card.registration=null;
    for(const [element,event,handler] of card.privateListeners||[])element.removeEventListener(event,handler);
    observer?.unobserve(card.element); revoke(card);
    card.show.removeEventListener('click', card.onShow); card.image.removeEventListener('error', card.onError);
    card.image.alt = ''; card.item = null; card.element.replaceChildren(); card.element.remove();
  }
  function clearCards() {
    observer?.disconnect(); observer = null;
    for (const card of cards.values()) removeCard(card);
    cards.clear(); list.replaceChildren();
  }
  function clearPrivate() {
    try{onPrivatePhotosCleared?.();}catch{}
    epoch++; clearCards(); groupSelect.replaceChildren(); groupSelect.disabled = true;
    groupLabel.hidden = true; totals.textContent = ''; groupTotals.textContent = ''; more.hidden = true;
    viewKey = '';
  }
  function localFailure() {
    if (disposed) return;
    clearPrivate(); snapshot = null; status.textContent = MESSAGES.error; status.dataset.state = 'error'; retry.hidden = true;
  }
  async function checkSession() {
    if (disposed || !library || (!sample && provider === null)) return false;
    const current = library, serial = epoch;
    try {
      const valid = await current.checkSession();
      if (valid !== true && !disposed && current === library && serial === epoch) {
        clearPrivate(); snapshot = null; status.textContent = sessionMessage(); status.dataset.state = 'session-required'; retry.hidden = true;
      }
      return valid === true;
    }
    catch { if (!disposed && current === library && serial === epoch) localFailure(); return false; }
  }
  async function invoke(method, ...args) {
    const current = library;
    try { await current?.[method](...args); }
    catch { if (!disposed && current === library) localFailure(); }
  }
  function totalsText(value = EMPTY_TOTALS) {
    value = value || EMPTY_TOTALS;
    return `원본 목록 ${value.original}개 · FHD 준비 ${value.fhdReady}개 · 미지원 ${value.unsupported}개 · 업로드 확인 ${value.uploaded}개`;
  }
  function mayShow(value) {
    return value?.sessionBound === true && (
      sample ? value.kind === 'synthetic-memory' && value.source === 'simulation'
        : provider !== null && (value.kind === 'configured-private' && value.source === 'private-provider'
          || localValidationAllowed && value.kind === 'local-validation' && value.source === 'local-files')
    );
  }
  function imageFailure(card) {
    revoke(card); card.loading = false;
    card.imageStatus.textContent = '이미지를 표시하지 못했습니다.';
    card.show.textContent = '이미지 다시 보기'; card.show.hidden = false; card.show.disabled = false;
  }
  async function showImage(card) {
    if (disposed || cards.get(card.photoId) !== card || card.loading || card.url || !root.open || !mayShow(snapshot)) return;
    const current = library, serial = epoch, generation = snapshot.generation;
    card.loading = true; card.show.disabled = true; card.imageStatus.textContent = '이미지 불러오는 중';
    const controller = new AbortController(); card.controller = controller;
    const live = () => !disposed && root.open && library === current && epoch === serial && !controller.signal.aborted && cards.get(card.photoId) === card && mayShow(snapshot) && snapshot.generation === generation;
    try {
      if (!await checkSession() || !live()) return;
      const result = await current.getDisplay(card.item.photoId, { signal: controller.signal });
      if (!await checkSession() || !live()) return;
      const display = card.item.display;
      if (!display || result.photoId !== card.item.photoId || result.generation !== generation || result.revision !== display.revision || result.sha256 !== display.sha256 || result.mediaType !== display.mediaType || !(result.bytes instanceof Uint8Array) || result.bytes.byteLength !== display.byteSize || !['image/jpeg', 'image/png', 'image/webp'].includes(result.mediaType)) throw new Error('INVALID_DISPLAY');
      const url = objectURL.createObjectURL(new BlobType([result.bytes], { type: result.mediaType }));
      if (typeof url !== 'string' || !url.startsWith('blob:')) { try { objectURL.revokeObjectURL(url); } catch {} throw new Error('INVALID_OBJECT_URL'); }
      if (!live()) { objectURL.revokeObjectURL(url); return; }
      card.url = url; card.image.src = url; card.image.hidden = false;
      card.show.hidden = true; card.imageStatus.textContent = ''; card.loading = false;
    } catch { if (live()) imageFailure(card); }
    finally { if (live() && !card.url) { card.loading = false; card.show.disabled = false; } }
  }
  function preservedSourceControls(card) {
    if(sample||snapshot?.kind!=='configured-private'||snapshot?.source!=='private-provider'||!card.item.sourceMetadata)return false;
    const metadata=copyPrivatePhotoSourceMetadata(card.item.sourceMetadata);
    const info=button('source-info','보존 촬영정보'),view=node('dl','source-metadata'),note=node('p','source-note');
    view.hidden=true;
    const labels={device:'기기',lens:'렌즈',focalLengthMm:'실제 초점거리(mm)',captureDateTime:'촬영시각 원문',pixelWidth:'원본 가로 픽셀',pixelHeight:'원본 세로 픽셀',orientation:'원본 방향',aspectRatio:'원본 비율',production:'작품 표기',seatLabel:'좌석 표기'};
    const sources={exif:'원본 EXIF',file:'파일 정보',filename:'파일명'};
    const reset=()=>{view.replaceChildren();view.hidden=true;note.textContent='';};
    const show=async()=>{
      if(disposed||!root.open||cards.get(card.photoId)!==card||!mayShow(snapshot))return;
      const serial=epoch,generation=snapshot.generation,current=library;
      if(!await checkSession()||disposed||!root.open||library!==current||epoch!==serial||snapshot?.generation!==generation||cards.get(card.photoId)!==card||!mayShow(snapshot))return;
      view.replaceChildren();
      for(const key of SOURCE_METADATA_FIELDS)if(Object.hasOwn(metadata.metadata,key))
        view.append(node('dt','metadata-label',labels[key]),node('dd','metadata-value',`${metadata.metadata[key]} · 출처: ${sources[metadata.metadataSources[key]]}`));
      view.hidden=false;note.textContent='보존한 촬영정보의 원문입니다. 촬영 시간대와 공연 당시 배치는 미확정이며, 실제 초점거리를 35mm 환산값으로 사용하지 않습니다.';
    };
    const listener=()=>{void show().catch(reset);};
    info.addEventListener('click',listener);card.privateListeners=[[info,'click',listener]];card.privateReset=reset;
    card.element.append(info,note,view);return true;
  }
  function sourceSeatControls(card) {
    if(sample||snapshot?.kind!=='configured-private'||snapshot?.source!=='private-provider'||!card.item.sourceSeatContext||card.item.uploadStatus!=='uploaded'||!card.item.display)return;
    const compare=button('source-seat-compare','선택 좌석에 사진 비교'),note=node('p','source-seat-note');
    const selection=()=>{try{return getCurrentPhotoSelection?.()??null;}catch{return null;}};
    const matches=()=>privateRegisteredPhotoMatchesSelection(card.item?.sourceSeatContext,selection());
    const update=()=>{compare.disabled=!matches()||card.sourceBusy===true;note.textContent=matches()?'현재 선택 좌석에 연결된 개인 사진입니다. 공연 당시 배치는 미확정입니다.':'연결된 좌석을 선택하면 비교할 수 있습니다.';};
    card.sourceUpdate=update;
    const apply=async()=>{
      if(disposed||!root.open||!matches()||card.sourceBusy||!mayShow(snapshot))return;
      const current=library,serial=epoch,generation=snapshot.generation,session=provider.getSession();
      if(!session)return;card.sourceBusy=true;update();
      const controller=new AbortController();card.sourceController=controller;
      const live=()=>!disposed&&root.open&&library===current&&epoch===serial&&!controller.signal.aborted&&cards.get(card.photoId)===card&&snapshot?.generation===generation&&mayShow(snapshot)&&matches();
      try{
        if(!await checkSession()||!live())return;
        const display=await current.getDisplay(card.photoId,{signal:controller.signal});
        const now=provider.getSession(),d=card.item.display;
        if(!await checkSession()||!live()||!now||['projectRef','accountId','epoch'].some(k=>now[k]!==session[k]))return;
        if(display.photoId!==card.photoId||display.generation!==generation||display.revision!==d.revision||display.sha256!==d.sha256||display.mediaType!==d.mediaType||!(display.bytes instanceof Uint8Array)||display.bytes.byteLength!==d.byteSize)throw Error('INVALID_DISPLAY');
        const payload={source:'imported-private',photoId:card.photoId,photoRevision:card.item.revision,session:{projectRef:session.projectRef,accountId:session.accountId,epoch:session.epoch},originalFilename:card.item.originalFilename,
          metadata:{...(card.item.sourceMetadata?.metadata??{})},seatContext:structuredClone(card.item.sourceSeatContext),
          display:{...display,byteSize:display.bytes.byteLength,pixelWidth:d.pixelWidth,pixelHeight:d.pixelHeight}};
        const applied=await onCompareRegisteredPhoto?.(payload,{signal:controller.signal});
        if(live())note.textContent=applied===true?'선택 좌석에 개인 사진을 표시했습니다.':'좌석 선택 상태를 확인해 주세요.';
      }catch{if(live())note.textContent='사진 비교를 완료하지 못했습니다.';}
      finally{card.sourceBusy=false;card.sourceController=null;if(!disposed&&cards.get(card.photoId)===card)compare.disabled=!matches();}
    };
    const listener=()=>{void apply();};compare.addEventListener('click',listener);
    card.privateListeners??=[];card.privateListeners.push([compare,'click',listener]);card.element.append(compare,note);update();
  }
  function importedDeletionControls(card) {
    if(sample||snapshot?.kind!=='configured-private'||snapshot?.source!=='private-provider'||!card.item.deletion
       ||card.item.mediaKind!=='image'||card.item.uploadStatus!=='uploaded'||!card.item.display
       ||typeof deleteClient?.remove!=='function'||typeof deleteClient?.recheck!=='function')return;
    let descriptor;try{descriptor=copyPrivatePhotoDeletionDescriptor(card.item.deletion,card.photoId,card.item.revision);}catch{return;}
    const remove=button('imported-delete','사진 삭제'),cancel=button('imported-delete-cancel','취소'),recheck=button('imported-delete-status','삭제 상태 확인'),note=node('p','imported-delete-note');
    cancel.hidden=true;recheck.hidden=true;let confirming=false,uncertain=false,busy=false,controller=null;
    const payload=Object.freeze({photoId:card.photoId,...descriptor});
    const reset=card.privateReset;
    card.privateReset=()=>{if(busy||uncertain)reloadOnOpen=true;controller?.abort();controller=null;busy=false;confirming=false;uncertain=false;remove.disabled=false;remove.textContent='사진 삭제';cancel.hidden=true;recheck.hidden=true;note.textContent='';reset?.();};
    const listen=(el,fn)=>{el.addEventListener('click',fn);card.privateListeners??=[];card.privateListeners.push([el,'click',fn]);};
    async function work(statusOnly=false){
      if(disposed||busy||!root.open||cards.get(card.photoId)!==card||!mayShow(snapshot)||uncertain&&!statusOnly)return;
      const serial=epoch,generation=snapshot.generation,current=library;controller=new AbortController();card.privateController=controller;const signal=controller.signal;busy=true;remove.disabled=true;cancel.hidden=true;recheck.disabled=true;
      const live=()=>!disposed&&root.open&&!signal.aborted&&epoch===serial&&library===current&&snapshot?.generation===generation&&cards.get(card.photoId)===card&&mayShow(snapshot);
      let sent=false;
      try{
        if(!await checkSession()||!live())return;
        sent=true;const answer=await (statusOnly?deleteClient.recheck(payload,{signal}):deleteClient.remove(payload,{signal}));
        if(!live()||!await checkSession()||!live())return;
        if(answer?.ok===true){
          const result=parsePrivatePhotoDeleteResult({operationId:answer.operationId,photoId:answer.photoId,expectedRevision:answer.expectedRevision,photoRevision:answer.photoRevision,status:answer.status,replayed:answer.replayed},payload);
          if(answer.confirmed===true&&result.status==='deleted'){clearPrivate();snapshot=null;await current.start();try{onCatalogChanged?.();}catch{}return;}
          uncertain=false;note.textContent='삭제되지 않은 상태를 확인했습니다. 다시 확인 후 삭제할 수 있습니다.';
        }else{uncertain=answer?.uncertain===true;note.textContent=uncertain?'삭제 결과가 불확실합니다. 상태 확인 전에는 다시 삭제하지 않습니다.':'삭제하지 못했습니다. 목록을 새로 불러와 상태를 확인하세요.';}
      }catch{if(live()){uncertain=sent;note.textContent=sent?'삭제 결과가 불확실합니다. 상태를 확인하세요.':'삭제 전 인증 확인에 실패했습니다.';}}
      finally{if(live()){busy=false;controller=null;card.privateController=null;confirming=false;remove.textContent='사진 삭제';remove.disabled=uncertain;recheck.hidden=!uncertain;recheck.disabled=false;}}
    }
    listen(remove,()=>{if(busy||uncertain||!root.open||!mayShow(snapshot))return;if(!confirming){confirming=true;remove.textContent='삭제 확인';cancel.hidden=false;note.textContent='이 사진의 목록과 공개 조회를 중단합니다. 원본과 저장 파일은 영구 삭제하지 않습니다.';return;}void work();});
    listen(cancel,()=>{if(busy)return;confirming=false;remove.textContent='사진 삭제';cancel.hidden=true;note.textContent='';});
    listen(recheck,()=>{void work(true);});card.element.append(remove,cancel,recheck,note);
  }
  function registeredControls(card) {
    if(sample||snapshot?.kind!=='configured-private'||snapshot?.source!=='private-provider'||!registrationReader||card.item.uploadStatus!=='uploaded'||!card.item.display)return;
    const info=button('registered-info','등록 정보'),compare=button('registered-compare','좌석 사진 비교'),focus=button('registered-focus','사진 초점 적용');
    const remove=button('registered-delete','등록 사진 삭제'),recheck=button('registered-delete-status','삭제 상태 확인'),note=node('p','registered-note');
    const metadataView=node('dl','registered-metadata');metadataView.hidden=true;
    const labels={production:'작품',venueName:'공연장',seatLabel:'좌석',captureDateTime:'촬영 일시',device:'기기',focalLengthMm:'초점거리(mm)',focalLength35Mm:'35mm 환산 초점거리',zoomFactor:'줌 배율',digitalZoomRatio:'디지털 줌 비율',pixelWidth:'가로 픽셀',pixelHeight:'세로 픽셀',orientation:'방향',aspectRatio:'비율',lens:'렌즈',captureLocation:'촬영 위치 설명'};
    function metadataInfo(r){metadataView.replaceChildren();metadataView.hidden=!r;if(!r)return;const value=r.manifest.registrationSnapshot;
      for(const key of [...PHOTO_METADATA_FIELDS,'captureLocation']){
        const title=node('dt','metadata-label',labels[key]||key),present=Object.hasOwn(value.metadata,key),v=value.metadata[key];
        const text=!present?'기록 없음':v===null?'미확정 (null)':v===''?'빈 값':key==='focalLength35Mm'&&focalControlMm(v)!==null?`${focalControlMm(v)} (반올림)`:String(v);
        const source=Object.hasOwn(value.metadataSources??{},key)?String(value.metadataSources[key]):'출처 기록 없음';
        metadataView.append(title,node('dd','metadata-value',`${text} · 출처: ${source}`));
      }
    }
    compare.hidden=true;focus.hidden=true;remove.hidden=true;recheck.hidden=true;
    card.privateListeners=[];card.registration=null;card.confirming=false;
    const listen=(element,handler)=>{element.addEventListener('click',handler);card.privateListeners.push([element,'click',handler]);};
    const currentSelection=()=>{try{return getCurrentPhotoSelection?.()??null;}catch{return null;}};
    function buttons(){const r=card.registration,source=r?.manifest.registrationSnapshot.seatContext,match=privateRegisteredPhotoMatchesSelection(source,currentSelection());
      compare.hidden=typeof onCompareRegisteredPhoto!=='function'||!r;focus.hidden=typeof onApplyRegisteredPhotoFocus!=='function'||!r;
      compare.textContent=source?.kind==='source2d'?'좌석 사진판에 표시':'좌석 사진 비교';
      compare.disabled=!match;focus.disabled=!match||source?.kind==='source2d';remove.hidden=!r||typeof deleteClient?.remove!=='function';
      if(r&&!match)note.textContent='등록 당시 선택과 현재 선택이 다릅니다. 좌석을 추정해 연결하지 않습니다.';
    }
    card.privateReset=()=>{if(card.privateBusy||card.deleteUncertain)reloadOnOpen=true;card.privateController?.abort();card.privateController=null;card.privateBusy=false;card.registration=null;card.confirming=false;card.deleteUncertain=false;remove.textContent='등록 사진 삭제';recheck.hidden=true;note.textContent='';metadataInfo(null);buttons();};
    async function work(kind){if(disposed||card.privateBusy||cards.get(card.photoId)!==card||!root.open||!mayShow(snapshot))return;
      if(card.deleteUncertain&&kind!=='status'){note.textContent='삭제 상태를 먼저 확인하세요.';return;}
      const serial=epoch,generation=snapshot.generation,current=library;const controller=new AbortController();card.privateController=controller;card.privateBusy=true;
      const live=()=>!disposed&&library===current&&epoch===serial&&snapshot?.generation===generation&&!controller.signal.aborted&&cards.get(card.photoId)===card&&mayShow(snapshot);
      try{if(!await checkSession()||!live())return;
        const r=kind==='status'?card.registration:await current.getRegisteredMetadata(card.photoId,{signal:controller.signal});if(!r||!live()||!await checkSession())return;card.registration=r;
        const registration=r.manifest.registrationSnapshot;metadataInfo(r);buttons();
        if(kind==='info'){note.textContent=privateRegisteredPhotoMatchesSelection(registration.seatContext,currentSelection())?'등록 당시 좌석 선택이 현재 선택과 일치합니다.':'등록 당시 선택과 현재 선택이 다릅니다. 좌석을 추정해 연결하지 않습니다.';return;}
        if(kind==='delete'||kind==='status'){
          const payload={operationId:r.operationId,photoId:r.photoId,expectedRevision:r.photoRevision};
          const answer=await (kind==='delete'?deleteClient.remove(payload,{signal:controller.signal}):deleteClient.recheck(payload,{signal:controller.signal}));
          if(!live()||!await checkSession())return;
          if(answer?.ok===true&&answer.confirmed===true&&answer.status==='deleted'&&answer.photoId===r.photoId){clearPrivate();snapshot=null;await current.start();try{onCatalogChanged?.();}catch{}return;}
          card.confirming=false;card.deleteUncertain=!!answer?.uncertain;remove.textContent='등록 사진 삭제';recheck.hidden=!answer?.uncertain;
          note.textContent=answer?.uncertain?'삭제 결과를 확인하지 못했습니다. 상태 확인 후 다시 진행하세요.':answer?.status==='live'?'삭제되지 않은 상태를 확인했습니다.':'삭제하지 못했습니다. 다시 확인하세요.';return;
        }
        if(!privateRegisteredPhotoMatchesSelection(registration.seatContext,currentSelection())){buttons();return;}
        const display=await current.getDisplay(card.photoId,{signal:controller.signal});
        if(!live()||!await checkSession()||!privateRegisteredPhotoMatchesSelection(registration.seatContext,currentSelection()))return;
        if(display.generation!==generation||display.photoId!==r.photoId||display.revision!==r.displayRevision||!(display.bytes instanceof Uint8Array))throw Error('STALE_DISPLAY');
        const item=card.item.display;
        const payload=Object.freeze({source:'registered-private',photoId:r.photoId,operationId:r.operationId,photoRevision:r.photoRevision,session:r.session,
          originalFilename:r.manifest.original.originalFilename,
          metadata:Object.freeze({...registration.metadata}),...(Object.hasOwn(registration,'metadataSources')?{metadataSources:Object.freeze({...registration.metadataSources})}:{}),seatContext:registration.seatContext,
          display:Object.freeze({bytes:new Uint8Array(display.bytes),mediaType:display.mediaType,sha256:display.sha256,byteSize:display.bytes.byteLength,pixelWidth:item.pixelWidth,pixelHeight:item.pixelHeight,revision:display.revision})});
        const callback=kind==='compare'?onCompareRegisteredPhoto:onApplyRegisteredPhotoFocus;
        const applied=typeof callback==='function'?await callback(payload,{signal:controller.signal}):false;
        if(live())note.textContent=applied===true?'등록 사진을 적용했습니다.':'등록 사진 적용 조건을 확인해 주세요.';
      }catch{if(live()){card.registration=null;metadataInfo(null);buttons();note.textContent=kind==='info'?'이 자료는 원본 보존 자료함의 조회 전용 항목이거나 등록 정보가 준비되지 않았습니다.':'등록 사진 동작을 완료하지 못했습니다.';}}
      finally{if(live()){card.privateBusy=false;card.privateController=null;}}
    }
    listen(info,()=>{void work('info');});listen(compare,()=>{void work('compare');});listen(focus,()=>{void work('focus');});
    listen(remove,()=>{if(!card.registration||card.privateBusy)return;if(!card.confirming){card.confirming=true;remove.textContent='삭제 확인';note.textContent='이 등록 사진의 목록·이미지 전달을 중단합니다. 보존 원본은 지우지 않습니다.';return;}void work('delete');});
    listen(recheck,()=>{void work('status');});
    card.element.append(info,compare,focus,remove,recheck,note,metadataView);
  }
  function addCard(item) {
    const element = node('article', 'item'); element.className = 'private-photo-card'; element.setAttribute('role', 'listitem');
    const title = node('h3', 'filename', basename(item.originalFilename));
    const facts = node('p', 'states', `원본: ${item.originalAvailable ? '목록에 있음' : '미확인'} · FHD: ${item.fhdStatus === 'ready' ? '준비됨' : item.fhdStatus === 'unsupported' ? '미지원' : '아직 준비되지 않음'}`);
    const kind = node('p', 'media-kind', item.mediaKind === 'raw' ? 'RAW · 표시 미지원' : item.mediaKind === 'video' ? '영상 · 표시 미지원' : '이미지');
    const context = node('p', 'context', `좌석: ${contextValue(item.context?.seatId)} · 작품: ${contextValue(item.context?.workId)} · 공연: ${contextValue(item.context?.runId)} · 회차: ${contextValue(item.context?.eventId)}`);
    const upload = node('p', 'upload', `업로드: ${item.uploadStatus === 'uploaded' ? '확인됨' : item.uploadStatus === 'not-uploaded' ? '아직 안 됨' : '미확인'}`);
    const image = node('img', 'image'); image.hidden = true; image.alt = `${sample ? '합성 샘플' : '개인 사진 표시본'} · ${basename(item.originalFilename)}`; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
    const imageStatus = node('p', 'image-status'); imageStatus.setAttribute('aria-live', 'polite');
    const show = button('show-image', '이미지 보기');
    const ready = item.mediaKind === 'image' && item.fhdStatus === 'ready' && item.display !== null;
    show.hidden = !ready;
    if (!ready) imageStatus.textContent = item.fhdStatus === 'unsupported' ? '이 형식은 표시본이 없습니다.' : 'FHD 표시본이 아직 준비되지 않았습니다.';
    const card = { item, photoId: item.photoId, element, image, imageStatus, show, controller: null, url: null, loading: false };
    card.onShow = () => { void showImage(card); };
    card.onError = () => { if (cards.get(card.photoId) === card && card.url) imageFailure(card); };
    show.addEventListener('click', card.onShow);
    image.addEventListener('error', card.onError);
    element.append(title, kind, facts, context, upload);
    if (ready) {
      // Keep the lazy image and its controls in reserved slots. Revealing a
      // verified image must not move the paging button while it is being used.
      const preview = node('div', 'preview'); preview.className = 'private-photo-preview';
      const imageSlot = node('div', 'image-slot'); imageSlot.className = 'private-photo-image-slot';
      const controls = node('div', 'image-controls'); controls.className = 'private-photo-image-controls';
      imageSlot.append(image); controls.append(imageStatus, show);
      preview.append(imageSlot, controls); element.append(preview);
    } else element.append(image, imageStatus, show);
    cards.set(item.photoId, card); list.append(element);
    if(!preservedSourceControls(card))registeredControls(card);
    sourceSeatControls(card);
    importedDeletionControls(card);
    if (ready) observer?.observe(element);
  }
  function installObserver() {
    if (observer || typeof IntersectionObserverType !== 'function') return;
    observer = new IntersectionObserverType(entries => {
      if (disposed || !root.open) return;
      for (const entry of entries) if (entry.isIntersecting) {
        const card = [...cards.values()].find(value => value.element === entry.target);
        if (card) { observer?.unobserve(entry.target); void showImage(card); }
      }
    }, { rootMargin: '100px 0px', threshold: 0.01 });
  }
  function render(value) {
    if (disposed) return;
    snapshot = value;
    root.dataset.state = value.status;
    notice.textContent = sample
      ? '합성 샘플입니다. 실제 사진·로그인·DB가 아니며, 종료하면 샘플 메모리를 비웁니다.'
      : localValidationAllowed ? '개인 로컬 검증 · 실제 로그인·DB 연결 아님. 로컬 연결 상태에 묶인 자료만 표시합니다.'
        : '인증된 개인 자료만 표시합니다. 원본 목록·FHD 준비·업로드 여부는 각각 다릅니다.';
    sampleButton.hidden = sample || provider !== null; stopButton.hidden = !sample;
    const key = JSON.stringify([value.generation, value.selectedGroupId]);
    if (!mayShow(value)) {
      clearPrivate();
      status.textContent = value.status === 'session-required' ? sessionMessage() : MESSAGES[value.status] || sessionMessage();
      status.dataset.state = value.status; retry.hidden = value.status !== 'error';
      return;
    }
    if (key !== viewKey) { epoch++; clearCards(); viewKey = key; }
    const oldOptions = JSON.stringify([...groupSelect.children].map(option => [option.value, option.textContent]));
    const options = [['', '폴더 선택'], ...value.groups.map(group => [group.groupId, group.sourceGroupId === null ? '미분류' : basename(group.label)])];
    if (JSON.stringify(options) !== oldOptions) {
      groupSelect.replaceChildren(...options.map(([id, label]) => { const option = node('option', '', label); option.value = id; option.disabled = id === ''; return option; }));
    }
    groupLabel.hidden = false; groupSelect.disabled = value.status === 'loading' || !value.groups.length;
    groupSelect.value = value.selectedGroupId ?? '';
    totals.textContent = totalsText(value.totals);
    groupTotals.textContent = value.groupTotals ? `선택 그룹 · ${totalsText(value.groupTotals)}` : '';
    const items = value.items;
    const ids = new Set(items.map(item => item.photoId));
    for (const [id, card] of cards) if (!ids.has(id)) { removeCard(card); cards.delete(id); }
    installObserver();
    for (const item of items) {
      const previous = cards.get(item.photoId);
      if (previous && JSON.stringify(previous.item) !== JSON.stringify(item)) { removeCard(previous); cards.delete(item.photoId); }
      if (!cards.has(item.photoId)) addCard(item);
    }
    status.textContent = MESSAGES[value.status] || (value.selectedGroupId === null ? MESSAGES.idle : items.length ? `${items.length}개 표시 중${value.hasMore ? ' · 더 불러올 수 있습니다.' : ''}` : '이 그룹에 표시할 자료가 없습니다.');
    if (value.status === 'ready') status.textContent = value.selectedGroupId === null ? (!value.groups.length ? '등록된 자료 그룹이 없습니다.' : MESSAGES.idle) : items.length ? `${items.length}개 표시 중${value.hasMore ? ' · 더 불러올 수 있습니다.' : ''}` : '이 그룹에 표시할 자료가 없습니다.';
    status.dataset.state = value.status; retry.hidden = value.status !== 'error';
    more.hidden = !value.hasMore; more.disabled = Boolean(value.loadingMore) || value.status === 'loading'; more.textContent = value.loadingMore ? '목록 더 불러오는 중' : '더 보기';
  }
  function disconnect() {
    epoch++; unsubscribe?.(); unsubscribe = null;
    if (timer !== null) { clearIntervalFn(timer); timer = null; }
    const old = library; library = null;
    try { old?.dispose(); } catch {}
    try { ownedSample?.dispose(); } catch {}
    ownedSample = null; clearPrivate(); snapshot = null;
  }
  function connect(nextProvider, isSample) {
    disconnect(); sample = isSample;
    try {
      if (isSample) ownedSample = nextProvider;
      library = createLibrary({ mode: nextProvider === null ? 'none' : 'provider', provider: nextProvider, clock, sha256,
        ...(!isSample&&registrationReader?{registrationReader}:{}),
        ...(!isSample && nextProvider === provider && localValidationAllowed ? { allowLocalValidation: true } : {}) });
      unsubscribe = library.subscribe(render);
      if (nextProvider !== null) {
        timer = setIntervalFn(() => { void checkSession(); for(const card of cards.values())card.sourceUpdate?.(); }, 1000);
        void invoke('start');
      }
    } catch {
      disconnect(); sample = false; stopButton.hidden = true; sampleButton.hidden = provider !== null; localFailure();
    }
  }
  on(sampleButton, 'click', () => {
    if (disposed || sample || provider !== null) return;
    root.open = true;
    try { connect(createSampleProvider({ clock }), true); } catch { localFailure(); }
  });
  on(stopButton, 'click', () => { if (!disposed) connect(null, false); });
  on(retry, 'click', () => { if (!disposed) void invoke('retry'); });
  on(groupSelect, 'change', () => {
    if (disposed || !mayShow(snapshot)) return;
    if (!groupSelect.value) { groupSelect.value = snapshot.selectedGroupId ?? ''; return; }
    epoch++; clearCards();
    void invoke('selectGroup', groupSelect.value);
  });
  on(more, 'click', () => { if (!disposed && !more.disabled) void invoke('loadMore'); });
  on(root, 'toggle', () => {
    if (root.open) {
      if(reloadOnOpen){reloadOnOpen=false;void invoke('start');}
      void checkSession();
      for (const card of cards.values()) if (!card.url && card.item.display) { observer?.unobserve(card.element); observer?.observe(card.element); }
    } else {
      epoch++;
      for (const card of cards.values()) {
        card.privateReset?.();
        revoke(card); card.loading = false; card.show.disabled = false;
        if (card.item.mediaKind === 'image' && card.item.fhdStatus === 'ready' && card.item.display) {
          card.show.hidden = false; card.show.textContent = '이미지 보기'; card.imageStatus.textContent = '';
        }
      }
    }
  });
  connect(provider, false);
  return Object.freeze({
    checkSession,
    refresh(){if(disposed||sample||provider===null)return false;connect(provider,false);return true;},
    dispose() {
      if (disposed) return;
      disposed = true; disconnect();
      for (const [element, event, handler] of listeners) element.removeEventListener(event, handler);
      root.replaceChildren(); root.remove();
    },
  });
}
