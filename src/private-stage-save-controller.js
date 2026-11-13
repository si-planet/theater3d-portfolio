/** Existing local save remains authoritative for local retention. This optional
 * controller neither writes local storage nor chooses a login/ID/model mapping.
 * It owns the injected v2 workspace and disposes it with this controller.
 */
import { clonePrivateStageJSON, PRIVATE_STAGE_SNAPSHOT_SCHEMA } from './private-stage-snapshot.js';
import { CANONICAL_SELECTION_PROJECT_REF as PROJECT } from './canonical-selection-context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const errors = new WeakMap(), reject = code => { const e = Error('Private stage operation rejected'); errors.set(e, code); throw e; };
const failure = code => Object.freeze({ ok: false, code });
const copy = value => clonePrivateStageJSON(value, 8 * 1024 * 1024);
function freeze(value) { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; }
function exact(value, keys, required = keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) reject('INVALID_CONFIGURATION');
  const names = Reflect.ownKeys(value), out = {};
  if (names.some(k => typeof k !== 'string' || !keys.includes(k)) || required.some(k => !names.includes(k))) reject('INVALID_CONFIGURATION');
  for (const k of names) { const d = Object.getOwnPropertyDescriptor(value, k); if (!d?.enumerable || !Object.hasOwn(d, 'value')) reject('INVALID_CONFIGURATION'); out[k] = d.value; }
  return out;
}
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}
function identifier(id) { if (typeof id !== 'string' || !id.trim() || id.trim() !== id || id.length > 300 || /[\u0000-\u001f\u007f]/u.test(id)) reject('INPUT_INVALID'); return id; }

export function createPrivateStageSaveController(options = {}) {
  const enabled = options && Object.getOwnPropertyDescriptor(options, 'enabled');
  if (enabled && !Object.hasOwn(enabled, 'value')) reject('INVALID_CONFIGURATION');
  if (enabled?.value === undefined || enabled.value === false) {
    const no = async () => failure('UNCONFIGURED');
    return Object.freeze({ save: no, list: no, load: no, getVerifiedPreset: no, remove:no, reconcileDelete:no,
      checkSession: () => false, getState: () => freeze({ status: 'unconfigured', entries: [], uncertainIds: [], pending: 0 }),
      isResultCurrent: () => false, subscribe: () => () => {}, dispose() {} });
  }
  if (enabled.value !== true) reject('INVALID_CONFIGURATION');
  const c = exact(options, ['enabled', 'workspace', 'sessionPort', 'getMapping', 'getSelectionStamp', 'applyPreset', 'clock'],
    ['enabled', 'workspace', 'sessionPort', 'getMapping', 'getSelectionStamp', 'applyPreset']);
  const w = c.workspace, port = exact(c.sessionPort, ['getSession', 'getAccessToken', 'subscribeSession']);
  if (!w || w.version !== 2 || ['prepare', 'restore', 'create', 'update', 'read', 'list', 'getSession', 'subscribeSession', 'dispose'].some(k => typeof w[k] !== 'function')
      || Object.values(port).some(fn => typeof fn !== 'function') || ['getMapping', 'getSelectionStamp', 'applyPreset'].some(k => typeof c[k] !== 'function')) reject('INVALID_CONFIGURATION');
  const clock = c.clock ?? Date.now; if (typeof clock !== 'function') reject('INVALID_CONFIGURATION');
  const deletionIntents=new Map();
  const cache = new Map(), uncertain = new Set(), active = new Set(), saves = new Map(), listeners = new Set(), receipts = new WeakMap();
  let disposed = false, generation = 0, identity = null;
  function notify() { for (const fn of listeners) try { fn(); } catch {} }
  function clear() {
    generation++; identity = null; cache.clear(); uncertain.clear(); saves.clear(); deletionIntents.clear();
    for (const run of active) run.abort(); active.clear(); notify();
  }
  function currentSession() {
    if (disposed) reject('DISPOSED');
    let s; try { s = exact(port.getSession.call(c.sessionPort), ['projectRef', 'accountId', 'epoch', 'expiresAt']); } catch { reject('SESSION_REQUIRED'); }
    const now = clock();
    if (s.projectRef !== PROJECT || typeof s.accountId !== 'string' || !UUID.test(s.accountId) || !Number.isSafeInteger(s.epoch) || s.epoch < 0
        || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= now || !equal(s, w.getSession())) reject('SESSION_REQUIRED');
    return s;
  }
  function synchronize() {
    let s; try { s = currentSession(); } catch (e) { if (identity || cache.size || active.size) clear(); throw e; }
    if (identity && !equal(identity, s)) clear(); identity = s; return s;
  }
  function sessionEvent() { if (!disposed) clear(); }
  const offPort = port.subscribeSession.call(c.sessionPort, sessionEvent), offWorkspace = w.subscribeSession(sessionEvent);
  if (typeof offPort !== 'function' || typeof offWorkspace !== 'function') { try { if (typeof offPort === 'function') offPort(); } catch {} reject('INVALID_CONFIGURATION'); }
  function selectionStamp() { const s = c.getSelectionStamp(); if (typeof s !== 'string' || s.length > 16384) reject('SELECTION_UNAVAILABLE'); return s; }
  async function mapping(preset, run) {
    guard(run); let value;
    try { value = await c.getMapping(preset); } finally { guard(run); }
    return exact(copy(value), ['selection', 'registry', 'modelBinding', 'seatBindings']);
  }
  function begin() {
    const s = synchronize(), view = selectionStamp(), controller = new AbortController(), epoch = generation;
    active.add(controller);
    return { s, view, controller, epoch };
  }
  function guard(run, view = true) {
    if (disposed) reject('DISPOSED');
    if (run.epoch !== generation || run.controller.signal.aborted || !equal(run.s, synchronize())) reject('SESSION_CHANGED');
    if (view && run.view !== selectionStamp()) reject('SELECTION_CHANGED');
  }
  function outcome(result) {
    if (!result || typeof result !== 'object') reject('INVALID_RESPONSE');
    if (result.ok !== true) {
      const code = typeof result.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code) ? result.code : 'REQUEST_FAILED';
      reject(code);
    }
    return result;
  }
  function verified(stage, supplied) {
    if (stage?.snapshot_schema !== PRIVATE_STAGE_SNAPSHOT_SCHEMA) reject('LEGACY_SNAPSHOT_UNSUPPORTED');
    const result = w.restore(stage, supplied); if (result.status !== 'resolved') reject(result.code || 'INVALID_RESPONSE'); return result;
  }
  function remember(stage, preset) {
    const old = cache.get(stage.id);
    if (old && old.revision > stage.revision) reject('STALE_RESPONSE');
    cache.set(stage.id, freeze({ id: stage.id, name: stage.name, revision: stage.revision, preset: copy(preset) })); uncertain.delete(stage.id);
  }
  function state() {
    try { synchronize(); } catch {}
    return freeze({ status: disposed ? 'disposed' : identity ? 'ready' : 'authentication-required',
      entries: [...cache.values()].map(({ id, name, revision }) => ({ id, name, revision, source: 'remote' })),
      uncertainIds: [...uncertain], uncertainDeleteIds:[...deletionIntents.keys()], pending: active.size });
  }
  function deliver(value, run, view = true) {
    active.delete(run.controller); notify(); guard(run, view);
    const result = freeze(value);
    receipts.set(result, { s: run.s, epoch: generation, view: selectionStamp(), id: result.id, revision: result.revision });
    return result;
  }
  function isResultCurrent(result) {
    const receipt = receipts.get(result); if (!receipt || disposed) return false;
    try { return receipt.epoch === generation && equal(receipt.s, synchronize()) && receipt.view === selectionStamp()
      && !(receipt.id && (cache.get(receipt.id)?.revision ?? 0) > receipt.revision); } catch { return false; }
  }
  function save(preset) {
    let prepared, input, captured, fingerprint, key;
    try {
      synchronize(); captured = copy(preset); key = identifier(captured.id);
      fingerprint = JSON.stringify(captured);
      if (saves.has(key)) return saves.get(key).fingerprint === fingerprint ? saves.get(key).promise : Promise.resolve(failure('BUSY'));
      if (uncertain.has(key)) return Promise.resolve(failure('RECONCILIATION_REQUIRED'));
    } catch (e) { return Promise.resolve(failure(errors.get(e) || 'INPUT_INVALID')); }
    let run; try { run = begin(); } catch (e) { return Promise.resolve(failure(errors.get(e) || 'REQUEST_FAILED')); }
    const entry = { fingerprint, promise: null };
    entry.promise = (async () => {
      let dispatched = false, receipt = false, delivered = false;
      try {
        input = { preset: captured, ...await mapping(captured, run) }; prepared = w.prepare(input);
        if (prepared.status !== 'resolved') reject(prepared.code || 'INPUT_INVALID');
        guard(run); const known = cache.get(key); dispatched = true;
        const result = await (known ? w.update(input, known.revision, { signal: run.controller.signal }) : w.create(input, { signal: run.controller.signal }));
        if (result?.ok === false && result.code === 'OUTCOME_UNKNOWN') {
          if (!disposed && run.epoch === generation && equal(run.s, currentSession())) uncertain.add(key);
        }
        outcome(result); receipt = true; guard(run);
        const restored = verified(result.stage, await mapping(captured, run));
        if (!equal(restored.preset, captured)) reject('INVALID_RESPONSE');
        guard(run); remember(result.stage, restored.preset);
        const response = deliver({ ok: true, id: key, revision: result.stage.revision, preset: copy(restored.preset) }, run); delivered = true; return response;
      } catch (e) {
        let code = errors.get(e) || 'REQUEST_FAILED';
        // A changed view after a valid commit cannot be labelled an unsaved write.
        // Do not update UI/cache; require an explicit read before another save.
        if (receipt || dispatched && ['SESSION_CHANGED', 'DISPOSED', 'SELECTION_CHANGED', 'REQUEST_FAILED'].includes(code)) {
          if (!disposed && run.epoch === generation) uncertain.add(key); code = 'OUTCOME_UNKNOWN';
        }
        return failure(code);
      } finally { active.delete(run.controller); if (saves.get(key) === entry) saves.delete(key); if (!delivered) notify(); }
    })();
    saves.set(key, entry); return entry.promise;
  }
  async function read(id, apply) {
    let run, delivered = false;
    try {
      identifier(id); synchronize(); if(deletionIntents.has(id))reject('RECONCILIATION_REQUIRED'); run = begin(); const initialMap = await mapping(null, run);
      const response = await w.read(id, { signal: run.controller.signal }); guard(run);
      if (!equal(initialMap, await mapping(null, run))) reject('SELECTION_CHANGED');
      // A verified same-session NOT_FOUND is also useful reconciliation. A
      // subsequent explicit save may create this same ID; never auto-resend.
      if (response?.ok === false && response.code === 'NOT_FOUND' && uncertain.has(id)) {
        uncertain.delete(id); cache.delete(id); notify();
      }
      const result = outcome(response);
      const restored = verified(result.stage, await mapping(result.stage?.state?.preset, run)); guard(run);
      // A read is a commit receipt for reconciling unknown writes, but an older
      // response must never overwrite a newer successful revision.
      const old = cache.get(id); if (old && old.revision > result.stage.revision) reject('STALE_RESPONSE');
      if (apply) {
        const applied = c.applyPreset(copy(restored.preset));
        if (applied !== true) reject('APPLY_REJECTED');
        guard(run, false);
      }
      remember(result.stage, restored.preset);
      const deliveredResult = deliver({ ok: true, id, revision: result.stage.revision, preset: copy(restored.preset), applied: apply }, run, !apply); delivered = true; return deliveredResult;
    } catch (e) { return failure(errors.get(e) || 'REQUEST_FAILED'); }
    finally { if (run) active.delete(run.controller); if (!delivered) notify(); }
  }
  async function list(page = { limit: 24, after_id: null }) {
    let run, delivered = false;
    try {
      run = begin(); const initialMap = await mapping(null, run);
      const result = outcome(await w.list(copy(page), { signal: run.controller.signal })); guard(run);
      if (!equal(initialMap, await mapping(null, run))) reject('SELECTION_CHANGED');
      const items = [];
      for (const stage of result.items) {
        let code = null;
        try { verified(stage, await mapping(stage?.state?.preset ?? null, run)); } catch (e) { code = errors.get(e) || 'MODEL_CONTEXT_MISMATCH'; }
        guard(run);
        items.push({ id: stage.id, name: stage.name, revision: stage.revision, source: 'remote', snapshotSchema: stage.snapshot_schema,
          compatible: code === null, code });
      }
      guard(run); const response = deliver({ ok: true, items, next_after_id: result.next_after_id }, run); delivered = true; return response;
    } catch (e) { return failure(errors.get(e) || 'REQUEST_FAILED'); }
    finally { if (run) active.delete(run.controller); if (!delivered) notify(); }
  }
  async function removeOrReconcile(id, expectedRevision, reconcile) {
    let run, dispatched=false, confirmed=false, delivered=false, entry;
    try {
      identifier(id); synchronize();
      if(typeof w.remove!=='function'||typeof w.deleteStatus!=='function')reject('UNCONFIGURED');
      if(reconcile){expectedRevision=deletionIntents.get(id);if(expectedRevision===undefined)reject('NO_PENDING_DELETE');}
      else if(uncertain.has(id))reject('RECONCILIATION_REQUIRED');
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||expectedRevision>=Number.MAX_SAFE_INTEGER)reject('INPUT_INVALID');
      if(saves.has(id))reject('BUSY');
      const known=cache.get(id);if(known&&known.revision!==expectedRevision)reject('REVISION_CONFLICT');
      run=begin(); entry={fingerprint:'delete',promise:Promise.resolve(failure('BUSY'))};saves.set(id,entry);
      guard(run);dispatched=true;
      const result=copy(await (reconcile?w.deleteStatus(id,expectedRevision,{signal:run.controller.signal}):w.remove(id,expectedRevision,{signal:run.controller.signal})));
      outcome(result);confirmed=true;guard(run);
      exact(result,['ok','id','revision','deleted']);
      if(result.id!==id||typeof result.deleted!=='boolean'||result.revision!==(result.deleted?expectedRevision+1:expectedRevision)||!reconcile&&!result.deleted)reject('INVALID_RESPONSE');
      if(result.deleted)cache.delete(id);
      deletionIntents.delete(id);uncertain.delete(id);
      const response=deliver({ok:true,id,revision:result.revision,deleted:result.deleted},run);delivered=true;return response;
    } catch(e){
      let code=errors.get(e)||'REQUEST_FAILED';
      if(!reconcile&&dispatched&&(confirmed||['OUTCOME_UNKNOWN','SESSION_CHANGED','DISPOSED','SELECTION_CHANGED','REQUEST_FAILED','INVALID_RESPONSE'].includes(code))){
        if(!disposed&&run?.epoch===generation){deletionIntents.set(id,expectedRevision);uncertain.add(id);}code='OUTCOME_UNKNOWN';
      }
      return failure(code);
    } finally {if(run)active.delete(run.controller);if(entry&&saves.get(id)===entry)saves.delete(id);if(!delivered)notify();}
  }
  return Object.freeze({ save, list, remove:(id,expectedRevision)=>removeOrReconcile(id,expectedRevision,false), reconcileDelete:id=>removeOrReconcile(id,undefined,true), load: id => read(id, true), getVerifiedPreset: id => read(id, false),
    checkSession() { try { synchronize(); return true; } catch { return false; } }, getState: state, isResultCurrent,
    subscribe(listener) { if (typeof listener !== 'function') reject('INPUT_INVALID'); if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposed) return; disposed = true; clear(); try { offPort(); } catch {} try { offWorkspace(); } catch {} try { w.dispose(); } catch {} listeners.clear(); },
  });
}
