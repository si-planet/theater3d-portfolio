const degrees = radians => radians * 180 / Math.PI;
const radians = degrees => degrees * Math.PI / 180;

export function normalizeSignedAngle(value) {
  if (!Number.isFinite(value)) throw new RangeError('Angle must be finite');
  const angle = ((value + 180) % 360 + 360) % 360 - 180;
  return Object.is(angle, -0) ? 0 : angle;
}

/** Keep manual tilt clear of a vertical look direction and its undefined up axis. */
export function normalizePitch(value) {
  if (!Number.isFinite(value)) throw new RangeError('Pitch must be finite');
  const pitch = Math.max(-85, Math.min(85, value));
  return Object.is(pitch, -0) ? 0 : pitch;
}

function point(value) {
  if (!value || !['x', 'y', 'z'].every(axis => Number.isFinite(value[axis]))) {
    throw new RangeError('View point must have finite coordinates');
  }
  return value;
}

/** Yaw is relative to this seat's stage centre; pitch is above the horizontal. */
export function seatViewDirection({ eye, stageCenter, target, yawDeg = 0, pitchDeg = 0, followSelected = true }) {
  point(eye); point(stageCenter); point(target);
  const dx = stageCenter.x - eye.x, dz = stageCenter.z - eye.z;
  const referenceBearingDeg = degrees(Math.atan2(dx, -dz));
  if (followSelected) {
    const targetDx = target.x - eye.x, targetDz = target.z - eye.z;
    const bearing = degrees(Math.atan2(targetDx, -targetDz));
    const pitch = degrees(Math.atan2(target.y - eye.y, Math.hypot(targetDx, targetDz)));
    return { target: { ...target }, referenceBearingDeg, yawDeg: normalizeSignedAngle(bearing - referenceBearingDeg), pitchDeg: pitch };
  }
  const yaw = normalizeSignedAngle(yawDeg), pitch = normalizePitch(pitchDeg), bearing = radians(referenceBearingDeg + yaw);
  const distance = Math.max(0.001, Math.hypot(dx, dz));
  return { referenceBearingDeg, yawDeg: yaw, pitchDeg: pitch, target: {
    x: eye.x + Math.sin(bearing) * distance,
    y: eye.y + Math.tan(radians(pitch)) * distance,
    z: eye.z - Math.cos(bearing) * distance,
  } };
}

/** Rebase a comparison seat onto the semantic aim, never old seat angles.
 * A manual pan remains local to its seat. Explicit actor tracking keeps the
 * actor target; otherwise comparison returns to the stable stage centre.
 * This helper does not receive or modify photo/focal/lock state. */
export function retargetSeatDirection({ eye, stageCenter, personTarget = null, followSelected = false }) {
  point(eye);point(stageCenter);
  const target=followSelected&&personTarget?point(personTarget):stageCenter;
  const direction=seatViewDirection({eye,stageCenter,target,followSelected:true});
  return {...direction,pitchDeg:normalizePitch(direction.pitchDeg)};
}

/**
 * Convert a drag from the screen centre through the perspective projection.
 * Shared focal pixels preserve the viewport aspect; narrower fields give finer aim.
 * Dragging right increases yaw; dragging down raises the camera (positive pitch).
 */
export function dragViewAngles({ yawDeg, pitchDeg, deltaX, deltaY, width, height, horizontalFovDeg }) {
  if (![deltaX, deltaY, width, height, horizontalFovDeg].every(Number.isFinite) ||
      width <= 0 || height <= 0 || horizontalFovDeg <= 0 || horizontalFovDeg >= 180) {
    throw new RangeError('Camera drag requires finite deltas, positive viewport dimensions and a field of view between 0 and 180 degrees');
  }
  const yaw = normalizeSignedAngle(yawDeg), pitch = normalizePitch(pitchDeg);
  const focalPixels = width / (2 * Math.tan(radians(horizontalFovDeg) / 2));
  if (!Number.isFinite(focalPixels) || focalPixels <= 0) throw new RangeError('Camera drag projection must have a finite positive focal length');
  return {
    yawDeg: normalizeSignedAngle(yaw + degrees(Math.atan(deltaX / focalPixels))),
    pitchDeg: normalizePitch(pitch + degrees(Math.atan(deltaY / focalPixels))),
  };
}

/** Actor facing 0 is audience/+z; this difference is 0 when facing the viewer. */
export function personFacingFromSeatDeg(person, eye) {
  point(eye);
  if (!person || !Number.isFinite(person.x) || !Number.isFinite(person.z)) throw new RangeError('Person position must be finite');
  const toViewer = degrees(Math.atan2(eye.x - person.x, eye.z - person.z));
  return normalizeSignedAngle(toViewer - (Number.isFinite(person.facingDeg) ? person.facingDeg : 0));
}
