// 35mm equivalent focal length is compared using equal diagonal field of view.
// The image aspect ratio determines its horizontal and vertical dimensions.
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);
const degrees = radians => radians * 180 / Math.PI;

function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

export function equivalentSensorDimensions(aspectRatio = 3 / 2) {
  positive(aspectRatio, 'aspectRatio');
  const heightMm = FULL_FRAME_DIAGONAL_MM / Math.sqrt(aspectRatio ** 2 + 1);
  return { widthMm: heightMm * aspectRatio, heightMm };
}

export function horizontalFovDeg(focalLength35Mm, aspectRatio = 3 / 2) {
  positive(focalLength35Mm, 'focalLength35Mm');
  return degrees(2 * Math.atan(equivalentSensorDimensions(aspectRatio).widthMm / (2 * focalLength35Mm)));
}

export function distance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function framingMetrics({ distanceM, subjectHeightM, focalLength35Mm, aspectRatio = 3 / 2 }) {
  positive(distanceM, 'distanceM');
  positive(subjectHeightM, 'subjectHeightM');
  positive(focalLength35Mm, 'focalLength35Mm');
  const { heightMm } = equivalentSensorDimensions(aspectRatio);
  const frameHeightM = distanceM * heightMm / focalLength35Mm;
  return {
    horizontalFovDeg: horizontalFovDeg(focalLength35Mm, aspectRatio),
    verticalFovDeg: degrees(2 * Math.atan(heightMm / (2 * focalLength35Mm))),
    frameHeightM,
    subjectFillFraction: subjectHeightM / frameHeightM,
  };
}

// Approximation for a subject near the optical axis and an upright camera.
// Pose, camera tilt, lens distortion and sensor crop are outside this model.
export function focalLengthForFraming35Mm({ distanceM, subjectHeightM, aspectRatio = 3 / 2, fillFraction = 0.8 }) {
  positive(distanceM, 'distanceM');
  positive(subjectHeightM, 'subjectHeightM');
  positive(fillFraction, 'fillFraction');
  const { heightMm } = equivalentSensorDimensions(aspectRatio);
  return fillFraction * distanceM * heightMm / subjectHeightM;
}
