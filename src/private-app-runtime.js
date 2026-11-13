/** Product data lifecycle. No ambient fetch, storage, account or credential lookup. */
export function createPrivateAppRuntime({ readPublicJSON, clock = () => Date.now() } = {}) {
  if (typeof readPublicJSON !== 'function' || typeof clock !== 'function') throw new TypeError('INVALID_CONFIGURATION');
  let provider = null, unsubscribe = null, epoch = 0, signature = null, disposed = false;
  let state = { mode: 'public', status: 'ready', epoch };
  const listeners = new Set();
  const failure = code => Object.assign(new Error('Private runtime unavailable'), { code });
  const notify = () => { for (const listener of listeners) try { listener(); } catch {} };
  function session() {
    if (!provider) return null;
    const value = provider.getSession();
    if (!value || value.projectRef !== 'portfolio-demo-disabled' || typeof value.accountId !== 'string'
        || !Number.isSafeInteger(value.epoch) || !Number.isSafeInteger(value.expiresAt)
        || value.expiresAt <= clock()) return null;
    return JSON.stringify([value.projectRef, value.accountId, value.epoch, value.expiresAt]);
  }
  function sync() {
    if (disposed || !provider) return;
    let next = null;
    try { next = session(); } catch {}
    if (next !== signature) {
      signature = next; state = { mode: 'private', status: next ? 'ready' : 'locked', epoch: ++epoch }; notify();
    }
  }
  function configure(connection = null) {
    if (disposed) throw failure('DISPOSED');
    const previousOff = unsubscribe; unsubscribe = null; provider = null; signature = null;
    state = { mode: connection === null ? 'public' : 'private', status: connection === null ? 'ready' : 'locked', epoch: ++epoch };
    try {
      try { previousOff?.(); } catch { throw failure('INVALID_CONFIGURATION'); }
      if (connection !== null) {
        if (!connection || Object.getPrototypeOf(connection) !== Object.prototype
            || Reflect.ownKeys(connection).length !== 3
            || !['readJSON', 'getSession', 'subscribeSession'].every(k => {
              const d = Object.getOwnPropertyDescriptor(connection, k);
              return d?.enumerable && Object.hasOwn(d, 'value') && typeof d.value === 'function';
            })) throw failure('INVALID_CONFIGURATION');
        provider = Object.freeze({ ...connection });
        unsubscribe = provider.subscribeSession(sync);
        if (typeof unsubscribe !== 'function') throw failure('INVALID_CONFIGURATION');
        signature = session(); state.status = signature ? 'ready' : 'locked';
      }
    } catch {
      try { unsubscribe?.(); } catch {} unsubscribe = null; provider = null;
      state.status = 'error'; notify(); return { ok: false, code: 'INVALID_CONFIGURATION' };
    }
    notify(); return { ok: true, status: state.status };
  }
  async function readJSON(path, options = {}) {
    if (disposed) throw failure('DISPOSED');
    if (typeof path !== 'string' || !/^\.\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/.test(path)
        || path.slice(2).split('/').some(p => !p || p === '.' || p === '..')) throw failure('INPUT_INVALID');
    sync();
    if (state.status !== 'ready') throw failure('SESSION_REQUIRED');
    const start = epoch, current = provider, sig = signature;
    const value = await (current ? current.readJSON(path, options) : readPublicJSON(path, options));
    sync();
    if (disposed || epoch !== start || provider !== current || signature !== sig || options.signal?.aborted)
      throw failure('SESSION_CHANGED');
    return value;
  }
  return Object.freeze({ configure, readJSON,
    getState() { sync(); return Object.freeze({ ...state }); },
    subscribe(listener) { if (disposed || typeof listener !== 'function') throw failure('INVALID_CONFIGURATION');
      listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { if (disposed) return; disposed = true; const oldOff = unsubscribe; provider = null; unsubscribe = null; signature = null;
      state = { mode: 'private', status: 'locked', epoch: ++epoch }; try { oldOff?.(); } catch {} notify(); listeners.clear(); },
  });
}
