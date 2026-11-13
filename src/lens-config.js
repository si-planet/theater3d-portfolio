import { CAMERA_FOCAL_MIN_MM, CAMERA_FOCAL_MAX_MM, DEFAULT_CAMERA_FOCAL_MM } from './camera-config.js';

// Lens focal lengths are optical millimetres. Camera framing remains 35 mm
// equivalent; cropFactor is a separate body setting, not an aperture multiplier.
export const LENS_CROP_FACTOR_MIN = 0.1;
export const LENS_CROP_FACTOR_MAX = 10;
export const DEFAULT_LENS_CONFIG = Object.freeze({
  mode: 'full', minMm: CAMERA_FOCAL_MIN_MM, maxMm: CAMERA_FOCAL_MAX_MM,
  lensId: null, cropFactor: 1,
});

// These are the original 2005 EF models, not II/RF replacements or EF70–300 DO/L variants.
// Default crop 1 is a body assumption the user can change. Only variable zoom
// endpoints are known: intermediate aperture transitions are not documented here.
export const LENS_PRESETS = Object.freeze([
  Object.freeze({
    id: 'canon-ef24-105-f4l-is-usm-i',
    name: 'Canon EF24–105mm F4L IS USM · 1세대',
    minFocalMm: 24, maxFocalMm: 105,
    apertureAtMinFocal: 4, apertureAtMaxFocal: 4,
    defaultCropFactor: 1, provenance: 'manufacturer',
    sourceLabel: 'Canon Camera Museum · 2005년 1세대',
    sourceUrl: 'https://global.canon/en/c-museum/product/ef387.html',
  }),
  Object.freeze({
    id: 'canon-ef70-300-f4-56-is-usm-i',
    name: 'Canon EF70–300mm F4–5.6 IS USM · 1세대',
    minFocalMm: 70, maxFocalMm: 300,
    apertureAtMinFocal: 4, apertureAtMaxFocal: 5.6,
    defaultCropFactor: 1, provenance: 'manufacturer',
    sourceLabel: 'Canon Camera Museum · 2005년 1세대',
    sourceUrl: 'https://global.canon/en/c-museum/product/ef388.html',
  }),
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numericText = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const nearlyEqual = (a, b) => Math.abs(a - b) <= Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b));

function finiteNumber(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!numericText.test(text)) return null;
    value = Number(text);
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function validCrop(value) {
  return value !== null && value >= LENS_CROP_FACTOR_MIN && value <= LENS_CROP_FACTOR_MAX;
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,99}$/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value);
}

function emptyAperture(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function globalBoundary(value) {
  if (nearlyEqual(value, CAMERA_FOCAL_MIN_MM)) return CAMERA_FOCAL_MIN_MM;
  if (nearlyEqual(value, CAMERA_FOCAL_MAX_MM)) return CAMERA_FOCAL_MAX_MM;
  return value;
}

function equivalentRange(lens, cropFactor) {
  const wide = lens.minFocalMm * cropFactor;
  const tele = lens.maxFocalMm * cropFactor;
  if (!Number.isFinite(wide) || !Number.isFinite(tele)) return null;
  const minMm = Math.max(CAMERA_FOCAL_MIN_MM, globalBoundary(wide));
  const maxMm = Math.min(CAMERA_FOCAL_MAX_MM, globalBoundary(tele));
  return minMm <= maxMm ? { minMm, maxMm } : null;
}

/** Validate only manually entered optical specifications and a saved body crop. */
export function createFavoriteLens(input, id) {
  const reject = error => ({ valid: false, lens: null, error });
  if (!record(input)) return reject('렌즈 정보를 확인해주세요.');
  const lensId = id === undefined ? (own(input, 'id') ? input.id : null) : id;
  if (!validId(lensId) || LENS_PRESETS.some(lens => lens.id === lensId)) {
    return reject('사용자 렌즈 식별자를 확인해주세요.');
  }
  const name = own(input, 'name') && typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) {
    return reject('렌즈 이름은 1~160자로 입력해주세요.');
  }
  const minFocalMm = own(input, 'minFocalMm') ? finiteNumber(input.minFocalMm) : null;
  const maxFocalMm = own(input, 'maxFocalMm') ? finiteNumber(input.maxFocalMm) : null;
  if (minFocalMm === null || maxFocalMm === null || minFocalMm <= 0 || maxFocalMm <= 0) {
    return reject('렌즈의 실제 초점거리는 양수로 입력해주세요.');
  }
  if (minFocalMm > maxFocalMm) return reject('최소 실제 초점거리는 최대값보다 클 수 없습니다.');
  const defaultCropFactor = own(input, 'defaultCropFactor') ? finiteNumber(input.defaultCropFactor)
    : own(input, 'cropFactor') ? finiteNumber(input.cropFactor) : 1;
  if (!validCrop(defaultCropFactor)) {
    return reject(`크롭 계수는 ${LENS_CROP_FACTOR_MIN}~${LENS_CROP_FACTOR_MAX} 사이의 숫자로 입력해주세요.`);
  }
  if (own(input, 'defaultCropFactor') && own(input, 'cropFactor')
    && finiteNumber(input.cropFactor) !== defaultCropFactor) return reject('저장할 크롭 계수를 한 값으로 입력해주세요.');

  const wideInput = own(input, 'apertureAtMinFocal') ? input.apertureAtMinFocal : null;
  const teleInput = own(input, 'apertureAtMaxFocal') ? input.apertureAtMaxFocal : null;
  const unknown = emptyAperture(wideInput) && emptyAperture(teleInput);
  const apertureAtMinFocal = unknown ? null : finiteNumber(wideInput);
  const apertureAtMaxFocal = unknown ? null : finiteNumber(teleInput);
  if (!unknown && (apertureAtMinFocal === null || apertureAtMaxFocal === null
    || apertureAtMinFocal <= 0 || apertureAtMaxFocal <= 0)) {
    return reject('최대 개방 조리개 F값은 양쪽 모두 양수로 입력하거나 양쪽을 비워주세요.');
  }
  if (minFocalMm === maxFocalMm && !unknown && apertureAtMinFocal !== apertureAtMaxFocal) {
    return reject('고정 초점거리 렌즈의 최대 개방 F값은 양쪽이 같아야 합니다.');
  }
  const lens = {
    id: lensId, name, minFocalMm, maxFocalMm, apertureAtMinFocal, apertureAtMaxFocal,
    defaultCropFactor, provenance: 'user', sourceLabel: '사용자 입력', sourceUrl: null,
  };
  if (!equivalentRange(lens, defaultCropFactor)) {
    return reject('이 렌즈와 크롭 계수는 카메라 18~400mm 환산 범위와 겹치지 않습니다.');
  }
  return { valid: true, lens, error: null };
}

/** Saved data can never promote a user's specifications to official presets. */
export function sanitizeFavoriteLenses(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const lenses = [];
  for (const item of input) {
    const result = createFavoriteLens(item);
    if (!result.valid || seen.has(result.lens.id)) continue;
    seen.add(result.lens.id);
    lenses.push(result.lens);
  }
  return lenses;
}

function findLens(id, favorites) {
  return LENS_PRESETS.find(lens => lens.id === id)
    || sanitizeFavoriteLenses(favorites).find(lens => lens.id === id) || null;
}

function candidateConfig(input, baseline) {
  const candidate = { ...baseline };
  for (const key of ['mode', 'minMm', 'maxMm', 'lensId', 'cropFactor']) {
    if (!own(input, key)) continue;
    candidate[key] = ['minMm', 'maxMm', 'cropFactor'].includes(key) ? finiteNumber(input[key]) : input[key];
  }
  return candidate;
}

function configError(config, favorites) {
  if (!['full', 'custom', 'lens'].includes(config.mode)) return '카메라 초점거리 범위 방식을 확인해주세요.';
  if (config.minMm === null || config.maxMm === null
    || config.minMm < CAMERA_FOCAL_MIN_MM || config.maxMm > CAMERA_FOCAL_MAX_MM
    || config.minMm > CAMERA_FOCAL_MAX_MM || config.maxMm < CAMERA_FOCAL_MIN_MM) {
    return '카메라 범위는 18~400mm 환산 범위 안에서 입력해주세요.';
  }
  if (config.minMm > config.maxMm) return '최소 초점거리는 최대값보다 클 수 없습니다.';
  if (!validCrop(config.cropFactor)) {
    return `크롭 계수는 ${LENS_CROP_FACTOR_MIN}~${LENS_CROP_FACTOR_MAX} 사이의 숫자로 입력해주세요.`;
  }
  const lens = config.lensId === null ? null : findLens(config.lensId, favorites);
  if (config.lensId !== null && (!validId(config.lensId) || !lens)) return '선택한 렌즈를 찾을 수 없습니다.';
  if (config.mode === 'lens') {
    if (!lens) return '사용할 렌즈를 선택해주세요.';
    if (!equivalentRange(lens, config.cropFactor)) {
      return '이 렌즈와 크롭 계수는 카메라 18~400mm 환산 범위와 겹치지 않습니다.';
    }
  }
  return null;
}

/** Restore invalid storage atomically; inherited or unrelated fields are ignored. */
export function sanitizeLensConfig(input, favorites = [], fallback = DEFAULT_LENS_CONFIG) {
  const fallbackCandidate = record(fallback) ? candidateConfig(fallback, DEFAULT_LENS_CONFIG) : { ...DEFAULT_LENS_CONFIG };
  const baseline = configError(fallbackCandidate, favorites) ? { ...DEFAULT_LENS_CONFIG } : fallbackCandidate;
  if (!record(input)) return { ...baseline };
  const candidate = candidateConfig(input, baseline);
  return configError(candidate, favorites) ? { ...baseline } : candidate;
}

/** Invalid multi-field edits preserve the whole last valid configuration. */
export function updateLensConfig(current, patch, favorites = []) {
  const config = sanitizeLensConfig(current, favorites);
  if (!record(patch)) return { valid: false, config, error: '렌즈 설정을 확인해주세요.' };
  const candidate = candidateConfig(patch, config);
  const error = configError(candidate, favorites);
  return error ? { valid: false, config, error } : { valid: true, config: candidate, error: null };
}

/** Actual usable lens span is the intersection divided by the selected crop. */
export function getCameraFocalRange(input = DEFAULT_LENS_CONFIG, favorites = []) {
  const config = sanitizeLensConfig(input, favorites);
  const lens = config.mode === 'lens' ? findLens(config.lensId, favorites) : null;
  const range = lens ? equivalentRange(lens, config.cropFactor)
    : config.mode === 'custom' ? { minMm: config.minMm, maxMm: config.maxMm }
      : { minMm: CAMERA_FOCAL_MIN_MM, maxMm: CAMERA_FOCAL_MAX_MM };
  return {
    ...range, lens, cropFactor: config.cropFactor, isFixed: range.minMm === range.maxMm,
    actualMinMm: lens ? range.minMm / config.cropFactor : null,
    actualMaxMm: lens ? range.maxMm / config.cropFactor : null,
  };
}

/** New selections start at the usable wide endpoint. Saved values are untouched. */
export function getCameraStartingFocalMm(config = DEFAULT_LENS_CONFIG, favorites = []) {
  return getCameraFocalRange(config, favorites).minMm;
}

/** Optical-mm shortcuts for physical lenses; other modes use equivalent mm.
 * These are useful framing steps, never claimed aperture transition points.
 * Preserve fractional clipped endpoints and do not offer out-of-range choices.
 */
export function getCameraFocalPresets(config = DEFAULT_LENS_CONFIG, favorites = []) {
  const range = getCameraFocalRange(config, favorites);
  const factor = range.lens ? range.cropFactor : 1;
  const min = range.lens && nearlyEqual(range.minMm / factor, range.lens.minFocalMm) ? range.lens.minFocalMm : range.minMm / factor;
  const max = range.lens && nearlyEqual(range.maxMm / factor, range.lens.maxFocalMm) ? range.lens.maxFocalMm : range.maxMm / factor;
  const values = [min, ...[24, 50, 70, 105, 200, 250, 300].filter(value => value > min && value < max), max];
  return values.filter((value, index) => index === 0 || !nearlyEqual(value, values[index - 1])).map(value => ({
    actualMm: range.lens ? value : null,
    equivalentMm: globalBoundary(value * factor),
    labelMm: value,
    basis: range.lens ? 'optical' : 'equivalent',
  }));
}

/** Keep fractional boundaries exactly; rounding could push a focal outside them. */
export function clampCameraFocalMm(value, config = DEFAULT_LENS_CONFIG, favorites = [], fallback = DEFAULT_CAMERA_FOCAL_MM) {
  const range = getCameraFocalRange(config, favorites);
  const number = finiteNumber(value) ?? finiteNumber(fallback) ?? DEFAULT_CAMERA_FOCAL_MM;
  return clamp(number, range.minMm, range.maxMm);
}

/**
 * Maximum opening is the lowest F-number, not the minimum aperture specification.
 * Variable zoom interiors stay unknown until verified transition data exists.
 */
export function getLensAperture(config, equivalentFocalMm, favorites = []) {
  const range = getCameraFocalRange(config, favorites);
  const equivalent = finiteNumber(equivalentFocalMm);
  const lens = range.lens;
  const actualFocalMm = lens && equivalent !== null ? finiteNumber(equivalent / range.cropFactor) : null;
  const result = {
    fNumber: null, confidence: 'unknown', actualFocalMm,
    sourceUrl: lens?.sourceUrl ?? null, sourceLabel: lens?.sourceLabel ?? null,
  };
  if (!lens || equivalent === null
    || (equivalent < range.minMm && !nearlyEqual(equivalent, range.minMm))
    || (equivalent > range.maxMm && !nearlyEqual(equivalent, range.maxMm))
    || lens.apertureAtMinFocal === null || lens.apertureAtMaxFocal === null) return result;
  if (lens.apertureAtMinFocal === lens.apertureAtMaxFocal) {
    return { ...result, fNumber: lens.apertureAtMinFocal, confidence: lens.provenance };
  }
  if (nearlyEqual(actualFocalMm, lens.minFocalMm)) {
    return { ...result, fNumber: lens.apertureAtMinFocal, confidence: lens.provenance };
  }
  if (nearlyEqual(actualFocalMm, lens.maxFocalMm)) {
    return { ...result, fNumber: lens.apertureAtMaxFocal, confidence: lens.provenance };
  }
  return result;
}

// Optional preset-only dependency. This never changes the user's lens store or
// infers an optical range from the unrelated custom minMm/maxMm fields.
export const PRESET_LENS_DEFINITION_SCHEMA = 'theater3d.preset-lens-definition/v1';
const definitionKeys = ['schema','lensId','name','minFocalMm','maxFocalMm','apertureAtMinFocal','apertureAtMaxFocal','defaultCropFactor','effectiveMinMm','effectiveMaxMm'];
const configKeys = ['mode','minMm','maxMm','lensId','cropFactor'];
function presetLensFields(value, keys) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)) throw Error();
  const names=Reflect.ownKeys(value); if(names.length!==keys.length||names.some(k=>!keys.includes(k)))throw Error();
  const out={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d?.enumerable||!own(d,'value'))throw Error();
    const v=d.value;if(v!==null&&!['string','number'].includes(typeof v)||typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))throw Error();out[key]=v;}
  return out;
}
function presetLensConfig(raw) {
  const config=presetLensFields(raw,configKeys);
  if(!['full','custom','lens'].includes(config.mode)||typeof config.cropFactor!=='number'||!validCrop(config.cropFactor)
    ||typeof config.minMm!=='number'||typeof config.maxMm!=='number'||config.minMm<CAMERA_FOCAL_MIN_MM||config.maxMm>CAMERA_FOCAL_MAX_MM||config.minMm>config.maxMm
    ||config.lensId!==null&&!validId(config.lensId))throw Error();
  return config;
}
function lensFromDefinition(d) {
  if(d.schema!==PRESET_LENS_DEFINITION_SCHEMA||typeof d.name!=='string'||d.name!==d.name.trim()
    ||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(d.name))throw Error();
  for(const key of ['minFocalMm','maxFocalMm','defaultCropFactor','effectiveMinMm','effectiveMaxMm'])if(typeof d[key]!=='number')throw Error();
  for(const key of ['apertureAtMinFocal','apertureAtMaxFocal'])if(d[key]!==null&&typeof d[key]!=='number')throw Error();
  const result=createFavoriteLens({id:d.lensId,name:d.name,minFocalMm:d.minFocalMm,maxFocalMm:d.maxFocalMm,
    apertureAtMinFocal:d.apertureAtMinFocal,apertureAtMaxFocal:d.apertureAtMaxFocal,defaultCropFactor:d.defaultCropFactor});
  if(!result.valid)throw Error();return result.lens;
}
export function validatePresetLensDefinition(config, definition) {
  try {
    const c=presetLensConfig(config),d=presetLensFields(definition,definitionKeys),lens=lensFromDefinition(d);
    if(c.lensId!==lens.id||configError(c,[lens]))return false;
    const range=getCameraFocalRange(c,[lens]);
    return d.effectiveMinMm===range.minMm&&d.effectiveMaxMm===range.maxMm;
  } catch { return false; }
}
export function capturePresetLensDefinition(config, favorites = []) {
  try {
    const c=presetLensConfig(config);
    if(c.lensId===null){if(c.mode==='lens')throw Error();return Object.freeze({ok:true,lensDefinition:null});}
    if(LENS_PRESETS.some(lens=>lens.id===c.lensId)){
      if(configError(c,[]))throw Error();return Object.freeze({ok:true,lensDefinition:null});
    }
    const prepared=copyPresetFavorites(favorites);
    const found=prepared.find(lens=>lens.id===c.lensId);
    if(!found)throw Error();
    const range=getCameraFocalRange(c,[found]);
    const d={schema:PRESET_LENS_DEFINITION_SCHEMA,lensId:found.id,name:found.name,minFocalMm:found.minFocalMm,maxFocalMm:found.maxFocalMm,
      apertureAtMinFocal:found.apertureAtMinFocal,apertureAtMaxFocal:found.apertureAtMaxFocal,defaultCropFactor:found.defaultCropFactor,
      effectiveMinMm:range.minMm,effectiveMaxMm:range.maxMm};
    if(!validatePresetLensDefinition(c,d))throw Error();
    return Object.freeze({ok:true,lensDefinition:Object.freeze(d)});
  } catch { return Object.freeze({ok:false,code:'LENS_DEFINITION_UNAVAILABLE'}); }
}
function copyPresetFavorites(favorites) {
  if(!Array.isArray(favorites)||Object.getPrototypeOf(favorites)!==Array.prototype||favorites.length>1000
    ||Reflect.ownKeys(favorites).length!==favorites.length+1)throw Error();
  const result=[],ids=new Set();
  for(let i=0;i<favorites.length;i++){
    const d=Object.getOwnPropertyDescriptor(favorites,String(i));if(!d?.enumerable||!own(d,'value'))throw Error();
    const lens=presetLensFields(d.value,['id','name','minFocalMm','maxFocalMm','apertureAtMinFocal','apertureAtMaxFocal','defaultCropFactor','provenance','sourceLabel','sourceUrl']);
    const canonical=createFavoriteLens(lens);
    if(!canonical.valid||ids.has(lens.id)||JSON.stringify(lens)!==JSON.stringify(canonical.lens))throw Error();
    ids.add(lens.id);result.push(canonical.lens);
  }
  return result;
}
export function restorePresetLensDefinition(config, definition, favorites = []) {
  try {
    const c=presetLensConfig(config),existing=copyPresetFavorites(favorites);
    if(definition===undefined){
      if(c.lensId!==null&&!LENS_PRESETS.some(lens=>lens.id===c.lensId)||configError(c,existing))return Object.freeze({ok:false,code:'LENS_DEFINITION_UNAVAILABLE'});
      return Object.freeze({ok:true,config:Object.freeze(c),favorites:Object.freeze(existing.map(Object.freeze)),lensDefinition:null});
    }
    if(!validatePresetLensDefinition(c,definition))throw Error();
    const d=presetLensFields(definition,definitionKeys),lens=lensFromDefinition(d);
    // The returned list is an ephemeral renderer dependency, not permission to
    // replace/persist a same-ID user favourite on this device.
    const effective=[...existing.filter(item=>item.id!==lens.id),lens].map(Object.freeze);
    return Object.freeze({ok:true,config:Object.freeze(c),favorites:Object.freeze(effective),lensDefinition:Object.freeze(d)});
  } catch { return Object.freeze({ok:false,code:'INVALID_LENS_DEFINITION'}); }
}
