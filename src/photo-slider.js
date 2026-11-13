import { focalControlMm } from './camera-config.js';
const EMPTY_MESSAGE = '범위 내 사진 없음';
const LANE_HEIGHT = 28;
const MARKER_GAP = 58;
let nextPreviewId = 1;

function validFocal(value) {
  if (!['number', 'string'].includes(typeof value)
      || (typeof value === 'string' && !value.trim())) return null;
  const focal = Number(value);
  return Number.isFinite(focal) ? focal : null;
}

function photoName(photo) {
  return typeof photo.name === 'string' && photo.name ? photo.name : '이름 없는 사진';
}

function focalLabel(focal) {
  return `${focalControlMm(focal)} mm`;
}

function addPreviewPhoto(document, parent, photo, focal, selectedPhotoId, onApply) {
  const choice = document.createElement('button');
  choice.type = 'button';
  choice.className = 'photo-focal-choice';
  choice.dataset.photoId = String(photo.id);
  choice.dataset.photoFocal = String(focal);
  choice.setAttribute('aria-label', `${photoName(photo)} · ${focalLabel(focal)} 적용`);
  choice.setAttribute('aria-pressed', String(photo.id === selectedPhotoId));
  if (photo.id === selectedPhotoId) choice.classList.add('is-selected');
  const picture = document.createElement('img');
  if (typeof photo.url === 'string' && photo.url) picture.src = photo.url;
  picture.alt = photoName(photo);
  picture.loading = 'lazy';
  picture.style.objectFit = 'contain';
  const fileName = document.createElement('span');
  fileName.className = 'photo-focal-file-name';
  fileName.textContent = photoName(photo);
  choice.append(picture, fileName);
  choice.addEventListener('click', () => { if (typeof onApply === 'function') onApply(photo); });
  parent.append(choice);
  return choice;
}

/**
 * Photo markers use only the explicitly entered 35 mm equivalent focal length.
 * The original photo and metadata are never changed or removed by rendering.
 * Same-focal photos share a marker and remain individually accessible in its
 * hover/focus preview. All listeners belong to replaced child nodes.
 */
export function renderPhotoSlider({ container, photos = [], selectedPhotoId = null,
  min, max, onApply } = {}) {
  if (!container || typeof container.replaceChildren !== 'function') return { photoCount: 0, markerCount: 0 };
  const document = container.ownerDocument;
  const previousFocus = document.activeElement;
  const focusKey = container.contains(previousFocus) ? {
    kind: previousFocus.classList?.contains('photo-focal-choice') ? 'choice' : 'marker',
    photoId: previousFocus.dataset?.photoId,
    focal: previousFocus.dataset?.photoFocal,
  } : null;
  const minimum = validFocal(min), maximum = validFocal(max);
  const validRange = minimum !== null && maximum !== null && minimum > 0 && maximum >= minimum;
  const groups = new Map();
  if (validRange) for (const photo of Array.isArray(photos) ? photos : []) {
    if (!photo || photo.id === null || photo.id === undefined) continue;
    const focal = validFocal(photo.metadata?.focalLength35Mm);
    if (focal === null || focal < minimum || focal > maximum) continue;
    if (!groups.has(focal)) groups.set(focal, []);
    groups.get(focal).push(photo);
  }

  container.replaceChildren();
  container.classList.add('photo-focal-strip');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', '사진의 35mm 환산 초점거리 비교');
  container.style.minHeight = '96px';
  if (!groups.size) {
    container.style.minHeight = '0px';
    const note = document.createElement('p');
    note.className = 'photo-focal-empty';
    note.textContent = EMPTY_MESSAGE;
    container.append(note);
    return { photoCount: 0, markerCount: 0 };
  }

  const width = Math.max(1, container.clientWidth || container.getBoundingClientRect?.().width || 320);
  const laneEnds = [];
  const focusTargets = [];
  let photoCount = 0;
  for (const [focal, items] of [...groups].sort((a, b) => a[0] - b[0])) {
    const fraction = minimum === maximum ? 0.5 : (focal - minimum) / (maximum - minimum);
    const pixel = fraction * width;
    let lane = laneEnds.findIndex(previous => pixel - previous >= MARKER_GAP);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = pixel;
    const selected = items.find(photo => photo.id === selectedPhotoId);
    const primary = selected || items[0];
    const group = document.createElement('div');
    group.className = 'photo-focal-group';
    group.style.position = 'absolute';
    group.style.inset = '0';
    group.style.pointerEvents = 'none';
    group.dataset.photoCount = String(items.length);

    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'photo-focal-marker';
    marker.style.position = 'absolute';
    marker.style.left = `${fraction * 100}%`;
    marker.style.top = `${lane * LANE_HEIGHT}px`;
    marker.style.pointerEvents = 'auto';
    marker.dataset.photoId = String(primary.id);
    marker.dataset.photoFocal = String(focal);
    marker.dataset.photoCount = String(items.length);
    marker.dataset.photoLane = String(lane);
    marker.dataset.edge = fraction < 0.15 ? 'start' : fraction > 0.85 ? 'end' : 'middle';
    marker.textContent = `${focalLabel(focal)}${items.length > 1 ? ` · ${items.length}장` : ''}`;
    marker.setAttribute('aria-label', `${focalLabel(focal)} · ${items.length > 1
      ? `사진 ${items.length}장, 미리보기에서 각각 선택 가능` : photoName(primary)} 적용`);
    marker.setAttribute('aria-pressed', String(Boolean(selected)));
    if (selected) marker.classList.add('is-selected');

    const preview = document.createElement('div');
    preview.id = `photo-focal-preview-${nextPreviewId++}`;
    preview.className = 'photo-focal-preview';
    preview.style.position = 'absolute';
    const previewWidth = Math.min(152, width);
    preview.style.width = `${previewWidth}px`;
    preview.style.left = `clamp(0px, ${fraction * 100}%, max(0px, calc(100% - ${previewWidth}px)))`;
    preview.style.transform = 'none';
    preview.style.top = `${lane * LANE_HEIGHT + 24}px`;
    preview.style.pointerEvents = 'auto';
    preview.style.maxHeight = '260px';
    preview.style.overflowY = 'auto';
    preview.setAttribute('role', 'group');
    preview.setAttribute('aria-label', `${focalLabel(focal)} 원본 사진 ${items.length}장`);
    marker.setAttribute('aria-controls', preview.id);
    for (const photo of items) {
      const choice = addPreviewPhoto(document, preview, photo, focal, selectedPhotoId, onApply);
      focusTargets.push({ kind: 'choice', photoId: String(photo.id), focal: String(focal), node: choice });
    }
    marker.addEventListener('click', () => { if (typeof onApply === 'function') onApply(primary); });
    focusTargets.push({ kind: 'marker', photoId: String(primary.id), focal: String(focal), node: marker });
    group.append(marker, preview);
    container.append(group);
    photoCount += items.length;
  }
  // Three lanes fit in the normal strip. Dense focal clusters can add lanes
  // rather than hiding a marker behind another selectable photo.
  container.style.minHeight = `${Math.max(96, laneEnds.length * LANE_HEIGHT + 8)}px`;
  if (focusKey) {
    const target = focusTargets.find(item => item.kind === focusKey.kind
      && (focusKey.kind === 'choice' ? item.photoId === focusKey.photoId : item.focal === focusKey.focal));
    target?.node.focus({ preventScroll: true });
  }
  return { photoCount, markerCount: groups.size };
}
