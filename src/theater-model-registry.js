const STATUSES = new Set(['stage_ready', 'approximate_ready', 'awaiting_geometry', 'identity_review']);
const renderableStatus = status => status === 'stage_ready' || status === 'approximate_ready';
const MODEL_FIELDS = ['venueId', 'layoutVersionId', 'venuePath', 'modelPath', 'defaultSeat'];
const ENTRY_FIELDS = ['informationRecordId', 'hallName', 'address', 'status', ...MODEL_FIELDS];
const text = value => typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isInteger(value) && value >= 1 && value <= 500;
const coordinate = value => finite(value) && Math.abs(value) <= 1000;
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };

function record(value, path, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'plain object required');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(item => !('value' in item))) fail(path, 'data properties required');
  if (fields && Object.keys(value).some(key => !fields.includes(key))) fail(path, 'unknown field');
}

function requiredText(value, path) {
  if (!text(value)) fail(path, 'nonempty text required');
  return value;
}

function nullableText(value, path) {
  if (value !== null && !text(value)) fail(path, 'text or explicit null required');
  return value;
}

function localDataPath(value, path) {
  if (typeof value !== 'string' || !/^\.\/data\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.json$/u.test(value)
      || value.slice(2).split('/').some(part => !part || part === '.' || part === '..')) fail(path, 'local ./data/...json path required without traversal or URL encoding');
  return value;
}

function seatReference(value, path) {
  record(value, path, ['row', 'number']);
  if (!integer(value.row) || !integer(value.number)) fail(path, 'positive integer row and number required');
  return { row: value.row, number: value.number };
}

/**
 * Information records remain separate from renderable local models. A pending
 * entry cannot borrow paths, IDs or a seat from a different theater.
 */
export function normalizeTheaterModelRegistry(input) {
  record(input, 'registry', ['schemaVersion', 'entries']);
  if (input.schemaVersion !== 1) fail('registry.schemaVersion', 'unsupported schema version');
  if (!Array.isArray(input.entries) || !input.entries.length) fail('registry.entries', 'nonempty entries array required');
  const informationIds = new Set(), venueIds = new Set(), layoutIds = new Set();
  const entries = input.entries.map((entry, index) => {
    const path = `registry.entries[${index}]`;
    record(entry, path, ENTRY_FIELDS);
    const informationRecordId = requiredText(entry.informationRecordId, `${path}.informationRecordId`);
    if (informationIds.has(informationRecordId)) fail(`${path}.informationRecordId`, 'duplicate information record ID');
    informationIds.add(informationRecordId);
    const hallName = nullableText(entry.hallName, `${path}.hallName`);
    if (!STATUSES.has(entry.status)) fail(`${path}.status`, 'unsupported model status');
    record(entry.address, `${path}.address`, ['road', 'sourceRefs']);
    const road = nullableText(entry.address.road, `${path}.address.road`);
    if (!Array.isArray(entry.address.sourceRefs)) fail(`${path}.address.sourceRefs`, 'source references array required');
    const sourceRefs = entry.address.sourceRefs.map((ref, refIndex) => {
      const refPath = `${path}.address.sourceRefs[${refIndex}]`;
      record(ref, refPath, ['sourceId', 'locator', 'claim']);
      const result = { sourceId: requiredText(ref.sourceId, `${refPath}.sourceId`) };
      for (const key of ['locator', 'claim']) if (key in ref) result[key] = requiredText(ref[key], `${refPath}.${key}`);
      return result;
    });
    if (road !== null && !sourceRefs.length) fail(`${path}.address`, 'a known road address requires source references');
    const result = { informationRecordId, venueId: null, hallName, layoutVersionId: null, venuePath: null,
      modelPath: null, defaultSeat: null, address: { road, sourceRefs }, status: entry.status };
    if (!renderableStatus(entry.status)) {
      if (MODEL_FIELDS.some(key => entry[key] !== null)) fail(path, 'pending model fields must all be explicit null');
      return result;
    }
    result.venueId = requiredText(entry.venueId, `${path}.venueId`);
    result.layoutVersionId = requiredText(entry.layoutVersionId, `${path}.layoutVersionId`);
    if (venueIds.has(result.venueId)) fail(`${path}.venueId`, 'duplicate ready venue ID');
    if (layoutIds.has(result.layoutVersionId)) fail(`${path}.layoutVersionId`, 'duplicate ready layout ID');
    venueIds.add(result.venueId); layoutIds.add(result.layoutVersionId);
    result.venuePath = localDataPath(entry.venuePath, `${path}.venuePath`);
    result.modelPath = localDataPath(entry.modelPath, `${path}.modelPath`);
    result.defaultSeat = seatReference(entry.defaultSeat, `${path}.defaultSeat`);
    return result;
  });
  const definitions = entries.filter(entry => renderableStatus(entry.status)).map(entry => ({
    id: entry.venueId, name: entry.hallName || entry.informationRecordId,
    venuePath: entry.venuePath, modelPath: entry.modelPath, defaultSeat: { ...entry.defaultSeat },
    informationRecordId: entry.informationRecordId, layoutVersionId: entry.layoutVersionId,
    ...(entry.status === 'approximate_ready' ? { modelKind: 'approximate' } : {}),
  }));
  return { entries, definitions };
}

/**
 * Validate raw geometry before normalizeGeometry can supply demo defaults or
 * discard damaged coordinates. This checks a renderable model, not whether its
 * measurements or identity have been verified by an operator.
 * Returns true on success and throws on any incomplete/mismatched input.
 */
export function validateRenderableTheaterModel(model, definition) {
  record(definition, 'definition');
  requiredText(definition.id, 'definition.id');
  requiredText(definition.layoutVersionId, 'definition.layoutVersionId');
  record(model, 'model');
  if (!(model.status === 'plan_interpreted' || (model.status === 'synthetic_fixture' && model.synthetic === true && model.venueId === 'synthetic-portfolio-orbit-042'))) fail('model.status', 'plan_interpreted model required');
  if (model.venueId !== definition.id) fail('model.venueId', 'venue ID differs from registry');
  if (model.modelId !== definition.layoutVersionId) fail('model.modelId', 'layout ID differs from registry');
  const approximate = definition.modelKind === 'approximate';
  if (approximate && model.approximate !== true) fail('model.approximate', 'explicit approximate model required');
  if (!approximate && model.approximate === true) fail('model.approximate', 'approximate models require their own registry status');
  record(model.geometry, 'model.geometry');
  const g = model.geometry;
  for (const key of ['stageWidthM', 'stageDepthM', 'stageHeightM']) {
    if (!coordinate(g[key]) || (key === 'stageHeightM' ? g[key] < 0 : g[key] <= 0)) fail(`model.geometry.${key}`, 'finite valid stage dimension required');
  }
  if (!Array.isArray(g.stagePolygon) || g.stagePolygon.length < 3) fail('model.geometry.stagePolygon', 'at least three stage points required');
  for (const [index, point] of g.stagePolygon.entries()) {
    record(point, `model.geometry.stagePolygon[${index}]`);
    if (!coordinate(point.x) || !coordinate(point.z)) fail(`model.geometry.stagePolygon[${index}]`, 'finite x/z coordinates required');
  }
  if (!Array.isArray(g.seats) || !g.seats.length) fail('model.geometry.seats', 'explicit positioned seats required');
  const pairs = new Set(), labels = new Set(), ids = new Set();
  for (const [index, seat] of g.seats.entries()) {
    const path = `model.geometry.seats[${index}]`; record(seat, path);
    if (!integer(seat.row) || !integer(seat.number)) fail(path, 'positive integer row/number required');
    if (!['x', 'z', 'floorY'].every(key => coordinate(seat[key]))) fail(path, 'finite x/z/floorY required; unknown seats belong in seatMapping');
    requiredText(seat.label, `${path}.label`);
    const pair = `${seat.row}:${seat.number}`, label = seat.label.normalize('NFC');
    if (pairs.has(pair)) fail(path, 'duplicate row:number');
    if (labels.has(label)) fail(path, 'duplicate seat label');
    pairs.add(pair); labels.add(label);
    if ('id' in seat) {
      requiredText(seat.id, `${path}.id`);
      if (ids.has(seat.id)) fail(path, 'duplicate seat ID');
      ids.add(seat.id);
    }
  }
  if ('defaultSeat' in definition) {
    const seat = seatReference(definition.defaultSeat, 'definition.defaultSeat');
    if (!pairs.has(`${seat.row}:${seat.number}`)) fail('definition.defaultSeat', 'default seat is not positioned in this model');
  }
  if (!Array.isArray(g.rowPlatforms) || (!approximate && !g.rowPlatforms.length)) fail('model.geometry.rowPlatforms', 'explicit row platforms required for interpreted seat-floor models');
  for (const [index, platform] of g.rowPlatforms.entries()) {
    const path = `model.geometry.rowPlatforms[${index}]`; record(platform, path);
    if (!integer(platform.row) || !['xMin', 'xMax', 'zStart', 'zEnd', 'y'].every(key => coordinate(platform[key]))
        || platform.xMax <= platform.xMin || platform.zEnd <= platform.zStart) fail(path, 'finite valid row platform required');
  }
  return true;
}
