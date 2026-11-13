import { parsePhotoLabel, readPhotoMetadata } from './photo-metadata.js';
import { sameSeatLabel } from './seat-label.js';
import { normalizeSeatMediaContext } from './seat-media-context.js';
import { processPhotoAssets, PHOTO_ASSET_LIMITS } from './photo-asset-processing.js';

const METADATA_LIMITS = Object.freeze({
  zoomFactor: 32,
  device: 160,
  production: 200,
  captureLocation: 500,
  focalLengthMm: 32,
  focalLength35Mm: 32,
  venueName: 200,
  seatLabel: 100,
  captureDateTime: 64,
  digitalZoomRatio: 32,
  pixelWidth: 32,
  pixelHeight: 32,
  orientation: 8,
  aspectRatio: 32,
  lens: 200,
});

const SEAT_CONTEXT_LIMITS = Object.freeze({
  venueId: 160,
  venueName: METADATA_LIMITS.venueName,
  modelId: 160,
  modelVersion: 160,
  seatId: 160,
  seatLabel: METADATA_LIMITS.seatLabel,
});

function emptyMetadata() {
  return Object.fromEntries(Object.keys(METADATA_LIMITS).map((key) => [key, '']));
}

function safeText(value, maxLength) {
  if (value == null) return '';
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function sanitizeSeatContext(context) {
  if (context === null) return null;
  if (context?.kind === 'source2d') {
    const source = normalizeSeatMediaContext(context);
    if (!source) throw new TypeError('Invalid source seat identity');
    return source;
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) throw new TypeError();
  if (context.source !== undefined && context.source !== 'user_selected') throw new TypeError();
  const selected = {};
  for (const [key, limit] of Object.entries(SEAT_CONTEXT_LIMITS)) {
    const input = key === 'modelVersion' && Number.isFinite(context[key]) && Number.isInteger(context[key])
      ? String(context[key]) : context[key];
    if (typeof input !== 'string' || /[\u0000-\u001f\u007f]/.test(input)) throw new TypeError();
    const value = input.trim();
    // Reject an invalid identity instead of truncating it into another seat/model.
    if (!value || value.length > limit) throw new TypeError();
    selected[key] = value;
  }
  for (const key of ['layoutVersionId', 'productionRunId']) {
    if (context[key] === undefined) continue;
    if (typeof context[key] !== 'string' || !context[key].trim() || context[key].length > 160 || /[\u0000-\u001f\u007f]/.test(context[key])) throw new TypeError();
    selected[key] = context[key];
  }
  return { ...selected, source: 'user_selected' };
}

function copySeatContext(context) {
  return context ? { ...context } : null;
}

/** Originals stay in page memory until explicitly saved to the optional local store. */
export function createPhotoManager({ onChange = () => {}, processor = processPhotoAssets, localStore = null } = {}) {
  const photos = new Map();
  const listeners = new Set();
  const localOperations = new Set();
  let localStorageStatus = localStore ? 'loading' : 'unavailable';
  let localStorageIssues = [];
  let localReady;
  let selectedId = null;
  let errors = [];
  let disposed = false;
  let nextId = 0;
  const pendingMetadata = new Set();
  const pendingProcessing = new Set();
  let processingQueue = Promise.resolve();

  function revokeDerived(item) {
    for (const key of ['displayUrl', 'thumbnailUrl']) {
      if (item[key]) URL.revokeObjectURL(item[key]);
      item[key] = null;
    }
    item.assets = null;
    item.assetBlobs = null;
  }

  function startProcessing(item) {
    item.processingController?.abort();
    const controller = new AbortController(); item.processingController = controller;
    item.processingStatus = 'processing'; item.processingIssues = [];
    const current = () => !disposed && photos.get(item.id) === item && item.processingController === controller && !controller.signal.aborted;
    const pending = processingQueue.then(async () => {
      if (!current()) return;
      let created = [];
      try {
        const result = await processor({ file: item.file, signal: controller.signal });
        if (!current()) return;
        if (!result?.ok) {
          if(item.size>PHOTO_ASSET_LIMITS.maxBytes){item.metadataStatus='read_failed';item.metadataNotes=['큰 파일의 촬영정보 추출을 완료하지 못했습니다. 원본은 유지합니다.'];}
          item.processingStatus = result?.issues?.some(issue => issue.code === 'ABORTED') ? 'cancelled' : 'failed';
          item.processingIssues = (result?.issues || [{ code: 'PROCESSING_FAILED', message: '표시본을 처리하지 못했습니다.' }]).map(issue => ({ code: safeText(issue.code, 80), message: safeText(issue.message, 500) }));
          emit(); return;
        }
        if (result.original?.blob !== item.file || !(result.display?.blob instanceof Blob) || !(result.thumbnail?.blob instanceof Blob)) throw new Error('Invalid processed assets');
        const displayUrl = URL.createObjectURL(result.display.blob); created.push(displayUrl);
        const thumbnailUrl = URL.createObjectURL(result.thumbnail.blob); created.push(thumbnailUrl);
        if (!current()) { for (const url of created) URL.revokeObjectURL(url); return; }
        revokeDerived(item); item.displayUrl = displayUrl; item.thumbnailUrl = thumbnailUrl; created = [];
        item.assets = Object.fromEntries(['original', 'display', 'thumbnail'].map(role => {
          const asset = result[role];
          return [role, { role, sha256: asset.sha256, mediaType: asset.mediaType, byteSize: asset.byteSize, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight, orientation: asset.orientation, exifPolicy: asset.exifPolicy, ...(asset.transformSpec ? { transformSpec: structuredClone(asset.transformSpec) } : {}) }];
        }));
        item.assetBlobs = { original: item.file, display: result.display.blob, thumbnail: result.thumbnail.blob };
        if(item.size>PHOTO_ASSET_LIMITS.maxBytes&&result.metadataRead){
          const parsed=result.metadataRead;
          for(const [key,value] of Object.entries(parsed.metadata))if(METADATA_LIMITS[key]&&!item.manualFields.has(key)){item.metadata[key]=safeText(value,METADATA_LIMITS[key]);item.metadataSources[key]=parsed.sources[key];}
          item.metadataStatus=parsed.status;item.metadataNotes=[...parsed.notes.map(note=>safeText(note,500)),...item.registrationNotes];
        }
        item.processingStatus = 'ready'; emit();
      } catch {
        for (const url of created) URL.revokeObjectURL(url);
        if (current()) { revokeDerived(item); item.processingStatus = 'failed'; item.processingIssues = [{ code: 'PROCESSING_FAILED', message: '표시본을 만들지 못했습니다. 원본과 촬영정보는 유지합니다.' }]; emit(); }
      }
    }).finally(() => pendingProcessing.delete(pending));
    processingQueue = pending.catch(() => {}); pendingProcessing.add(pending);
  }

  async function flushProcessing() {
    while (pendingProcessing.size) await Promise.allSettled([...pendingProcessing]);
    return getSnapshot();
  }

  // Explicit local-management access only. Snapshots and metadata exports never
  // contain these immutable Blob references; no transmission happens here.
  function getReadyAssets(id) {
    const item = photos.get(id);
    if (disposed || !item || item.processingStatus !== 'ready' || !item.assetBlobs) return { ok: false, issues: [{ code: 'NOT_READY', message: '처리가 완료된 사진을 먼저 선택하세요.' }] };
    return { ok: true, value: {
      photo: publicItem(item),
      assets: Object.fromEntries(['original', 'display', 'thumbnail'].map(role => [role, { ...structuredClone(item.assets[role]), blob: item.assetBlobs[role] }]))
    }, issues: [] };
  }

  function cancelProcessing(id) {
    if (!checkActive()) return emit();
    const item = photos.get(id);
    if (item?.processingStatus === 'processing') {
      item.processingController.abort(); item.processingStatus = 'cancelled';
      item.processingIssues = [{ code: 'ABORTED', message: '표시본 처리를 취소했습니다. 원본과 촬영정보는 유지합니다.' }];
    }
    return emit();
  }

  function retryProcessing(id) {
    if (!checkActive()) return emit();
    const item = photos.get(id);
    if (item && ['failed', 'cancelled'].includes(item.processingStatus)) startProcessing(item);
    return emit();
  }

  function publicItem(item) {
    return {
      id: item.id,
      name: item.name,
      size: item.size,
      type: item.type,
      lastModified: item.lastModified,
      url: item.url,
      displayUrl: item.displayUrl,
      thumbnailUrl: item.thumbnailUrl,
      processingStatus: item.processingStatus,
      processingIssues: item.processingIssues.map(issue => ({ ...issue })),
      assets: item.assets ? structuredClone(item.assets) : null,
      metadata: { ...item.metadata },
      metadataSources: { ...item.metadataSources },
      metadataStatus: item.metadataStatus,
      metadataNotes: [...item.metadataNotes],
      seatContext: copySeatContext(item.seatContext),
      localStatus: item.localStatus || 'unsaved',
      hasLocalCopy: Boolean(item.hasLocalCopy),
      localIssues: (item.localIssues || []).map(issue => ({ ...issue })),
    };
  }

  function getSnapshot() {
    const items = Array.from(photos.values(), publicItem);
    return {
      items,
      selectedId,
      selected: items.find((item) => item.id === selectedId) ?? null,
      errors: [...errors],
      localStorageStatus,
      localStorageIssues: localStorageIssues.map(issue => ({ ...issue })),
    };
  }

  function emit() {
    const snapshot = getSnapshot();
    if (typeof onChange === 'function') onChange(snapshot);
    for (const listener of listeners) listener(getSnapshot());
    return snapshot;
  }

  function checkActive() {
    if (!disposed) return true;
    errors = ['사진 관리가 종료되었습니다. 페이지를 다시 열어 주세요.'];
    return false;
  }

  function startMetadataRead(item) {
    if (item.size > PHOTO_ASSET_LIMITS.maxBytes) {
      item.metadataStatus = 'loading';
      item.metadataNotes = ['큰 파일의 촬영정보는 표시본 처리 중 한 번만 읽습니다. 원본은 유지합니다.'];
      return;
    }
    // The synchronous addFiles result is available before any async EXIF update.
    // Resolve by item identity, never by selectedId, which may already have changed.
    const pending = Promise.resolve().then(() => readPhotoMetadata(item.file)).then((parsed) => {
      if (disposed || photos.get(item.id) !== item) return;
      for (const [key, value] of Object.entries(parsed.metadata)) {
        if (METADATA_LIMITS[key] && !item.manualFields.has(key)) {
          item.metadata[key] = safeText(value, METADATA_LIMITS[key]);
          item.metadataSources[key] = parsed.sources[key];
        }
      }
      item.metadataStatus = parsed.status;
      item.metadataNotes = [...parsed.notes.map(note => safeText(note, 500)), ...item.registrationNotes];
      emit();
    }).finally(() => pendingMetadata.delete(pending));
    pendingMetadata.add(pending);
  }

  async function flushMetadata() {
    while (pendingMetadata.size) await Promise.allSettled([...pendingMetadata]);
    return getSnapshot();
  }

  function addFiles(files, { seatContext = null } = {}) {
    if (!checkActive()) return emit();
    errors = [];
    let registration;
    try {
      registration = sanitizeSeatContext(seatContext);
    } catch {
      errors.push('선택한 극장·모델 버전·좌석 정보를 확인해 주세요. 사진은 추가하지 않았습니다.');
      return emit();
    }
    let incoming;
    try {
      if (files == null || typeof files === 'string') throw new TypeError();
      incoming = Array.from(files);
    } catch {
      errors.push('추가할 이미지 파일 목록을 확인해 주세요.');
      return emit();
    }

    for (const file of incoming) {
      const name = safeText(file?.name || '이름 없는 파일', 255);
      const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
      if (/image\/(heic|heif)(?:-sequence)?$/.test(type) || /\.(heic|heif)$/i.test(name)) {
        errors.push(`${name}: HEIC/HEIF 미리보기는 지원하지 않습니다. 원본은 보관하고 비교용 JPEG 또는 PNG를 선택해 주세요.`);
        continue;
      }
      if (!type.startsWith('image/')) {
        errors.push(`${name}: 이미지 MIME 유형을 확인할 수 없습니다. JPEG, PNG, WebP 또는 GIF 파일을 선택해 주세요.`);
        continue;
      }
      if (!file || typeof file.name !== 'string' || !Number.isFinite(file.size) || file.size <= 0) {
        errors.push(`${name}: 비어 있거나 읽을 수 없는 이미지 파일입니다.`);
        continue;
      }

      let url;
      try {
        url = URL.createObjectURL(file);
      } catch {
        errors.push(`${name}: 이 브라우저에서 파일 미리보기를 만들 수 없습니다.`);
        continue;
      }

      const id = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `photo-${Date.now()}-${++nextId}`;
      const label = parsePhotoLabel(name, typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : '');
      const metadata = { ...emptyMetadata(), ...label };
      const metadataSources = Object.fromEntries(Object.entries(label).filter(([, value]) => value).map(([key]) => [key, 'filename']));
      const manualFields = new Set();
      if (registration) {
        for (const key of ['venueName', 'seatLabel']) {
          metadata[key] = registration[key];
          metadataSources[key] = 'seat_selection';
          // Late filename/EXIF reads cannot replace an explicit seat selection.
          manualFields.add(key);
        }
      }
      const item = {
        id,
        name,
        size: file.size,
        type,
        lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
        url,
        file,
        metadata,
        metadataSources,
        metadataStatus: 'loading',
        metadataNotes: [],
        manualFields,
        seatContext: copySeatContext(registration),
        registrationNotes: [],
        displayUrl: null, thumbnailUrl: null, assets: null, assetBlobs: null,
        processingStatus: 'processing', processingIssues: [], processingController: null,
        localStatus: 'unsaved', hasLocalCopy: false, localIssues: [], revision: 0,
      };
      photos.set(id, item);
      selectedId = id;
      startMetadataRead(item);
      startProcessing(item);
    }
    return emit();
  }

  function select(id) {
    if (!checkActive()) return emit();
    errors = [];
    if (id == null) selectedId = null;
    else if (photos.has(id)) selectedId = id;
    else errors.push('선택한 사진을 찾을 수 없습니다.');
    return emit();
  }

  function updateSelected(patch) {
    if (!checkActive()) return emit();
    errors = [];
    const selected = photos.get(selectedId);
    if (!selected) {
      errors.push('먼저 사진을 선택해 주세요.');
      return emit();
    }
    selected.revision = (selected.revision || 0) + 1;
    selected.localStatus = 'unsaved';
    selected.localIssues = [];
    // Accept a direct metadata patch or { metadata: { ... } }.
    const metadata = patch?.metadata ?? patch;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push('사진 촬영조건을 확인해 주세요.');
      return emit();
    }
    for (const [key, limit] of Object.entries(METADATA_LIMITS)) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        selected.metadata[key] = safeText(metadata[key], limit);
        selected.manualFields.add(key);
        selected.metadataSources[key] = 'manual';
      }
    }
    // Compare spelling only within the user's existing venue/layout/seat
    // selection. Preserve its IDs and version; a label cannot create a link.
    if (selected.seatContext && (Object.hasOwn(metadata, 'venueName') || Object.hasOwn(metadata, 'seatLabel')) && (selected.metadata.venueName !== selected.seatContext.venueName
      || !sameSeatLabel(selected.metadata.seatLabel, selected.seatContext.seatLabel))) {
      selected.seatContext = null;
      const note = '극장명 또는 좌석 표시를 수정하여 공식 좌석 연결을 해제했습니다. 새 좌석에 연결하려면 해당 좌석에서 사진을 다시 등록해 주세요.';
      selected.registrationNotes.push(note);
      selected.metadataNotes.push(note);
    }
    return emit();
  }

  function remove(id) {
    if (!checkActive()) return emit();
    errors = [];
    const item = photos.get(id);
    if (!item) {
      errors.push('삭제할 사진을 찾을 수 없습니다.');
      return emit();
    }
    item.processingController?.abort(); revokeDerived(item); URL.revokeObjectURL(item.url);
    photos.delete(id);
    if (selectedId === id) selectedId = photos.keys().next().value ?? null;
    return emit();
  }

  function exportJson() {
    return JSON.stringify({
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      privacyNote: '이 JSON에는 원본과 미리보기 주소가 없습니다. 명시적으로 브라우저에 보관한 원본만 재접속 시 복원됩니다. 브라우저 데이터 삭제나 기기 변경에 대비해 원본을 별도로 보관하세요.',
      photos: Array.from(photos.values(), (item) => ({
        name: item.name,
        size: item.size,
        type: item.type,
        lastModified: item.lastModified,
        metadata: { ...item.metadata },
        metadataSources: { ...item.metadataSources },
        metadataStatus: item.metadataStatus,
        metadataNotes: [...item.metadataNotes],
        seatContext: copySeatContext(item.seatContext),
      })),
    }, null, 2);
  }

  function dispose() {
    if (disposed) return getSnapshot();
    for (const item of photos.values()) { item.processingController?.abort(); revokeDerived(item); URL.revokeObjectURL(item.url); }
    photos.clear();
    selectedId = null;
    errors = [];
    disposed = true;
    localStore?.close?.();
    const snapshot = emit();
    listeners.clear();
    return snapshot;
  }

  const issue = (code, message) => ({ ok: false, issues: [{ code, message }] });
  const copyIssues = result => (result?.issues || [{ code: 'STORAGE_FAILED', message: '브라우저 보관을 완료하지 못했습니다. 원본은 현재 페이지에 유지됩니다.' }])
    .map(value => ({ code: safeText(value.code, 80), message: safeText(value.message, 500) }));

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A listener is required');
    listeners.add(listener); return () => listeners.delete(listener);
  }

  async function restoreLocal() {
    if (!localStore) return getSnapshot();
    let result;
    try { result = await localStore.list(); }
    catch { result = issue('READ_FAILED', '보관한 사진을 읽지 못했습니다. 저장된 원본은 지우지 않았습니다.'); }
    if (disposed) return getSnapshot();
    if (!result?.ok || !Array.isArray(result.value)) {
      localStorageStatus = 'error'; localStorageIssues = copyIssues(result); return emit();
    }
    const restored = [];
    try {
      // Validate the entire batch before changing the in-memory list. No data is
      // deleted or silently skipped when an older/corrupt record cannot load.
      for (const record of result.value) {
        if (!record || record.schemaVersion !== 1 || typeof record.id !== 'string' ||
            !record.id || !(record.original instanceof Blob) || !record.original.size ||
            typeof record.name !== 'string' || typeof record.type !== 'string' ||
            !record.metadata || typeof record.metadata !== 'object' || Array.isArray(record.metadata)) throw Error('Invalid record');
        const seatContext = sanitizeSeatContext(record.seatContext);
        const metadata = emptyMetadata();
        for (const [key, limit] of Object.entries(METADATA_LIMITS)) {
          const value = record.metadata[key] ?? '';
          const storedLimit = ['venueName', 'seatLabel'].includes(key) ? Math.max(limit, 500) : limit;
          if (typeof value !== 'string' || value.length > storedLimit || /[\u0000-\u001f\u007f]/.test(value)) throw Error('Invalid stored metadata');
          metadata[key] = value;
        }
        if (photos.has(record.id)) throw Error('Duplicate record');
        const file = new File([record.original], record.name, { type: record.type, lastModified: record.lastModified ?? 0 });
        restored.push({ id: record.id, name: record.name, size: file.size, type: record.type,
          lastModified: record.lastModified, file, url: null, metadata,
          metadataSources: { ...(record.metadataSources || {}) }, metadataStatus: record.metadataStatus,
          metadataNotes: [...(record.metadataNotes || [])], manualFields: new Set(record.manualFields || []),
          seatContext, registrationNotes: [], displayUrl: null, thumbnailUrl: null, assets: null, assetBlobs: null,
          processingStatus: 'processing', processingIssues: [], processingController: null,
          localStatus: 'saved', hasLocalCopy: true, localIssues: [], revision: 0 });
      }
      for (const item of restored) item.url = URL.createObjectURL(item.file);
    } catch {
      for (const item of restored) if (item.url) URL.revokeObjectURL(item.url);
      localStorageStatus = 'error'; localStorageIssues = copyIssues(issue('CORRUPT_RECORD', '보관 자료의 형식을 확인하지 못했습니다. 기존 원본은 삭제하거나 덮어쓰지 않았습니다.')); return emit();
    }
    for (const item of restored) { photos.set(item.id, item); startProcessing(item); }
    if (!selectedId && restored.length) selectedId = restored[0].id;
    localStorageStatus = 'ready'; localStorageIssues = []; return emit();
  }

  async function saveLocal(id) {
    await localReady;
    if (disposed) return issue('CLOSED', '사진 관리가 종료되었습니다.');
    const item = photos.get(id);
    if (!item) return issue('NOT_FOUND', '보관할 사진을 찾지 못했습니다.');
    if (!localStore || localStorageStatus !== 'ready') return issue('UNAVAILABLE', '브라우저 보관을 사용할 수 없습니다. 원본 파일을 별도로 보관하세요.');
    if (localOperations.has(id)) return issue('BUSY', '이 사진의 보관 작업이 진행 중입니다.');
    localOperations.add(id); item.localStatus = 'saving'; item.localIssues = []; emit();
    try {
      await flushMetadata();
      if (disposed || photos.get(id) !== item) return issue('CLOSED', '사진이 목록에서 바뀌어 보관하지 않았습니다.');
      const revision = item.revision || 0;
      const record = { schemaVersion: 1, id: item.id, name: item.name, type: item.type,
        lastModified: item.lastModified, original: item.file,
        metadata: { ...item.metadata }, metadataSources: { ...item.metadataSources },
        metadataStatus: item.metadataStatus, metadataNotes: [...item.metadataNotes],
        manualFields: [...item.manualFields], seatContext: copySeatContext(item.seatContext),
        savedAt: new Date().toISOString() };
      let result;
      try { result = await localStore.put(record); }
      catch { result = issue('WRITE_FAILED', '브라우저에 보관하지 못했습니다. 현재 페이지의 원본은 유지했습니다.'); }
      if (!disposed && photos.get(id) === item) {
        if (result?.ok) { item.hasLocalCopy = true; item.localStatus = (item.revision || 0) === revision ? 'saved' : 'unsaved'; item.localIssues = []; }
        else { item.localStatus = 'error'; item.localIssues = copyIssues(result); }
      }
      return result;
    } finally { localOperations.delete(id); if (!disposed) emit(); }
  }

  async function deleteLocal(id) {
    await localReady;
    if (disposed) return issue('CLOSED', '사진 관리가 종료되었습니다.');
    if (!localStore || localStorageStatus !== 'ready') return issue('UNAVAILABLE', '브라우저 보관을 사용할 수 없습니다.');
    if (localOperations.has(id)) return issue('BUSY', '이 사진의 보관 작업이 진행 중입니다.');
    const item = photos.get(id); localOperations.add(id);
    if (item) { item.localStatus = 'saving'; item.localIssues = []; emit(); }
    try {
      let result;
      try { result = await localStore.delete(id); }
      catch { result = issue('DELETE_FAILED', '보관본을 지우지 못했습니다. 기존 원본은 유지했습니다.'); }
      if (!disposed && item && photos.get(id) === item) {
        if (result?.ok) { item.hasLocalCopy = false; item.localStatus = 'unsaved'; item.localIssues = []; }
        else { item.localStatus = 'error'; item.localIssues = copyIssues(result); }
      }
      return result;
    } finally { localOperations.delete(id); if (!disposed) emit(); }
  }

  // Defer construction-time callbacks so callers can finish assigning manager/UI.
  localReady = Promise.resolve().then(restoreLocal);
  return { addFiles, select, updateSelected, getSnapshot, getReadyAssets, remove, exportJson, dispose, flushMetadata, whenMetadataReady: flushMetadata, flushProcessing, whenProcessingReady: flushProcessing, cancelProcessing, retryProcessing,
    subscribe, saveLocal, deleteLocal, whenLocalReady: () => localReady };

}
