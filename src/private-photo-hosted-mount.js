/** Product mount/lifecycle only. Disabled until explicit reviewed inputs arrive.
 * Login/logout actions are supplied by the host; no SDK, credential form, global
 * fetch, account inference or persistence is created here.
 */
import { createPrivatePhotoLibraryUI } from './private-photo-library-ui.js';
import { createPrivatePhotoHttpProvider } from './private-photo-http-provider.js';
import { createPrivatePhotoSessionPort } from './private-photo-session-port.js';

const mounts = new WeakMap(), CANCELED = Symbol('canceled');
const TEXT = Object.freeze({
  unconfigured: '개인 자료 연결이 아직 설정되지 않았습니다.',
  connecting: '개인 자료 연결 상태를 확인하고 있습니다.',
  'authentication-required': '개인 자료를 보려면 연결된 계정으로 로그인해 주세요.',
  ready: '계정 세션이 준비됐습니다. 아래 자료함에서 조회 결과를 확인할 수 있습니다.',
  'auth-action-unconfigured': '로그인 연결 동작이 아직 설정되지 않았습니다.',
  'login-pending': '로그인 동작을 진행하고 있습니다.',
  'login-cancelled': '로그인이 취소됐습니다. 개인 자료 연결을 닫았습니다.',
  'login-error': '로그인 상태를 확인하지 못했습니다. 개인 자료 연결은 닫혀 있습니다.',
  'logout-pending': '개인 자료를 비웠습니다. 로그아웃 결과를 확인하고 있습니다.',
  'logged-out': '로그아웃 동작이 완료됐으며 개인 자료를 비웠습니다.',
  'logout-local-only': '개인 자료 연결을 닫았습니다. 계정 로그아웃 동작은 아직 설정되지 않았습니다.',
  'logout-error': '개인 자료는 비웠지만 계정 로그아웃 완료는 확인하지 못했습니다.',
  'configuration-error': '연결 설정을 확인하지 못했습니다. 개인 자료를 불러오지 않습니다.',
});
function exact(object, keys) {
  if (!object || ![Object.prototype, null].includes(Object.getPrototypeOf(object)) || Array.isArray(object)) throw Error('INVALID_MOUNT_CONFIG');
  const own = Reflect.ownKeys(object);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) throw Error('INVALID_MOUNT_CONFIG');
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) throw Error('INVALID_MOUNT_CONFIG');
    out[key] = d.value;
  }
  return out;
}
function configuration(input) {
  const keys = Reflect.ownKeys(input);
  const callbacks=['getCurrentPhotoSelection','onCompareRegisteredPhoto','onApplyRegisteredPhotoFocus','onPrivatePhotosCleared'];
  if (keys.some(k => !['config', 'authClient', 'fetchImpl', 'loginAction', 'logoutAction', 'clock','registrationReader','deleteClient',...callbacks].includes(k))) throw Error('INVALID_MOUNT_CONFIG');
  const v = exact(input, keys);
  v.config = exact(v.config, ['projectRef', 'supabaseUrl', 'publishableKey']);
  if (typeof v.fetchImpl !== 'function' || v.loginAction !== undefined && typeof v.loginAction !== 'function'
      || v.logoutAction !== undefined && typeof v.logoutAction !== 'function'
      || v.clock !== undefined && typeof v.clock !== 'function') throw Error('INVALID_MOUNT_CONFIG');
  for(const key of callbacks)if(v[key]!==undefined&&typeof v[key]!=='function')throw Error('INVALID_MOUNT_CONFIG');
  for(const [key,methods]of [['registrationReader',['read','getSession']],['deleteClient',['remove','recheck']]])if(v[key]!==undefined){
    for(const method of methods){const d=v[key]&&Object.getOwnPropertyDescriptor(v[key],method);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function')throw Error('INVALID_MOUNT_CONFIG');}
  }
  return v;
}
function canceledAction(result) {
  if (result === false || result === null) return true;
  if (result && typeof result === 'object') {
    const error = Object.getOwnPropertyDescriptor(result, 'error');
    const status = Object.getOwnPropertyDescriptor(result, 'status');
    if (error && (!Object.hasOwn(error, 'value') || error.value !== null && error.value !== undefined)
        || status && !Object.hasOwn(status, 'value')) throw Error('AUTH_ACTION_FAILED');
    return status?.value === 'cancelled';
  }
  return false;
}

export function createPrivatePhotoHostedMount(options = {}) {
  // Do not inspect any configuration/auth/transport options while disabled.
  const descriptor = options && Object.getOwnPropertyDescriptor(options, 'container');
  const container = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  if (!container?.ownerDocument?.createElement) throw new TypeError('PRIVATE_PHOTO_CONTAINER_REQUIRED');
  const providerHook=Object.getOwnPropertyDescriptor(options,'onProviderChanged');
  const catalogHook=Object.getOwnPropertyDescriptor(options,'onCatalogChanged');
  const notifyProvider=provider=>{if(providerHook&&Object.hasOwn(providerHook,'value')&&typeof providerHook.value==='function')providerHook.value(provider);};
  mounts.get(container)?.dispose();
  const doc = container.ownerDocument;
  const root = doc.createElement('div'); root.dataset.privateHosted = 'root';
  const controls = doc.createElement('div'); controls.className = 'private-photo-actions';
  const status = doc.createElement('p'); status.dataset.privateHosted = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const login = doc.createElement('button'); login.type = 'button'; login.dataset.privateHosted = 'login'; login.textContent = '계정 연결';
  const logoutButton = doc.createElement('button'); logoutButton.type = 'button'; logoutButton.dataset.privateHosted = 'logout'; logoutButton.textContent = '로그아웃';
  const uiHost = doc.createElement('div'); uiHost.dataset.privateHosted = 'library';
  controls.append(login, logoutButton); root.append(status, controls, uiHost); container.append(root);
  let disposed = false, generation = 0, settings = null, context = null, ui = null;
  let state = 'unconfigured', sessionReady = false, busy = false, actionPromise = null;
  // Rebuilding the provider must not erase its 401/403 rejection. Keep only
  // SHA256 token fingerprints for this mount's lifetime, never raw credentials.
  const deniedTokens = new Set(); let denialLimit = false;
  function snapshot() { return Object.freeze({ status: disposed ? 'disposed' : state, configured: settings !== null, sessionReady, busy: !disposed && busy, disposed }); }
  function show(next, isBusy = false) {
    if (disposed) return;
    state = next; busy = isBusy; status.dataset.state = next; status.textContent = TEXT[next] || TEXT['configuration-error'];
    login.hidden = settings === null || sessionReady; login.disabled = isBusy || typeof settings?.loginAction !== 'function';
    logoutButton.hidden = settings === null || !sessionReady && !isBusy; logoutButton.disabled = isBusy;
  }
  function removeUI() { try { ui?.dispose(); } catch {} ui = null; try { notifyProvider(null); } catch {} }
  function mountUI(provider = null) {
    removeUI();
    try { notifyProvider(provider); } catch {}
    ui = createPrivatePhotoLibraryUI({ container: uiHost, provider, onCatalogChanged:()=>{notifyProvider(provider);if(catalogHook&&Object.hasOwn(catalogHook,'value')&&typeof catalogHook.value==='function')catalogHook.value();},
      ...Object.fromEntries(['registrationReader','deleteClient','getCurrentPhotoSelection','onCompareRegisteredPhoto','onApplyRegisteredPhotoFocus','onPrivatePhotosCleared'].filter(k=>settings&&Object.hasOwn(settings,k)).map(k=>[k,settings[k]])),
      ...(settings?.clock ? { clock: settings.clock } : {}) });
  }
  function closeConnection() {
    generation++; actionPromise = null; sessionReady = false; busy = false;
    const old = context; context = null;
    if (old) {
      old.cancelResolve(CANCELED); old.abort.abort();
      try { old.unsubscribe?.(); } catch {}
    }
    removeUI();
    try { old?.provider?.dispose(); } catch {}
    try { old?.bridge?.dispose(); } catch {}
  }
  function closedUI() {
    mountUI(settings === null ? null : createPrivatePhotoHttpProvider({ enabled: false }));
  }
  function newContext() {
    let cancelResolve;
    const cancelPromise = new Promise(resolve => { cancelResolve = resolve; });
    return { generation, cancelPromise, cancelResolve, abort: new AbortController(), provider: null,
      bridge: null, unsubscribe: null, signature: undefined, admitted: false, syncing: false };
  }
  const live = c => !disposed && context === c && c.generation === generation && !c.abort.signal.aborted;
  function guardedTransport(c, transport) {
    return async (url, request) => {
      let authorization = request.headers.Authorization;
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorization));
      authorization = null;
      const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!live(c) || request.signal.aborted) throw Error('MOUNT_CANCELED');
      if (denialLimit || deniedTokens.has(fingerprint)) return new Response(null, { status: 401 });
      const response = await transport(url, request);
      if (response?.status === 401 || response?.status === 403) {
        if (deniedTokens.size >= 4096) denialLimit = true;
        else deniedTokens.add(fingerprint);
      }
      return response;
    };
  }
  function sync(c) {
    if (!live(c) || !c.admitted || c.syncing || busy) return;
    c.syncing = true;
    try {
      const session = c.provider.getSession(), signature = session ? JSON.stringify(session) : null;
      if (signature === c.signature) return;
      c.signature = signature; sessionReady = session !== null;
      mountUI(c.provider);
      show(sessionReady ? 'ready' : 'authentication-required');
    } catch {
      if (live(c)) { closeConnection(); closedUI(); show('configuration-error'); }
    } finally { c.syncing = false; }
  }
  async function attach(c) {
    try {
      const fixed = settings;
      c.bridge = createPrivatePhotoSessionPort({ enabled: true, projectRef: fixed.config.projectRef,
        authClient: fixed.authClient, ...(fixed.clock ? { clock: fixed.clock } : {}) });
      c.provider = createPrivatePhotoHttpProvider({ enabled: true, ...fixed.config,
        fetchImpl: guardedTransport(c, fixed.fetchImpl), sessionPort: c.bridge.port, ...(fixed.clock ? { clock: fixed.clock } : {}) });
      c.unsubscribe = c.provider.subscribeSession(() => sync(c));
      const result = await Promise.race([c.bridge.start(), c.cancelPromise]);
      if (result === CANCELED || !live(c)) return snapshot();
      if (result.status === 'error') throw Error('AUTH_SESSION_UNAVAILABLE');
      busy = false; c.admitted = true; sync(c); return snapshot();
    } catch {
      if (live(c)) { closeConnection(); closedUI(); show('configuration-error'); }
      return snapshot();
    }
  }
  async function enable(input) {
    if (disposed) return snapshot();
    if (input === null || input === undefined) return disable();
    closeConnection(); settings = null;
    try { settings = configuration(input); } catch { closedUI(); show('configuration-error'); return snapshot(); }
    show('connecting', true); const c = newContext(); context = c;
    return attach(c);
  }
  function disable() {
    if (disposed) return snapshot();
    closeConnection(); settings = null; closedUI(); show('unconfigured'); return snapshot();
  }
  async function connectAuth() {
    if (disposed) return snapshot();
    if (actionPromise) return actionPromise;
    if (!settings) { show('unconfigured'); return snapshot(); }
    if (typeof settings.loginAction !== 'function') { show('auth-action-unconfigured'); return snapshot(); }
    const action = settings.loginAction;
    closeConnection(); closedUI(); show('login-pending', true);
    const c = newContext(); context = c;
    actionPromise = (async () => {
      try {
        const result = await Promise.race([Promise.resolve().then(() => action({ signal: c.abort.signal })), c.cancelPromise]);
        if (result === CANCELED || !live(c)) return snapshot();
        if (canceledAction(result)) {
          closeConnection(); closedUI(); show('login-cancelled'); return snapshot();
        }
        show('connecting', true); return await attach(c);
      } catch {
        if (live(c)) { closeConnection(); closedUI(); show('login-error'); }
        return snapshot();
      } finally { if (live(c)) actionPromise = null; }
    })();
    return actionPromise;
  }
  async function logout() {
    if (disposed) return snapshot();
    if (actionPromise && state === 'logout-pending') return actionPromise;
    const action = settings?.logoutAction;
    closeConnection(); closedUI();
    if (typeof action !== 'function') { show(settings ? 'logout-local-only' : 'unconfigured'); return snapshot(); }
    show('logout-pending', true); const c = newContext(); context = c;
    actionPromise = (async () => {
      try {
        const result = await Promise.race([Promise.resolve().then(() => action({ signal: c.abort.signal })), c.cancelPromise]);
        if (result === CANCELED || !live(c)) return snapshot();
        const canceled = canceledAction(result);
        closeConnection(); closedUI(); show(canceled ? 'logout-error' : 'logged-out');
      } catch { if (live(c)) { closeConnection(); closedUI(); show('logout-error'); } }
      return snapshot();
    })();
    return actionPromise;
  }
  async function checkSession() {
    if (disposed) return false;
    const c = context;
    if (c?.admitted) sync(c);
    const current = ui;
    try { const valid = await current?.checkSession(); return !disposed && current === ui && valid === true; }
    catch { return false; }
  }
  const loginClick = () => { void connectAuth(); }, logoutClick = () => { void logout(); };
  login.addEventListener('click', loginClick); logoutButton.addEventListener('click', logoutClick);
  const controller = Object.freeze({ enable, connectAuth, logout, disable, checkSession, refresh(){const c=context;if(disposed||!c?.admitted||!live(c)||!sessionReady)return false;sync(c);try{notifyProvider(c.provider);}catch{}return ui?.refresh()===true;}, getState: snapshot,
    dispose() {
      if (disposed) return; closeConnection(); disposed = true; settings = null;
      deniedTokens.clear(); denialLimit = false;
      login.removeEventListener('click', loginClick); logoutButton.removeEventListener('click', logoutClick);
      root.replaceChildren(); root.remove(); if (mounts.get(container) === controller) mounts.delete(container);
    },
  });
  mounts.set(container, controller); closedUI(); show('unconfigured'); return controller;
}
