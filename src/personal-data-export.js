import { SIMULATION_STORAGE_KEY, createSimulationStorage } from './simulation-storage.js';
import { createFavoriteLens, updateLensConfig, DEFAULT_LENS_CONFIG } from './lens-config.js';

export const PERSONAL_DATA_EXPORT_SCHEMA = 'theater3d.personal-data-export/v1';
export const PERSONAL_DATA_EXPORT_KEYS = Object.freeze({
  simulations: SIMULATION_STORAGE_KEY,
  notes: 'theater3d-portfolio.seat-notes.v1',
  lenses: 'theater3d-portfolio.camera-lens-settings.v1',
});
const LIMIT = 1024 * 1024;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && same(a[k], b[k]));
};
const fail = code => { throw new Error(code); };
function exact(v, keys) {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !own(v, k))) fail('INVALID_DOCUMENT');
}
// Deliberately conservative recognizable material check, not full DLP. Notes
// remain private freeform text even after this check; never publish the archive.
const credentialKey = /^(?:auth(?:orization|entication)?|credentials?|password|passwd|secret|(?:access|refresh|id|api|auth)[_-]?token|token|api[_-]?key|private[_-]?key|client[_-]?secret|service[_-]?role[_-]?key)$/i;
const secretMaterial = /-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/i;
function inspect(v, depth = 0) {
  if (depth > 24) fail('LIMIT_EXCEEDED');
  if (typeof v === 'string') { if (secretMaterial.test(v)) fail('RECOGNIZED_SECRET'); return; }
  if (typeof v === 'number' && !Number.isFinite(v)) fail('INVALID_DOCUMENT');
  if (v === null || typeof v !== 'object') return;
  const entries = Object.entries(v);
  if (entries.length > 10000) fail('LIMIT_EXCEEDED');
  for (const [key, value] of entries) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || credentialKey.test(key)) fail('UNSAFE_FIELD');
    if (secretMaterial.test(key)) fail('RECOGNIZED_SECRET');
    inspect(value, depth + 1);
  }
}
function simulations(doc) {
  exact(doc, ['schemaVersion', 'items']);
  if (![1, 2, 3].includes(doc.schemaVersion)) fail('UNSUPPORTED_VERSION');
  if (!Array.isArray(doc.items) || doc.items.length > 100) fail('INVALID_DOCUMENT');
  // Validation uses an isolated, read-only backend and load (never the legacy
  // recovery export path, which intentionally accepts unsupported records).
  const raw = JSON.stringify(doc);
  const backend = { getItem: key => key === SIMULATION_STORAGE_KEY ? raw : null, setItem() { fail('UNEXPECTED_WRITE'); } };
  const adapter = createSimulationStorage({ storage: backend });
  const ids = new Set();
  for (const preset of doc.items) {
    if (!object(preset) || ![1, 2, 3].includes(preset.schemaVersion)) fail('UNSUPPORTED_VERSION');
    if (new TextEncoder().encode(JSON.stringify(preset)).length > 256 * 1024) fail('LIMIT_EXCEEDED');
    if (ids.has(preset.id)) fail('INVALID_DOCUMENT');
    ids.add(preset.id);
    const result = adapter.load(preset.id, preset.context);
    if (!result.ok || !same(result.value, preset)) fail('INVALID_DOCUMENT');
  }
  return { count: doc.items.length };
}
function noteContext(key) {
  if (key.length > 2048) fail('INVALID_DOCUMENT');
  let tuple; try { tuple = JSON.parse(key); } catch { fail('INVALID_DOCUMENT'); }
  if (!Array.isArray(tuple)) fail('INVALID_DOCUMENT');
  if (tuple.length === 6 && tuple[0] === 'source2d') {
    if (tuple.slice(1).some(v => typeof v !== 'string' || !v || v !== v.trim() || v.length > 300 || /[\u0000-\u001f\u007f]/.test(v))) fail('INVALID_DOCUMENT');
  } else if (tuple.length !== 4 || tuple.some(v => !['string', 'number'].includes(typeof v) || v === '' || typeof v === 'number' && !Number.isFinite(v))) fail('INVALID_DOCUMENT');
}
function notes(doc) {
  exact(doc, ['version', 'notes']);
  if (doc.version !== 1) fail('UNSUPPORTED_VERSION');
  if (!object(doc.notes) || Object.keys(doc.notes).length > 10000) fail('INVALID_DOCUMENT');
  for (const [key, text] of Object.entries(doc.notes)) {
    noteContext(key);
    if (typeof text !== 'string' || text.length > 2000) fail('INVALID_DOCUMENT');
  }
  return { count: Object.keys(doc.notes).length };
}
function lenses(doc) {
  exact(doc, ['version', 'config', 'favorites']);
  if (doc.version !== 1) fail('UNSUPPORTED_VERSION');
  if (!Array.isArray(doc.favorites) || doc.favorites.length > 1000) fail('INVALID_DOCUMENT');
  exact(doc.config, ['mode', 'minMm', 'maxMm', 'lensId', 'cropFactor']);
  const ids = new Set();
  for (const lens of doc.favorites) {
    exact(lens, ['id', 'name', 'minFocalMm', 'maxFocalMm', 'apertureAtMinFocal', 'apertureAtMaxFocal', 'defaultCropFactor', 'provenance', 'sourceLabel', 'sourceUrl']);
    const result = createFavoriteLens(lens);
    if (!result.valid || !same(result.lens, lens) || ids.has(lens.id)) fail('INVALID_DOCUMENT');
    ids.add(lens.id);
  }
  // Comparing with the validated result forbids coercion/defaulting and prevents
  // malformed favorite rows from silently disappearing in a sanitizer.
  const checked = updateLensConfig(DEFAULT_LENS_CONFIG, doc.config, doc.favorites);
  if (!checked.valid || !same(checked.config, doc.config)) fail('INVALID_DOCUMENT');
  return { count: 1, favoriteCount: doc.favorites.length };
}
const validators = { simulations, notes, lenses };
function localOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 300) return false;
  // An explicit source label, never a network destination. Deployed TD uses
  // HTTPS; plain HTTP is accepted only for local development.
  try { const u = new URL(origin); return (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) && u.origin === origin && !u.username && !u.password; } catch { return false; }
}

/** Read-only, explicit-origin snapshot of exactly three approved TD keys.
 * Manifest contract: documents.{simulations,notes,lenses}.status is missing,
 * ready, or held; count is null for held (unknown), zero for missing. Lenses
 * additionally has favoriteCount. Counts include every saved context. issues
 * contain only static {document,code}; no names, keys, note text or raw values.
 * Any held input makes archive null: no partial/raw recovery archive is emitted.
 * No ambient storage, I/O, migration, downloads, writes or deletes occur here.
 */
export async function preparePersonalDataExport({ storage, origin, clock = () => new Date() } = {}) {
  const documents = {}, originals = {}, values = {}, issues = [];
  let createdAt = null;
  const hold = (name, code) => {
    documents[name] = { status: 'held', count: null, ...(name === 'lenses' ? { favoriteCount: null } : {}) };
    issues.push({ document: name, code });
  };
  let available = true;
  try { if (!storage || typeof storage.getItem !== 'function') available = false; } catch { available = false; }
  const validOrigin = localOrigin(origin);
  try { createdAt = new Date(clock()).toISOString(); } catch { /* fail closed below */ }
  for (const [name, key] of Object.entries(PERSONAL_DATA_EXPORT_KEYS)) {
    if (!available || !validOrigin || !createdAt) { hold(name, !available ? 'STORAGE_UNAVAILABLE' : !validOrigin ? 'INVALID_ORIGIN' : 'INVALID_CLOCK'); continue; }
    let raw;
    try { raw = storage.getItem(key); originals[name] = raw; } catch { hold(name, 'STORAGE_UNAVAILABLE'); continue; }
    if (raw === null) { documents[name] = { status: 'missing', count: 0, ...(name === 'lenses' ? { favoriteCount: 0 } : {}) }; values[name] = null; continue; }
    try {
      if (typeof raw !== 'string') fail('INVALID_DOCUMENT');
      if (raw.length > LIMIT || new TextEncoder().encode(raw).length > LIMIT) fail('LIMIT_EXCEEDED');
      let parsed; try { parsed = JSON.parse(raw); } catch { fail('CORRUPT_JSON'); }
      inspect(parsed);
      documents[name] = { status: 'ready', ...validators[name](parsed) };
      values[name] = parsed;
    } catch (e) { hold(name, ['INVALID_DOCUMENT', 'UNSUPPORTED_VERSION', 'LIMIT_EXCEEDED', 'CORRUPT_JSON', 'UNSAFE_FIELD', 'RECOGNIZED_SECRET'].includes(e?.message) ? e.message : 'INVALID_DOCUMENT'); }
  }
  // Reread all approved keys after validation; never enumerate browser storage.
  for (const [name, key] of Object.entries(PERSONAL_DATA_EXPORT_KEYS)) {
    if (!own(originals, name)) continue;
    try { if (storage.getItem(key) !== originals[name]) hold(name, 'STORAGE_CHANGED'); } catch { hold(name, 'STORAGE_UNAVAILABLE'); }
  }
  const heldDocuments = Object.values(documents).filter(v => v.status === 'held').length;
  const manifest = {
    schema: 'theater3d.personal-data-export-manifest/v1', createdAt, origin: validOrigin ? origin : null,
    accessScope: 'owner_private', documents,
    counts: { simulations: documents.simulations.count, notes: documents.notes.count, lensConfigurations: documents.lenses.count, favoriteLenses: documents.lenses.favoriteCount },
    heldDocuments, complete: heldDocuments === 0,
  };
  return { ok: manifest.complete, manifest, archive: manifest.complete ? { schema: PERSONAL_DATA_EXPORT_SCHEMA, manifest, documents: values } : null, issues };
}
