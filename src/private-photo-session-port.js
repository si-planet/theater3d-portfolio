/** Memory-only bridge for an injected Supabase Auth-compatible client.
 * No SDK import, login, refresh, persistence, network, email lookup or identity
 * verification. The server must independently verify every access token.
 */
import { PRIVATE_PHOTO_PROJECT, privatePhotoLibraryError } from './private-photo-library.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENTS = new Set(['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED',
  'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED']);
const HISTORY_LIMIT = 4096;
const fail = () => { throw privatePhotoLibraryError('INVALID_CONFIGURATION'); };
function value(object, key) {
  if (!object || typeof object !== 'object') fail();
  const d = Object.getOwnPropertyDescriptor(object, key);
  if (!d || !Object.hasOwn(d, 'value')) fail();
  return d.value;
}
function method(object, key) {
  if (!object || typeof object !== 'object') fail();
  let current = object;
  for (let depth = 0; current && depth < 8; depth++, current = Object.getPrototypeOf(current)) {
    const d = Object.getOwnPropertyDescriptor(current, key);
    if (d) {
      if (!Object.hasOwn(d, 'value') || typeof d.value !== 'function') fail();
      return d.value.bind(object);
    }
  }
  fail();
}

export function createPrivatePhotoSessionPort(options = {}) {
  const d = options && Object.getOwnPropertyDescriptor(options, 'enabled');
  if (d && !Object.hasOwn(d, 'value')) fail();
  if (d?.value === undefined || d.value === false) {
    const port = Object.freeze({ getSession: () => null, subscribeSession: () => () => {}, getAccessToken: () => null });
    return Object.freeze({ port, start: async () => ({ status: 'disabled' }), dispose() {} });
  }
  if (d.value !== true || !options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) fail();
  if (Reflect.ownKeys(options).some(k => !['enabled', 'projectRef', 'authClient', 'clock'].includes(k))) fail();
  if (value(options, 'projectRef') !== PRIVATE_PHOTO_PROJECT) fail();
  const authClient = value(options, 'authClient');
  const authGetSession = method(authClient, 'getSession'), authSubscribe = method(authClient, 'onAuthStateChange');
  const clockDescriptor = Object.getOwnPropertyDescriptor(options, 'clock');
  if (clockDescriptor && !Object.hasOwn(clockDescriptor, 'value')) fail();
  const clock = clockDescriptor?.value ?? (() => Date.now()); if (typeof clock !== 'function') fail();
  const listeners = new Set(), history = new Map();
  let token = null, session = null, timer = null, epoch = 0, generation = 0, eventVersion = 0;
  let started = false, disposed = false, listening = false, unsubscribe = null, startPromise = null, pending = Promise.resolve();
  let status = 'idle';
  const now = () => { const n = clock(); if (!Number.isSafeInteger(n) || n < 0) fail(); return n; };
  const notify = () => { for (const fn of listeners) try { fn(); } catch {} };
  function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
  function clear(next = 'session-required') {
    generation++; stopTimer(); const changed = token !== null || session !== null;
    token = null; session = null; status = next; if (changed) notify();
  }
  function check() {
    if (disposed || !session || !token) return false;
    try { if (session.expiresAt <= now()) { clear(); return false; } }
    catch { clear('error'); return false; }
    return true;
  }
  function schedule() {
    stopTimer(); if (!check()) return;
    timer = setTimeout(() => { timer = null; if (check()) schedule(); },
      Math.min(2147483647, Math.max(0, session.expiresAt - now())));
    timer?.unref?.();
  }
  function unpack(raw) {
    if (raw === null) return null;
    const accessToken = value(raw, 'access_token'), seconds = value(raw, 'expires_at'), user = value(raw, 'user');
    const accountId = value(user, 'id');
    if (typeof accessToken !== 'string' || accessToken.length < 16 || accessToken.length > 8192
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)
        || typeof accountId !== 'string' || !UUID.test(accountId)
        || !Number.isSafeInteger(seconds) || seconds <= 0
        || !Number.isSafeInteger(seconds * 1000) || seconds * 1000 <= now()) fail();
    return { accessToken, accountId, expiresAt: seconds * 1000 };
  }
  async function fingerprint(accessToken) {
    const bytes = new TextEncoder().encode(accessToken);
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
    } finally { bytes.fill(0); }
  }
  async function install(raw) {
    if (disposed) return;
    let input;
    try { input = unpack(raw); } catch { clear('error'); return; }
    if (input === null) { clear(); return; }
    if (check() && token === input.accessToken && session.accountId === input.accountId && session.expiresAt === input.expiresAt) return;
    clear('loading'); const run = generation;
    try {
      const key = await fingerprint(input.accessToken);
      if (disposed || run !== generation) return;
      if (input.expiresAt <= now()) { clear(); return; }
      const prior = history.get(key);
      if (prior && (prior.accountId !== input.accountId || prior.expiresAt !== input.expiresAt)) {
        clear('error'); return;
      }
      if (!prior && (epoch >= Number.MAX_SAFE_INTEGER || history.size >= HISTORY_LIMIT)) { clear('error'); return; }
      const assigned = prior?.epoch ?? ++epoch;
      if (!Number.isSafeInteger(assigned) || assigned < 1) { clear('error'); return; }
      if (!prior) history.set(key, { accountId: input.accountId, expiresAt: input.expiresAt, epoch: assigned });
      token = input.accessToken;
      session = { projectRef: PRIVATE_PHOTO_PROJECT, accountId: input.accountId, epoch: assigned, expiresAt: input.expiresAt };
      status = 'ready'; schedule(); notify();
    } catch { if (!disposed && run === generation) clear('error'); }
    finally { input.accessToken = null; }
  }
  function changed(event, raw) {
    if (disposed || !started || !listening) return;
    eventVersion++;
    if (!EVENTS.has(event)) { clear('error'); pending = Promise.resolve(); return; }
    if (event === 'SIGNED_OUT') { clear(); pending = Promise.resolve(); return; }
    // The SDK callback stays synchronous; no SDK call or awaited token work here.
    pending = install(raw); pending.catch(() => {});
  }
  async function start() {
    if (disposed) return { status: 'disposed' };
    if (started) { await startPromise; await pending; return { status }; }
    started = true; status = 'loading'; const baseline = eventVersion;
    startPromise = (async () => {
      try {
        listening = true;
        const result = authSubscribe(changed);
        const subscription = value(value(result, 'data'), 'subscription');
        unsubscribe = method(subscription, 'unsubscribe');
      } catch { listening = false; clear('error'); return; }
      try {
        const result = await authGetSession();
        if (disposed || eventVersion !== baseline) { await pending; return; }
        if (value(result, 'error') !== null) { clear('error'); return; }
        await install(value(value(result, 'data'), 'session'));
      } catch { if (!disposed && eventVersion === baseline) clear('error'); }
    })();
    await startPromise; await pending; return { status: disposed ? 'disposed' : status };
  }
  const port = Object.freeze({
    getSession() { return check() ? { ...session } : null; },
    subscribeSession(listener) {
      if (typeof listener !== 'function' || disposed) fail();
      listeners.add(listener); return () => listeners.delete(listener);
    },
    getAccessToken() { return check() ? token : null; },
  });
  return Object.freeze({ port, start,
    dispose() {
      if (disposed) return; disposed = true; listening = false; clear('disposed');
      try { unsubscribe?.(); } catch {} unsubscribe = null; listeners.clear(); history.clear();
    },
  });
}
