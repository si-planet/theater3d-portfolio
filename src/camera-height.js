// Personal camera heights are measured from the chair's seating surface in cm.
// The 45 cm chair height is a model assumption, not an official venue dimension.
export const CAMERA_HEIGHT_MIN_CM = 0;
export const CAMERA_HEIGHT_MAX_CM = 150;
export const DEFAULT_SEAT_HEIGHT_M = 0.45;
export const DEFAULT_CAMERA_HEIGHT_CONFIG = Object.freeze({
  minCm: 30,
  maxCm: 80,
  offsetCm: 75,
});

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validRange(minCm, maxCm) {
  return minCm !== null && maxCm !== null
    && minCm >= CAMERA_HEIGHT_MIN_CM && maxCm <= CAMERA_HEIGHT_MAX_CM
    && minCm <= maxCm;
}

function normalizedConfig(input, fallback) {
  if (!record(input)) return { ...fallback };
  const minCm = own(input, 'minCm') ? finiteNumber(input.minCm) : fallback.minCm;
  const maxCm = own(input, 'maxCm') ? finiteNumber(input.maxCm) : fallback.maxCm;
  const offsetCm = own(input, 'offsetCm') ? finiteNumber(input.offsetCm) : fallback.offsetCm;
  if (!validRange(minCm, maxCm) || offsetCm === null) return { ...fallback };
  return { minCm, maxCm, offsetCm: clamp(offsetCm, minCm, maxCm) };
}

/** Restore saved personal settings, falling back atomically if they are invalid. */
export function sanitizeCameraHeightConfig(config, fallback = DEFAULT_CAMERA_HEIGHT_CONFIG) {
  const baseline = normalizedConfig(fallback, DEFAULT_CAMERA_HEIGHT_CONFIG);
  return normalizedConfig(config, baseline);
}

/** Apply one edit; invalid input preserves the last valid configuration. */
export function updateCameraHeightConfig(current, patch) {
  const config = sanitizeCameraHeightConfig(current);
  const reject = error => ({ valid: false, config, error });
  if (!record(patch)) return reject('카메라 높이 설정을 확인해주세요.');
  const candidate = { ...config };
  for (const key of ['minCm', 'maxCm', 'offsetCm']) {
    if (!own(patch, key)) continue;
    const number = finiteNumber(patch[key]);
    if (number === null) return reject('카메라 높이는 빈칸 없이 숫자로 입력해주세요.');
    candidate[key] = number;
  }
  if (candidate.minCm < CAMERA_HEIGHT_MIN_CM || candidate.minCm > CAMERA_HEIGHT_MAX_CM
    || candidate.maxCm < CAMERA_HEIGHT_MIN_CM || candidate.maxCm > CAMERA_HEIGHT_MAX_CM) {
    return reject(`개인 높이 범위는 ${CAMERA_HEIGHT_MIN_CM}~${CAMERA_HEIGHT_MAX_CM} cm로 입력해주세요.`);
  }
  if (candidate.minCm > candidate.maxCm) return reject('최저 높이는 최고 높이보다 클 수 없습니다.');
  candidate.offsetCm = clamp(candidate.offsetCm, candidate.minCm, candidate.maxCm);
  return { valid: true, config: candidate, error: null };
}

/** Clamp a requested height to the user's own range, retaining valid decimals. */
export function clampCameraOffsetCm(offsetCm, config = DEFAULT_CAMERA_HEIGHT_CONFIG) {
  const valid = sanitizeCameraHeightConfig(config);
  const number = finiteNumber(offsetCm);
  return number === null ? valid.offsetCm : clamp(number, valid.minCm, valid.maxCm);
}

/**
 * Camera height above this seat's floor, in metres. The caller adds the row's
 * floor elevation via seatPosition; adding it here would count it twice.
 */
export function effectiveFloorHeight(config, seatHeightM = DEFAULT_SEAT_HEIGHT_M) {
  const valid = sanitizeCameraHeightConfig(config);
  const number = finiteNumber(seatHeightM);
  const chairHeightM = number !== null && number >= 0 ? number : DEFAULT_SEAT_HEIGHT_M;
  return chairHeightM + valid.offsetCm / 100;
}
