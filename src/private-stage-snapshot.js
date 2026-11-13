import { STORED_CAMERA_ASPECTS } from './camera-config.js';
/** Shared schema3 snapshot boundary. Pure, synchronous, no storage/network/auth.
 * Local validation is delegated to the existing simulation-storage contract.
 * Apply-time defaults and geometry normalization never become persisted data.
 */
import { createSimulationStorage, SIMULATION_STORAGE_KEY } from './simulation-storage.js';
import { CANONICAL_SELECTION_PROJECT_REF as PROJECT, resolveCanonicalSelection } from './canonical-selection-context.js';

export const PRIVATE_STAGE_SNAPSHOT_SCHEMA = 'theater3d.stage-preset-snapshot/v2';
export const PRIVATE_STAGE_DTO_PROTOCOL = 'theater3d/stage-owner-candidate/v2';
export const PRIVATE_STAGE_SNAPSHOT_LIMITS = Object.freeze({ presetBytes: 256 * 1024, snapshotBytes: 1024 * 1024, depth: 32, nodes: 100000, seats: 4096 });
const MODEL_SCHEMA = 'theater3d.stage-model-binding/v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MODEL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const errors = new WeakMap(), own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const fail = code => { const e = new TypeError('Private stage snapshot rejected'); errors.set(e, code); throw e; };
const bytes = v => new TextEncoder().encode(JSON.stringify(v)).length;
const freeze = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && same(a[k], b[k]));
};

/** Detached JSON-value copy, preserving optional presence, null and numbers.
 * Rejects -0 because JSON transport cannot preserve its sign. No getters are
 * evaluated; unknown property names and submitted values never enter errors.
 */
export function clonePrivateStageJSON(value, maximum = PRIVATE_STAGE_SNAPSHOT_LIMITS.snapshotBytes) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8 * 1024 * 1024) fail('LIMIT_EXCEEDED');
  const ancestors = new Set(); let nodes = 0;
  function walk(v, depth) {
    if (++nodes > PRIVATE_STAGE_SNAPSHOT_LIMITS.nodes || depth > PRIVATE_STAGE_SNAPSHOT_LIMITS.depth) fail('LIMIT_EXCEEDED');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) fail('INPUT_INVALID');
      return v;
    }
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) fail('UNREPRESENTABLE_NUMBER'); return v; }
    if (!v || typeof v !== 'object' || ancestors.has(v)) fail('INPUT_INVALID');
    const proto = Object.getPrototypeOf(v), array = Array.isArray(v);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('INPUT_INVALID');
    const keys = Reflect.ownKeys(v); if (keys.length > 10001) fail('LIMIT_EXCEEDED');
    ancestors.add(v); let out;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(v, 'length')?.value;
      if (!Number.isSafeInteger(length) || length > 10000 || keys.length !== length + 1) fail('INPUT_INVALID');
      out = [];
      for (let i = 0; i < length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d?.enumerable || !own(d, 'value')) fail('INPUT_INVALID'); out.push(walk(d.value, depth + 1));
      }
    } else {
      out = {};
      for (const key of keys) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !d?.enumerable || !own(d, 'value')) fail('INPUT_INVALID');
        out[key] = walk(d.value, depth + 1);
      }
    }
    ancestors.delete(v); return out;
  }
  const result = walk(value, 0); if (bytes(result) > maximum) fail('LIMIT_EXCEEDED'); return result;
}
function exact(v, allowed, required = allowed) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k)) || required.some(k => !own(v, k))) fail('INPUT_INVALID');
  return v;
}
function identifier(v) { if (typeof v !== 'string' || !UUID.test(v)) fail('INVALID_CANONICAL_ID'); }
function localSeat(v) { exact(v, ['row', 'number']); if (!Number.isSafeInteger(v.row) || v.row < 1 || v.row > 1000000 || !Number.isSafeInteger(v.number) || v.number < 1 || v.number > 1000000) fail('INVALID_SEAT_BINDINGS'); return `${v.row}:${v.number}`; }
function sourceSelection(v, registryId) {
  // The resolver checks source aliases, optional/null identities and all types
  // before reaching REGISTRY_UNAVAILABLE. No source identity is reconstructed.
  const result = resolveCanonicalSelection(v, null);
  if (result.code !== 'REGISTRY_UNAVAILABLE') fail(result.code);
  if (v.registryId !== registryId) fail('REGISTRY_MISMATCH');
  for (const value of Object.values(v.sourceIdentity)) if (typeof value === 'string' && (/^[\s]*(?:blob:|data:|https?:|file:)/i.test(value) || /[\u0000-\u001f\u007f]/.test(value))) fail('INPUT_INVALID');
}
function checkedPreset(preset) {
  if (preset?.schemaVersion !== 3) fail('LEGACY_PRESET_REQUIRES_LOCAL_REVIEW');
  if (bytes(preset) > PRIVATE_STAGE_SNAPSHOT_LIMITS.presetBytes) fail('LIMIT_EXCEEDED');
  const document = JSON.stringify({ schemaVersion: 3, items: [preset] });
  let writes = 0;
  const backend = { getItem: key => key === SIMULATION_STORAGE_KEY ? document : null, setItem() { writes++; fail('UNEXPECTED_STORAGE_WRITE'); } };
  const result = createSimulationStorage({ storage: backend }).load(preset.id, preset.context);
  if (!result.ok || writes) fail('LOCAL_PRESET_REJECTED');
  if (!same(result.value, preset)) fail('LOSSY_LOCAL_PRESET');
  // Canonical storage reserves example: IDs. Preserve the local record and
  // explicitly decline this unsupported mapping; never allocate a replacement.
  if (preset.id.startsWith('example:')) fail('UNSUPPORTED_LOCAL_ID');
  // Canonical Python-strip whitespace differs from JS trim (notably U+0085
  // and U+FEFF). Preserve both existing contracts without rewriting the name.
  if (/^[\u0009-\u000d\u001c-\u001f\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u.test(preset.name)) fail('UNSUPPORTED_LOCAL_NAME');
  return preset;
}
function checkedSnapshot(state) {
  exact(state, ['contract', 'preset', 'canonicalMapping']);
  if (bytes(state) > PRIVATE_STAGE_SNAPSHOT_LIMITS.snapshotBytes) fail('LIMIT_EXCEEDED');
  if (state.contract !== PRIVATE_STAGE_SNAPSHOT_SCHEMA) fail('SNAPSHOT_VERSION_MISMATCH');
  const p = checkedPreset(state.preset), m = exact(state.canonicalMapping,
    ['registry_id', 'venue_id', 'layout_edition_id', 'model_revision_id', 'seat_id', 'source_selection', 'seats']);
  for (const k of ['registry_id', 'venue_id', 'layout_edition_id', 'seat_id']) identifier(m[k]);
  if (typeof m.model_revision_id !== 'string' || !MODEL_UUID.test(m.model_revision_id)) fail('INVALID_CANONICAL_ID');
  sourceSelection(m.source_selection, m.registry_id);
  if (!Array.isArray(m.seats) || m.seats.length > PRIVATE_STAGE_SNAPSHOT_LIMITS.seats) fail('INVALID_SEAT_BINDINGS');
  const mapped = new Map(), canonical = new Set();
  for (const row of m.seats) {
    exact(row, ['localSeat', 'seat_id', 'source_selection']); const key = localSeat(row.localSeat);
    identifier(row.seat_id); sourceSelection(row.source_selection, m.registry_id);
    if (mapped.has(key) || canonical.has(row.seat_id)) fail('DUPLICATE_SEAT_MAPPING');
    mapped.set(key, row.seat_id); canonical.add(row.seat_id);
  }
  const requireSeat = seat => { const id = mapped.get(localSeat(seat)); if (!id) fail('SEAT_MAPPING_UNAVAILABLE'); return id; };
  if (p.state.seat && requireSeat(p.state.seat) !== m.seat_id) fail('SELECTED_SEAT_MISMATCH');
  for (const person of p.state.audienceLayout?.people || []) requireSeat(person.seat);
  for (const seat of p.state.audienceLayout?.excludedSeats || []) requireSeat(seat);
  if (p.state.audienceLayout?.editSeat) requireSeat(p.state.audienceLayout.editSeat);
  // Reuse identity normalization to reject aliased duplicate source tuples and
  // a selected tuple that contradicts an explicit seat mapping. This graph is
  // only structural validation; it does not authenticate submitted mappings.
  const projection = { schema: 'theater3d.canonical-selection-registry/v1', projectRef: PROJECT, registryId: m.registry_id,
    venues: [{ id: m.venue_id }], layoutEditions: [{ id: m.layout_edition_id, venueId: m.venue_id }],
    seats: [...new Set([m.seat_id, ...canonical])].map(id => ({ id, layoutEditionId: m.layout_edition_id })),
    bindings: m.seats.map(row => ({ sourceScheme: row.source_selection.sourceScheme, sourceIdentity: row.source_selection.sourceIdentity,
      venueId: m.venue_id, layoutEditionId: m.layout_edition_id, seatId: row.seat_id, mappingStatus: 'verified' })),
  };
  const mappedSelection = resolveCanonicalSelection(m.source_selection, projection);
  if (mappedSelection.status === 'resolved' && mappedSelection.canonical.seat_id !== m.seat_id) fail('SELECTED_SEAT_MISMATCH');
  if (mappedSelection.status !== 'resolved' && mappedSelection.code !== 'NO_EXPLICIT_MAPPING') fail(mappedSelection.code);
  if (p.state.seat && mappedSelection.status !== 'resolved') fail('SELECTED_SOURCE_MISMATCH');
  return state;
}
export function copyPrivateStageSnapshot(state) { return freeze(checkedSnapshot(clonePrivateStageJSON(state))); }
export function validatePrivateStageSnapshot(state) { try { copyPrivateStageSnapshot(state); return true; } catch { return false; } }

/** DTO v2 includes direct membership; all must match its validated envelope. */
export function copyPrivateStageDTO(value) {
  const d = exact(clonePrivateStageJSON(value, PRIVATE_STAGE_SNAPSHOT_LIMITS.snapshotBytes + 8192),
    ['protocol', 'id', 'revision', 'name', 'state', 'access_scope', 'snapshot_schema', 'layout_edition_id', 'model_revision_id', 'seat_id', 'post_id']);
  if (d.protocol !== PRIVATE_STAGE_DTO_PROTOCOL || d.access_scope !== 'owner_private' || d.snapshot_schema !== PRIVATE_STAGE_SNAPSHOT_SCHEMA
      || !Number.isSafeInteger(d.revision) || d.revision < 1 || d.post_id !== null) fail('INVALID_RESPONSE');
  checkedSnapshot(d.state);
  const p = d.state.preset, m = d.state.canonicalMapping;
  if (d.id !== p.id || d.name !== p.name || ['layout_edition_id', 'model_revision_id', 'seat_id'].some(k => d[k] !== m[k])) fail('MODEL_CONTEXT_MISMATCH');
  return freeze(d);
}
export function validatePrivateStageDTO(value) { try { copyPrivateStageDTO(value); return true; } catch { return false; } }

/** Write receipt equality for v2 only; call before COMMIT and at each response
 * boundary. Read/list are outside this helper's scope and return false. Object
 * key order is irrelevant, but null, absent fields and array order differ.
 */
export function privateStageWriteMatches(action, payload, dto) {
  try {
    if (action !== 'private.stage.create' && action !== 'private.stage.update') return false;
    const p = clonePrivateStageJSON(payload), d = copyPrivateStageDTO(dto);
    if (action === 'private.stage.create') {
      const fields = ['id', 'layout_edition_id', 'model_revision_id', 'seat_id', 'post_id', 'name', 'snapshot_schema', 'state'];
      exact(p, fields);
      return d.revision === 1 && fields.every(k => same(p[k], d[k]));
    }
    exact(p, ['id', 'expected_revision', 'changes']);
    if (!Number.isSafeInteger(p.expected_revision) || p.expected_revision < 1 || p.expected_revision >= Number.MAX_SAFE_INTEGER) return false;
    const changes = exact(p.changes, ['name', 'state'], []), keys = Object.keys(changes);
    return keys.length > 0 && d.id === p.id && d.revision === p.expected_revision + 1 && keys.every(k => same(changes[k], d[k]));
  } catch { return false; }
}

/** Explicit registry projection only. It is evidence for review, not authority
 * to access a server; the server must independently check canonical DB FKs.
 */
export function preparePrivateStageSnapshotV2(input) {
  try {
    const { preset: p, selection, registry, modelBinding: model, seatBindings } = exact(clonePrivateStageJSON(input, 8 * 1024 * 1024), ['preset', 'selection', 'registry', 'modelBinding', 'seatBindings']);
    checkedPreset(p);
    const selected = resolveCanonicalSelection(selection, registry);
    if (selected.status !== 'resolved') fail(selected.code);
    if (model === null) fail('MODEL_MAPPING_UNAVAILABLE');
    exact(model, ['schema', 'projectRef', 'registryId', 'sourceSelection', 'localContext', 'venueId', 'layoutEditionId', 'modelRevisionId', 'mappingStatus']);
    if (model.schema !== MODEL_SCHEMA || model.projectRef !== PROJECT || model.registryId !== selection.registryId || model.mappingStatus !== 'verified') fail('INVALID_MODEL_MAPPING');
    if (typeof model.modelRevisionId !== 'string' || !MODEL_UUID.test(model.modelRevisionId)) fail('INVALID_CANONICAL_ID');
    if (!same(model.sourceSelection, selection) || !same(model.localContext, p.context)
        || model.venueId !== selected.canonical.venue_id || model.layoutEditionId !== selected.canonical.layout_edition_id) fail('MODEL_CONTEXT_MISMATCH');
    if (!Array.isArray(seatBindings) || seatBindings.length > PRIVATE_STAGE_SNAPSHOT_LIMITS.seats) fail('INVALID_SEAT_BINDINGS');
    const audienceIds = new Set();
    const seats = seatBindings.map(row => {
      exact(row, ['localSeat', 'selection', 'audienceId']); localSeat(row.localSeat);
      const mapped = resolveCanonicalSelection(row.selection, registry);
      if (mapped.status !== 'resolved') fail(mapped.code);
      if (mapped.canonical.venue_id !== model.venueId || mapped.canonical.layout_edition_id !== model.layoutEditionId) fail('SEAT_CONTEXT_MISMATCH');
      if (row.audienceId !== null) {
        if (typeof row.audienceId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,159}$/.test(row.audienceId) || ['__proto__', 'constructor', 'prototype'].includes(row.audienceId)) fail('INVALID_SEAT_BINDINGS');
        if (audienceIds.has(row.audienceId)) fail('DUPLICATE_AUDIENCE_ID'); audienceIds.add(row.audienceId);
      }
      // audienceId is v1 adapter bookkeeping, never an invented schema3 ID.
      return { localSeat: row.localSeat, seat_id: mapped.canonical.seat_id, source_selection: row.selection };
    });
    const state = copyPrivateStageSnapshot({ contract: PRIVATE_STAGE_SNAPSHOT_SCHEMA, preset: p, canonicalMapping: {
      registry_id: selection.registryId, venue_id: model.venueId, layout_edition_id: model.layoutEditionId,
      model_revision_id: model.modelRevisionId, seat_id: selected.canonical.seat_id, source_selection: selection, seats,
    } });
    return freeze({ status: 'resolved', code: 'EXPLICIT_STATE_MAPPING', unsupported: [], payload: {
      id: p.id, layout_edition_id: model.layoutEditionId, model_revision_id: model.modelRevisionId,
      seat_id: selected.canonical.seat_id, post_id: null, name: p.name, snapshot_schema: PRIVATE_STAGE_SNAPSHOT_SCHEMA, state,
    } });
  } catch (e) { return freeze({ status: 'unresolved', code: errors.get(e) || 'INPUT_INVALID', unsupported: [], payload: null }); }
}

// Serializable shape projection for SQL/static parity. Runtime semantic truth
// remains simulation-storage + authored-geometry; projection alone is NOT a
// validator. semantic tags below name checks SQL must implement independently.
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const number = (minimum, maximum) => ({ type: 'number', minimum, ...(maximum === undefined ? {} : { maximum }) });
const integer = (minimum, maximum = 1000000) => ({ ...number(minimum, maximum), integer: true });
const str = maxLength => ({ type: 'string', minLength: 1, maxLength, semantic: 'local_text' });
const localId = { ...str(160), pattern: '^[a-zA-Z0-9][a-zA-Z0-9:_.-]*$', semantic: 'local_id' };
const enumeration = values => ({ type: 'string', enum: values });
const nullable = spec => ({ ...spec, nullable: true });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const boolean = { type: 'boolean' }, coordinate = number(-1000, 1000);
const seat = object({ row: integer(1), number: integer(1) }, ['row', 'number']);
const color = { type: 'string', pattern: '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' };
const person = object({ id: localId, name: str(60), x: coordinate, z: coordinate, heightM: number(.3, 3), bodyPreset: enumeration(['male', 'female']), color,
  position: enumeration(['center', 'front', 'back', 'left', 'right', 'custom']), facingDeg: number(-180, 360), pose: enumeration(['standing', 'chair', 'floor', 'cross-legged']) }, ['id', 'x', 'z', 'heightM']);
const structure = object({ id: localId, name: str(60), type: enumeration(['box', 'cylinder']), x: coordinate, z: coordinate,
  widthM: number(.05, 100), depthM: number(.05, 100), diameterM: number(.05, 100), heightM: number(.05, 100), rotationDeg: number(-360, 360), color }, ['id', 'type', 'x', 'z', 'heightM']);
const localContext = object({ venueId: localId, layoutVersionId: localId, seatId: nullable(localId) }, ['venueId', 'layoutVersionId']);
const point = object({ x: number(-100, 100), z: number(-100, 100) }, ['x', 'z']);
const authored = { ...object({ schemaVersion: { type: 'number', enum: [1] }, stagePolygon: array(point, 32, 3), stageHeightM: number(0, 10),
  seatBlockAngles: array(object({ blockKey: { type: 'string', pattern: '^block:[^\\u0000-\\u001f\\u007f]{1,80}$' }, rotationDeg: number(-180, 180) }, ['blockKey', 'rotationDeg']), 100) }, ['schemaVersion']), semantic: 'authored_geometry' };
const stateShape = { ...object({ authoredGeometry: authored, seat,
  layout: object({ people: array(person, 128), structures: array(structure, 20), selectedPersonId: nullable(localId), selectedStructureId: nullable(localId), nextPersonId: integer(1, Number.MAX_SAFE_INTEGER), nextStructureId: integer(1, Number.MAX_SAFE_INTEGER) }, ['people', 'structures']),
  audienceLayout: object({ people: array(object({ id: localId, name: str(100), seat, preset: enumeration(['male', 'female']) }, ['seat', 'preset']), 1000), excludedSeats: array(seat, 10000), visible: boolean, fullPreset: enumeration(['male', 'female', 'mixed']), editSeat: nullable(seat) }, ['people']),
  camera: object({ focalLength35Mm: number(18, 400), sightFocalLength35Mm: integer(5, 20), sightViewEnabled: boolean, aspect: enumeration(STORED_CAMERA_ASPECTS), eyeHeightM: number(0, 5), viewYawDeg: number(-360, 360), viewPitchDeg: number(-90, 90), followSelectedPerson: boolean, aimFraming: enumeration(['full', 'upper']) }),
  editorCamera: object({ yawDeg: number(-360, 360), elevationDeg: number(10, 80), zoom: number(.5, 2) }),
  cameraHeightConfig: object({ minCm: number(0, 150), maxCm: number(0, 150), offsetCm: number(0, 150) }, ['minCm', 'maxCm', 'offsetCm']),
  lensConfig: object({ mode: enumeration(['full', 'custom', 'lens']), minMm: number(18, 400), maxMm: number(18, 400), lensId: nullable(localId), cropFactor: number(.1, 10) }),
  lensDefinition: object({ schema: enumeration(['theater3d.preset-lens-definition/v1']), lensId: {type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$'}, name:str(160), minFocalMm:{type:'number',exclusiveMinimum:0},maxFocalMm:{type:'number',exclusiveMinimum:0},apertureAtMinFocal:nullable({type:'number',exclusiveMinimum:0}),apertureAtMaxFocal:nullable({type:'number',exclusiveMinimum:0}),defaultCropFactor:number(.1,10),effectiveMinMm:number(18,400),effectiveMaxMm:number(18,400)},['schema','lensId','name','minFocalMm','maxFocalMm','apertureAtMinFocal','apertureAtMaxFocal','defaultCropFactor','effectiveMinMm','effectiveMaxMm']),
  settings: object({ showGrid: boolean, stageWallsEnabled: boolean, stageWallSides: object({ back: boolean, left: boolean, right: boolean }, ['back', 'left', 'right']), stageWallHeightM: number(.1, 20), auditoriumBarriersEnabled: boolean, obstructionEnabled: boolean, obstructionWidthM: number(.05, 100), obstructionHeightM: number(.05, 100), obstructionX: coordinate, obstructionDepthM: number(0, 100) }),
  selectedPersonIds: array(localId, 128), personEditView: enumeration(['top', 'front', '3d']), modelView: enumeration(['isometric', 'side']),
  personArrangement: object({ spacingMode: enumeration(['fixed', 'endpoints']), axis: enumeration(['x', 'z', 'diagonal']), spacingCm: { type: 'number', exclusiveMinimum: 0 } }, ['spacingMode', 'axis']),
}), semantic: 'simulation_schema3_state' };
const timestamp = { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{3})?Z$', semantic: 'local_timestamp' };
export const PRIVATE_STAGE_PRESET_JSON_SCHEMA = freeze({ ...object({ schemaVersion: { type: 'number', enum: [3] }, id: localId, name: str(100), context: localContext, state: stateShape, createdAt: timestamp, updatedAt: timestamp }, ['schemaVersion', 'id', 'name', 'context', 'state', 'createdAt', 'updatedAt']), semantic: 'simulation_schema3_preset' });
const uuid = { type: 'string', pattern: UUID.source };
const sourceIdentity = { type: 'object', semantic: 'canonical_source_identity', additionalProperties: false,
  properties: Object.fromEntries(['kind', 'information_record_id', 'informationRecordId', 'layout_version_id', 'layoutVersionId', 'configuration_key', 'configurationKey', 'frame_id', 'frameId', 'seat_id', 'seatId', 'venue_id', 'venueId', 'model_id', 'modelId', 'model_version', 'modelVersion', 'production_run_id', 'productionRunId', 'source', 'venue_name', 'venueName', 'seat_label', 'seatLabel'].map(k => [k, { oneOf: [{ type: 'string', maxLength: 500 }, { type: 'number', integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }], nullable: true }])), required: [] };
const selectionShape = object({ projectRef: enumeration([PROJECT]), registryId: uuid, sourceScheme: enumeration(['source2d', 'legacy3d']), sourceIdentity }, ['projectRef', 'registryId', 'sourceScheme', 'sourceIdentity']);
export const PRIVATE_STAGE_SNAPSHOT_JSON_SCHEMA = freeze({ ...object({ contract: enumeration([PRIVATE_STAGE_SNAPSHOT_SCHEMA]), preset: PRIVATE_STAGE_PRESET_JSON_SCHEMA,
  canonicalMapping: object({ registry_id: uuid, venue_id: uuid, layout_edition_id: uuid, model_revision_id: { type: 'string', pattern: MODEL_UUID.source }, seat_id: uuid, source_selection: selectionShape,
    seats: array(object({ localSeat: seat, seat_id: uuid, source_selection: selectionShape }, ['localSeat', 'seat_id', 'source_selection']), PRIVATE_STAGE_SNAPSHOT_LIMITS.seats) }, ['registry_id', 'venue_id', 'layout_edition_id', 'model_revision_id', 'seat_id', 'source_selection', 'seats']),
}, ['contract', 'preset', 'canonicalMapping']), semantic: 'private_stage_snapshot_v2' });
