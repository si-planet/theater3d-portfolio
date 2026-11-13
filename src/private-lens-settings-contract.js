/** Owner-private standalone lens settings candidate. Pure; never reads storage. */
import { createFavoriteLens, updateLensConfig } from './lens-config.js';
import { POST_PROJECT, postExact, postFail, postDeny } from './private-seat-notes-contract.js';

export const PRIVATE_LENS_SETTINGS_PROTOCOL = 'theater3d/private-lens-settings/v1';
export const PRIVATE_LENS_SETTINGS_MAX_BYTES = 256 * 1024;
export const PRIVATE_LENS_SETTINGS_NUMBER_PATHS = Object.freeze([['payload','settings'], ['settings']]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const favoriteKeys = ['id','name','minFocalMm','maxFocalMm','apertureAtMinFocal','apertureAtMaxFocal','defaultCropFactor','provenance','sourceLabel','sourceUrl'];
export const sameLensSettings = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && sameLensSettings(a[k],b[k]));
};

/** Detached finite JSON copy; accessors, sparse arrays and numeric erasure fail. */
export function cloneLensSettingsJSON(value) {
  let nodes=0; const ancestors=new Set();
  function walk(v,depth) {
    if (++nodes>20000 || depth>20) postFail('LIMIT_EXCEEDED');
    if (v===null || typeof v==='boolean') return v;
    if (typeof v==='string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v)) postFail();
      return v;
    }
    if (typeof v==='number' && Number.isFinite(v) && !Object.is(v,-0)) return v;
    if (!v || typeof v!=='object' || ancestors.has(v)) postFail();
    const array=Array.isArray(v),keys=Reflect.ownKeys(v);
    if (array ? Object.getPrototypeOf(v)!==Array.prototype || keys.length!==v.length+1
      : ![Object.prototype,null].includes(Object.getPrototypeOf(v))) postFail();
    ancestors.add(v); const out=array?[]:{};
    for (const key of array?Array.from({length:v.length},(_,i)=>String(i)):keys) {
      const d=Object.getOwnPropertyDescriptor(v,key);
      if (typeof key!=='string' || ['__proto__','constructor','prototype'].includes(key) || !d?.enumerable || !Object.hasOwn(d,'value')) postFail();
      out[key]=walk(d.value,depth+1);
    }
    ancestors.delete(v); return Object.freeze(out);
  }
  const result=walk(value,0);
  if (new TextEncoder().encode(JSON.stringify(result)).length>PRIVATE_LENS_SETTINGS_MAX_BYTES) postFail('LIMIT_EXCEEDED');
  return result;
}

export function validateLensSettings(value) {
  const s=postExact(cloneLensSettingsJSON(value),['version','config','favorites']);
  if (s.version!==1 || !Array.isArray(s.favorites) || s.favorites.length>1000) postFail();
  const seen=new Set();
  for (const raw of s.favorites) {
    const lens=postExact(raw,favoriteKeys),canonical=createFavoriteLens(lens);
    if (!canonical.valid || seen.has(lens.id) || !sameLensSettings(lens,canonical.lens)) postFail();
    seen.add(lens.id);
  }
  const config=postExact(s.config,['mode','minMm','maxMm','lensId','cropFactor']);
  if (!['minMm','maxMm','cropFactor'].every(k=>typeof config[k]==='number')) postFail();
  const checked=updateLensConfig(null,config,s.favorites);
  if (!checked.valid || !sameLensSettings(config,checked.config)) postFail();
  return cloneLensSettingsJSON(s);
}

export function validateLensSettingsRequest(value) {
  const r=postExact(cloneLensSettingsJSON(value),['protocol','projectRef','accountId','epoch','action','payload']);
  if (r.protocol!==PRIVATE_LENS_SETTINGS_PROTOCOL || r.projectRef!==POST_PROJECT) postFail('PROJECT_MISMATCH');
  if (typeof r.accountId!=='string' || !UUID.test(r.accountId) || !Number.isSafeInteger(r.epoch) || r.epoch<0) postFail();
  if (r.action==='private.lens.read') postExact(r.payload,[]);
  else if (r.action==='private.lens.put') {
    const p=postExact(r.payload,['requestId','expectedRevision','settings']);
    if (typeof p.requestId!=='string' || !UUID.test(p.requestId) || !Number.isSafeInteger(p.expectedRevision)
      || p.expectedRevision<0 || p.expectedRevision>=Number.MAX_SAFE_INTEGER) postFail();
    validateLensSettings(p.settings);
  } else postFail('OPERATION_NOT_SUPPORTED');
  return cloneLensSettingsJSON(r);
}

export function validateLensSettingsResult(value,r) {
  const v=cloneLensSettingsJSON(value);
  if (v?.ok===false) {
    postExact(v,['ok','code']); if (postDeny(v.code).code!==v.code) postFail('INVALID_RESPONSE'); return v;
  }
  postExact(v,r.action==='private.lens.read'?['ok','settings','revision']:['ok','settings','revision','requestId','replayed']);
  if (v.ok!==true || !Number.isSafeInteger(v.revision) || v.revision<0) postFail('INVALID_RESPONSE');
  if (r.action==='private.lens.read' && v.revision===0) {
    if (v.settings!==null) postFail('INVALID_RESPONSE'); return v;
  }
  validateLensSettings(v.settings);
  if (v.revision<1) postFail('INVALID_RESPONSE');
  if (r.action==='private.lens.put' && (typeof v.replayed!=='boolean' || v.requestId!==r.payload.requestId
    || v.revision!==r.payload.expectedRevision+1 || !sameLensSettings(v.settings,r.payload.settings))) postFail('INVALID_RESPONSE');
  return v;
}
