import {copyPrivatePhotoDeletionDescriptor} from './private-photo-delete-contract.js';
import {copyPrivatePhotoSourceContext} from './private-photo-source-context.js';
import {copyPrivatePhotoSourceMetadata} from './private-photo-source-metadata.js';
/** Private, in-memory photo-library state. No HTTP, storage, DOM or login.
 * A provider is a trusted injected boundary, not proof of real authentication.
 * The default none mode never inspects or calls that provider.
 */
import {copyPrivatePhotoRegistrationReadResult} from './private-photo-registration-read-contract.js';
export const PRIVATE_PHOTO_PROTOCOL = 'theater3d/private-photo-library/v1';
export const PRIVATE_PHOTO_PROJECT = 'portfolio-demo-disabled';
const MAX_BYTES = 25 * 1024 * 1024;
const COUNTS = ['total', 'original', 'fhdReady', 'uploaded', 'unsupported'];
const CONTEXT = ['venueId', 'layoutVersionId', 'seatId', 'workId', 'runId', 'eventId'];
const ERRORS = new Set(['UNCONFIGURED', 'INVALID_CONFIGURATION', 'SESSION_REQUIRED', 'SESSION_EXPIRED',
  'SESSION_CHANGED', 'ACCESS_DENIED', 'PROJECT_MISMATCH', 'INVALID_RESPONSE', 'SCOPE_MISMATCH',
  'REVISION_MISMATCH', 'CURSOR_INVALID', 'LIMIT_EXCEEDED', 'DUPLICATE_ID', 'PHOTO_UNAVAILABLE',
  'IMAGE_INTEGRITY', 'REQUEST_FAILED', 'ABORTED', 'DISPOSED', 'STALE_REQUEST']);
const ownErrors = new WeakMap();
export function privatePhotoLibraryError(code) {
  const safe = ERRORS.has(code) ? code : 'REQUEST_FAILED';
  const error = new Error('Private photo request rejected');
  Object.defineProperty(error, 'code', { value: safe, enumerable: true });
  ownErrors.set(error, safe); return error;
}
const fail = (code = 'INVALID_RESPONSE') => { throw privatePhotoLibraryError(code); };
const errorCode = error => { try { return ownErrors.get(error) || (ERRORS.has(error?.code) ? error.code : 'REQUEST_FAILED'); } catch { return 'REQUEST_FAILED'; } };
const positive = value => Number.isSafeInteger(value) && value > 0;
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const wellFormed = value => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
function text(value, max = 300, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && (!value || value.trim() !== value))
      || /[\u0000-\u001f\u007f]/u.test(value) || !wellFormed(value)) fail();
  return value;
}
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) fail();
  const out = {};
  for (const key of found) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail();
    out[key] = d.value;
  }
  return out;
}
function rows(value, limit) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) fail('LIMIT_EXCEEDED');
  return Array.from({ length: value.length }, (_, index) => {
    const d = Object.getOwnPropertyDescriptor(value, String(index));
    if (!d || !Object.hasOwn(d, 'value')) fail(); return d.value;
  });
}
function counts(value) {
  const out = fields(value, COUNTS);
  if (COUNTS.some(key => !nonnegative(out[key])) || out.total > 1000000
      || COUNTS.slice(1).some(key => out[key] > out.total)
      || out.fhdReady + out.unsupported > out.total || out.uploaded > out.fhdReady) fail();
  return out;
}
const equalCounts = (a, b) => COUNTS.every(key => a[key] === b[key]);
const frozen = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
};
const copy = value => JSON.parse(JSON.stringify(value));
function sessionValue(value, now) {
  if (value === null) fail('SESSION_REQUIRED');
  const s = fields(value, ['projectRef', 'accountId', 'epoch', 'expiresAt']);
  if (s.projectRef !== PRIVATE_PHOTO_PROJECT) fail('PROJECT_MISMATCH');
  text(s.accountId);
  if (!nonnegative(s.epoch) || !positive(s.expiresAt) || !nonnegative(now) || s.expiresAt <= now) fail('SESSION_EXPIRED');
  return s;
}
const sameSession = (a, b) => a.accountId === b.accountId && a.epoch === b.epoch && a.expiresAt === b.expiresAt;
function groupValue(value) {
  const g = fields(value, ['groupId', 'sourceGroupId', 'label', 'snapshot', 'revision', 'totals']);
  text(g.groupId); text(g.label, 500); text(g.snapshot);
  if (g.sourceGroupId !== null) text(g.sourceGroupId);
  if (!positive(g.revision)) fail(); g.totals = counts(g.totals); return g;
}
function displayValue(value) {
  if (value === null) return null;
  const d = fields(value, ['revision', 'sha256', 'byteSize', 'mediaType', 'pixelWidth', 'pixelHeight']);
  if (!positive(d.revision) || !positive(d.byteSize) || d.byteSize > MAX_BYTES
      || typeof d.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.sha256)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(d.mediaType)
      || !positive(d.pixelWidth) || !positive(d.pixelHeight)
      || Math.max(d.pixelWidth, d.pixelHeight) > 1920 || Math.min(d.pixelWidth, d.pixelHeight) > 1080) fail();
  return d;
}
function photoValue(value, group) {
  const p = fields(value, ['photoId', 'sourceGroupId', 'revision', 'originalFilename', 'mediaKind',
    'originalAvailable', 'fhdStatus', 'uploadStatus', 'context', 'display',...(Object.hasOwn(value,'sourceMetadata')?['sourceMetadata']:[]),...(Object.hasOwn(value,'sourceSeatContext')?['sourceSeatContext']:[]),...(Object.hasOwn(value,'deletion')?['deletion']:[])]);
  text(p.photoId); text(p.originalFilename, 255);
  if (/[/\\]/.test(p.originalFilename) || ['.', '..'].includes(p.originalFilename)) fail();
  if (p.sourceGroupId !== group.sourceGroupId || !positive(p.revision)) fail('SCOPE_MISMATCH');
  if (!['image', 'raw', 'video'].includes(p.mediaKind) || typeof p.originalAvailable !== 'boolean'
      || !['ready', 'not-ready', 'unsupported'].includes(p.fhdStatus)
      || !['not-uploaded', 'uploaded', 'unknown'].includes(p.uploadStatus)) fail();
  if(Object.hasOwn(p,'sourceMetadata'))p.sourceMetadata=copyPrivatePhotoSourceMetadata(p.sourceMetadata);
  if(Object.hasOwn(p,'sourceSeatContext'))p.sourceSeatContext=copyPrivatePhotoSourceContext(p.sourceSeatContext);
  if(Object.hasOwn(p,'deletion')){try{p.deletion=copyPrivatePhotoDeletionDescriptor(p.deletion,p.photoId,p.revision);}catch{fail('INVALID_RESPONSE');}if(p.mediaKind!=='image'||p.uploadStatus!=='uploaded'||!p.display)fail('INVALID_RESPONSE');}
  p.context = fields(p.context, CONTEXT);
  for (const value of Object.values(p.context)) if (value !== null) text(value);
  // Context is supplied identity, never inferred from folder/filename labels.
  p.display = displayValue(p.display);
  if ((p.fhdStatus === 'ready') !== (p.display !== null)
      || p.mediaKind !== 'image' && p.fhdStatus !== 'unsupported'
      || p.uploadStatus === 'uploaded' && p.fhdStatus !== 'ready') fail();
  return p;
}
function measured(items) {
  return { total: items.length, original: items.filter(p => p.originalAvailable).length,
    fhdReady: items.filter(p => p.fhdStatus === 'ready').length,
    uploaded: items.filter(p => p.uploadStatus === 'uploaded').length,
    unsupported: items.filter(p => p.fhdStatus === 'unsupported').length };
}
function cursorValue(value, group, session) {
  if (value === null) return null;
  const c = fields(value, ['token', 'accountId', 'epoch', 'groupId', 'snapshot', 'revision']);
  text(c.token, 1000);
  if (c.accountId !== session.accountId || c.epoch !== session.epoch || c.groupId !== group.groupId
      || c.snapshot !== group.snapshot || c.revision !== group.revision) fail('CURSOR_INVALID');
  return c;
}
async function defaultSha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function imageHeader(bytes, display) {
  if (display.mediaType === 'image/png') {
    if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getUint32(16) === display.pixelWidth && view.getUint32(20) === display.pixelHeight;
  }
  if (display.mediaType === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

export function createPrivatePhotoLibrary(options = {}) {
  const mode = options.mode ?? 'none';
  const listeners = new Set(), active = new Set();
  let provider = null, kind = 'unconfigured', source = null, configError = null;
  let clock = () => Date.now(), sha256 = defaultSha256, pageSize = 24;
  let disposed = false, bound = null, unsubscribe = null, expiryTimer = null, generation = 0, sequence = 0;
  let lastAction = null, pageBusy = false, photoScopes = new Map(), cursors = new Set();
  let current = { status: 'unconfigured', groups: [], selectedGroupId: null, items: [], totals: null,
    groupTotals: null, cursor: null, hasMore: false, loadingMore: false, error: null };
  if (mode !== 'none') {
    try {
      if (mode !== 'provider') fail('INVALID_CONFIGURATION');
      const input = options.provider;
      if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) fail('INVALID_CONFIGURATION');
      provider = {};
      for (const key of ['kind', 'source', 'getSession', 'subscribeSession', 'listGroups', 'listPhotos', 'readDisplay']) {
        const d = Object.getOwnPropertyDescriptor(input, key);
        if (!d || !Object.hasOwn(d, 'value')) fail('INVALID_CONFIGURATION');
        provider[key] = typeof d.value === 'function' ? d.value.bind(input) : d.value;
      }
      kind = provider.kind; source = provider.source;
      // Explicit local validation is a file/session binding, never real login.
      if (!(kind === 'synthetic-memory' && source === 'simulation' || kind === 'configured-private' && source === 'private-provider'
          || kind === 'local-validation' && source === 'local-files' && options.allowLocalValidation === true)
          || ['getSession', 'subscribeSession', 'listGroups', 'listPhotos', 'readDisplay'].some(k => typeof provider[k] !== 'function')) fail('INVALID_CONFIGURATION');
      clock = options.clock ?? clock; sha256 = options.sha256 ?? sha256; pageSize = options.pageSize ?? 24;
      if (typeof clock !== 'function' || typeof sha256 !== 'function' || !positive(pageSize) || pageSize > 50) fail('INVALID_CONFIGURATION');
      current.status = 'idle';
    } catch { provider = null; kind = 'unconfigured'; source = null; configError = 'INVALID_CONFIGURATION'; current.status = 'error'; current.error = { code: configError }; }
  }
  function snapshot() { return frozen({ ...copy(current), kind, source, generation, sessionBound: bound !== null }); }
  function emit(patch = {}) {
    current = { ...current, ...patch }; const value = snapshot();
    for (const listener of listeners) try { listener(value); } catch { /* Observers cannot grant access. */ }
    return value;
  }
  function clearTimer() { if (expiryTimer !== null) clearTimeout(expiryTimer); expiryTimer = null; }
  function cancelRequests() { for (const run of active) run.controller.abort(); active.clear(); pageBusy = false; }
  function invalidate(code = 'SESSION_CHANGED', status = 'session-required') {
    generation++; cancelRequests(); clearTimer(); bound = null; photoScopes.clear(); cursors.clear(); lastAction = null;
    return emit({ status, groups: [], selectedGroupId: null, items: [], totals: null, groupTotals: null,
      cursor: null, hasMore: false, loadingMore: false, error: code ? { code } : null });
  }
  function scheduleExpiry() {
    clearTimer(); if (!bound || disposed) return;
    const delay = Math.max(0, Math.min(2147483647, bound.expiresAt - clock()));
    expiryTimer = setTimeout(() => { if (checkSession()) scheduleExpiry(); }, delay);
    expiryTimer?.unref?.();
  }
  function checkSession() {
    if (!provider || disposed || !bound) return false;
    try {
      if (clock() >= bound.expiresAt) fail('SESSION_EXPIRED');
      const next = sessionValue(provider.getSession(), clock());
      if (!sameSession(bound, next)) fail('SESSION_CHANGED'); return true;
    } catch (error) { invalidate(errorCode(error)); return false; }
  }
  function guard(run) {
    if (disposed) fail('DISPOSED');
    if (run.controller.signal.aborted) fail('ABORTED');
    if (run.generation !== generation) fail('STALE_REQUEST');
    if (!checkSession()) fail(current.error?.code || 'SESSION_REQUIRED');
    if (!sameSession(run.session, bound)) fail('SESSION_CHANGED');
  }
  function runFor(externalSignal) {
    if (!provider) fail(configError || 'UNCONFIGURED');
    if (!checkSession()) fail(current.error?.code || 'SESSION_REQUIRED');
    const controller = new AbortController();
    const run = { controller, generation, session: { ...bound }, cleanup: () => {} };
    if (externalSignal !== undefined) {
      if (!(externalSignal instanceof AbortSignal)) fail('INVALID_RESPONSE');
      const abort = () => controller.abort(); externalSignal.addEventListener('abort', abort, { once: true });
      run.cleanup = () => externalSignal.removeEventListener('abort', abort);
      if (externalSignal.aborted) controller.abort();
    }
    active.add(run); return run;
  }
  async function awaitGuarded(run, operation) {
    guard(run);
    let listener;
    const pending = Promise.resolve().then(() => { guard(run); return operation(); });
    pending.catch(() => {});
    try {
      const cancel = new Promise((_, reject) => {
        listener = () => reject(privatePhotoLibraryError('ABORTED'));
        run.controller.signal.addEventListener('abort', listener, { once: true });
        if (run.controller.signal.aborted) listener();
      });
      const value = await Promise.race([pending, cancel]); guard(run); return value;
    } finally { run.controller.signal.removeEventListener('abort', listener); }
  }
  function finish(run) { run.cleanup(); active.delete(run); }
  function requestFor(run, action, payload) {
    if (sequence >= Number.MAX_SAFE_INTEGER) fail('LIMIT_EXCEEDED');
    return frozen({ protocol: PRIVATE_PHOTO_PROTOCOL, projectRef: PRIVATE_PHOTO_PROJECT,
      accountId: run.session.accountId, epoch: run.session.epoch, requestId: `private-photo-request:${++sequence}`,
      action, payload });
  }
  function envelope(raw, request) {
    const value = fields(raw, ['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action', 'kind', 'source', 'ok', 'result']);
    if (value.projectRef !== PRIVATE_PHOTO_PROJECT) fail('PROJECT_MISMATCH');
    if (['protocol', 'accountId', 'epoch', 'requestId', 'action'].some(key => value[key] !== request[key])
        || value.kind !== kind || value.source !== source || value.ok !== true) fail('SCOPE_MISMATCH');
    return value.result;
  }
  function failed(run, error) {
    if (run.generation !== generation || disposed) return snapshot();
    return emit({ status: 'error', loadingMore: false, error: { code: errorCode(error) } });
  }
  async function start() {
    if (disposed) return snapshot();
    if (!provider) return snapshot();
    invalidate(null, 'loading');
    let run;
    try {
      if (!unsubscribe) {
        const value = provider.subscribeSession(() => { checkSession(); });
        if (typeof value !== 'function') fail('INVALID_CONFIGURATION'); unsubscribe = value;
      }
      bound = sessionValue(provider.getSession(), clock()); scheduleExpiry();
      run = runFor(); lastAction = 'groups';
      const request = requestFor(run, 'private.groups.list', { limit: 50 });
      const raw = await awaitGuarded(run, () => provider.listGroups(request, { signal: run.controller.signal }));
      const result = fields(envelope(raw, request), ['snapshot', 'revision', 'groups', 'totals']);
      text(result.snapshot); if (!positive(result.revision)) fail();
      const groups = rows(result.groups, 50).map(groupValue), totals = counts(result.totals);
      if (new Set(groups.map(g => g.groupId)).size !== groups.length) fail('DUPLICATE_ID');
      const sum = Object.fromEntries(COUNTS.map(k => [k, groups.reduce((a, g) => a + g.totals[k], 0)]));
      if (!equalCounts(sum, totals)) fail();
      guard(run); lastAction = null; return emit({ status: 'ready', groups, totals, error: null });
    } catch (error) {
      if (run) return failed(run, error);
      return invalidate(errorCode(error), ['SESSION_REQUIRED', 'SESSION_EXPIRED'].includes(errorCode(error)) ? 'session-required' : 'error');
    } finally { if (run) finish(run); }
  }
  async function page(group, cursor) {
    let run;
    try {
      run = runFor(); pageBusy = true; lastAction = { groupId: group.groupId, cursor: copy(cursor) };
      emit({ status: 'loading', loadingMore: cursor !== null, error: null });
      const request = requestFor(run, 'private.photos.list', { groupId: group.groupId, snapshot: group.snapshot,
        revision: group.revision, cursor: copy(cursor), limit: pageSize });
      const raw = await awaitGuarded(run, () => provider.listPhotos(request, { signal: run.controller.signal }));
      const result = fields(envelope(raw, request), ['groupId', 'snapshot', 'revision', 'items', 'totals', 'nextCursor']);
      if (result.groupId !== group.groupId || result.snapshot !== group.snapshot) fail('SCOPE_MISMATCH');
      if (result.revision !== group.revision) fail('REVISION_MISMATCH');
      const totals = counts(result.totals); if (!equalCounts(totals, group.totals)) fail();
      const items = rows(result.items, pageSize).map(value => photoValue(value, group));
      const all = [...current.items, ...items];
      if (new Set(all.map(p => p.photoId)).size !== all.length) fail('DUPLICATE_ID');
      for (const item of items) {
        const prior = photoScopes.get(item.photoId);
        if (prior && (prior.groupId !== group.groupId || prior.fingerprint !== JSON.stringify(item))) fail('SCOPE_MISMATCH');
      }
      const nextCursor = cursorValue(result.nextCursor, group, run.session);
      if (nextCursor && (!items.length || cursors.has(nextCursor.token))) fail('CURSOR_INVALID');
      const actual = measured(all);
      if (COUNTS.some(k => actual[k] > totals[k]) || nextCursor === null && !equalCounts(actual, totals)
          || nextCursor !== null && actual.total >= totals.total) fail();
      guard(run);
      for (const item of items) photoScopes.set(item.photoId, { groupId: group.groupId, fingerprint: JSON.stringify(item) });
      if (nextCursor) cursors.add(nextCursor.token);
      lastAction = null;
      return emit({ status: 'ready', items: all, groupTotals: totals, cursor: nextCursor,
        hasMore: nextCursor !== null, loadingMore: false, error: null });
    } catch (error) {
      if (run) return failed(run, error);
      return snapshot();
    } finally { if (run) { finish(run); if (run.generation === generation) pageBusy = false; } }
  }
  async function selectGroup(groupId) {
    if (disposed || !provider || !checkSession()) return snapshot();
    const group = current.groups.find(g => g.groupId === groupId);
    if (!group) return emit({ status: 'error', error: { code: 'SCOPE_MISMATCH' } });
    generation++; cancelRequests(); cursors.clear();
    emit({ selectedGroupId: groupId, items: [], groupTotals: group.totals, cursor: null, hasMore: false, loadingMore: false, error: null });
    return page(group, null);
  }
  async function loadMore() {
    if (disposed || !provider || pageBusy || !current.hasMore || !checkSession()) return snapshot();
    const group = current.groups.find(g => g.groupId === current.selectedGroupId);
    return group ? page(group, current.cursor) : snapshot();
  }
  async function retry() {
    if (lastAction === 'groups') return start();
    if (lastAction && !pageBusy && checkSession()) {
      const group = current.groups.find(g => g.groupId === lastAction.groupId);
      if (group) return page(group, lastAction.cursor);
    }
    return snapshot();
  }
  async function getDisplay(photoId, { signal } = {}) {
    const run = runFor(signal);
    try {
      const photo = current.items.find(p => p.photoId === photoId);
      const group = current.groups.find(g => g.groupId === current.selectedGroupId);
      if (!photo?.display || photo.fhdStatus !== 'ready' || !group) fail('PHOTO_UNAVAILABLE');
      const display = photo.display;
      const request = requestFor(run, 'private.photo.display', { groupId: group.groupId, snapshot: group.snapshot,
        groupRevision: group.revision, photoId: photo.photoId, photoRevision: photo.revision, displayRevision: display.revision });
      const raw = await awaitGuarded(run, () => provider.readDisplay(request, { signal: run.controller.signal }));
      const result = fields(envelope(raw, request), ['groupId', 'snapshot', 'groupRevision', 'photoId', 'photoRevision',
        'displayRevision', 'mediaType', 'byteSize', 'sha256', 'pixelWidth', 'pixelHeight', 'bytes']);
      if (Object.keys(request.payload).some(k => result[k] !== request.payload[k])) fail('SCOPE_MISMATCH');
      if (['mediaType', 'byteSize', 'sha256', 'pixelWidth', 'pixelHeight'].some(k => result[k] !== display[k])) fail('IMAGE_INTEGRITY');
      if (!(result.bytes instanceof Uint8Array) || Object.getPrototypeOf(result.bytes) !== Uint8Array.prototype
          || result.bytes.byteLength !== display.byteSize || result.bytes.byteLength > MAX_BYTES) fail('IMAGE_INTEGRITY');
      const bytes = new Uint8Array(result.bytes);
      if (!imageHeader(bytes, display)) fail('IMAGE_INTEGRITY');
      const digest = await awaitGuarded(run, () => sha256(new Uint8Array(bytes)));
      if (digest !== display.sha256) fail('IMAGE_INTEGRITY');
      guard(run);
      return Object.freeze({ photoId, mediaType: display.mediaType, bytes, byteSize: bytes.byteLength,
        revision: display.revision, sha256: digest, generation: run.generation });
    } catch (error) { throw privatePhotoLibraryError(errorCode(error)); }
    finally { finish(run); }
  }
  async function getRegisteredMetadata(photoId, {signal} = {}) {
    const run=runFor(signal);
    try {
      const photo=current.items.find(p=>p.photoId===photoId);
      if(kind!=='configured-private'||source!=='private-provider'||!photo?.display||photo.uploadStatus!=='uploaded')fail('PHOTO_UNAVAILABLE');
      const reader=options.registrationReader;
      const d=reader&&Object.getOwnPropertyDescriptor(reader,'read');
      if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')fail('UNCONFIGURED');
      const account=reader&&Object.getOwnPropertyDescriptor(reader,'getSession');
      const readerSession=()=>{if(!account||!Object.hasOwn(account,'value')||typeof account.value!=='function')fail('INVALID_CONFIGURATION');
        const s=account.value.call(reader);if(!s||s.projectRef!==PRIVATE_PHOTO_PROJECT||s.accountId!==run.session.accountId)fail('SESSION_CHANGED');return s;};
      const reading=readerSession();
      const payload={photoId,photoRevision:photo.revision,displayRevision:photo.display.revision};
      const result=copyPrivatePhotoRegistrationReadResult(await awaitGuarded(run,()=>d.value.call(reader,payload,{signal:run.controller.signal})),payload);
      const latest=readerSession();if(!sameSession(reading,latest))fail('SESSION_CHANGED');
      guard(run);return Object.freeze({...result,generation:run.generation,session:Object.freeze({accountId:run.session.accountId,epoch:run.session.epoch})});
    }catch(error){throw privatePhotoLibraryError(errorCode(error));}finally{finish(run);}
  }
  return Object.freeze({
    subscribe(listener) { if (typeof listener !== 'function') return () => {}; listeners.add(listener); try { listener(snapshot()); } catch {} return () => listeners.delete(listener); },
    getSnapshot() { if (bound && clock() >= bound.expiresAt) invalidate('SESSION_EXPIRED'); return snapshot(); },
    start, selectGroup, loadMore, retry, getDisplay, getRegisteredMetadata, checkSession,
    dispose() { if (disposed) return; disposed = true; invalidate('DISPOSED', 'disposed'); try { unsubscribe?.(); } catch {} unsubscribe = null; listeners.clear(); },
  });
}
