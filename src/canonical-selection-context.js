/** Pure local selection review. No identity allocation, storage or transport.
 *
 * This small registry is an explicit, reviewed selection projection, NOT an
 * IdentityMap checkpoint or a canonical snapshot. A caller must retain the
 * reviewed mapping; registryId/mappingStatus do not authenticate its provenance.
 * A result never grants publication, database access or renderer activation.
 */
export const CANONICAL_SELECTION_PROJECT_REF = 'portfolio-demo-disabled';
export const CANONICAL_SELECTION_REGISTRY_SCHEMA = 'theater3d.canonical-selection-registry/v1';

const MAX_ROWS = 4096;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ERROR_CODES = new WeakMap();
const ALIASES = Object.freeze({
  informationRecordId: 'information_record_id', layoutVersionId: 'layout_version_id',
  configurationKey: 'configuration_key', frameId: 'frame_id', seatId: 'seat_id',
  venueId: 'venue_id', modelId: 'model_id', modelVersion: 'model_version',
  productionRunId: 'production_run_id', venueName: 'venue_name', seatLabel: 'seat_label',
});
const SOURCE2D = ['kind', 'information_record_id', 'layout_version_id', 'configuration_key', 'frame_id', 'seat_id'];
const LEGACY_REQUIRED = ['venue_id', 'model_id', 'model_version', 'seat_id'];
const LEGACY_OPTIONAL = ['layout_version_id', 'production_run_id', 'source'];
const LABELS = ['venue_name', 'seat_label'];

function reject(code) {
  const error = {};
  ERROR_CODES.set(error, code);
  throw error;
}

function fields(value, allowed, required = allowed, code = 'UNSUPPORTED_INPUT') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) reject(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) reject(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length) reject(code);
  const result = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) reject(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // Read ordinary data properties only; never invoke an accessor getter.
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) reject(code);
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result, key))) reject(code);
  return result;
}

function rows(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) reject('INVALID_REGISTRY');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = descriptor?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ROWS) reject('REGISTRY_LIMIT');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) reject('INVALID_REGISTRY');
  const result = [];
  for (let index = 0; index < length; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !Object.hasOwn(entry, 'value') || !entry.enumerable) reject('INVALID_REGISTRY');
    result.push(entry.value);
  }
  return result;
}

function opaque(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300
      || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) reject('INVALID_SOURCE_IDENTITY');
  return value;
}

function uuid(value, code = 'INVALID_REGISTRY_ID') {
  if (typeof value !== 'string' || !UUID4.test(value)) reject(code);
  return value;
}

function identity(scheme, value) {
  if (scheme !== 'source2d' && scheme !== 'legacy3d') reject('UNSUPPORTED_SOURCE_SCHEME');
  const names = [...SOURCE2D, ...LEGACY_REQUIRED, ...LEGACY_OPTIONAL, ...LABELS];
  const raw = fields(value, [...new Set([...names, ...Object.keys(ALIASES)])], [], 'INVALID_SOURCE_IDENTITY');
  const normalized = Object.create(null);
  for (const original of Object.keys(raw)) {
    const name = Object.hasOwn(ALIASES, original) ? ALIASES[original] : original;
    if (Object.hasOwn(normalized, name)) reject('AMBIGUOUS_IDENTITY_FIELD');
    normalized[name] = raw[original];
  }
  const allowed = scheme === 'source2d' ? [...SOURCE2D, ...LABELS]
    : [...LEGACY_REQUIRED, ...LEGACY_OPTIONAL, ...LABELS, 'kind'];
  const required = scheme === 'source2d' ? SOURCE2D : LEGACY_REQUIRED;
  if (Object.keys(normalized).some(key => !allowed.includes(key))
      || required.some(key => !Object.hasOwn(normalized, key))) reject('INVALID_SOURCE_IDENTITY');
  for (const label of LABELS) {
    if (Object.hasOwn(normalized, label) && normalized[label] !== null
        && (typeof normalized[label] !== 'string' || normalized[label].length > 500)) reject('INVALID_SOURCE_IDENTITY');
  }
  const result = Object.create(null);
  if (scheme === 'source2d') {
    if (normalized.kind !== 'source2d') reject('INVALID_SOURCE_IDENTITY');
    for (const key of SOURCE2D) result[key] = opaque(normalized[key]);
  } else {
    if (Object.hasOwn(normalized, 'kind') && !['legacy', 'legacy3d'].includes(normalized.kind)) reject('INVALID_SOURCE_IDENTITY');
    result.kind = 'legacy3d';
    for (const key of LEGACY_REQUIRED) {
      const value = normalized[key];
      result[key] = key === 'model_version' && Number.isSafeInteger(value) && value >= 0 ? value : opaque(value);
    }
    for (const key of LEGACY_OPTIONAL) {
      if (!Object.hasOwn(normalized, key)) continue;
      const value = normalized[key];
      if (key === 'source') {
        if (value !== null && value !== 'user_selected') reject('INVALID_SOURCE_IDENTITY');
      } else {
        // Missing and explicitly unknown are different source identities.
        result[key] = value === null ? null : opaque(value);
      }
    }
  }
  return JSON.stringify([scheme, Object.keys(result).sort().map(key => [key, result[key]])]);
}

function registryIndex(input) {
  const registry = fields(input, ['schema', 'projectRef', 'registryId', 'venues', 'layoutEditions', 'seats', 'bindings'], undefined, 'INVALID_REGISTRY');
  if (registry.schema !== CANONICAL_SELECTION_REGISTRY_SCHEMA) reject('UNSUPPORTED_REGISTRY_SCHEMA');
  if (registry.projectRef !== CANONICAL_SELECTION_PROJECT_REF) reject('PROJECT_MISMATCH');
  uuid(registry.registryId);
  const venues = rows(registry.venues), editions = rows(registry.layoutEditions);
  const seats = rows(registry.seats), bindings = rows(registry.bindings);
  if (venues.length + editions.length + seats.length + bindings.length > MAX_ROWS) reject('REGISTRY_LIMIT');
  const used = new Set([registry.registryId]);
  function reserve(id) {
    uuid(id);
    if (used.has(id)) reject('REGISTRY_ID_COLLISION');
    used.add(id);
  }
  const venueIds = new Set(), editionOwners = new Map(), seatOwners = new Map(), index = new Map();
  for (const raw of venues) {
    const row = fields(raw, ['id'], undefined, 'INVALID_REGISTRY');
    reserve(row.id); venueIds.add(row.id);
  }
  for (const raw of editions) {
    const row = fields(raw, ['id', 'venueId'], undefined, 'INVALID_REGISTRY');
    reserve(row.id); uuid(row.venueId);
    if (!venueIds.has(row.venueId)) reject('UNKNOWN_VENUE');
    editionOwners.set(row.id, row.venueId);
  }
  for (const raw of seats) {
    const row = fields(raw, ['id', 'layoutEditionId'], undefined, 'INVALID_REGISTRY');
    reserve(row.id); uuid(row.layoutEditionId);
    if (!editionOwners.has(row.layoutEditionId)) reject('UNKNOWN_EDITION');
    seatOwners.set(row.id, row.layoutEditionId);
  }
  for (const raw of bindings) {
    const row = fields(raw, ['sourceScheme', 'sourceIdentity', 'venueId', 'layoutEditionId', 'seatId', 'mappingStatus'], undefined, 'INVALID_REGISTRY');
    if (row.mappingStatus !== 'verified') reject('UNVERIFIED_MAPPING');
    uuid(row.venueId); uuid(row.layoutEditionId); uuid(row.seatId);
    if (!venueIds.has(row.venueId)) reject('UNKNOWN_VENUE');
    if (!editionOwners.has(row.layoutEditionId)) reject('UNKNOWN_EDITION');
    if (!seatOwners.has(row.seatId)) reject('UNKNOWN_SEAT');
    if (editionOwners.get(row.layoutEditionId) !== row.venueId
        || seatOwners.get(row.seatId) !== row.layoutEditionId) reject('SCOPE_MISMATCH');
    const key = identity(row.sourceScheme, row.sourceIdentity);
    if (index.has(key)) reject('DUPLICATE_BINDING');
    index.set(key, Object.freeze({venue_id: row.venueId, layout_edition_id: row.layoutEditionId, seat_id: row.seatId}));
  }
  return {registryId: registry.registryId, index};
}

function unresolved(code) {
  return Object.freeze({status: 'unresolved', code, canonical: null});
}

/** Resolve one complete source tuple against one explicitly supplied registry.
 * No labels/array positions are used to join records, and no ID is generated.
 * Validation covers the entire projection, including unselected records.
 */
export function resolveCanonicalSelection(selection, registry) {
  try {
    if (selection === null || selection === undefined) return unresolved('SELECTION_UNAVAILABLE');
    const selected = fields(selection, ['projectRef', 'registryId', 'sourceScheme', 'sourceIdentity'], undefined, 'INVALID_SELECTION');
    if (selected.projectRef !== CANONICAL_SELECTION_PROJECT_REF) reject('PROJECT_MISMATCH');
    uuid(selected.registryId);
    const key = identity(selected.sourceScheme, selected.sourceIdentity);
    if (registry === null || registry === undefined) return unresolved('REGISTRY_UNAVAILABLE');
    const checked = registryIndex(registry);
    if (selected.registryId !== checked.registryId) reject('REGISTRY_MISMATCH');
    const canonical = checked.index.get(key);
    return canonical ? Object.freeze({status: 'resolved', code: 'EXPLICIT_MAPPING', canonical})
      : unresolved('NO_EXPLICIT_MAPPING');
  } catch (error) {
    // Never reflect untrusted error messages, property names or input values.
    return unresolved(ERROR_CODES.get(error) || 'UNSUPPORTED_INPUT');
  }
}
