/** Same-tab refresh continuity only. No access token or password persistence.
 * Explicitly injected browser sessionStorage; no localStorage/IDB/cookie fallback.
 */
export function createPrivateAuthContinuityStore(storage) {
  if(!storage||['getItem','setItem','removeItem'].some(k=>typeof storage[k]!=='function'))throw new TypeError('INVALID_CONFIGURATION');
  const key='td.private-auth.portfolio-demo-disabled.refresh.v1';
  return Object.freeze({
    read(){return storage.getItem(key);},
    write(value){if(typeof value!=='string'||value.length>16384)throw new TypeError('INPUT_LIMIT');storage.setItem(key,value);},
    remove(){storage.removeItem(key);},
  });
}
