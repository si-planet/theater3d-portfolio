import {copyPrivatePhotoDeletionDescriptor} from './private-photo-delete-contract.js';
import {copyPrivatePhotoSourceContext} from './private-photo-source-context.js';
import {copyPrivatePhotoSourceMetadata} from './private-photo-source-metadata.js';
/** Private HTTP boundary. Disabled by default; no global fetch, storage or login.
 * Session/key/transport are injected at runtime. A session claim is not server
 * authorization: the server must verify its bearer token and canonical access.
 */
import { PRIVATE_PHOTO_PROTOCOL, PRIVATE_PHOTO_PROJECT, privatePhotoLibraryError } from './private-photo-library.js';
import {PRIVATE_PHOTO_REGISTRATION_READ_ACTION as READ,PRIVATE_PHOTO_REGISTRATION_READ_ENDPOINT as READ_PATH,copyPrivatePhotoRegistrationReadPayload,copyPrivatePhotoRegistrationReadResult} from './private-photo-registration-read-contract.js';

export const PRIVATE_PHOTO_ENDPOINT = '/functions/v1/theater3d-private-library';
const ORIGIN = `https://${PRIVATE_PHOTO_PROJECT}.supabase.co`;
const KIND = 'configured-private', SOURCE = 'private-provider';
const MAX_BYTES = 25 * 1024 * 1024, MAX_JSON = 2 * 1024 * 1024, MAX_HEADER = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const positive = v => Number.isSafeInteger(v) && v > 0;
const localErrors = new WeakSet();
const fail = code => { const error = privatePhotoLibraryError(code); localErrors.add(error); throw error; };
const copy = v => JSON.parse(JSON.stringify(v));

function exact(value, keys, code = 'INVALID_RESPONSE') {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)) fail(code);
  const found = Reflect.ownKeys(value);
  if (found.length !== keys.length || found.some(k => typeof k !== 'string' || !keys.includes(k))) fail(code);
  const out = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail(code);
    out[k] = d.value;
  }
  return out;
}
function text(value, max = 300) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max
      || /[\u0000-\u001f\u007f]/u.test(value)
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('INVALID_RESPONSE');
  return value;
}
function rows(value, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max
      || Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_RESPONSE');
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('INVALID_RESPONSE'); return d.value;
  });
}
function counts(value) {
  const c = exact(value, ['total', 'original', 'fhdReady', 'uploaded', 'unsupported']);
  if (Object.values(c).some(v => !Number.isSafeInteger(v) || v < 0) || c.total > 1000000
      || Object.values(c).some(v => v > c.total) || c.fhdReady + c.unsupported > c.total || c.uploaded > c.fhdReady) fail('INVALID_RESPONSE');
  return c;
}
function cursor(value, request) {
  if (value === null) return null;
  const c = exact(value, ['token', 'accountId', 'epoch', 'groupId', 'snapshot', 'revision']);
  text(c.token, 1000);
  if (c.accountId !== request.accountId || c.epoch !== request.epoch || c.groupId !== request.payload.groupId
      || c.snapshot !== request.payload.snapshot || c.revision !== request.payload.revision) fail('CURSOR_INVALID');
  return c;
}
function display(value) {
  if (value === null) return null;
  const d = exact(value, ['revision', 'sha256', 'byteSize', 'mediaType', 'pixelWidth', 'pixelHeight']);
  if (!positive(d.revision) || !positive(d.byteSize) || d.byteSize > MAX_BYTES
      || typeof d.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(d.sha256)
      || !['image/png', 'image/jpeg', 'image/webp'].includes(d.mediaType)
      || !positive(d.pixelWidth) || !positive(d.pixelHeight)
      || Math.max(d.pixelWidth, d.pixelHeight) > 1920 || Math.min(d.pixelWidth, d.pixelHeight) > 1080) fail('INVALID_RESPONSE');
  return d;
}
function requestValue(value, action, session) {
  const r = exact(value, ['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action', 'payload']);
  if (r.projectRef !== PRIVATE_PHOTO_PROJECT) fail('PROJECT_MISMATCH');
  if (r.protocol !== PRIVATE_PHOTO_PROTOCOL || r.action !== action || r.accountId !== session.accountId || r.epoch !== session.epoch) fail('ACCESS_DENIED');
  if (typeof r.requestId !== 'string' || r.requestId.length > 80 || !/^private-photo-request:[1-9][0-9]*$/.test(r.requestId)) fail('INVALID_RESPONSE');
  if (action === 'private.groups.list') {
    r.payload = exact(r.payload, ['limit']);
  } else if (action === 'private.photos.list') {
    r.payload = exact(r.payload, ['groupId', 'snapshot', 'revision', 'cursor', 'limit']);
    text(r.payload.groupId); text(r.payload.snapshot); if (!positive(r.payload.revision)) fail('INVALID_RESPONSE');
    r.payload.cursor = cursor(r.payload.cursor, r);
  } else if (action === READ) {
    r.payload = copyPrivatePhotoRegistrationReadPayload(r.payload);
  } else {
    r.payload = exact(r.payload, ['groupId', 'snapshot', 'groupRevision', 'photoId', 'photoRevision', 'displayRevision']);
    for (const k of ['groupId', 'snapshot', 'photoId']) text(r.payload[k]);
    for (const k of ['groupRevision', 'photoRevision', 'displayRevision']) if (!positive(r.payload[k])) fail('INVALID_RESPONSE');
  }
  if (action !== 'private.photo.display' && action !== READ && (!positive(r.payload.limit) || r.payload.limit > 50)) fail('LIMIT_EXCEEDED');
  return r;
}
function resultValue(raw, request) {
  const e = exact(raw, ['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action', 'kind', 'source', 'ok', 'result']);
  if (e.projectRef !== PRIVATE_PHOTO_PROJECT) fail('PROJECT_MISMATCH');
  if (['protocol', 'accountId', 'epoch', 'requestId', 'action'].some(k => e[k] !== request[k])
      || e.kind !== KIND || e.source !== SOURCE || e.ok !== true) fail('SCOPE_MISMATCH');
  if (request.action === 'private.groups.list') {
    const r = exact(e.result, ['snapshot', 'revision', 'groups', 'totals']);
    text(r.snapshot); if (!positive(r.revision)) fail('INVALID_RESPONSE'); r.totals = counts(r.totals);
    r.groups = rows(r.groups, request.payload.limit).map(value => {
      const g = exact(value, ['groupId', 'sourceGroupId', 'label', 'snapshot', 'revision', 'totals']);
      text(g.groupId); if (g.sourceGroupId !== null) text(g.sourceGroupId); text(g.label, 500); text(g.snapshot);
      if (g.snapshot !== r.snapshot || g.revision !== r.revision || /^(?:https?:|file:|\/Users\/)/.test(g.label)) fail('INVALID_RESPONSE');
      g.totals = counts(g.totals); return g;
    });
    if (new Set(r.groups.map(g => g.groupId)).size !== r.groups.length) fail('DUPLICATE_ID');
    e.result = r;
  } else if (request.action === 'private.photos.list') {
    const r = exact(e.result, ['groupId', 'snapshot', 'revision', 'items', 'totals', 'nextCursor']);
    if (['groupId', 'snapshot', 'revision'].some(k => r[k] !== request.payload[k])) fail('SCOPE_MISMATCH');
    r.totals = counts(r.totals); r.nextCursor = cursor(r.nextCursor, request);
    r.items = rows(r.items, request.payload.limit).map(value => {
      const p = exact(value, ['photoId', 'sourceGroupId', 'revision', 'originalFilename', 'mediaKind',
        'originalAvailable', 'fhdStatus', 'uploadStatus', 'context', 'display',...(Object.hasOwn(value,'sourceMetadata')?['sourceMetadata']:[]),...(Object.hasOwn(value,'sourceSeatContext')?['sourceSeatContext']:[]),...(Object.hasOwn(value,'deletion')?['deletion']:[])]);
      text(p.photoId); if (p.sourceGroupId !== null) text(p.sourceGroupId); text(p.originalFilename, 255);
      if (/[/\\]/.test(p.originalFilename) || ['.', '..'].includes(p.originalFilename) || !positive(p.revision)
          || !['image', 'raw', 'video'].includes(p.mediaKind) || typeof p.originalAvailable !== 'boolean'
          || !['ready', 'not-ready', 'unsupported'].includes(p.fhdStatus)
          || !['not-uploaded', 'uploaded', 'unknown'].includes(p.uploadStatus)) fail('INVALID_RESPONSE');
  if(Object.hasOwn(p,'sourceMetadata'))p.sourceMetadata=copyPrivatePhotoSourceMetadata(p.sourceMetadata);
      if(Object.hasOwn(p,'sourceSeatContext'))p.sourceSeatContext=copyPrivatePhotoSourceContext(p.sourceSeatContext);
  if(Object.hasOwn(p,'deletion')){try{p.deletion=copyPrivatePhotoDeletionDescriptor(p.deletion,p.photoId,p.revision);}catch{fail('INVALID_RESPONSE');}if(p.mediaKind!=='image'||p.uploadStatus!=='uploaded'||!p.display)fail('INVALID_RESPONSE');}
      p.context = exact(p.context, ['venueId', 'layoutVersionId', 'seatId', 'workId', 'runId', 'eventId']);
      for (const v of Object.values(p.context)) if (v !== null) text(v);
      p.display = display(p.display);
      if ((p.fhdStatus === 'ready') !== (p.display !== null) || p.mediaKind !== 'image' && p.fhdStatus !== 'unsupported'
          || p.uploadStatus === 'uploaded' && p.fhdStatus !== 'ready') fail('INVALID_RESPONSE');
      return p;
    });
    if (new Set(r.items.map(p => p.photoId)).size !== r.items.length) fail('DUPLICATE_ID');
    e.result = r;
  } else if (request.action === READ) {
    e.result = copyPrivatePhotoRegistrationReadResult(e.result, request.payload);
  } else {
    const r = exact(e.result, ['groupId', 'snapshot', 'groupRevision', 'photoId', 'photoRevision', 'displayRevision',
      'mediaType', 'byteSize', 'sha256', 'pixelWidth', 'pixelHeight']);
    if (Object.keys(request.payload).some(k => r[k] !== request.payload[k])) fail('SCOPE_MISMATCH');
    display({ revision: r.displayRevision, ...Object.fromEntries(['mediaType', 'byteSize', 'sha256', 'pixelWidth', 'pixelHeight'].map(k => [k, r[k]])) });
    e.result = r;
  }
  return e;
}

export function createPrivatePhotoHttpProvider(options = {}) {
  const descriptor = options && Object.getOwnPropertyDescriptor(options, 'enabled');
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('INVALID_CONFIGURATION');
  const enabled = descriptor?.value;
  if (enabled === undefined || enabled === false) {
    return Object.freeze({ kind: KIND, source: SOURCE, getSession: () => null, subscribeSession: () => () => {},
      listGroups: async () => fail('UNCONFIGURED'), listPhotos: async () => fail('UNCONFIGURED'),
      readDisplay: async () => fail('UNCONFIGURED'), readRegisteredMetadata: async () => fail('UNCONFIGURED'), dispose() {} });
  }
  if (enabled !== true || !options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail('INVALID_CONFIGURATION');
  const keys = Reflect.ownKeys(options);
  if (keys.some(k => !['enabled', 'projectRef', 'supabaseUrl', 'publishableKey', 'fetchImpl', 'sessionPort', 'clock'].includes(k))) fail('INVALID_CONFIGURATION');
  const input = exact(options, keys, 'INVALID_CONFIGURATION');
  if (input.projectRef !== PRIVATE_PHOTO_PROJECT || input.supabaseUrl !== ORIGIN
      || typeof input.publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(input.publishableKey)
      || typeof input.fetchImpl !== 'function') fail('INVALID_CONFIGURATION');
  const port = exact(input.sessionPort, ['getSession', 'subscribeSession', 'getAccessToken'], 'INVALID_CONFIGURATION');
  if (Object.values(port).some(fn => typeof fn !== 'function')) fail('INVALID_CONFIGURATION');
  for (const key of Object.keys(port)) port[key] = port[key].bind(input.sessionPort);
  const clock = input.clock ?? (() => Date.now()); if (typeof clock !== 'function') fail('INVALID_CONFIGURATION');
  const listeners = new Set(), active = new Set(), deniedEpochs = new Map();
  let current = null, disposed = false, unsubscribe = null;
  const same = (a, b) => a === null && b === null || a && b && Object.keys(a).every(k => a[k] === b[k]);
  function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_CONFIGURATION'); return value; }
  function notify() { for (const listener of listeners) try { listener(); } catch {} }
  function clear() { current = null; for (const c of active) c.abort(); active.clear(); notify(); }
  function getSession() {
    if (disposed) return null;
    let next = null;
    try {
      const value = port.getSession();
      if (value !== null) {
        next = exact(value, ['projectRef', 'accountId', 'epoch', 'expiresAt']);
        if (next.projectRef !== PRIVATE_PHOTO_PROJECT || typeof next.accountId !== 'string' || !UUID.test(next.accountId)
            || !Number.isSafeInteger(next.epoch) || next.epoch < 0 || !positive(next.expiresAt) || next.expiresAt <= now()
            || next.epoch <= (deniedEpochs.get(next.accountId) ?? -1)) next = null;
      }
    } catch { next = null; }
    if (!same(next, current)) {
      current = next; for (const c of active) c.abort(); active.clear(); notify();
    }
    return current ? { ...current } : null;
  }
  function rejectSession(session) {
    deniedEpochs.set(session.accountId, Math.max(session.epoch, deniedEpochs.get(session.accountId) ?? -1));
    clear();
  }
  function begin(signal) {
    if (disposed) fail('DISPOSED');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('INVALID_RESPONSE');
    if (signal?.aborted) fail('ABORTED');
    const session = getSession(); if (!session) fail('SESSION_REQUIRED');
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); active.add(controller);
    return { session, controller, cleanup() { signal?.removeEventListener('abort', abort); active.delete(controller); } };
  }
  function guard(run) {
    if (disposed) fail('DISPOSED');
    if (run.controller.signal.aborted) fail('ABORTED');
    if (!same(getSession(), run.session)) fail('SESSION_CHANGED');
    if (run.controller.signal.aborted) fail('ABORTED');
  }
  async function wait(run, operation) {
    guard(run); let abort;
    const task = Promise.resolve().then(() => { guard(run); return operation(); }); task.catch(() => {});
    try {
      const canceled = new Promise((_, reject) => {
        abort = () => reject(privatePhotoLibraryError('ABORTED'));
        run.controller.signal.addEventListener('abort', abort, { once: true });
        if (run.controller.signal.aborted) abort();
      });
      const value = await Promise.race([task, canceled]); guard(run); return value;
    } finally { run.controller.signal.removeEventListener('abort', abort); }
  }
  async function bodyBytes(response, maximum, run) {
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum)) fail('INVALID_RESPONSE');
    if (typeof response.body?.getReader !== 'function') fail('INVALID_RESPONSE');
    const reader = response.body.getReader(), parts = []; let size = 0, finished = false;
    try {
      while (true) {
        const chunk = await wait(run, () => reader.read());
        if (chunk.done) { finished = true; break; }
        if (!(chunk.value instanceof Uint8Array) || Object.getPrototypeOf(chunk.value) !== Uint8Array.prototype) fail('INVALID_RESPONSE');
        size += chunk.value.length; if (size > maximum) fail('INVALID_RESPONSE'); parts.push(new Uint8Array(chunk.value));
      }
      // Native fetch may decode HTTP content-codings; decoded stream caps and
      // application byte/hash contracts, not encoded Content-Length, prove bounds.
      if (!(response instanceof Response) && length !== null && Number(length) !== size) fail('INVALID_RESPONSE');
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return bytes;
    } finally {
      if (!finished) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  }
  async function send(action, raw, { signal } = {}) {
    const run = begin(signal); let token = null;
    try {
      const endpoint = action === READ ? READ_PATH : PRIVATE_PHOTO_ENDPOINT;
      const request = requestValue(raw, action, run.session);
      token = await wait(run, () => port.getAccessToken());
      if (typeof token !== 'string' || token.length < 16 || token.length > 8192
          || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        rejectSession(run.session); fail('SESSION_REQUIRED');
      }
      const response = await wait(run, () => (0, input.fetchImpl)(ORIGIN + endpoint, {
        method: 'POST', headers: { apikey: input.publishableKey, Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json', Accept: action === 'private.photo.display' ? 'image/png, image/jpeg, image/webp' : 'application/json' },
        body: JSON.stringify(request), signal: run.controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      }));
      token = null;
      if (!response || !Number.isSafeInteger(response.status) || typeof response.headers?.get !== 'function'
          || response.redirected === true || response.url && response.url !== ORIGIN + endpoint) fail('INVALID_RESPONSE');
      if (response.status === 401 || response.status === 403) {
        rejectSession(run.session); fail(response.status === 401 ? 'SESSION_REQUIRED' : 'ACCESS_DENIED');
      }
      if (response.status !== 200 || response.ok !== true) {
        const code = { 404: 'PHOTO_UNAVAILABLE', 409: 'REVISION_MISMATCH', 413: 'LIMIT_EXCEEDED', 429: 'REQUEST_FAILED' }[response.status];
        fail(code || 'REQUEST_FAILED'); // Upstream error bodies are never read.
      }
      const type = response.headers.get('Content-Type');
      if (action !== 'private.photo.display') {
        if (typeof type !== 'string' || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)) fail('INVALID_RESPONSE');
        const bytes = await bodyBytes(response, MAX_JSON, run);
        let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_RESPONSE'); }
        const result = resultValue(value, request); guard(run); return copy(result);
      }
      const header = response.headers.get('X-Theater3D-Envelope');
      if (typeof header !== 'string' || header.length > MAX_HEADER) fail('INVALID_RESPONSE');
      let value; try { value = JSON.parse(decodeURIComponent(header)); } catch { fail('INVALID_RESPONSE'); }
      const result = resultValue(value, request);
      if (type !== result.result.mediaType) fail('IMAGE_INTEGRITY');
      const bytes = await bodyBytes(response, Math.min(MAX_BYTES, result.result.byteSize), run);
      if (bytes.byteLength !== result.result.byteSize) fail('IMAGE_INTEGRITY');
      guard(run); return { ...copy(result), result: { ...copy(result.result), bytes } };
    } catch (error) {
      if (localErrors.has(error)) throw error;
      fail(run.controller.signal.aborted ? 'ABORTED' : 'REQUEST_FAILED');
    } finally { token = null; run.cleanup(); }
  }
  return Object.freeze({ kind: KIND, source: SOURCE, getSession,
    subscribeSession(listener) {
      if (typeof listener !== 'function' || disposed) fail('INVALID_CONFIGURATION');
      if (!unsubscribe) {
        try { unsubscribe = port.subscribeSession(() => { getSession(); }); } catch { fail('INVALID_CONFIGURATION'); }
        if (typeof unsubscribe !== 'function') { unsubscribe = null; fail('INVALID_CONFIGURATION'); }
      }
      listeners.add(listener); return () => listeners.delete(listener);
    },
    listGroups: (input, options) => send('private.groups.list', input, options),
    listPhotos: (input, options) => send('private.photos.list', input, options),
    readDisplay: (input, options) => send('private.photo.display', input, options),
    readRegisteredMetadata: (input, options) => send(READ, input, options),
    dispose() { if (disposed) return; disposed = true; clear(); try { unsubscribe?.(); } catch {} unsubscribe = null; listeners.clear(); deniedEpochs.clear(); },
  });
}
