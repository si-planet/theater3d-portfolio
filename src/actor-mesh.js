import { resolveBodyProfile } from './body-profile.js';

const TAU = Math.PI * 2;
const finite = (value, fallback) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const vector = (x, y, z) => ({ x, y, z });
const add = (a, b) => vector(a.x + b.x, a.y + b.y, a.z + b.z);
const subtract = (a, b) => vector(a.x - b.x, a.y - b.y, a.z - b.z);
const multiply = (a, scale) => vector(a.x * scale, a.y * scale, a.z * scale);
const cross = (a, b) => vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit = value => multiply(value, 1 / (Math.hypot(value.x, value.y, value.z) || 1));

// Shape-preserving cubic slopes round each transition without overshooting a
// neck radius or creating a negative radius at the bottom/top poles.
function slopes(anchors, key) {
  const secants = anchors.slice(1).map((anchor, index) => (anchor[key] - anchors[index][key]) / (anchor.y - anchors[index].y));
  return anchors.map((anchor, index) => {
    if (index === 0) return secants[0];
    if (index === anchors.length - 1) return secants.at(-1);
    const left = secants[index - 1], right = secants[index];
    if (left * right <= 0) return 0;
    const before = anchor.y - anchors[index - 1].y, after = anchors[index + 1].y - anchor.y;
    const w1 = 2 * after + before, w2 = after + 2 * before;
    return (w1 + w2) / (w1 / left + w2 / right);
  });
}

function interpolate(a, b, leftSlope, rightSlope, t, key) {
  const span = b.y - a.y, t2 = t * t, t3 = t2 * t;
  return {
    value: Math.max(0, (2 * t3 - 3 * t2 + 1) * a[key] + (t3 - 2 * t2 + t) * span * leftSlope
      + (-2 * t3 + 3 * t2) * b[key] + (t3 - t2) * span * rightSlope),
    slope: ((6 * t2 - 6 * t) * a[key] + (3 * t2 - 4 * t + 1) * span * leftSlope
      + (-6 * t2 + 6 * t) * b[key] + (3 * t2 - 2 * t) * span * rightSlope) / span,
  };
}

function bodyAnchors(shape, preset) {
  const crotch = shape.crotchY ?? (preset === 'female' ? 0.458 : 0.453);
  const anchors = [
    { role: 'pelvis-bottom', y: crotch, width: 0, depth: 0 },
    { role: 'pelvis-rounding', y: crotch + .019, width: shape.hipHalfWidth * .76, depth: shape.torsoHalfDepth * .80 },
    { role: 'hip', y: shape.hipY, width: shape.hipHalfWidth, depth: shape.torsoHalfDepth },
    { role: 'pelvis-top', y: shape.waistY - .025, width: shape.waistHalfWidth * .99, depth: shape.torsoHalfDepth * .83 },
    { role: 'waist', y: shape.waistY, width: shape.waistHalfWidth, depth: shape.torsoHalfDepth * .88 },
    { role: 'waist-joint-top', y: shape.waistY + .026, width: shape.waistHalfWidth * .99, depth: shape.torsoHalfDepth * .85 },
    { role: 'torso-rounding', y: shape.waistY + .052, width: shape.waistHalfWidth * 1.04, depth: shape.torsoHalfDepth * .92 },
    { role: 'chest', y: (shape.waistY + shape.shoulderY) / 2 + .019, width: shape.shoulderHalfWidth * .89, depth: shape.torsoHalfDepth },
    { role: 'shoulder', y: shape.shoulderY, width: shape.shoulderHalfWidth, depth: shape.torsoHalfDepth * .95 },
    { role: 'shoulder-rounding', y: shape.shoulderY + .016, width: shape.shoulderHalfWidth * .93, depth: shape.torsoHalfDepth * .89 },
    { role: 'neck-base', y: shape.neckBottomY + .031, width: shape.shoulderHalfWidth * .47, depth: shape.torsoHalfDepth * .70 },
    { role: 'neck-lower', y: shape.neckBottomY + .043, width: shape.neckRadius * .82, depth: shape.neckRadius * .82 },
    { role: 'neck', y: shape.neckBottomY + .058, width: shape.neckRadius * .76, depth: shape.neckRadius * .76 },
    { role: 'neck-head-joint', y: shape.neckTopY - .011, width: shape.neckRadius * .72, depth: shape.neckRadius * .72 },
  ];
  for (const degrees of [-55, -35, -10, 15, 40, 60, 75, 90]) {
    const angle = degrees * Math.PI / 180, y = degrees === 90 ? 1 : shape.headCenterY + Math.sin(angle) * shape.headHalfHeight;
    if (y <= anchors.at(-1).y) continue;
    anchors.push({ role: degrees === 90 ? 'head-top' : 'head', y,
      width: degrees === 90 ? 0 : Math.cos(angle) * shape.headHalfWidth,
      depth: degrees === 90 ? 0 : Math.cos(angle) * shape.headHalfDepth });
  }
  return anchors;
}

function face(faces, vertices, part, brightness = 1) {
  const points = vertices.map(vertex => vertex.point), normals = vertices.map(vertex => vertex.normal);
  faces.push({ points, normals, part, brightness,
    surfaceNormal: unit(normals.reduce(add, vector(0, 0, 0))),
    surfaceCenter: multiply(points.reduce(add, vector(0, 0, 0)), 1 / points.length) });
}

function joinRings(faces, rings, part, brightness) {
  for (let row = 0; row + 1 < rings.length; row += 1) for (let index = 0; index < rings[row].length; index += 1) {
    const next = (index + 1) % rings[row].length;
    const lower = rings[row], upper = rings[row + 1];
    const vertices = [lower[index], lower[next], upper[next], upper[index]];
    // Pole rings share one point. Triangles keep their finite area and avoid
    // zero-length polygon edges at the exact floor and head-top bounds.
    if (Math.hypot(...Object.values(subtract(lower[index].point, lower[next].point))) < 1e-10) vertices.splice(1, 1);
    if (Math.hypot(...Object.values(subtract(upper[index].point, upper[next].point))) < 1e-10) vertices.splice(vertices.length - 1, 1);
    if (vertices.length >= 3) face(faces, vertices, part, brightness);
  }
}

function appendCapsule(faces, bottom, top, radius, part, segments, capSteps, { radialScale = 1, brightness = 1 } = {}) {
  const axis = unit(subtract(top, bottom));
  const reference = Math.abs(axis.y) < .9 ? vector(0, 1, 0) : vector(1, 0, 0);
  const u = unit(cross(axis, reference)), v = unit(cross(axis, u));
  const rings = [];
  const ring = (center, angle) => Array.from({ length: segments }, (_, index) => {
    const azimuth = TAU * index / segments, c = Math.cos(azimuth), s = Math.sin(azimuth);
    const radial = add(multiply(u, c * radialScale), multiply(v, s));
    const radialNormal = add(multiply(u, c / radialScale), multiply(v, s));
    return { point: add(center, add(multiply(axis, Math.sin(angle) * radius), multiply(radial, Math.cos(angle) * radius))),
      normal: unit(add(multiply(axis, Math.sin(angle)), multiply(radialNormal, Math.cos(angle)))) };
  });
  for (let step = 0; step <= capSteps; step += 1) rings.push(ring(bottom, -Math.PI / 2 + step * Math.PI / (2 * capSteps)));
  for (let step = 0; step <= capSteps; step += 1) rings.push(ring(top, step * Math.PI / (2 * capSteps)));
  joinRings(faces, rings, part, brightness);
}

function appendLimbLoft(faces, anchors, part, segments, capSteps, world, rotate) {
  const widthSlopes = slopes(anchors, 'width'), depthSlopes = slopes(anchors, 'depth'), centerSlopes = slopes(anchors, 'centerX');
  const sampled = [];
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    const a = anchors[index], b = anchors[index + 1], steps = Math.max(2, Math.ceil((b.y - a.y) * capSteps * 3));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      // A centre may be negative (the left arm/leg). Its interpolation is
      // linear so the radius helper's nonnegative clamp cannot change a pose.
      sampled.push({ y: a.y + (b.y - a.y) * t, centerX: a.centerX + (b.centerX - a.centerX) * t,
        centerSlope: (b.centerX - a.centerX) / (b.y - a.y),
        width: interpolate(a, b, widthSlopes[index], widthSlopes[index + 1], t, 'width'),
        depth: interpolate(a, b, depthSlopes[index], depthSlopes[index + 1], t, 'depth') });
    }
  }
  const last = anchors.at(-1);
  sampled.push({ y: last.y, centerX: last.centerX, centerSlope: centerSlopes.at(-1),
    width: { value: last.width, slope: widthSlopes.at(-1) }, depth: { value: last.depth, slope: depthSlopes.at(-1) } });
  const rings = sampled.map((ring, row) => Array.from({ length: segments }, (_, index) => {
    const azimuth = TAU * index / segments, c = Math.cos(azimuth), s = Math.sin(azimuth);
    const w = ring.width.value, d = ring.depth.value;
    const normal = w < 1e-10 || d < 1e-10 ? vector(0, row === 0 ? -1 : 1, 0)
      : unit(vector(d * c, -((ring.centerSlope + ring.width.slope * c) * d * c + w * ring.depth.slope * s ** 2), w * s));
    return { point: world(vector(ring.centerX + w * c, ring.y, d * s)), normal: rotate(normal) };
  }));
  joinRings(faces, rings, part, 1);
}

function appendJoint(faces, center, width, height, depth, part, segments, capSteps, world, rotate) {
  // The little pivot balls need less surface detail than the torso and head.
  // Four azimuth quadrants still include each exact side/height extremum.
  segments = Math.max(12, Math.round(segments * .7 / 4) * 4);
  capSteps = Math.max(2, Math.ceil(capSteps * .5));
  const rings = [];
  for (let row = 0; row <= capSteps * 2; row += 1) {
    const angle = -Math.PI / 2 + Math.PI * row / (capSteps * 2), radial = Math.cos(angle), vertical = Math.sin(angle);
    rings.push(Array.from({ length: segments }, (_, index) => {
      const azimuth = TAU * index / segments, c = Math.cos(azimuth), s = Math.sin(azimuth);
      return { point: world(add(center, vector(width * radial * c, height * vertical, depth * radial * s))),
        normal: rotate(unit(vector(radial * c / width, vertical / height, radial * s / depth))) };
    }));
  }
  joinRings(faces, rings, part, .86);
}

function bodyRadiusAt(anchors, y) {
  const index = anchors.findIndex((anchor, i) => i + 1 < anchors.length && y >= anchor.y && y <= anchors[i + 1].y);
  const a = anchors[index], b = anchors[index + 1], t = (y - a.y) / (b.y - a.y);
  const widths = slopes(anchors, 'width'), depths = slopes(anchors, 'depth');
  return { width: interpolate(a, b, widths[index], widths[index + 1], t, 'width').value,
    depth: interpolate(a, b, depths[index], depths[index + 1], t, 'depth').value };
}

// A small inset-style badge identifies the front without imitating a face.
// Its actual polygon shares the body's projection, clipping and hit testing.
function appendFrontMarker(faces, anchors, world, rotate) {
  const markerPoint = (x, y) => {
    const { width, depth } = bodyRadiusAt(anchors, y);
    return world(vector(x, y, depth * Math.sqrt(Math.max(0, 1 - (x / width) ** 2)) + .001));
  };
  const centerY = .72, normal = rotate(vector(0, 0, 1));
  const vertices = Array.from({ length: 16 }, (_, index) => {
    const angle = TAU * index / 16;
    return { point: markerPoint(Math.cos(angle) * .012, centerY + Math.sin(angle) * .018), normal };
  });
  face(faces, vertices, 'torso_front_marker', 1);
  return markerPoint(0, centerY);
}

/** Population LOD: adult proportions, floor and crown stay in world metres.
 * Facets are only a display approximation; no saved person values are changed. */
function buildCrowdMesh(person) {
  const bodyProfile = resolveBodyProfile(person), h = bodyProfile.heightM, shape = bodyProfile.shapeRatios;
  const angle = finite(person.facingDeg, 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const rotate = p => vector(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  const floorY = finite(person.floorY, 0), origin = vector(finite(person.x, 0), floorY, finite(person.z, 0));
  const world = p => add(origin, multiply(rotate(p), h)), faces = [];
  const ring = (y, width, depth) => Array.from({ length: 8 }, (_, i) => {
    const a = TAU * i / 8;
    return { point: world(vector(Math.cos(a) * width, y, Math.sin(a) * depth)),
      normal: rotate(unit(vector(Math.cos(a), 0, Math.sin(a)))) };
  });
  const anchors = bodyAnchors(shape, bodyProfile.bodyPreset);
  const core = anchors.filter(a => ['pelvis-bottom', 'hip', 'waist', 'chest', 'shoulder', 'neck', 'neck-head-joint', 'head-top'].includes(a.role));
  // Three head rings preserve a rounded, adult-sized head rather than a pole.
  core.splice(core.length - 1, 0, ...[-35, 0, 40].map(deg => ({ y: shape.headCenterY + Math.sin(deg * Math.PI / 180) * shape.headHalfHeight,
    width: Math.cos(deg * Math.PI / 180) * shape.headHalfWidth, depth: Math.cos(deg * Math.PI / 180) * shape.headHalfDepth })));
  core.sort((a,b) => a.y-b.y);
  joinRings(faces, core.map(a => ring(a.y,a.width,a.depth)), 'torso_neck_head', 1);
  for (const side of [-1,1]) {
    const legX = side * shape.hipHalfWidth * .59;
    appendCapsule(faces, world(vector(legX,.04,0)), world(vector(legX,shape.crotchY+.015,0)), h * shape.calfRadius, 'lower_leg',8,1);
    appendCapsule(faces, world(vector(side*(shape.shoulderHalfWidth+shape.upperArmRadius),.46,0)),
      world(vector(side*shape.shoulderHalfWidth,.76,0)),h*shape.forearmRadius,'lower_arm',8,1);
    appendCapsule(faces, world(vector(legX,shape.footHeight/2,0)),world(vector(legX,shape.footHeight/2,shape.footLength*.6)),h*shape.footHeight/2,'foot',8,1);
  }
  appendFrontMarker(faces, anchors, world, rotate);
  const points = faces.flatMap(f=>f.points);
  return { bodyProfile, faces, rings: [], bounds: {xMin:Math.min(...points.map(p=>p.x)),xMax:Math.max(...points.map(p=>p.x)),
    yMin:floorY,yMax:floorY+h,zMin:Math.min(...points.map(p=>p.z)),zMax:Math.max(...points.map(p=>p.z))},
    landmarks: { floor:world(vector(0,0,0)),headTop:world(vector(0,1,0)) } };
}

/**
 * The runtime standing-person surface, in world metres. Torso, neck and head
 * share consecutive rings in one closed loft; its crown is exactly heightM.
 * Rounded wooden segments overlap spherical joints: this is a drawing
 * mannequin style, not a measured body or a simulation of human skin.
 * Population references are returned with the assumed shape, never as measured
 * geometry. This does not build or alter the seated-audience model.
 */
function buildStandingActorMesh(person = {}, { segments = 28, capSteps = 8, crowd = false } = {}) {
  if (crowd) return buildCrowdMesh(person);
  segments = clamp(Math.round(finite(segments, 28) / 4) * 4, 12, 40);
  capSteps = clamp(Math.round(finite(capSteps, 8)), 3, 12);
  const bodyProfile = resolveBodyProfile({ heightM: person.heightM, bodyPreset: person.bodyPreset });
  const h = bodyProfile.heightM, shape = bodyProfile.shapeRatios;
  const x = finite(person.x, 0), z = finite(person.z, 0), floorY = finite(person.floorY, 0);
  const angle = finite(person.facingDeg, 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const rotate = value => vector(value.x * c + value.z * s, value.y, -value.x * s + value.z * c);
  const world = value => add(vector(x, floorY, z), multiply(rotate(value), h));
  const p = (dx, dy, dz = 0) => world(vector(dx, dy, dz));
  const anchors = bodyAnchors(shape, bodyProfile.bodyPreset);
  const widths = slopes(anchors, 'width'), depths = slopes(anchors, 'depth');
  const sampled = [];
  for (let index = 0; index + 1 < anchors.length; index += 1) {
    const a = anchors[index], b = anchors[index + 1], steps = Math.max(capSteps >= 6 ? 3 : 2, Math.ceil((b.y - a.y) * capSteps * 3));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps, width = interpolate(a, b, widths[index], widths[index + 1], t, 'width'), depth = interpolate(a, b, depths[index], depths[index + 1], t, 'depth');
      sampled.push({ role: step === 0 ? a.role : 'surface', y: a.y + (b.y - a.y) * t, width: width.value, depth: depth.value, widthSlope: width.slope, depthSlope: depth.slope });
    }
  }
  sampled.push({ ...anchors.at(-1), widthSlope: widths.at(-1), depthSlope: depths.at(-1) });
  const rings = sampled.map(ring => ({ role: ring.role, y: floorY + ring.y * h, widthM: ring.width * h, depthM: ring.depth * h,
    vertices: Array.from({ length: segments }, (_, index) => {
      const azimuth = TAU * index / segments, cos = Math.cos(azimuth), sin = Math.sin(azimuth);
      const normal = ring.width < 1e-10 || ring.depth < 1e-10 ? vector(0, ring.y > .9 ? 1 : -1, 0)
        : unit(vector(ring.depth * cos, -(ring.widthSlope * ring.depth * cos ** 2 + ring.width * ring.depthSlope * sin ** 2), ring.width * sin));
      return { point: p(ring.width * cos, ring.y, ring.depth * sin), normal: rotate(normal) };
    }) }));
  const faces = [];
  joinRings(faces, rings.map(ring => ring.vertices), 'torso_neck_head', 1);
  const crotch = shape.crotchY ?? (bodyProfile.bodyPreset === 'female' ? .458 : .453);
  const joints = { shoulder: [], elbow: [], wrist: [], hip: [], knee: [], ankle: [] };
  const limbSegments = Math.min(segments, 20);
  for (const side of [-1, 1]) {
    const legX = side * shape.hipHalfWidth * .59;
    const hipY = crotch + .025, kneeY = .282, ankleY = .041;
    const hipRadius = Math.min(shape.thighRadius * .84, shape.hipHalfWidth * .41), kneeRadius = shape.calfRadius * .91, ankleRadius = shape.calfRadius * .45;
    for (const [joint, y, radius] of [['hip', hipY, hipRadius], ['knee', kneeY, kneeRadius], ['ankle', ankleY, ankleRadius]]) {
      appendJoint(faces, vector(legX, y, 0), radius, radius, radius, `${joint}_joint`, segments, capSteps, world, rotate);
      joints[joint].push(p(legX, y));
    }
    appendLimbLoft(faces, [
      { y: ankleY, width: 0, depth: 0, centerX: legX },
      { y: ankleY + ankleRadius * .65, width: shape.calfRadius * .63, depth: shape.calfRadius * .63, centerX: legX },
      { y: .14, width: shape.calfRadius, depth: shape.calfRadius * .94, centerX: legX },
      { y: kneeY - kneeRadius * .65, width: shape.calfRadius * .73, depth: shape.calfRadius * .73, centerX: legX },
      { y: kneeY, width: 0, depth: 0, centerX: legX },
    ], 'lower_leg', limbSegments, capSteps, world, rotate);
    appendLimbLoft(faces, [
      { y: kneeY, width: 0, depth: 0, centerX: legX },
      { y: kneeY + kneeRadius * .64, width: shape.thighRadius * .65, depth: shape.thighRadius * .65, centerX: legX },
      { y: .37, width: shape.thighRadius, depth: shape.thighRadius * .94, centerX: legX },
      { y: hipY - hipRadius * .64, width: shape.thighRadius * .76, depth: shape.thighRadius * .76, centerX: legX },
      { y: hipY, width: 0, depth: 0, centerX: legX },
    ], 'upper_leg', limbSegments, capSteps, world, rotate);
    const footRadius = shape.footHeight / 2;
    appendCapsule(faces, p(legX, footRadius, -shape.footLength / 4 + footRadius), p(legX, footRadius, shape.footLength * .75 - footRadius), h * footRadius, 'foot', limbSegments, Math.max(3, Math.ceil(capSteps * .5)), { radialScale: .025 / footRadius });
    const shoulderX = side * shape.shoulderHalfWidth * .98, elbowX = side * (shape.shoulderHalfWidth + shape.upperArmRadius * .75), handX = side * (shape.shoulderHalfWidth + shape.upperArmRadius * 1.25);
    const shoulderCapY = shape.shoulderY - .015;
    const elbowY = .622, wristY = .477;
    for (const [joint, centerX, centerY, radius] of [['shoulder', shoulderX, shoulderCapY, shape.upperArmRadius * .96], ['elbow', elbowX, elbowY, shape.forearmRadius * .93], ['wrist', handX, wristY, shape.forearmRadius * .65]]) {
      appendJoint(faces, vector(centerX, centerY, 0), radius, radius, radius, `${joint}_joint`, segments, capSteps, world, rotate);
      joints[joint].push(p(centerX, centerY));
    }
    appendJoint(faces, vector(handX, .443, 0), shape.forearmRadius * .85, .032, shape.forearmRadius * .73, 'hand', segments, capSteps, world, rotate);
    appendLimbLoft(faces, [
      { y: wristY, width: 0, depth: 0, centerX: handX },
      { y: wristY + shape.forearmRadius * .58, width: shape.forearmRadius * .69, depth: shape.forearmRadius * .69, centerX: handX },
      { y: .542, width: shape.forearmRadius, depth: shape.forearmRadius, centerX: (handX + elbowX) / 2 },
      { y: elbowY - shape.forearmRadius * .62, width: shape.forearmRadius * .80, depth: shape.forearmRadius * .80, centerX: elbowX },
      { y: elbowY, width: 0, depth: 0, centerX: elbowX },
    ], 'lower_arm', limbSegments, capSteps, world, rotate);
    appendLimbLoft(faces, [
      { y: elbowY, width: 0, depth: 0, centerX: elbowX },
      { y: elbowY + shape.forearmRadius * .65, width: shape.upperArmRadius * .69, depth: shape.upperArmRadius * .69, centerX: elbowX },
      { y: .707, width: shape.upperArmRadius, depth: shape.upperArmRadius, centerX: (elbowX + shoulderX) / 2 },
      { y: shoulderCapY - shape.upperArmRadius * .65, width: shape.upperArmRadius * .78, depth: shape.upperArmRadius * .78, centerX: shoulderX },
      { y: shoulderCapY, width: 0, depth: 0, centerX: shoulderX },
    ], 'upper_arm', limbSegments, capSteps, world, rotate);
  }
  const frontMarker = appendFrontMarker(faces, anchors, world, rotate);
  const points = faces.flatMap(face => face.points);
  const bounds = { xMin: Math.min(...points.map(p => p.x)), xMax: Math.max(...points.map(p => p.x)),
    yMin: floorY, yMax: floorY + h, zMin: Math.min(...points.map(p => p.z)), zMax: Math.max(...points.map(p => p.z)) };
  return { bodyProfile, rings, faces, bounds, landmarks: {
    pelvisBottom: p(0, crotch), shoulder: p(0, shape.shoulderY), neckLower: p(0, shape.neckBottomY + .043),
    neckUpper: p(0, shape.neckTopY - .011), headCenter: p(0, shape.headCenterY), headTop: p(0, 1), floor: p(0, 0),
    frontMarker, joints,
  } };
}

/** Joint poses are display assumptions. heightM always remains standing height. */
export function buildActorMesh(person = {}, detail = {}) {
  const pose = ['chair','floor','cross-legged'].includes(person.pose) ? person.pose : 'standing';
  const mesh = buildStandingActorMesh(person, pose === 'standing' ? detail : {...detail,crowd:false,segments:detail.crowd?12:detail.segments,capSteps:detail.crowd?3:detail.capSteps});
  if (pose === 'standing') return mesh;
  if (pose === 'cross-legged') return applyCrossLeggedPose(mesh, person);
  const h=mesh.bodyProfile.heightM,hip=mesh.bodyProfile.shapeRatios.crotchY+.025,knee=.282,ankle=.041;
  const hipY=pose==='chair'?knee:.065,kneeY=pose==='chair'?knee:.055;
  const thighAngle=-Math.acos(Math.max(-1,Math.min(1,(hipY-kneeY)/(hip-knee))));
  const thighZ=Math.sqrt(Math.max(0,(hip-knee)**2-(hipY-kneeY)**2));
  const shinAngle=pose==='chair'?0:-Math.acos(Math.max(-1,Math.min(1,(kneeY-ankle)/(knee-ankle))));
  const shinZ=pose==='chair'?0:Math.sqrt(Math.max(0,(knee-ankle)**2-(kneeY-ankle)**2));
  const angle=finite(person.facingDeg,0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const origin=vector(finite(person.x,0),finite(person.floorY,0),finite(person.z,0));
  const local=p=>{const dx=(p.x-origin.x)/h,dz=(p.z-origin.z)/h;return vector(dx*c-dz*s,(p.y-origin.y)/h,dx*s+dz*c);};
  const world=p=>vector(origin.x+(p.x*c+p.z*s)*h,origin.y+p.y*h,origin.z+(-p.x*s+p.z*c)*h);
  const turn=(p,a)=>vector(p.x,p.y*Math.cos(a)-p.z*Math.sin(a),p.y*Math.sin(a)+p.z*Math.cos(a));
  function partPose(p,part,normal=false){
    if(part==='upper_leg'){const q=turn(normal?p:vector(p.x,p.y-hip,p.z),thighAngle);return normal?q:vector(q.x,q.y+hipY,q.z);}
    if(part==='lower_leg'||part==='knee_joint'){const q=turn(normal?p:vector(p.x,p.y-knee,p.z),shinAngle);return normal?q:vector(q.x,q.y+kneeY,q.z+thighZ);}
    if(part==='foot'||part==='ankle_joint')return normal?p:vector(p.x,p.y,p.z+thighZ+shinZ);
    return normal?p:vector(p.x,p.y+hipY-hip,p.z);
  }
  for(const face of mesh.faces){
    face.points=face.points.map(p=>world(partPose(local(p),face.part)));
    face.normals=face.normals.map(n=>{const q=partPose(vector(n.x*c-n.z*s,n.y,n.x*s+n.z*c),face.part,true);return vector(q.x*c+q.z*s,q.y,-q.x*s+q.z*c);});
  }
  for(const ring of mesh.rings){ring.y+=(hipY-hip)*h;for(const v of ring.vertices)v.point=world(partPose(local(v.point),'torso_neck_head'));}
  for(const name of ['headTop','headCenter','neckUpper','neckLower','shoulder','pelvisBottom'])if(mesh.landmarks[name])mesh.landmarks[name]=world(partPose(local(mesh.landmarks[name]),'torso_neck_head'));
  for(const [name,points]of Object.entries(mesh.landmarks.joints||{}))mesh.landmarks.joints[name]=points.map(p=>world(partPose(local(p),name+'_joint')));
  const points=mesh.faces.flatMap(f=>f.points);
  mesh.bounds={xMin:Math.min(...points.map(p=>p.x)),xMax:Math.max(...points.map(p=>p.x)),yMin:origin.y,yMax:Math.max(...points.map(p=>p.y)),zMin:Math.min(...points.map(p=>p.z)),zMax:Math.max(...points.map(p=>p.z))};
  mesh.pose=pose;mesh.posedHeightM=mesh.bounds.yMax-origin.y;mesh.torsoOffsetM=(hipY-hip)*h;
  return mesh;
}


/** Authored cross-legged display pose, not a measured anatomical posture.
 * Standing height and the person's source position/yaw remain unchanged.
 * Each leg segment is rotated rigidly; a raised right shin makes the crossed
 * lower legs readable instead of laying both at the same depth and height.
 */
function applyCrossLeggedPose(mesh, person) {
  const h = mesh.bodyProfile.heightM, shape = mesh.bodyProfile.shapeRatios;
  const hip = shape.crotchY + .025, knee = .282, ankle = .041, hipY = .085;
  const angle = finite(person.facingDeg, 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const origin = vector(finite(person.x, 0), finite(person.floorY, 0), finite(person.z, 0));
  const toLocal = p => { const dx = (p.x-origin.x)/h, dz = (p.z-origin.z)/h; return vector(dx*c-dz*s, (p.y-origin.y)/h, dx*s+dz*c); };
  const toWorld = p => vector(origin.x+(p.x*c+p.z*s)*h, origin.y+p.y*h, origin.z+(-p.x*s+p.z*c)*h);
  const normalLocal = n => vector(n.x*c-n.z*s, n.y, n.x*s+n.z*c);
  const normalWorld = n => vector(n.x*c+n.z*s, n.y, -n.x*s+n.z*c);
  const dot = (a,b) => a.x*b.x+a.y*b.y+a.z*b.z;
  // Minimal rigid rotation taking the standing +y bone axis to the posed axis.
  const boneRotation = direction => {
    const target = unit(direction), axis = cross(vector(0,1,0), target), cosine = target.y;
    return value => add(value, add(cross(axis,value), multiply(cross(axis,cross(axis,value)), 1/(1+cosine))));
  };
  const legs = new Map([-1,1].map(side => {
    const legX = side * shape.hipHalfWidth * .59, thighLength = hip-knee, shinLength = knee-ankle;
    const kneeY = side < 0 ? .070 : .110, ankleY = side < 0 ? ankle : .090;
    const kneeX = legX + side*thighLength*.64;
    const kneeZ = Math.sqrt(Math.max(0, thighLength**2-(kneeX-legX)**2-(kneeY-hipY)**2));
    const ankleX = -side*Math.abs(legX)*.6;
    const ankleZ = kneeZ - Math.sqrt(Math.max(0,shinLength**2-(ankleX-kneeX)**2-(ankleY-kneeY)**2));
    const hipPoint=vector(legX,hipY,0), kneePoint=vector(kneeX,kneeY,kneeZ), anklePoint=vector(ankleX,ankleY,ankleZ);
    const thighTurn=boneRotation(subtract(hipPoint,kneePoint)), shinTurn=boneRotation(subtract(kneePoint,anklePoint));
    const footTurn=p=>vector(side*p.z,p.y,-side*p.x);
    return [side,{legX,hipPoint,kneePoint,anklePoint,thighTurn,shinTurn,footTurn}];
  }));
  function transform(p, part, side, normal=false) {
    const leg=legs.get(side), rigid=(sourceY,target,rotate)=>normal?rotate(p):add(target,rotate(subtract(p,vector(leg.legX,sourceY,0))));
    if(part==='upper_leg')return rigid(hip,leg.hipPoint,leg.thighTurn);
    if(part==='lower_leg')return rigid(knee,leg.kneePoint,leg.shinTurn);
    if(part==='knee_joint')return rigid(knee,leg.kneePoint,leg.thighTurn);
    if(part==='foot'||part==='ankle_joint')return rigid(ankle,leg.anklePoint,leg.footTurn);
    return normal?p:vector(p.x,p.y+hipY-hip,p.z);
  }
  for(const face of mesh.faces) {
    const localPoints=face.points.map(toLocal), side=localPoints.reduce((sum,p)=>sum+p.x,0)<0?-1:1;
    face.points=localPoints.map(p=>toWorld(transform(p,face.part,side)));
    face.normals=face.normals.map(n=>unit(normalWorld(transform(normalLocal(n),face.part,side,true))));
    face.surfaceCenter=multiply(face.points.reduce(add,vector(0,0,0)),1/face.points.length);
    face.surfaceNormal=unit(face.normals.reduce(add,vector(0,0,0)));
  }
  for(const ring of mesh.rings) { ring.y+=(hipY-hip)*h; for(const v of ring.vertices)v.point=toWorld(transform(toLocal(v.point),'torso_neck_head',1)); }
  for(const name of ['headTop','headCenter','neckUpper','neckLower','shoulder','pelvisBottom','frontMarker']) {
    if(mesh.landmarks[name])mesh.landmarks[name]=toWorld(transform(toLocal(mesh.landmarks[name]),'torso_neck_head',1));
  }
  for(const [name,points] of Object.entries(mesh.landmarks.joints||{})) {
    mesh.landmarks.joints[name]=points.map(p=>{const local=toLocal(p);return toWorld(transform(local,name+'_joint',local.x<0?-1:1));});
  }
  const points=mesh.faces.flatMap(face=>face.points);
  mesh.bounds={xMin:Math.min(...points.map(p=>p.x)),xMax:Math.max(...points.map(p=>p.x)),yMin:origin.y,yMax:Math.max(...points.map(p=>p.y)),zMin:Math.min(...points.map(p=>p.z)),zMax:Math.max(...points.map(p=>p.z))};
  mesh.pose='cross-legged';mesh.posedHeightM=mesh.bounds.yMax-origin.y;mesh.torsoOffsetM=(hipY-hip)*h;
  return mesh;
}
