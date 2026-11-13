/** Optional hosted boundary for existing local presets; default disabled.
 * No local storage writes, automatic identity allocation, model inference or UI.
 * Canonical v1 rejects unsupported schema3 fields. Explicit v2 preserves the
 * full schema3 snapshot and exact mapping. The caller keeps its local preset.
 */
import { prepareSimulationForApply } from './simulation-storage.js';
import { CANONICAL_SELECTION_PROJECT_REF as PROJECT, resolveCanonicalSelection } from './canonical-selection-context.js';
import { preparePrivateStageSnapshotV2, copyPrivateStageSnapshot, copyPrivateStageDTO, clonePrivateStageJSON, privateStageWriteMatches,
  PRIVATE_STAGE_SNAPSHOT_SCHEMA, PRIVATE_STAGE_DTO_PROTOCOL } from './private-stage-snapshot.js';

const ORIGIN = `https://${PROJECT}.supabase.co`, ENDPOINT = '/functions/v1/theater3d-private-library';
const PROTOCOL = 'theater3d/stage-owner-http/v1', DTO = 'theater3d/stage-owner-candidate/v1';
const PROTOCOL_V2 = 'theater3d/stage-owner-http/v2';
const MODEL_SCHEMA = 'theater3d.stage-model-binding/v1', MAX_BODY = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const privateErrors = new WeakMap(), clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { const error = Error('Private stage operation rejected'); privateErrors.set(error, code); throw error; };
const denied = code => Object.freeze({ ok: false, code });
const positive = n => Number.isSafeInteger(n) && n > 0;
function exact(value, names, required = names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)) fail('INPUT_INVALID');
  const keys = Reflect.ownKeys(value), out = {};
  if (keys.some(k => typeof k !== 'string' || !names.includes(k)) || required.some(k => !keys.includes(k))) fail('INPUT_INVALID');
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INPUT_INVALID'); out[key] = d.value;
  }
  return out;
}
function jsonCopy(value, maximum = 1024 * 1024) {
  const seen = new Set(); let nodes = 0;
  function walk(v, depth) {
    if (++nodes > 100000 || depth > 32) fail('LIMIT_EXCEEDED');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || seen.has(v)) fail('INPUT_INVALID');
    seen.add(v); let out;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype || v.length > 10000 || Reflect.ownKeys(v).length !== v.length + 1) fail('INPUT_INVALID');
      out = Array.from({ length: v.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail('INPUT_INVALID'); return walk(d.value, depth + 1);
      });
    } else {
      if (![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail('INPUT_INVALID'); out = {};
      for (const key of Reflect.ownKeys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d?.enumerable || !Object.hasOwn(d, 'value')) fail('INPUT_INVALID');
        out[key] = walk(d.value, depth + 1);
      }
    }
    seen.delete(v); return out;
  }
  const result = walk(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > maximum) fail('LIMIT_EXCEEDED');
  return result;
}
function frozen(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) frozen(v); Object.freeze(value); } return value; }
function text(value, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail('INPUT_INVALID'); return value;
}
function identifier(value) { text(value); if (value.trim() !== value || value.startsWith('example:')) fail('INPUT_INVALID'); return value; }
function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('UNREPRESENTABLE_NUMBER');
  let out = Object.is(value, -0) ? '-0' : String(value);
  if (/e/i.test(out)) {
    const [mantissa, power] = out.toLowerCase().split('e'), negative = mantissa.startsWith('-');
    const raw = negative ? mantissa.slice(1) : mantissa, [whole, fraction = ''] = raw.split('.');
    const digits = whole + fraction, offset = whole.length + Number(power);
    out = (negative ? '-' : '') + (offset <= 0 ? '0.' + '0'.repeat(-offset) + digits
      : offset >= digits.length ? digits + '0'.repeat(offset - digits.length) : digits.slice(0, offset) + '.' + digits.slice(offset));
  }
  if (out.length > 128 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(out) || !Object.is(Number(out), value)) fail('UNREPRESENTABLE_NUMBER');
  return out;
}
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && same(a[k], b[k]));
}
const unresolved = (code, unsupported = []) => frozen({ status: 'unresolved', code, payload: null, unsupported });

/** Exact supported subset only. Existing 55-case resolver is reused for every
 * selected/audience/excluded seat, including unused supplied bindings.
 */
export function preparePrivateStageSnapshot(input) {
  try {
    const args = exact(jsonCopy(input), ['preset', 'selection', 'registry', 'modelBinding', 'seatBindings']);
    const { preset: p, selection, registry, modelBinding: rawModel, seatBindings } = args;
    // Validation only: do not use its copy/defaults to silently migrate records.
    prepareSimulationForApply(p);
    if (new TextEncoder().encode(JSON.stringify(p)).length > 256 * 1024) return unresolved('LIMIT_EXCEEDED');
    if (p.schemaVersion !== 3) return unresolved('LEGACY_PRESET_REQUIRES_LOCAL_REVIEW');
    identifier(p.id); text(p.name, 100);
    const selected = resolveCanonicalSelection(selection, registry);
    if (selected.status !== 'resolved') return unresolved(selected.code);
    if (rawModel === null) return unresolved('MODEL_MAPPING_UNAVAILABLE');
    const model = exact(rawModel, ['schema', 'projectRef', 'registryId', 'sourceSelection', 'localContext', 'venueId', 'layoutEditionId', 'modelRevisionId', 'mappingStatus']);
    if (model.schema !== MODEL_SCHEMA || model.projectRef !== PROJECT || model.registryId !== selection.registryId
        || model.mappingStatus !== 'verified' || !UUID.test(model.modelRevisionId)) return unresolved('INVALID_MODEL_MAPPING');
    if (!same(model.sourceSelection, selection) || !same(model.localContext, p.context)
        || model.venueId !== selected.canonical.venue_id || model.layoutEditionId !== selected.canonical.layout_edition_id) return unresolved('MODEL_CONTEXT_MISMATCH');
    if (!Array.isArray(seatBindings) || seatBindings.length > 4096) return unresolved('INVALID_SEAT_BINDINGS');
    const seats = new Map(), canonicalSeats = new Set(), audienceIds = new Set();
    for (const entry of seatBindings) {
      const row = exact(entry, ['localSeat', 'selection', 'audienceId']);
      const local = exact(row.localSeat, ['row', 'number']);
      if (!positive(local.row) || !positive(local.number)) return unresolved('INVALID_SEAT_BINDINGS');
      const mapped = resolveCanonicalSelection(row.selection, registry);
      if (mapped.status !== 'resolved') return unresolved(mapped.code);
      if (mapped.canonical.venue_id !== model.venueId || mapped.canonical.layout_edition_id !== model.layoutEditionId) return unresolved('SEAT_CONTEXT_MISMATCH');
      const key = `${local.row}:${local.number}`;
      if (seats.has(key) || canonicalSeats.has(mapped.canonical.seat_id)) return unresolved('DUPLICATE_SEAT_MAPPING');
      if (row.audienceId !== null) {
        identifier(row.audienceId);
        if (audienceIds.has(row.audienceId)) return unresolved('DUPLICATE_AUDIENCE_ID'); audienceIds.add(row.audienceId);
      }
      seats.set(key, { id: mapped.canonical.seat_id, audienceId: row.audienceId }); canonicalSeats.add(mapped.canonical.seat_id);
    }
    const s = p.state, unsupported = [];
    const inspect = (value, keys, path) => { for (const key of Object.keys(value || {})) if (!keys.includes(key)) unsupported.push(path + '.' + key); };
    inspect(s, ['seat', 'layout', 'audienceLayout', 'camera', 'settings'], 'state');
    inspect(s.layout, ['people', 'structures'], 'state.layout');
    for (const person of s.layout?.people || []) inspect(person, ['id', 'name', 'x', 'z', 'heightM', 'pose', 'facingDeg'], 'state.layout.people[]');
    for (const object of s.layout?.structures || []) inspect(object, ['id', 'name', 'type', 'x', 'z', 'widthM', 'depthM', 'diameterM', 'heightM', 'rotationDeg'], 'state.layout.structures[]');
    inspect(s.camera, ['eyeHeightM', 'focalLength35Mm', 'aspect', 'viewYawDeg', 'viewPitchDeg'], 'state.camera');
    inspect(s.settings, ['stageWallsEnabled', 'stageWallHeightM', 'stageWallSides'], 'state.settings');
    inspect(s.audienceLayout, ['people', 'excludedSeats', 'visible'], 'state.audienceLayout');
    for (const person of s.audienceLayout?.people || []) inspect(person, ['id', 'seat', 'preset'], 'state.audienceLayout.people[]');
    if (unsupported.length) return unresolved('UNSUPPORTED_STATE_FIELDS', [...new Set(unsupported)].sort());
    if (!s.seat || !s.layout || !s.camera || !s.settings || !s.audienceLayout) return unresolved('INCOMPLETE_STATE');
    const seat = local => seats.get(`${local.row}:${local.number}`) || fail('SEAT_MAPPING_UNAVAILABLE');
    if (seat(s.seat).id !== selected.canonical.seat_id) return unresolved('SELECTED_SEAT_MISMATCH');
    const required = (value, keys) => { if (keys.some(k => !Object.hasOwn(value, k))) fail('INCOMPLETE_STATE'); };
    required(s.camera, ['eyeHeightM', 'focalLength35Mm', 'aspect', 'viewYawDeg', 'viewPitchDeg']);
    required(s.settings, ['stageWallsEnabled', 'stageWallHeightM', 'stageWallSides']);
    required(s.audienceLayout, ['people', 'excludedSeats', 'visible']);
    const state = {
      evidence_kind: 'model_assumption',
      people: s.layout.people.map(person => {
        required(person, ['id', 'name', 'x', 'z', 'heightM', 'pose', 'facingDeg']);
        return { id: person.id, label: text(person.name, 60), x_m: decimal(person.x), z_m: decimal(person.z), height_m: decimal(person.heightM), pose: person.pose, facing_deg: decimal(person.facingDeg) };
      }),
      objects: s.layout.structures.map(object => {
        required(object, ['id', 'name', 'type', 'x', 'z', 'heightM', 'rotationDeg']);
        required(object, object.type === 'box' ? ['widthM', 'depthM'] : ['diameterM']);
        return { id: object.id, label: text(object.name, 60), type: object.type, x_m: decimal(object.x), z_m: decimal(object.z),
          width_m: object.widthM === undefined ? null : decimal(object.widthM), depth_m: object.depthM === undefined ? null : decimal(object.depthM),
          diameter_m: object.diameterM === undefined ? null : decimal(object.diameterM), height_m: decimal(object.heightM), rotation_deg: decimal(object.rotationDeg) };
      }),
      camera: { eye_height_m: decimal(s.camera.eyeHeightM), focal_length_35mm: decimal(s.camera.focalLength35Mm), aspect: s.camera.aspect,
        yaw_deg: decimal(s.camera.viewYawDeg), pitch_deg: decimal(s.camera.viewPitchDeg) },
      stage_walls: { enabled: s.settings.stageWallsEnabled, height_m: decimal(s.settings.stageWallHeightM), sides: clone(s.settings.stageWallSides) },
      audience: { excluded_seat_ids: s.audienceLayout.excludedSeats.map(local => seat(local).id),
        people: s.audienceLayout.people.map(person => {
          const mapped = seat(person.seat), id = person.id ?? mapped.audienceId;
          if (id === null) fail('AUDIENCE_ID_UNAVAILABLE');
          return { id: identifier(id), seat_id: mapped.id, body_preset: person.preset, height_m: null };
        }), visible: s.audienceLayout.visible }, source_refs: [],
    };
    if (s.camera.eyeHeightM <= 0 || new Set(state.audience.people.map(p => p.id)).size !== state.audience.people.length) return unresolved('CANONICAL_STATE_REJECTED');
    for (const collection of [state.people, state.objects, state.audience.people]) for (const row of collection) identifier(row.id);
    return frozen({ status: 'resolved', code: 'EXPLICIT_STATE_MAPPING', unsupported: [], payload: {
      id: p.id, layout_edition_id: model.layoutEditionId, model_revision_id: model.modelRevisionId,
      seat_id: selected.canonical.seat_id, post_id: null, name: p.name, snapshot_schema: 'logical-arrangement-review-v1', state,
    } });
  } catch (error) { return unresolved(privateErrors.get(error) || 'INPUT_INVALID'); }
}

/** Re-verify a v2 read against the currently supplied explicit model/seat map.
 * This is a detached preset, never a storage write or renderer activation.
 */
export function restorePrivateStageSnapshotV2(stage, mapping) {
  try {
    const dto = copyPrivateStageDTO(stage), input = exact(clonePrivateStageJSON(mapping, 8 * 1024 * 1024), ['selection', 'registry', 'modelBinding', 'seatBindings']);
    const prepared = preparePrivateStageSnapshotV2({ preset: dto.state.preset, ...input });
    if (prepared.status !== 'resolved') return frozen({ status: 'unresolved', code: prepared.code, preset: null });
    if (!same(prepared.payload.state.canonicalMapping, dto.state.canonicalMapping)) return frozen({ status: 'unresolved', code: 'MODEL_CONTEXT_MISMATCH', preset: null });
    return frozen({ status: 'resolved', code: 'EXPLICIT_STATE_MAPPING', preset: clonePrivateStageJSON(dto.state.preset), revision: dto.revision });
  } catch { return frozen({ status: 'unresolved', code: 'INVALID_RESPONSE', preset: null }); }
}

/** No default fetch/storage. V1 retains its deliberately restricted subset;
 * explicit snapshotVersion:2 carries full schema3 plus verified read context.
 */
export function createPrivateStageWorkspace(options = {}) {
  const descriptor = options && Object.getOwnPropertyDescriptor(options, 'enabled');
  if (descriptor && !Object.hasOwn(descriptor, 'value')) fail('INVALID_CONFIGURATION');
  if (descriptor?.value === undefined || descriptor.value === false) return Object.freeze({
    version: 0, prepare: preparePrivateStageSnapshot, restore: restorePrivateStageSnapshotV2,
    create: async () => denied('UNCONFIGURED'), update: async () => denied('UNCONFIGURED'),
    read: async () => denied('UNCONFIGURED'), list: async () => denied('UNCONFIGURED'),
    remove: async () => denied('UNCONFIGURED'), deleteStatus: async () => denied('UNCONFIGURED'),
    getSession: () => null, subscribeSession: () => () => {}, dispose() {},
  });
  if (descriptor.value !== true) fail('INVALID_CONFIGURATION');
  const c = exact(options, ['enabled', 'config', 'sessionPort', 'fetchImpl', 'validateState', 'clock', 'snapshotVersion'], ['enabled', 'config', 'sessionPort', 'fetchImpl']);
  const version = c.snapshotVersion ?? 1;
  if (![1, 2].includes(version)) fail('INVALID_CONFIGURATION');
  const config = exact(c.config, ['projectRef', 'supabaseUrl', 'publishableKey']);
  if (config.projectRef !== PROJECT || config.supabaseUrl !== ORIGIN || typeof config.publishableKey !== 'string'
      || !/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(config.publishableKey)
      || typeof c.fetchImpl !== 'function' || version === 1 && typeof c.validateState !== 'function'
      || c.validateState !== undefined && typeof c.validateState !== 'function') fail('INVALID_CONFIGURATION');
  const port = exact(c.sessionPort, ['getSession', 'getAccessToken', 'subscribeSession']);
  if (Object.values(port).some(fn => typeof fn !== 'function')) fail('INVALID_CONFIGURATION');
  for (const key of Object.keys(port)) port[key] = port[key].bind(c.sessionPort);
  const clock = c.clock ?? Date.now; if (typeof clock !== 'function') fail('INVALID_CONFIGURATION');
  const active = new Set(), deniedEpoch = new Map(), createdContexts = new Map(), listeners = new Set(); let disposed = false, serial = 0;
  const notify = () => { for (const fn of listeners) try { fn(); } catch {} };
  const unsubscribe = port.subscribeSession(() => { createdContexts.clear(); for (const run of active) run.abort(); notify(); });
  if (typeof unsubscribe !== 'function') fail('INVALID_CONFIGURATION');
  function session() {
    if (disposed) fail('DISPOSED');
    let s; try { s = exact(port.getSession(), ['projectRef', 'accountId', 'epoch', 'expiresAt']); } catch { fail('SESSION_REQUIRED'); }
    const now = clock();
    if (s.projectRef !== PROJECT || typeof s.accountId !== 'string' || !UUID.test(s.accountId) || !Number.isSafeInteger(s.epoch) || s.epoch < 0
        || !positive(s.expiresAt) || !Number.isSafeInteger(now) || now < 0 || s.expiresAt <= now
        || s.epoch <= (deniedEpoch.get(s.accountId) ?? -1)) fail('SESSION_REQUIRED');
    return s;
  }
  async function validateState(value, schema = 'logical-arrangement-review-v1') {
    if (schema === PRIVATE_STAGE_SNAPSHOT_SCHEMA && version === 2) {
      try { return copyPrivateStageSnapshot(value); } catch { fail('CONTRACT_REJECTED'); }
    }
    if (schema !== 'logical-arrangement-review-v1') fail('CONTRACT_REJECTED');
    if (typeof c.validateState !== 'function') fail('LEGACY_SNAPSHOT_UNSUPPORTED');
    const copy = frozen(jsonCopy(value));
    if (await c.validateState(copy) !== true) fail('CONTRACT_REJECTED'); return copy;
  }
  async function row(raw) {
    if (version === 2) {
      const d = exact(raw, ['protocol', 'id', 'revision', 'name', 'state', 'access_scope', 'snapshot_schema', 'layout_edition_id', 'model_revision_id', 'seat_id', 'post_id']);
      if (d.protocol !== PRIVATE_STAGE_DTO_PROTOCOL || d.access_scope !== 'owner_private' || !positive(d.revision)) fail('INVALID_RESPONSE');
      if (d.snapshot_schema === PRIVATE_STAGE_SNAPSHOT_SCHEMA) {
        try { return copyPrivateStageDTO(d); } catch { fail('INVALID_RESPONSE'); }
      }
      identifier(d.id); text(d.name, 1000000); identifier(d.layout_edition_id); identifier(d.model_revision_id);
      if (d.seat_id !== null) identifier(d.seat_id); if (d.post_id !== null) identifier(d.post_id);
      d.state = await validateState(d.state, d.snapshot_schema); return frozen(d);
    }
    const d = exact(raw, ['protocol', 'id', 'revision', 'name', 'state', 'access_scope']);
    if (d.protocol !== DTO || d.access_scope !== 'owner_private' || !positive(d.revision)) fail('INVALID_RESPONSE');
    identifier(d.id); text(d.name, 1000000); d.state = await validateState(d.state); return frozen(d);
  }
  async function send(action, payload, opts = {}) {
    let invoked = false, confirmedDenial = false, writing = action === 'private.stage.create' || action === 'private.stage.update' || action === 'private.stage.delete';
    const deletion = action === 'private.stage.delete' || action === 'private.stage.deleteStatus';
    let controller, removeAbort = () => {};
    try {
      const option = exact(opts, ['signal'], []);
      if (option.signal !== undefined && !(option.signal instanceof AbortSignal)) fail('INPUT_INVALID');
      if (option.signal?.aborted) fail('ABORTED');
      const initial = session(); controller = new AbortController(); active.add(controller);
      const abort = () => controller.abort(); option.signal?.addEventListener('abort', abort, { once: true });
      removeAbort = () => option.signal?.removeEventListener('abort', abort);
      function guard() { if (controller.signal.aborted) fail('ABORTED'); if (!same(initial, session())) fail('SESSION_CHANGED'); }
      async function step(fn) {
        guard(); let listener;
        const canceled = new Promise((_, reject) => { listener = () => { const e = Error('Private stage operation rejected'); privateErrors.set(e, 'ABORTED'); reject(e); }; controller.signal.addEventListener('abort', listener, { once: true }); });
        const task = Promise.resolve().then(() => { guard(); return fn(); }); task.catch(() => {});
        try { const result = await Promise.race([task, canceled]); guard(); return result; }
        finally { controller.signal.removeEventListener('abort', listener); }
      }
      const p = jsonCopy(payload);
      if (action === 'private.stage.create') {
        exact(p, ['id', 'layout_edition_id', 'model_revision_id', 'seat_id', 'post_id', 'name', 'snapshot_schema', 'state']);
        p.state = await step(() => validateState(p.state, p.snapshot_schema));
      } else if (action === 'private.stage.update') {
        exact(p, ['id', 'expected_revision', 'changes']); identifier(p.id);
        if (!positive(p.expected_revision) || p.expected_revision >= Number.MAX_SAFE_INTEGER) fail('INPUT_INVALID');
        exact(p.changes, ['name', 'state']); text(p.changes.name, 100); p.changes.state = await step(() => validateState(p.changes.state,
          version === 2 && p.changes.state?.contract === PRIVATE_STAGE_SNAPSHOT_SCHEMA ? PRIVATE_STAGE_SNAPSHOT_SCHEMA : 'logical-arrangement-review-v1'));
      } else if (deletion) {
        if(version!==2)fail('UNCONFIGURED'); exact(p,['id','expected_revision']);identifier(p.id);
        if(!positive(p.expected_revision)||p.expected_revision>=Number.MAX_SAFE_INTEGER)fail('INPUT_INVALID');
      } else if (action === 'private.stage.read') { exact(p, ['id']); identifier(p.id); }
      else { exact(p, ['limit', 'after_id']); if (!positive(p.limit) || p.limit > 100) fail('INPUT_INVALID'); if (p.after_id !== null) identifier(p.after_id); }
      if (serial >= Number.MAX_SAFE_INTEGER) fail('REQUEST_LIMIT');
      const request = { protocol: version === 2 ? PROTOCOL_V2 : PROTOCOL, projectRef: PROJECT, accountId: initial.accountId, epoch: initial.epoch,
        requestId: `private-stage-request:${++serial}`, action, payload: p };
      let token = await step(() => port.getAccessToken());
      if (typeof token !== 'string' || token.length < 16 || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('SESSION_REQUIRED');
      const response = await step(() => { invoked = true; return (0, c.fetchImpl)(ORIGIN + ENDPOINT, {
        method: 'POST', headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      }); }); token = null;
      if (!response || !Number.isSafeInteger(response.status) || typeof response.headers?.get !== 'function' || response.redirected
          || response.url && response.url !== ORIGIN + ENDPOINT) fail('INVALID_RESPONSE');
      if (response.status === 401 || response.status === 403) {
        deniedEpoch.set(initial.accountId, initial.epoch); createdContexts.clear(); for (const run of active) run.abort(); notify();
        // Auth rejection is not a commit receipt for an already dispatched write.
        fail(response.status === 401 ? 'SESSION_REQUIRED' : 'ACCESS_DENIED');
      }
      const errorReply = response.status !== 200 || response.ok !== true;
      if (errorReply && version !== 2) fail(({ 404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'LIMIT_EXCEEDED' })[response.status] || 'REQUEST_FAILED');
      const maximum = errorReply ? 16384 : MAX_BODY;
      if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') fail('INVALID_RESPONSE');
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > maximum)) fail('INVALID_RESPONSE');
      const reader = response.body?.getReader(); if (!reader) fail('INVALID_RESPONSE');
      const chunks = []; let size = 0, complete = false;
      try {
        for (;;) {
          const chunk = await step(() => reader.read()); if (chunk.done) { complete = true; break; }
          if (!(chunk.value instanceof Uint8Array)) fail('INVALID_RESPONSE');
          size += chunk.value.byteLength; if (size > maximum) fail('LIMIT_EXCEEDED'); chunks.push(new Uint8Array(chunk.value));
        }
      } finally { if (!complete) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
      if (length !== null && Number(length) !== size) fail('INVALID_RESPONSE');
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = jsonCopy(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), maximum);
      if (errorReply) {
        const e = exact(parsed, ['ok', 'code', 'message']);
        const definitive = { BAD_REQUEST: 400, INPUT_INVALID: 400, CONTRACT_REJECTED: 400, LIMIT_EXCEEDED: 413,
          NOT_FOUND: 404, CONFLICT: 409, REVISION_CONFLICT: 409, REFERENCE_REJECTED: 409, CONFLICT_RETRY_REQUIRED: 409 };
        if (e.ok !== false || e.message !== 'Private service request rejected' || definitive[e.code] !== response.status) fail('REQUEST_FAILED');
        confirmedDenial = true; fail(e.code);
      }
      const envelope = exact(parsed,
        ['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action', 'kind', 'source', 'ok', 'result']);
      if (['protocol', 'projectRef', 'accountId', 'epoch', 'requestId', 'action'].some(k => envelope[k] !== request[k])
          || envelope.kind !== 'configured-private' || envelope.source !== 'private-provider' || envelope.ok !== true) fail('INVALID_RESPONSE');
      let result;
      if (deletion) {
        const r=exact(envelope.result,['ok','id','revision','deleted']);
        if(r.ok!==true||r.id!==p.id||typeof r.deleted!=='boolean'||r.revision!==(r.deleted?p.expected_revision+1:p.expected_revision)
          ||action==='private.stage.delete'&&!r.deleted)fail('INVALID_RESPONSE'); result=r;
      } else if (action === 'private.stage.list') {
        const r = exact(envelope.result, ['ok', 'items', 'next_after_id']);
        if (r.ok !== true || !Array.isArray(r.items) || r.items.length > p.limit) fail('INVALID_RESPONSE');
        r.items = await step(() => Promise.all(r.items.map(row)));
        if (new Set(r.items.map(x => x.id)).size !== r.items.length || r.items.some(x => x.id === p.after_id)
            || r.next_after_id !== null && (r.items.length !== p.limit || r.items.at(-1)?.id !== r.next_after_id)) fail('INVALID_RESPONSE');
        result = r;
      } else {
        const r = exact(envelope.result, ['ok', 'stage']); if (r.ok !== true) fail('INVALID_RESPONSE'); r.stage = await step(() => row(r.stage));
        if (r.stage.id !== p.id || action === 'private.stage.create' && r.stage.revision !== 1
            || action === 'private.stage.update' && r.stage.revision !== p.expected_revision + 1) fail('INVALID_RESPONSE'); result = r;
      }
      if (version === 2 && writing && !deletion && !privateStageWriteMatches(action, p, result.stage)) fail('INVALID_RESPONSE');
      guard();
      if (deletion) { if(result.deleted)createdContexts.delete(p.id); }
      else if (version === 2) {
        const rows = action === 'private.stage.list' ? result.items : [result.stage];
        for (const row of rows) createdContexts.set(row.id, contextOf(row));
      }
      return frozen(result);
    } catch (error) { return denied(invoked && writing && !confirmedDenial ? 'OUTCOME_UNKNOWN' : privateErrors.get(error) || 'REQUEST_FAILED'); }
    finally { removeAbort(); if (controller) active.delete(controller); }
  }
  function prepare(input) { return version === 2 ? preparePrivateStageSnapshotV2(input) : preparePrivateStageSnapshot(input); }
  const contextOf = p => ({ layout_edition_id: p.layout_edition_id, model_revision_id: p.model_revision_id, seat_id: p.seat_id });
  return Object.freeze({ version, prepare, restore: restorePrivateStageSnapshotV2,
    getSession() { try { return frozen(session()); } catch { return null; } },
    subscribeSession(listener) { if (typeof listener !== 'function') fail('INPUT_INVALID'); listeners.add(listener); return () => listeners.delete(listener); },
    async create(input, opts) {
      const prepared = prepare(input); if (prepared.status !== 'resolved') return denied(prepared.code);
      let stamp; try { stamp = session(); } catch (error) { return denied(privateErrors.get(error) || 'SESSION_REQUIRED'); }
      const result = await send('private.stage.create', prepared.payload, opts);
      if (result.ok) {
        try { if (!same(stamp, session())) return denied('OUTCOME_UNKNOWN'); } catch { return denied('OUTCOME_UNKNOWN'); }
        createdContexts.set(prepared.payload.id, contextOf(prepared.payload));
      }
      return result;
    },
    async update(input, expectedRevision, opts) {
      const prepared = prepare(input); if (prepared.status !== 'resolved') return denied(prepared.code);
      const known = createdContexts.get(prepared.payload.id);
      // V1 requires this session's successful create. V2 also accepts the
      // direct context in a fully validated read/list response.
      if (!known) return denied('REMOTE_CONTEXT_NOT_RETURNED');
      if (!same(known, contextOf(prepared.payload))) return denied('MODEL_CONTEXT_MISMATCH');
      return send('private.stage.update', { id: prepared.payload.id, expected_revision: expectedRevision, changes: { name: prepared.payload.name, state: prepared.payload.state } }, opts);
    },
    remove: (id, expectedRevision, opts) => send('private.stage.delete', {id,expected_revision:expectedRevision},opts),
    deleteStatus: (id, expectedRevision, opts) => send('private.stage.deleteStatus', {id,expected_revision:expectedRevision},opts),
    read: (id, opts) => send('private.stage.read', { id }, opts),
    list: (page = { limit: 24, after_id: null }, opts) => send('private.stage.list', page, opts),
    dispose() { if (disposed) return; disposed = true; for (const run of active) run.abort(); active.clear(); deniedEpoch.clear(); createdContexts.clear(); notify(); listeners.clear(); try { unsubscribe(); } catch {} },
  });
}
