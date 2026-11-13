/** Fixed simulation only: 134 invented records, no source files or real account.
 * 131 entries share one generated 1x1 PNG fixture; RAW 1 + video 2 remain listed.
 * This provider has no transport, persistence, external records input or upload.
 */
import { PRIVATE_PHOTO_PROTOCOL, PRIVATE_PHOTO_PROJECT, privatePhotoLibraryError } from './private-photo-library.js';
const KIND = 'synthetic-memory', SOURCE = 'simulation';
const PNG_HEX = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c633028d8f21f00047c02540b197b2f0000000049454e44ae426082';
const DIGEST = 'b4bdc3bfb1bd803b7ec0bd5184750f8666ccb3aaf89da4b7043d1a2c8abda5b9';
const SNAPSHOT = 'synthetic-private-library-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw privatePhotoLibraryError(code); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_RESPONSE');
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_RESPONSE');
  const result = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) fail('INVALID_RESPONSE'); result[key] = d.value;
  }
  return result;
}
function totals(items) {
  return { total: items.length, original: items.length, fhdReady: items.filter(item => item.fhdStatus === 'ready').length,
    uploaded: 0, unsupported: items.filter(item => item.fhdStatus === 'unsupported').length };
}

export function createPrivatePhotoMemoryProvider(options = {}) {
  if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).some(key => key !== 'clock')) fail('INVALID_CONFIGURATION');
  const descriptor = Object.getOwnPropertyDescriptor(options, 'clock');
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('INVALID_CONFIGURATION');
  const clock = descriptor?.value ?? (() => Date.now());
  if (typeof clock !== 'function') fail('INVALID_CONFIGURATION');
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 3600000)) fail('INVALID_CONFIGURATION');
  let session = { projectRef: PRIVATE_PHOTO_PROJECT, accountId: 'synthetic-private-account', epoch: 1, expiresAt: now + 3600000 };
  let disposed = false;
  const listeners = new Set(), issuedCursors = new Map();
  const specifications = [
    { groupId: 'synthetic-group-a', sourceGroupId: 'synthetic-source-folder-a', label: '샘플 원본 폴더 A' },
    { groupId: 'synthetic-group-b', sourceGroupId: 'synthetic-source-folder-b', label: '샘플 원본 폴더 B' },
  ];
  const items = Array.from({ length: 134 }, (_, index) => {
    const number = index + 1, image = number <= 131, raw = number === 132;
    return { photoId: `synthetic-photo-${String(number).padStart(3, '0')}`,
      sourceGroupId: specifications[index < 90 ? 0 : 1].sourceGroupId, revision: 1,
      originalFilename: image ? `샘플-사진-${String(number).padStart(3, '0')}.png`
        : raw ? '샘플-미지원-132.raw' : `샘플-영상-${number}.mp4`,
      mediaKind: image ? 'image' : raw ? 'raw' : 'video', originalAvailable: true,
      fhdStatus: image ? 'ready' : 'unsupported', uploadStatus: 'not-uploaded',
      context: { venueId: null, layoutVersionId: null, seatId: null, workId: null, runId: null, eventId: null },
      display: image ? { revision: 1, sha256: DIGEST, byteSize: 70, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 } : null };
  });
  const groups = specifications.map(group => ({ ...group, snapshot: SNAPSHOT, revision: 1,
    totals: totals(items.filter(item => item.sourceGroupId === group.sourceGroupId)) }));
  function getSession() { return !disposed && session && session.expiresAt > clock() ? { ...session } : null; }
  function admitted(input, action, keys, signal) {
    if (signal?.aborted) fail('ABORTED');
    const current = getSession(); if (!current) fail('SESSION_REQUIRED');
    const request = exact(input, ['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action', 'payload']);
    if (request.projectRef !== PRIVATE_PHOTO_PROJECT) fail('PROJECT_MISMATCH');
    if (request.protocol !== PRIVATE_PHOTO_PROTOCOL || request.action !== action
        || request.accountId !== current.accountId || request.epoch !== current.epoch) fail('ACCESS_DENIED');
    if (typeof request.requestId !== 'string' || !/^private-photo-request:[1-9][0-9]*$/.test(request.requestId)) fail('INVALID_RESPONSE');
    return { request, payload: exact(request.payload, keys) };
  }
  function response(request, result) {
    return { protocol: PRIVATE_PHOTO_PROTOCOL, projectRef: PRIVATE_PHOTO_PROJECT,
      accountId: request.accountId, epoch: request.epoch, requestId: request.requestId, action: request.action,
      kind: KIND, source: SOURCE, ok: true, result };
  }
  function groupFor(payload, revisionKey = 'revision') {
    const group = groups.find(group => group.groupId === payload.groupId);
    if (!group || group.snapshot !== payload.snapshot) fail('SCOPE_MISMATCH');
    if (group.revision !== payload[revisionKey]) fail('REVISION_MISMATCH');
    return group;
  }
  function logout() {
    session = null; issuedCursors.clear();
    for (const listener of listeners) try { listener(); } catch { /* No observer error logging. */ }
  }
  return Object.freeze({
    kind: KIND, source: SOURCE, getSession,
    subscribeSession(listener) {
      if (typeof listener !== 'function' || disposed) fail('INVALID_CONFIGURATION');
      listeners.add(listener); return () => listeners.delete(listener);
    },
    async listGroups(input, { signal } = {}) {
      const { request, payload } = admitted(input, 'private.groups.list', ['limit'], signal);
      if (!Number.isSafeInteger(payload.limit) || payload.limit < groups.length || payload.limit > 50) fail('LIMIT_EXCEEDED');
      return response(request, { snapshot: SNAPSHOT, revision: 1, groups: copy(groups), totals: totals(items) });
    },
    async listPhotos(input, { signal } = {}) {
      const { request, payload } = admitted(input, 'private.photos.list', ['groupId', 'snapshot', 'revision', 'cursor', 'limit'], signal);
      const group = groupFor(payload);
      if (!Number.isSafeInteger(payload.limit) || payload.limit < 1 || payload.limit > 50) fail('LIMIT_EXCEEDED');
      let offset = 0;
      if (payload.cursor !== null) {
        const c = exact(payload.cursor, ['token', 'accountId', 'epoch', 'groupId', 'snapshot', 'revision']);
        const expected = issuedCursors.get(c.token);
        if (!expected || JSON.stringify(c) !== JSON.stringify(expected.cursor)
            || c.accountId !== request.accountId || c.epoch !== request.epoch || c.groupId !== group.groupId
            || c.snapshot !== group.snapshot || c.revision !== group.revision) fail('CURSOR_INVALID');
        offset = expected.offset;
      }
      const groupItems = items.filter(item => item.sourceGroupId === group.sourceGroupId);
      const page = groupItems.slice(offset, offset + payload.limit), end = offset + page.length;
      let nextCursor = null;
      if (end < groupItems.length) {
        nextCursor = { token: `synthetic-cursor:${group.groupId}:${end}`, accountId: request.accountId,
          epoch: request.epoch, groupId: group.groupId, snapshot: group.snapshot, revision: group.revision };
        issuedCursors.set(nextCursor.token, { offset: end, cursor: copy(nextCursor) });
      }
      return response(request, { groupId: group.groupId, snapshot: group.snapshot, revision: group.revision,
        items: copy(page), totals: copy(group.totals), nextCursor });
    },
    async readDisplay(input, { signal } = {}) {
      const { request, payload } = admitted(input, 'private.photo.display', ['groupId', 'snapshot', 'groupRevision',
        'photoId', 'photoRevision', 'displayRevision'], signal);
      const group = groupFor(payload, 'groupRevision');
      const item = items.find(item => item.photoId === payload.photoId && item.sourceGroupId === group.sourceGroupId);
      if (!item?.display) fail('PHOTO_UNAVAILABLE');
      if (item.revision !== payload.photoRevision || item.display.revision !== payload.displayRevision) fail('REVISION_MISMATCH');
      const bytes = Uint8Array.from(PNG_HEX.match(/../g), hex => Number.parseInt(hex, 16));
      return response(request, { ...copy(payload), mediaType: 'image/png', byteSize: bytes.byteLength,
        sha256: DIGEST, pixelWidth: 1, pixelHeight: 1, bytes });
    },
    logout,
    dispose() { if (disposed) return; logout(); disposed = true; listeners.clear(); },
  });
}
