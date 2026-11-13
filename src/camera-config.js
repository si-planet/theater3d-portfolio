// Camera framing and personal sight comparisons keep independent values.
// Sight comparisons are generic rectilinear views, not a calibrated eye model.
export const CAMERA_FOCAL_MIN_MM = 18;
export const CAMERA_FOCAL_MAX_MM = 400;
export const DEFAULT_CAMERA_FOCAL_MM = 24;
export const DEFAULT_CAMERA_ASPECT = '6:4';
export const CAPTURE_ASPECTS = Object.freeze(['6:4', '4:6', '16:9', '9:16']);
// Retain previous saved values for lossless read/export and convert only on apply.
export const STORED_CAMERA_ASPECTS = Object.freeze([...CAPTURE_ASPECTS, '4:3', '3:4', '3:2', '1:1']);
export function normalizeCameraAspectForApply(aspect) {
  return aspect === '4:3' ? '6:4' : aspect === '3:4' ? '4:6' : aspect;
}
export const SIGHT_FOCAL_MIN_MM = 5;
export const SIGHT_FOCAL_MAX_MM = 20;
export const DEFAULT_SIGHT_FOCAL_MM = 13;

// Integer controls are a presentation layer only. Never use these helpers to
// normalize lens/EXIF records, stored state, or raw optical calculations.
function finiteFocalControlValue(value) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Rounded equivalent-mm display/control value; invalid input fails closed. */
export function focalControlMm(value) {
  const number = finiteFocalControlValue(value);
  return number === null ? null : Math.round(number);
}

/** Raw ranges must be finite positive numeric bounds in ascending order.
 * Invalid ranges return null; equal rounded bounds disable the integer UI.
 */
export function getFocalControlRange(range) {
  if (!range || typeof range.minMm !== 'number' || typeof range.maxMm !== 'number'
      || finiteFocalControlValue(range.minMm) === null
      || finiteFocalControlValue(range.maxMm) === null
      || range.minMm > range.maxMm) return null;
  const minMm = Math.round(range.minMm), maxMm = Math.round(range.maxMm);
  return { minMm, maxMm, isFixed: minMm === maxMm };
}

/** Convert an explicit integer-UI edit to raw equivalent mm.
 * UI endpoints select exact optical endpoints; interior steps select integers.
 * Invalid/collapsed input preserves a valid fallback (clamped to raw bounds),
 * or the raw minimum. Invalid ranges return null and must not be applied.
 */
export function focalFromControlMm(value, range, fallbackRaw) {
  const control = getFocalControlRange(range);
  if (!control) return null;
  const clampRaw = raw => Math.min(range.maxMm, Math.max(range.minMm, raw));
  const fallback = clampRaw(finiteFocalControlValue(fallbackRaw) ?? range.minMm);
  const number = finiteFocalControlValue(value);
  if (number === null || control.isFixed) return fallback;
  const integer = Math.min(control.maxMm, Math.max(control.minMm, Math.round(number)));
  if (integer === control.minMm) return range.minMm;
  if (integer === control.maxMm) return range.maxMm;
  return clampRaw(integer);
}
