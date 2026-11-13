// Experimental offline data contract only. This verifies a selected local
// snapshot; it grants no administrator/author authority and performs no I/O.
export const OFFLINE_SERVICE_BUNDLE_SCHEMA = 'theater-offline-service-bundle/experimental-v0';
export const OFFLINE_SERVICE_BUNDLE_COMPATIBILITY = 'offline-core/experimental-v0';
export const OFFLINE_SERVICE_BUNDLE_LIMITS = Object.freeze({ maxRecords: 10000, maxAssets: 1000, maxAssetBytes: 25 * 1024 * 1024, maxTotalBytes: 100 * 1024 * 1024 });
const validated = new WeakSet();
const collections = ['layouts', 'seats', 'posts', 'photos'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const typedLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
const typedBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer').get;
const error = (code, path) => { throw Object.assign(new TypeError(code + ': ' + path), { code, path }); };

function plain(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) error('INVALID_SHAPE', path);
}
function fields(value, names, path) {
  plain(value, path);
  if (Object.keys(value).some(key => !names.includes(key)) || names.some(key => !own(value, key))) error('UNSUPPORTED_FIELD', path);
}
function cloneJSON(value, path = 'input', ancestors = new Set(), budget = { count: 0 }, depth = 0) {
  if (++budget.count > 200000 || depth > 20) error('RESOURCE_LIMIT', path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (value.length > 1000000) error('RESOURCE_LIMIT', path); return value; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) error('INVALID_SHAPE', path); return value; }
  if (!value || typeof value !== 'object' || ancestors.has(value)) error('INVALID_SHAPE', path);
  if (!Array.isArray(value)) plain(value, path);
  if (Object.getOwnPropertySymbols(value).length) error('INVALID_SHAPE', path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(descriptor => !own(descriptor, 'value'))) error('INVALID_SHAPE', path);
  ancestors.add(value);
  let copy;
  if (Array.isArray(value)) {
    if (value.length > 10000) error('RESOURCE_LIMIT', path);
    if (Object.entries(descriptors).some(([key, descriptor]) => key !== 'length' &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !descriptor.enumerable))) error('INVALID_SHAPE', path);
    copy = [];
    for (let i = 0; i < value.length; i++) {
      if (!own(descriptors, i)) error('INVALID_SHAPE', path);
      copy.push(cloneJSON(descriptors[i].value, path + '[' + i + ']', ancestors, budget, depth + 1));
    }
  } else {
    copy = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) error('INVALID_SHAPE', path);
      copy[key] = cloneJSON(descriptor.value, path + '.' + key, ancestors, budget, depth + 1);
    }
  }
  ancestors.delete(value);
  return copy;
}
function id(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,299}$/.test(value)) error('INVALID_ID', path);
}
function label(value, path, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) error('INVALID_TEXT', path);
}
function integer(value, path, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) error('RESOURCE_LIMIT', path);
}
function deepFreeze(value) { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}';
}
/** Canonical bytes bind the exact selected records, not a DB transaction or
 * trusted issuer. A malicious issuer can recompute every checksum. */
export function canonicalOfflineRecordsBytes(records) { return new TextEncoder().encode(canonicalJSON(cloneJSON(records, 'records'))); }

// The existing photo-metadata module reads JPEG SOF dimensions too. This
// smaller v0 boundary additionally rejects pre-scan metadata/comment segments.
// Neither parser fully decodes pixels or proves original aspect/no-upscale.
function jpegHeader(bytes, path) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) error('FORMAT_MISMATCH', path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2, dimensions = null, scan = false;
  for (let n = 0; n < 4096 && offset < bytes.length; n++) {
    if (bytes[offset++] !== 255) error('IMAGE_HEADER_INVALID', path);
    while (bytes[offset] === 255) offset++;
    if (offset >= bytes.length) error('IMAGE_HEADER_INVALID', path);
    const marker = bytes[offset++];
    if (marker === 0xda) { scan = true; break; }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) error('IMAGE_HEADER_INVALID', path);
    const size = view.getUint16(offset);
    if (size < 2 || offset + size > bytes.length) error('IMAGE_HEADER_INVALID', path);
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) error('IMAGE_METADATA_UNSUPPORTED', path);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (dimensions || size < 8 || bytes[offset + 2] !== 8) error('IMAGE_HEADER_INVALID', path);
      dimensions = { pixelHeight: view.getUint16(offset + 3), pixelWidth: view.getUint16(offset + 5) };
    }
    offset += size;
  }
  if (!scan || !dimensions || !dimensions.pixelWidth || !dimensions.pixelHeight) error('IMAGE_HEADER_INVALID', path);
  return dimensions;
}

export function isValidatedOfflineServiceBundle(snapshot) { return validated.has(snapshot); }

export async function validateOfflineServiceBundle(input, { sha256 } = {}) {
  if (typeof sha256 !== 'function') error('HASH_NOT_CONFIGURED', 'options.sha256');
  plain(input, 'input');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length || Object.keys(descriptors).some(key => !['manifest', 'records', 'files'].includes(key)) ||
      ['manifest', 'records', 'files'].some(key => !descriptors[key] || !own(descriptors[key], 'value'))) error('INVALID_SHAPE', 'input');
  // Copy all caller-owned metadata and bytes before the first await.
  const manifest = cloneJSON(descriptors.manifest.value, 'manifest');
  const records = cloneJSON(descriptors.records.value, 'records');
  fields(manifest, ['schema', 'bundleId', 'snapshotRevision', 'createdAt', 'appCompatibility', 'scope', 'complete', 'counts', 'recordsSha256', 'assets'], 'manifest');
  if (manifest.schema !== OFFLINE_SERVICE_BUNDLE_SCHEMA) error('UNSUPPORTED_SCHEMA', 'manifest.schema');
  if (manifest.appCompatibility !== OFFLINE_SERVICE_BUNDLE_COMPATIBILITY) error('UNSUPPORTED_APP', 'manifest.appCompatibility');
  if (manifest.scope !== 'explicit-selected-service-records') error('UNSUPPORTED_SCOPE', 'manifest.scope');
  if (manifest.complete !== true) error('INCOMPLETE_BUNDLE', 'manifest.complete');
  if (typeof manifest.recordsSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.recordsSha256)) error('INVALID_HASH', 'manifest.recordsSha256');
  id(manifest.bundleId, 'manifest.bundleId'); id(manifest.snapshotRevision, 'manifest.snapshotRevision');
  if (typeof manifest.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(manifest.createdAt) ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || new Date(manifest.createdAt).toISOString().replace('.000Z', 'Z') !== manifest.createdAt.replace('.000Z', 'Z')) error('INVALID_TIMESTAMP', 'manifest.createdAt');
  fields(records, collections, 'records'); fields(manifest.counts, collections, 'manifest.counts');
  let totalRecords = 0;
  const maps = {};
  for (const name of collections) {
    if (!Array.isArray(records[name])) error('INVALID_SHAPE', 'records.' + name);
    totalRecords += records[name].length;
    if (totalRecords > OFFLINE_SERVICE_BUNDLE_LIMITS.maxRecords) error('RESOURCE_LIMIT', 'records');
    if (manifest.counts[name] !== records[name].length) error('COUNT_MISMATCH', 'manifest.counts.' + name);
    maps[name] = new Map();
    for (const record of records[name]) {
      plain(record, 'records.' + name); id(record.id, name + '.id'); id(record.revision, name + '.revision');
      if (maps[name].has(record.id)) error('DUPLICATE_ID', name + '.id'); maps[name].set(record.id, record);
    }
  }
  for (const r of records.layouts) {
    fields(r, ['id', 'revision', 'informationRecordId', 'hallId', 'configurationKey', 'coordinateSystem'], 'layouts');
    id(r.informationRecordId, 'layouts.informationRecordId'); id(r.hallId, 'layouts.hallId', true); id(r.configurationKey, 'layouts.configurationKey');
    if (!['source_image_px', 'local_meters'].includes(r.coordinateSystem)) error('COORDINATE_SYSTEM_INVALID', 'layouts.coordinateSystem');
  }
  for (const r of records.seats) {
    fields(r, ['id', 'revision', 'layoutId', 'frameId', 'displayLabel', 'officialSeatId'], 'seats');
    id(r.layoutId, 'seats.layoutId'); id(r.frameId, 'seats.frameId'); id(r.officialSeatId, 'seats.officialSeatId', true); label(r.displayLabel, 'seats.displayLabel', 500);
    if (!maps.layouts.has(r.layoutId)) error('BROKEN_REFERENCE', 'seats.layoutId');
  }
  for (const r of records.posts) {
    fields(r, ['id', 'revision', 'seatId', 'performanceTitle', 'opinion'], 'posts');
    id(r.seatId, 'posts.seatId'); label(r.performanceTitle, 'posts.performanceTitle', 500); label(r.opinion, 'posts.opinion', 100000, true);
    if (!maps.seats.has(r.seatId)) error('BROKEN_REFERENCE', 'posts.seatId');
  }
  for (const r of records.photos) {
    fields(r, ['id', 'revision', 'postId', 'assetId', 'sourceReferenceId'], 'photos');
    id(r.postId, 'photos.postId'); id(r.assetId, 'photos.assetId'); id(r.sourceReferenceId, 'photos.sourceReferenceId', true);
    if (!maps.posts.has(r.postId)) error('BROKEN_REFERENCE', 'photos.postId');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length > OFFLINE_SERVICE_BUNDLE_LIMITS.maxAssets) error('RESOURCE_LIMIT', 'manifest.assets');
  const assets = new Map(), paths = new Set();
  for (const a of manifest.assets) {
    fields(a, ['id', 'revision', 'path', 'role', 'byteSize', 'mediaType', 'sha256', 'pixelWidth', 'pixelHeight', 'orientation'], 'assets');
    id(a.id, 'assets.id'); id(a.revision, 'assets.revision');
    if (assets.has(a.id) || paths.has(a.path)) error('DUPLICATE_ID', 'assets');
    if (typeof a.path !== 'string' || !/^assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.jpg$/.test(a.path)) error('INVALID_PATH', 'assets.path');
    if (a.role !== 'service_fhd_copy') error('UNSUPPORTED_ASSET_ROLE', 'assets.role');
    if (a.mediaType !== 'image/jpeg' || a.orientation !== 1) error('FORMAT_MISMATCH', 'assets.mediaType');
    integer(a.byteSize, 'assets.byteSize', OFFLINE_SERVICE_BUNDLE_LIMITS.maxAssetBytes);
    integer(a.pixelWidth, 'assets.pixelWidth', 1920); integer(a.pixelHeight, 'assets.pixelHeight', 1920);
    const w = a.pixelWidth, h = a.pixelHeight;
    if (w > h ? w > 1920 || h > 1080 : w < h ? w > 1080 || h > 1920 : w > 1080) error('FHD_LIMIT_EXCEEDED', 'assets.dimensions');
    if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256)) error('INVALID_HASH', 'assets.sha256');
    assets.set(a.id, a); paths.add(a.path);
  }
  const usedAssets = new Set();
  for (const r of records.photos) { if (!assets.has(r.assetId)) error('BROKEN_REFERENCE', 'photos.assetId'); usedAssets.add(r.assetId); }
  if (usedAssets.size !== assets.size) error('UNREFERENCED_ASSET', 'manifest.assets');
  const fileMap = descriptors.files.value;
  if (!(fileMap instanceof Map) || Object.getPrototypeOf(fileMap) !== Map.prototype || Object.getOwnPropertyNames(fileMap).length || Object.getOwnPropertySymbols(fileMap).length) error('INVALID_SHAPE', 'files');
  if (fileMap.size !== assets.size) error('FILE_SET_MISMATCH', 'files');
  const copied = new Map(); let totalBytes = 0;
  for (const [filePath, value] of fileMap) {
    if (!paths.has(filePath)) error('UNEXPECTED_FILE', 'files');
    let length;
    try { if (!(value instanceof Uint8Array) || !(typedBuffer.call(value) instanceof ArrayBuffer)) error('INVALID_BYTES', 'files'); length = typedLength.call(value); } catch { error('INVALID_BYTES', 'files'); }
    integer(length, 'files.byteSize', OFFLINE_SERVICE_BUNDLE_LIMITS.maxAssetBytes);
    totalBytes += length; if (totalBytes > OFFLINE_SERVICE_BUNDLE_LIMITS.maxTotalBytes) error('RESOURCE_LIMIT', 'files');
    const bytes = new Uint8Array(length); bytes.set(value); copied.set(filePath, bytes);
  }
  let recordsDigest;
  try { recordsDigest = await sha256(canonicalOfflineRecordsBytes(records)); } catch { error('HASH_FAILED', 'manifest.recordsSha256'); }
  if (typeof recordsDigest !== 'string' || !/^[a-f0-9]{64}$/.test(recordsDigest)) error('HASH_FAILED', 'manifest.recordsSha256');
  if (recordsDigest !== manifest.recordsSha256) error('HASH_MISMATCH', 'manifest.recordsSha256');
  for (const a of assets.values()) {
    const bytes = copied.get(a.path); if (!bytes) error('ASSET_MISSING', 'assets.path');
    if (bytes.length !== a.byteSize) error('BYTE_SIZE_MISMATCH', 'assets.byteSize');
    const dimensions = jpegHeader(bytes, a.path);
    if (dimensions.pixelWidth !== a.pixelWidth || dimensions.pixelHeight !== a.pixelHeight) error('IMAGE_DIMENSION_MISMATCH', 'assets.dimensions');
    let digest; try { digest = await sha256(new Uint8Array(bytes)); } catch { error('HASH_FAILED', 'assets.sha256'); }
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) error('HASH_FAILED', 'assets.sha256');
    if (digest !== a.sha256) error('HASH_MISMATCH', 'assets.sha256');
  }
  deepFreeze(manifest); deepFreeze(records);
  const snapshot = Object.freeze({ manifest, records,
    listAssetIds: () => [...assets.keys()],
    readAsset: assetId => { const asset = assets.get(assetId); if (!asset) error('NOT_FOUND', 'assetId'); return new Uint8Array(copied.get(asset.path)); },
  });
  validated.add(snapshot); return snapshot;
}
