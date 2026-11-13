/** Explicit Supabase Email/password REST adapter. Access credentials stay memory-only; optional injected same-tab refresh continuity;
 * no ambient fetch/storage, password persistence, account creation or identity inference.
 * Only the SDK-compatible authClient facade exposes a minimal access session
 * to the existing session bridge. Public outcomes never contain credentials.
 */
const PROJECT = 'portfolio-demo-disabled', ORIGIN = `https://${PROJECT}.supabase.co`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const errors = new WeakMap(), bad = code => { const e = Error('Private authentication failed'); errors.set(e, code); throw e; };
const failed = code => Object.freeze({ ok: false, code });
function object(value, keys, required = keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)) bad('INPUT_INVALID');
  const names = Reflect.ownKeys(value), result = {};
  if (names.some(k => typeof k !== 'string' || !keys.includes(k)) || required.some(k => !names.includes(k))) bad('INPUT_INVALID');
  for (const name of names) { const d = Object.getOwnPropertyDescriptor(value, name); if (!d?.enumerable || !Object.hasOwn(d, 'value')) bad('INPUT_INVALID'); result[name] = d.value; }
  return result;
}
function field(value, name, required = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad('INVALID_RESPONSE');
  const d = Object.getOwnPropertyDescriptor(value, name); if (!d && !required) return undefined;
  if (!d || !Object.hasOwn(d, 'value')) bad('INVALID_RESPONSE'); return d.value;
}
const token = value => { if (typeof value !== 'string' || value.length < 16 || value.length > 8192 || !JWT.test(value)) bad('INVALID_RESPONSE'); return value; };

export function createPrivateSupabaseAuth(options = {}) {
  const enabled = options && Object.getOwnPropertyDescriptor(options, 'enabled');
  if (enabled && !Object.hasOwn(enabled, 'value')) bad('INVALID_CONFIGURATION');
  if (enabled?.value === undefined || enabled.value === false) {
    const authClient = Object.freeze({ getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) });
    const no = async () => failed('UNCONFIGURED');
    return Object.freeze({ authClient, signIn: no, refresh: no, restore: no, verifySession: no, signOut: no, invalidate() {},
      getState: () => Object.freeze({ status: 'unconfigured', authenticated: false, expiresAt: null, generation: 0 }), subscribe: () => () => {}, dispose() {} });
  }
  if (enabled.value !== true) bad('INVALID_CONFIGURATION');
  const c = object(options, ['enabled', 'config', 'fetchImpl', 'clock', 'requestTimeoutMs', 'continuityStore'], ['enabled', 'config', 'fetchImpl']);
  const config = object(c.config, ['projectRef', 'supabaseUrl', 'publishableKey']);
  if (config.projectRef !== PROJECT || config.supabaseUrl !== ORIGIN || typeof config.publishableKey !== 'string'
      || !/^sb_publishable_[A-Za-z0-9_-]{1,400}$/.test(config.publishableKey) || typeof c.fetchImpl !== 'function') bad('INVALID_CONFIGURATION');
  // Native browser fetch must be called as a function, not as a config method.
  const fetchImpl = c.fetchImpl;
  const clock = c.clock ?? Date.now; if (typeof clock !== 'function') bad('INVALID_CONFIGURATION');
  const requestTimeoutMs = c.requestTimeoutMs ?? 20000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60000) bad('INVALID_CONFIGURATION');
  // The application supplies only its own same-tab storage adapter. This module
  // never discovers browser storage or exposes persisted credentials in state.
  const store = c.continuityStore === undefined ? null : object(c.continuityStore, ['read', 'write', 'remove']);
  if (store && ['read', 'write', 'remove'].some(k => typeof store[k] !== 'function')) bad('INVALID_CONFIGURATION');
  let persistenceStatus = store ? 'available' : 'disabled', restorePending = null;
  function forget() { if (store) try { store.remove(); } catch { persistenceStatus = 'unavailable'; } }
  function remember(value) {
    if (!store) return;
    try { store.write(JSON.stringify({version:1, projectRef:PROJECT, subject:value.subject,
      refreshToken:value.refresh, savedAt:now()})); persistenceStatus='saved'; }
    catch { persistenceStatus='unavailable'; forget(); }
  }
  const listeners = new Set(), authListeners = new Set(), active = new Set();
  let session = null, generation = 0, disposed = false, state = 'signed-out', timer = null, refreshPending = null, verifyPending = null;
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) bad('CLOCK_INVALID'); return value; };
  function raw() { return session ? { access_token: session.access, expires_at: session.expiresAt / 1000, user: { id: session.subject } } : null; }
  function notify(event) {
    if (event) for (const fn of authListeners) try { fn(event, raw()); } catch {}
    for (const fn of listeners) try { fn(); } catch {}
  }
  function clear(next = 'signed-out', emit = true, preserveContinuity = false) {
    if (generation >= Number.MAX_SAFE_INTEGER) { disposed = true; next = 'disposed'; }
    else generation++;
    if (timer !== null) clearTimeout(timer); timer = null;
    session = null; refreshPending = null; verifyPending = null; state = next; if(next!=='expired'&&!preserveContinuity)forget();
    for (const run of active) run.abort(); active.clear(); const clearedAt = generation;
    if (emit) notify('SIGNED_OUT'); return clearedAt;
  }
  function valid() {
    if (disposed || !session) return false;
    try { if (session.expiresAt <= now()) { clear('expired'); return false; } }
    catch { clear('error'); return false; }
    return true;
  }
  function scheduleExpiry() {
    if (timer !== null) clearTimeout(timer); timer = null; if (!valid()) return;
    timer = setTimeout(() => { timer = null; if (valid()) scheduleExpiry(); }, Math.min(2147483647, Math.max(0, session.expiresAt - now())));
    timer?.unref?.();
  }
  function begin(opts = {}) {
    if (disposed) bad('DISPOSED');
    const value = object(opts, ['signal'], []); if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) bad('INPUT_INVALID');
    if (value.signal?.aborted) bad('ABORTED');
    const controller = new AbortController(), epoch = generation; active.add(controller); let timedOut = false;
    const abort = () => controller.abort(); value.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, requestTimeoutMs);
    return { controller, epoch, get timedOut() { return timedOut; }, close() { clearTimeout(timer); active.delete(controller); value.signal?.removeEventListener('abort', abort); } };
  }
  function guard(run) { if (disposed) bad('DISPOSED'); if (run.epoch !== generation) bad('SESSION_CHANGED'); if (run.controller.signal.aborted) bad(run.timedOut ? 'TIMEOUT' : 'ABORTED'); }
  async function step(run, fn) {
    guard(run); let off;
    const cancel = new Promise((_, reject) => { off = () => { const e = Error('Private authentication failed'); errors.set(e, run.timedOut ? 'TIMEOUT' : 'ABORTED'); reject(e); }; run.controller.signal.addEventListener('abort', off, { once: true }); });
    const task = Promise.resolve().then(() => { guard(run); return fn(); }); task.catch(() => {});
    try { const result = await Promise.race([task, cancel]); guard(run); return result; }
    finally { run.controller.signal.removeEventListener('abort', off); }
  }
  // Diagnostics only for an explicit password sign-in failure. Never return or
  // log upstream messages, account fields, credentials, or unknown error codes.
  async function signInErrorCode(run, response) {
    const allowed = Object.freeze({ invalid_credentials: 'INVALID_CREDENTIALS',
      email_not_confirmed: 'EMAIL_CONFIRMATION_REQUIRED', user_banned: 'ACCOUNT_RESTRICTED',
      captcha_failed: 'CAPTCHA_REQUIRED', over_request_rate_limit: 'RATE_LIMITED',
      request_timeout: 'TIMEOUT' });
    let reader, complete = false;
    try {
      if (response.headers?.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return 'AUTH_REJECTED';
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 4096)) return 'AUTH_REJECTED';
      reader = response.body?.getReader(); if (!reader) return 'AUTH_REJECTED';
      const chunks = []; let size = 0;
      for (;;) {
        const item = await step(run, () => reader.read());
        if (item.done) { complete = true; break; }
        if (!(item.value instanceof Uint8Array)) return 'AUTH_REJECTED';
        size += item.value.byteLength; if (size > 4096) return 'AUTH_REJECTED';
        chunks.push(new Uint8Array(item.value));
      }
      if (length !== null && Number(length) !== size) return 'AUTH_REJECTED';
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!result || typeof result !== 'object' || Array.isArray(result)) return 'AUTH_REJECTED';
      // Supabase REST supports modern `code` and legacy `error_code`.
      // Conflicting string codes are not a trustworthy diagnostic.
      const values = ['code', 'error_code'].map(name => {
        const descriptor = Object.getOwnPropertyDescriptor(result, name);
        return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : undefined;
      }).filter(value => value !== undefined);
      if (!values.length || values.some(value => value !== values[0])) return 'AUTH_REJECTED';
      return Object.hasOwn(allowed, values[0]) ? allowed[values[0]] : 'AUTH_REJECTED';
    } catch (error) {
      if (['TIMEOUT', 'ABORTED', 'DISPOSED', 'SESSION_CHANGED'].includes(errors.get(error))) throw error;
      return 'AUTH_REJECTED';
    } finally {
      if (reader) {
        if (!complete) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
        try { reader.releaseLock(); } catch {}
      }
    }
  }
  async function request(run, path, { body, access, empty = false } = {}) {
    const headers = { apikey: config.publishableKey, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json'; if (access) headers.Authorization = 'Bearer ' + access;
    const url = ORIGIN + path;
    const response = await step(run, () => fetchImpl(url, { method: body !== undefined || empty ? 'POST' : 'GET', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: run.controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' }));
    if (!response || !Number.isSafeInteger(response.status) || response.redirected || response.url && response.url !== url) bad('INVALID_RESPONSE');
    if ([400, 401, 403, 422].includes(response.status)) {
      if (path === '/auth/v1/token?grant_type=password') bad(await signInErrorCode(run, response));
      if (response.status !== 422) bad('AUTH_REJECTED');
    }
    if (response.status === 429) bad('RATE_LIMITED');
    if (response.status < 200 || response.status > 299 || response.ok !== true) bad('REQUEST_FAILED');
    if (empty) return null;
    if (response.headers?.get('Content-Type')?.split(';')[0].trim() !== 'application/json') bad('INVALID_RESPONSE');
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 65536)) bad('INVALID_RESPONSE');
    const reader = response.body?.getReader(); if (!reader) bad('INVALID_RESPONSE');
    const chunks = []; let size = 0, complete = false;
    try { for (;;) { const item = await step(run, () => reader.read()); if (item.done) { complete = true; break; }
      if (!(item.value instanceof Uint8Array)) bad('INVALID_RESPONSE'); size += item.value.byteLength;
      if (size > 65536) bad('LIMIT_EXCEEDED'); chunks.push(new Uint8Array(item.value)); } }
    finally { if (!complete) try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    if (length !== null && Number(length) !== size) bad('INVALID_RESPONSE');
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let result; try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { bad('INVALID_RESPONSE'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) bad('INVALID_RESPONSE'); return result;
  }
  async function verified(run, access) {
    const user = await request(run, '/auth/v1/user', { access }), subject = field(user, 'id');
    if (typeof subject !== 'string' || !UUID.test(subject)) bad('INVALID_RESPONSE'); return subject;
  }
  async function accept(run, response, expectedSubject, event) {
    let access = token(field(response, 'access_token')), refresh = field(response, 'refresh_token');
    try {
      if (typeof refresh !== 'string' || refresh.length < 8 || refresh.length > 8192 || /[\s\u0000-\u001f\u007f]/u.test(refresh)) bad('INVALID_RESPONSE');
      const tokenType = field(response, 'token_type'); if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') bad('INVALID_RESPONSE');
      const expiry = field(response, 'expires_at', false), duration = field(response, 'expires_in', false);
      if (expiry === undefined && (!Number.isSafeInteger(duration) || duration <= 0)) bad('INVALID_RESPONSE');
      const seconds = expiry ?? Math.floor(now() / 1000) + duration, expiresAt = seconds * 1000;
      if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) bad('SESSION_EXPIRED');
      const claimedUser = field(response, 'user', false), claimed = claimedUser === undefined ? undefined : field(claimedUser, 'id');
      const subject = await verified(run, access); guard(run);
      if (expectedSubject && expectedSubject !== subject || claimed !== undefined && claimed !== subject) bad('SESSION_CHANGED');
      if (expiresAt <= now()) bad('SESSION_EXPIRED');
      session = { access, refresh, subject, expiresAt }; remember(session); state = 'ready'; scheduleExpiry(); notify(event); guard(run);
      if (!valid() || session.access !== access) bad('SESSION_CHANGED');
      return Object.freeze({ ok: true, status: 'ready' });
    } finally { access = null; refresh = null; }
  }
  async function signIn(input, opts = {}) {
    let run, values, clearedAt;
    try {
      if (disposed) bad('DISPOSED'); values = object(input, ['email', 'password']);
      if (typeof values.email !== 'string' || values.email.length > 320 || values.email.trim() !== values.email
          || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.email) || typeof values.password !== 'string' || !values.password.length || values.password.length > 4096) bad('INPUT_INVALID');
      clearedAt = clear('signing-in'); if (generation !== clearedAt || disposed) bad('SESSION_CHANGED'); run = begin(opts); notify();
      const response = await request(run, '/auth/v1/token?grant_type=password', { body: values }); values.password = null; values.email = null;
      return await accept(run, response, null, 'SIGNED_IN');
    } catch (e) { if (clearedAt === generation && !disposed) clear('error'); return failed(errors.get(e) || 'REQUEST_FAILED'); }
    finally { if (values) { values.password = null; values.email = null; } run?.close(); }
  }
  function refresh(opts = {}) {
    if (refreshPending) return refreshPending;
    if (!valid()) return Promise.resolve(failed(disposed ? 'DISPOSED' : 'SESSION_REQUIRED'));
    let refreshToken = session.refresh; const expected = session.subject, clearedAt = clear('refreshing');
    if (generation !== clearedAt || disposed) { refreshToken = null; return Promise.resolve(failed('SESSION_CHANGED')); }
    let run; try { run = begin(opts); } catch (e) { refreshToken = null; if(generation===clearedAt&&!disposed)clear('error'); return Promise.resolve(failed(errors.get(e) || 'REQUEST_FAILED')); }
    const work = (async () => {
      try { const response = await request(run, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }); refreshToken = null;
        return await accept(run, response, expected, 'TOKEN_REFRESHED'); }
      catch (e) { if (run.epoch === generation && !disposed) clear('error'); return failed(errors.get(e) || 'REQUEST_FAILED'); }
      finally { refreshToken = null; run.close(); if (refreshPending === work) refreshPending = null; }
    })(); refreshPending = work; return work;
  }
  function restore(opts = {}) {
    if (restorePending) return restorePending;
    if (disposed) return Promise.resolve(failed('DISPOSED'));
    if (valid()) return Promise.resolve(Object.freeze({ok:true,status:'ready'}));
    if (!store) return Promise.resolve(failed('SESSION_REQUIRED'));
    let value, record;
    try {
      value=store.read(); if(value===null)return Promise.resolve(failed('SESSION_REQUIRED'));
      if(typeof value!=='string'||value.length>16384)bad('INVALID_RESPONSE');
      record=object(JSON.parse(value),['version','projectRef','subject','refreshToken','savedAt']);
      if(record.version!==1||record.projectRef!==PROJECT||typeof record.subject!=='string'||!UUID.test(record.subject)
        ||typeof record.refreshToken!=='string'||record.refreshToken.length<8||record.refreshToken.length>8192
        ||/[\s\u0000-\u001f\u007f]/u.test(record.refreshToken)||!Number.isSafeInteger(record.savedAt)
        ||record.savedAt>now()||now()-record.savedAt>24*60*60*1000)bad('INVALID_RESPONSE');
      store.remove(); // Consume before refresh; never automatically replay an uncertain refresh.
    } catch { forget(); return Promise.resolve(failed('SESSION_RESTORE_UNAVAILABLE')); }
    const clearedAt=clear('refreshing'); let run;
    try { if(generation!==clearedAt||disposed)bad('SESSION_CHANGED');run=begin(opts); }
    catch(e){record=null;return Promise.resolve(failed(errors.get(e)||'SESSION_RESTORE_UNAVAILABLE'));}
    const work=(async()=>{
      try { const expected=record.subject;const response=await request(run,'/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:record.refreshToken}});record=null;
        return await accept(run,response,expected,'TOKEN_REFRESHED'); }
      catch(e){if(run.epoch===generation&&!disposed)clear('error');return failed(errors.get(e)||'REQUEST_FAILED');}
      finally{record=null;value=null;run.close();if(restorePending===work)restorePending=null;}
    })();restorePending=work;return work;
  }
  function verifySession(opts = {}) {
    if (verifyPending) return verifyPending;
    if (!valid()) return Promise.resolve(failed(disposed ? 'DISPOSED' : 'SESSION_REQUIRED'));
    const initial = session; let run; try { run = begin(opts); } catch (e) { return Promise.resolve(failed(errors.get(e) || 'REQUEST_FAILED')); }
    const work = (async () => {
      try { const subject = await verified(run, initial.access); guard(run);
        if (!valid() || session !== initial || subject !== initial.subject) bad('SESSION_CHANGED'); return Object.freeze({ ok: true, status: 'ready' }); }
      catch (e) { if (run.epoch === generation && !disposed) clear('error'); return failed(errors.get(e) || 'REQUEST_FAILED'); }
      finally { run.close(); if (verifyPending === work) verifyPending = null; }
    })(); verifyPending = work; return work;
  }
  async function signOut(opts = {}) {
    if (disposed) return failed('DISPOSED'); let access = session?.access ?? null; const clearedAt = clear();
    if (generation !== clearedAt || disposed) { access = null; return failed('SESSION_CHANGED'); }
    if (!access) return Object.freeze({ ok: true, status: 'signed-out' }); let run;
    try { run = begin(opts); await request(run, '/auth/v1/logout?scope=local', { access, empty: true }); return Object.freeze({ ok: true, status: 'signed-out' }); }
    catch { return failed('LOGOUT_UNCONFIRMED'); }
    finally { access = null; run?.close(); }
  }
  const authClient = Object.freeze({
    async getSession() { valid(); return { data: { session: raw() }, error: null }; },
    onAuthStateChange(fn) { if (typeof fn !== 'function' || disposed) bad('INPUT_INVALID'); authListeners.add(fn);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(fn) } } }; },
  });
  return Object.freeze({ authClient, signIn, refresh, restore, verifySession, signOut,
    getContinuityState() { return Object.freeze({status:persistenceStatus}); },
    invalidate() { if (!disposed) clear('session-rejected'); },
    getState() { const authenticated = valid(); return Object.freeze({ status: state, authenticated, expiresAt: authenticated ? session.expiresAt : null, generation }); },
    subscribe(fn) { if (typeof fn !== 'function' || disposed) bad('INPUT_INVALID'); listeners.add(fn); return () => listeners.delete(fn); },
    dispose({preserveContinuity=false}={}) { if (disposed) return; disposed = true; clear('disposed', true, preserveContinuity===true); listeners.clear(); authListeners.clear(); },
  });
}
