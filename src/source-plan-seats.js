/** Selectable drawing seats, independent of a measured audience-floor model.
 * Coordinates use either a conditional local metre scale or explicit diagram
 * units. The retained widthM/depthM API names do not give diagrams metric scale.
 * Labels, official identity and missing rotation remain source/user facts. */
const SCHEMA = 'theater-selectable-plan/v1';
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const finite = value => typeof value === 'number' && Number.isFinite(value);

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'plain object required');
}

/** Keep extra JSON source metadata, but do not evaluate accessors, run toJSON,
 * silently turn NaN into null or share a mutable nested object with the caller. */
function copyJSON(value, path = 'plan', ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path, 'finite JSON number required');
    return value;
  }
  if (!value || typeof value !== 'object') fail(path, 'JSON data required');
  if (ancestors.has(value)) fail(path, 'cyclic data unsupported');
  if (!Array.isArray(value)) object(value, path);
  if (Object.getOwnPropertySymbols(value).length) fail(path, 'symbol keys unsupported');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !own(descriptor, 'value'))) fail(path, 'accessors unsupported');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail(path, 'array data properties unsupported');
      const result = [];
      for (let index = 0; index < value.length; index++) {
        if (!own(value, index)) fail(path, 'sparse array unsupported');
        result.push(copyJSON(descriptors[index].value, `${path}[${index}]`, ancestors));
      }
      return result;
    }
    const result = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) fail(`${path}.${key}`, 'enumerable JSON data required');
      Object.defineProperty(result, key, { value: copyJSON(descriptor.value, `${path}.${key}`, ancestors), enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally { ancestors.delete(value); }
}

function required(value, names, path) {
  for (const name of names) if (!own(value, name)) fail(`${path}.${name}`, 'explicit value required');
}
function text(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !value.trim()) fail(path, nullable ? 'nonempty text or explicit null required' : 'nonempty text required');
}
function array(value, path) { if (!Array.isArray(value)) fail(path, 'array required'); }
function unique(value, seen, path) {
  const key = value.normalize('NFC');
  if (seen.has(key)) fail(path, 'duplicate identity');
  seen.add(key);
}

function validateFrame(frame, path, seatIDs = new Set(), allowEmptyStage = true) {
  object(frame, path);
  required(frame, ['id', 'label', 'stagePolygon', 'seats'], path);
  text(frame.id, `${path}.id`); text(frame.label, `${path}.label`);
  array(frame.stagePolygon, `${path}.stagePolygon`);
  // A selection-only diagram can lack an extracted stage outline. Conditional
  // metric plans need three stage points, without a survey/precision gate.
  if (frame.stagePolygon.length < 3 && (!allowEmptyStage || frame.stagePolygon.length > 0)) fail(`${path}.stagePolygon`, allowEmptyStage ? 'empty or at least three points required' : 'at least three points required for conditional_mm');
  for (const [index, point] of frame.stagePolygon.entries()) {
    const location = `${path}.stagePolygon[${index}]`; object(point, location);
    if (!finite(point.x) || !finite(point.z)) fail(location, 'finite x/z required');
  }
  array(frame.seats, `${path}.seats`);
  const geometryIDs = new Set();
  for (const [index, seat] of frame.seats.entries()) {
    const location = `${path}.seats[${index}]`; object(seat, location);
    required(seat, ['id', 'sourceGeometryId', 'label', 'officialSeatId', 'rowLabel', 'x', 'z', 'widthM', 'depthM', 'rotationDeg'], location);
    for (const key of ['id', 'sourceGeometryId', 'label']) text(seat[key], `${location}.${key}`);
    text(seat.officialSeatId, `${location}.officialSeatId`, true);
    text(seat.rowLabel, `${location}.rowLabel`, true);
    unique(seat.id, seatIDs, `${location}.id`);
    unique(seat.sourceGeometryId, geometryIDs, `${location}.sourceGeometryId`);
    if (!finite(seat.x) || !finite(seat.z)) fail(location, 'finite seat-centre x/z required');
    if (!finite(seat.widthM) || seat.widthM <= 0 || !finite(seat.depthM) || seat.depthM <= 0) fail(location, 'positive finite widthM/depthM required');
    if (seat.rotationDeg !== null && !finite(seat.rotationDeg)) fail(`${location}.rotationDeg`, 'finite degrees or explicit null required');
  }
}

/** Return a detached plan or throw TypeError. No inferred official seat ID,
 * row, rotation, floor height, physical venue identity or camera is created. */
export function normalizeSourceSeatPlan(input) {
  const plan = copyJSON(input);
  object(plan, 'plan');
  required(plan, ['schema', 'informationRecordId', 'venueId', 'layoutVersionId', 'title', 'unitScope', 'frames'], 'plan');
  if (plan.schema !== SCHEMA) fail('plan.schema', 'theater-selectable-plan/v1 required');
  text(plan.informationRecordId, 'plan.informationRecordId');
  text(plan.venueId, 'plan.venueId', true); text(plan.layoutVersionId, 'plan.layoutVersionId', true);
  text(plan.title, 'plan.title');
  if (!['conditional_mm', 'selection_diagram'].includes(plan.unitScope)) fail('plan.unitScope', 'conditional_mm or selection_diagram required');
  array(plan.frames, 'plan.frames');
  if (!plan.frames.length) fail('plan.frames', 'at least one source frame required');
  const frameIDs = new Set(), seatIDs = new Set();
  for (const [index, frame] of plan.frames.entries()) {
    validateFrame(frame, `plan.frames[${index}]`, seatIDs, plan.unitScope === 'selection_diagram');
    unique(frame.id, frameIDs, `plan.frames[${index}].id`);
  }
  return plan;
}

const spelling = value => value.normalize('NFC').toUpperCase().replace(/\s+/gu, '')
  .replace(/[0-9]+/g, digits => digits.replace(/^0+(?=\d)/, ''));
const aliases = value => !Array.isArray(value) ? [] : value.flatMap(alias => {
  const label = typeof alias === 'string' ? alias : alias?.label;
  return typeof label === 'string' && label.trim() ? [label] : [];
});
const option = (value, path) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') fail(path, 'text or empty value required');
  return value.trim() ? value : '';
};
function includesQuery(key, query) {
  let index = key.indexOf(query);
  while (index !== -1) {
    const end = index + query.length;
    const joinsPreviousNumber = /^[0-9]/.test(query) && index > 0 && /[0-9]/.test(key[index - 1]);
    const joinsNextNumber = /[0-9]$/.test(query) && end < key.length && /[0-9]/.test(key[end]);
    if (!joinsPreviousNumber && !joinsNextNumber) return true;
    index = key.indexOf(query, index + 1);
  }
  return false;
}

/** Return all matching {frameId,seat} candidates, in source order. Exact
 * normalized labels win over substrings; a numeric-only query matches whole
 * numeric tokens, so 01 does not silently select 11 or 101. Normalization is
 * for searching only and never changes a source label or official identity. */
export function findSourcePlanSeats(input, { frameId, query, rowLabel } = {}) {
  const plan = normalizeSourceSeatPlan(input);
  const frameFilter = option(frameId, 'search.frameId');
  const queryKey = spelling(option(query, 'search.query'));
  const rowKey = spelling(option(rowLabel, 'search.rowLabel'));
  const candidates = [];
  for (const frame of plan.frames) {
    if (frameFilter && frame.id !== frameFilter) continue;
    for (const seat of frame.seats) {
      const rows = [seat.rowLabel, ...aliases(seat.rowAliases)].filter(value => typeof value === 'string').map(spelling);
      if (rowKey && !rows.includes(rowKey)) continue;
      const labels = [seat.label, ...aliases(seat.aliases)];
      const labelKeys = labels.map(spelling);
      const keys = [...labelKeys, ...rows, ...rows.flatMap(row => labelKeys.map(label => row + label))];
      const explicitNumber = seat.sourceLabels && Object.hasOwn(seat.sourceLabels, 'numberText');
      const numberText = seat.sourceLabels?.numberText;
      const numericKeys = explicitNumber ? (typeof numberText === 'string' && numberText.trim() ? [spelling(numberText)] : []) : labelKeys;
      candidates.push({ frameId: frame.id, seat, keys, labelKeys, numericKeys });
    }
  }
  if (!queryKey) return candidates.map(({ frameId: id, seat }) => ({ frameId: id, seat }));
  const numericOnly = /^[0-9]+$/.test(queryKey);
  const exact = candidates.filter(item => (numericOnly ? item.numericKeys : item.keys).includes(queryKey));
  // A numeric chair query must not match every chair in row "1". Rows have
  // their own filter; nonnumeric row queries such as "1열" still work.
  const matches = exact.length ? exact : candidates.filter(item => (numericOnly ? item.numericKeys : item.keys).some(key => numericOnly
    ? (key.match(/[0-9]+/g) || []).includes(queryKey) : includesQuery(key, queryKey)));
  return matches.map(({ frameId: id, seat }) => ({ frameId: id, seat }));
}

/** Hit-test seat-centred rectangles in one frame. Positive degrees turn +x
 * toward +z. Unknown rotation uses an unrotated drawing hit box, while its
 * source null is retained. radiusM expands the actual rectangle edge rather
 * than using a centre-radius approximation. For selection_diagram these are
 * drawing units, not metres. All overlaps remain candidates. */
export function hitSourcePlanSeats(input, point, radiusM = 0) {
  const frame = copyJSON(input, 'frame'); validateFrame(frame, 'frame');
  object(point, 'point');
  if (!finite(point.x) || !finite(point.z)) fail('point', 'finite x/z required');
  if (!finite(radiusM) || radiusM < 0) fail('radiusM', 'finite nonnegative radius required');
  const hits = [];
  for (const [index, seat] of frame.seats.entries()) {
    const dx = point.x - seat.x, dz = point.z - seat.z;
    // Finite inputs can still overflow during subtraction or rotation. Work
    // in a scaled coordinate frame in that case; do not use an infinite error
    // tolerance or impose a physical-precision limit on source coordinates.
    const rescale = !finite(dx) || !finite(dz) || !finite(Math.abs(dx) + Math.abs(dz));
    const scale = rescale ? Math.max(Math.abs(point.x), Math.abs(point.z), Math.abs(seat.x), Math.abs(seat.z), seat.widthM, seat.depthM, radiusM) : 1;
    const deltaX = rescale ? point.x / scale - seat.x / scale : dx;
    const deltaZ = rescale ? point.z / scale - seat.z / scale : dz;
    const width = seat.widthM / scale, depth = seat.depthM / scale;
    const radians = ((seat.rotationDeg ?? 0) % 360) * Math.PI / 180;
    const cosine = Math.cos(radians), sine = Math.sin(radians);
    const x = deltaX * cosine + deltaZ * sine, z = -deltaX * sine + deltaZ * cosine;
    let outsideX = Math.max(0, Math.abs(x) - width / 2), outsideZ = Math.max(0, Math.abs(z) - depth / 2);
    if (!rescale && radians === 0) {
      // The unrotated drawing endpoints are centre +/- half extent. Compare
      // those finite absolute coordinates directly: subtracting the centre
      // first can retain endpoint-addition roundoff larger than local error.
      const left = seat.x - width / 2, right = seat.x + width / 2;
      const top = seat.z - depth / 2, bottom = seat.z + depth / 2;
      if ([left, right, top, bottom].every(finite)) {
        outsideX = Math.max(0, left - point.x, point.x - right);
        outsideZ = Math.max(0, top - point.z, point.z - bottom);
      }
    }
    const tolerance = Number.EPSILON * 16 * Math.max(Math.abs(deltaX), Math.abs(deltaZ), width, depth);
    const inside = outsideX <= tolerance && outsideZ <= tolerance;
    const edge = inside ? 0 : Math.hypot(outsideX, outsideZ);
    if (edge <= radiusM / scale + tolerance) {
      const centre = Math.hypot(deltaX, deltaZ);
      hits.push({ seat, distanceM: centre * scale, edgeDistanceM: edge * scale, inside, index, logDistance: Math.log(centre) + Math.log(scale) });
    }
  }
  hits.sort((a, b) => a.distanceM - b.distanceM || a.logDistance - b.logDistance || a.index - b.index);
  return hits.map(({ index, logDistance, ...hit }) => hit);
}
