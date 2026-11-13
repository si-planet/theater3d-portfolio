/** Authenticated runtime metadata transport. No ambient network/storage or token persistence. */
const PROJECT = 'portfolio-demo-disabled', PROTOCOL = 'theater3d/private-runtime-data/v1';
const ENDPOINT = `https://${PROJECT}.supabase.co/functions/v1/theater3d-private-runtime`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const CODES = new Set(['UNCONFIGURED','POLICY_UNCONFIGURED','SESSION_REQUIRED','SESSION_CHANGED','ACCESS_DENIED',
  'PROJECT_MISMATCH','BAD_REQUEST','NOT_FOUND','BUNDLE_MISMATCH','CURSOR_INVALID','INTEGRITY_MISMATCH','LIMIT_EXCEEDED','ABORTED','REQUEST_FAILED']);
function fail(code) { throw Object.assign(new Error('Private runtime request rejected'), { code }); }
function exact(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== keys.length || keys.some(k => {
        const d = Object.getOwnPropertyDescriptor(value, k); return !d?.enumerable || !Object.hasOwn(d,'value');
      })) fail('INVALID_RESPONSE');
  return value;
}
function alias(value) {
  return typeof value === 'string' && /^\.\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(value)
    && !value.slice(2).split('/').some(p => !p || p === '.' || p === '..');
}
async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
}
export function createPrivateRuntimeClient(options = {}) {
  const flag = Object.getOwnPropertyDescriptor(options, 'enabled');
  if (!flag || flag.value !== true) {
    const deny = async () => fail('UNCONFIGURED');
    return Object.freeze({ readJSON: deny, resolveMapping: deny, resolveSelection: deny, getSession: () => null, subscribeSession: () => () => {}, dispose() {} });
  }
  const { config, fetchImpl, sessionPort, clock = () => Date.now() } = options;
  exact(config, ['projectRef','supabaseUrl','publishableKey']);
  if (config.projectRef !== PROJECT || config.supabaseUrl !== `https://${PROJECT}.supabase.co`
      || !/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(config.publishableKey)
      || typeof fetchImpl !== 'function' || typeof clock !== 'function'
      || !['getSession','getAccessToken','subscribeSession'].every(k => typeof sessionPort?.[k] === 'function')) fail('INVALID_CONFIGURATION');
  const key = config.publishableKey, listeners = new Set(), active = new Set();
  let disposed = false, sequence = 0, last = null, indexPromise = null;
  function session() {
    if (disposed) return null;
    const raw = sessionPort.getSession();
    if (!raw) return null;
    const s = exact(raw, ['projectRef','accountId','epoch','expiresAt']);
    if (s.projectRef !== PROJECT || !UUID.test(s.accountId) || !Number.isSafeInteger(s.epoch) || s.epoch < 0
        || !Number.isSafeInteger(s.expiresAt) || s.expiresAt <= clock()) return null;
    return Object.freeze({ ...s });
  }
  function sync() {
    let current = null;
    try { current = session(); } catch {}
    const signature = current ? JSON.stringify(current) : null;
    if (signature !== last) {
      last = signature; indexPromise = null;
      for (const abort of active) abort.abort();
      for (const fn of listeners) try { fn(); } catch {}
    }
    return current;
  }
  const unsubscribe = sessionPort.subscribeSession(sync);
  if (typeof unsubscribe !== 'function') fail('INVALID_CONFIGURATION');
  sync();
  function ensure(s, signal) {
    const current = sync();
    if (disposed || !current || JSON.stringify(current) !== JSON.stringify(s)) fail('SESSION_CHANGED');
    if (signal?.aborted) fail('ABORTED');
  }
  function step(work, signal) {
    return new Promise((resolve,reject) => {
      let settled=false;
      const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',aborted);fn(value);};
      const aborted=()=>finish(reject,Object.assign(new Error('Private runtime request rejected'),{code:'ABORTED'}));
      if(signal.aborted){aborted();return;}
      signal.addEventListener('abort',aborted,{once:true});
      Promise.resolve().then(()=>{if(settled || signal.aborted)return;return work();}).then(v=>finish(resolve,v),e=>finish(reject,e));
    });
  }
  async function call(action, payload, { signal } = {}) {
    const s = sync(); if (!s) fail('SESSION_REQUIRED');
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('BAD_REQUEST');
    ensure(s, signal);
    const token = sessionPort.getAccessToken();
    if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) fail('SESSION_REQUIRED');
    if (++sequence > Number.MAX_SAFE_INTEGER) fail('REQUEST_FAILED');
    const requestId = `private-runtime-request:${sequence}`;
    const body = JSON.stringify({ protocol: PROTOCOL, projectRef: PROJECT, accountId: s.accountId, epoch: s.epoch, requestId, action, payload });
    if (new TextEncoder().encode(body).length > 512 * 1024) fail('LIMIT_EXCEEDED');
    const abort = new AbortController(), onAbort = () => abort.abort();
    signal?.addEventListener('abort', onAbort, { once: true }); active.add(abort);
    const timer = setTimeout(onAbort, 20000); timer?.unref?.();
    try {
      const response = await step(() => fetchImpl(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json',
        apikey: key, Authorization: `Bearer ${token}` }, body, signal: abort.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' }), abort.signal);
      ensure(s, signal); if (abort.signal.aborted) fail('ABORTED');
      if (!response || response.redirected || response.url && response.url !== ENDPOINT) fail('ACCESS_DENIED');
      if (response.status === 401) fail('SESSION_REQUIRED');
      if (response.status === 403) fail('ACCESS_DENIED');
      if (response.headers?.get('Content-Type')?.split(';')[0].trim() !== 'application/json') fail('INVALID_RESPONSE');
      const max = action === 'private.runtime.read' ? 40 * 1024 * 1024 : 4 * 1024 * 1024;
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > max)) fail('LIMIT_EXCEEDED');
      const reader = response.body?.getReader(); if (!reader) fail('INVALID_RESPONSE');
      const chunks = []; let size = 0, done = false;
      try {
        while (true) {
          const part = await step(() => reader.read(), abort.signal); ensure(s, signal); if (abort.signal.aborted) fail('ABORTED');
          if (part.done) { done = true; break; }
          if (!(part.value instanceof Uint8Array) || (size += part.value.length) > max) fail('LIMIT_EXCEEDED');
          chunks.push(new Uint8Array(part.value));
        }
      } finally { if (!done) { try { Promise.resolve(reader.cancel()).catch(()=>{}); } catch {} } try { reader.releaseLock(); } catch {} }
      // Native fetch may decode HTTP content-codings; decoded stream caps and
      // application byte/hash contracts, not encoded Content-Length, prove bounds.
      if (!(response instanceof Response) && length !== null && Number(length) !== size) fail('INVALID_RESPONSE');
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (envelope?.ok === false) { exact(envelope, ['ok','code']); fail(CODES.has(envelope.code) ? envelope.code : 'REQUEST_FAILED'); }
      exact(envelope, ['protocol','projectRef','accountId','epoch','requestId','action','kind','source','ok','result']);
      if (response.status !== 200 || envelope.ok !== true || envelope.protocol !== PROTOCOL || envelope.projectRef !== PROJECT
          || envelope.accountId !== s.accountId || envelope.epoch !== s.epoch || envelope.requestId !== requestId
          || envelope.action !== action || envelope.kind !== 'configured-private' || envelope.source !== 'private-provider') fail('INVALID_RESPONSE');
      ensure(s, signal); return envelope.result;
    } catch (e) { ensure(s, signal); if (CODES.has(e?.code) || e?.code === 'INVALID_RESPONSE') throw Object.assign(new Error('Private runtime request rejected'), { code: e.code }); fail('REQUEST_FAILED'); }
    finally { clearTimeout(timer); active.delete(abort); signal?.removeEventListener('abort', onAbort); }
  }
  async function index(options) {
    const s = sync(); if (!s) fail('SESSION_REQUIRED');
    if (!indexPromise) {
      const work = (async () => {
        const routes = new Map(), ids = new Set(); let cursor = null, bundleId = null, total = null;
        do {
          const r = exact(await call('private.runtime.index', { cursor, limit: 50 }, options), ['bundleId','total','items','nextCursor']);
          if (!UUID.test(r.bundleId) || bundleId && bundleId !== r.bundleId || !Number.isSafeInteger(r.total) || r.total < 1 || r.total > 512
              || total !== null && total !== r.total || !Array.isArray(r.items) || !r.items.length || r.items.length > 50) fail('INVALID_RESPONSE');
          bundleId = r.bundleId; total = r.total;
          for (const item of r.items) {
            exact(item, ['routeId','alias','sha256','byteSize']);
            if (!UUID.test(item.routeId) || !alias(item.alias) || !HASH.test(item.sha256)
                || !Number.isSafeInteger(item.byteSize) || item.byteSize < 1 || item.byteSize > 16 * 1024 * 1024
                || routes.has(item.alias) || ids.has(item.routeId)) fail('INVALID_RESPONSE');
            ids.add(item.routeId); routes.set(item.alias, Object.freeze({ ...item }));
          }
          cursor = r.nextCursor;
          if (cursor !== null) {
            exact(cursor, ['bundleId','accountId','epoch','afterRouteId']);
            if (cursor.bundleId !== bundleId || cursor.accountId !== s.accountId || cursor.epoch !== s.epoch
                || cursor.afterRouteId !== r.items.at(-1).routeId || routes.size >= total) fail('INVALID_RESPONSE');
          }
        } while (cursor);
        if (routes.size !== total) fail('INVALID_RESPONSE'); ensure(s, options?.signal);
        return { bundleId, routes };
      })();
      indexPromise = work; work.catch(() => { if (indexPromise === work) indexPromise = null; });
    }
    const value = await indexPromise; ensure(s, options?.signal); return value;
  }
  return Object.freeze({
    getSession: sync,
    subscribeSession(fn) { if (typeof fn !== 'function' || disposed) fail('INVALID_CONFIGURATION'); listeners.add(fn); return () => listeners.delete(fn); },
    async readJSON(path, options = {}) {
      if (!alias(path)) fail('BAD_REQUEST');
      const s = sync(); if (!s) fail('SESSION_REQUIRED');
      const i = await index(options), route = i.routes.get(path); if (!route) fail('NOT_FOUND');
      const r = exact(await call('private.runtime.read', { bundleId: i.bundleId, routeId: route.routeId }, options),
        ['bundleId','routeId','alias','sha256','byteSize','jsonText']);
      if (r.bundleId !== i.bundleId || ['routeId','alias','sha256','byteSize'].some(k => r[k] !== route[k]) || typeof r.jsonText !== 'string') fail('INVALID_RESPONSE');
      const bytes = new TextEncoder().encode(r.jsonText);
      if (bytes.length !== route.byteSize || await digest(bytes) !== route.sha256) fail('INTEGRITY_MISMATCH');
      const value = JSON.parse(r.jsonText); ensure(s, options.signal); return value;
    },
    async resolveMapping(payload, options = {}) {
      const r = await call('private.runtime.mapping', payload, options);
      if (r?.status === 'unresolved') { exact(r, ['status','code','mapping']);
        if (!['NO_EXPLICIT_MAPPING','MAPPING_INCOMPLETE','AMBIGUOUS_MAPPING','SELECTED_SEAT_REQUIRED','SEAT_MAPPING_UNAVAILABLE','UNVERIFIED_MAPPING'].includes(r.code) || r.mapping !== null) fail('INVALID_RESPONSE'); return r; }
      exact(r, ['status','mapping']); if (r.status !== 'resolved') fail('INVALID_RESPONSE');
      exact(r.mapping, ['selection','registry','modelBinding','seatBindings']); return r;
    },
    async resolveSelection(payload, options = {}) {
      const r = await call('private.runtime.selection', payload, options);
      exact(r, ['status','code','selection','registry','canonical']);
      if (r.status === 'unresolved') {
        if (!['NO_EXPLICIT_MAPPING','MAPPING_INCOMPLETE','AMBIGUOUS_MAPPING','UNVERIFIED_MAPPING'].includes(r.code)
            || r.selection !== null || r.registry !== null || r.canonical !== null) fail('INVALID_RESPONSE');
      } else if (r.status !== 'resolved' || r.code !== 'EXPLICIT_MAPPING' || !r.selection || !r.registry || !r.canonical) fail('INVALID_RESPONSE');
      return r;
    },
    dispose() { if (disposed) return; disposed = true; try { unsubscribe(); } catch {} indexPromise = null; last = null;
      for (const abort of active) abort.abort(); for (const fn of listeners) try { fn(); } catch {} listeners.clear(); },
  });
}
