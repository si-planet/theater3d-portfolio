import { pickStageObject } from './stage-editing.js';

const CLICK_THRESHOLD = 6; // CSS pixels, independent of display density and zoom.
const clamp = (value, max) => Math.max(0, Math.min(max, value));

// Selection belongs to the workspace API. This controller holds only an
// uncommitted pointer gesture; cancel never rewrites selection or actor data.
export function createActorMarquee({ canvas, box, getSnapshot, onSelection }) {
  let drag = null;
  box.setAttribute('aria-hidden', 'true');
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const signature = snapshot => JSON.stringify([
    snapshot.context, snapshot.state.editMode, snapshot.state.personEditView,
    snapshot.state.editorCamera, snapshot.state.selectedPersonIds,
    snapshot.layout?.people.map(person => [person.id, person.x, person.z, person.heightM, person.pose]),
  ]);
  function valid(snapshot) {
    const rect = canvas.getBoundingClientRect();
    return snapshot.ready && snapshot.state.editMode === 'person'
      && snapshot.layout === drag.layout && snapshot.geometry === drag.geometry
      && signature(snapshot) === drag.signature
      && rect.width === drag.width && rect.height === drag.height;
  }
  function cancel() {
    if (!drag) return;
    const id = drag.id;
    drag = null;
    box.hidden = true;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function sync() {
    if (drag && !valid(getSnapshot())) cancel();
  }
  function update(event) {
    const p = point(event);
    if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > CLICK_THRESHOLD) drag.active = true;
    drag.end = { x: clamp(p.x, drag.width), y: clamp(p.y, drag.height) };
    const a = drag.start, b = drag.end;
    drag.rect = { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
      right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
    box.hidden = !drag.active;
    Object.assign(box.style, { left: canvas.offsetLeft + drag.rect.left + 'px',
      top: canvas.offsetTop + drag.rect.top + 'px', width: Math.abs(a.x - b.x) + 'px',
      height: Math.abs(a.y - b.y) + 'px' });
  }
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  canvas.addEventListener('pointerdown', event => {
    const snapshot = getSnapshot();
    if (drag || !snapshot.ready || snapshot.state.editMode !== 'person'
      || !event.isPrimary || event.button !== 0) return;
    const start = point(event), bounds = canvas.getBoundingClientRect();
    // The same surface picker as actor movement owns every object hit.
    if (pickStageObject(snapshot.stageScene?.stageObjectHits, start.x, start.y)) return;
    drag = { id: event.pointerId, start, end: start, active: false,
      width: bounds.width, height: bounds.height, layout: snapshot.layout, geometry: snapshot.geometry,
      signature: signature(snapshot), prior: event.ctrlKey || event.metaKey ? [...snapshot.state.selectedPersonIds] : [] };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    consume(event);
  }, true);
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    consume(event);
    if (!valid(getSnapshot())) { cancel(); return; }
    update(event);
  }, true);
  const finish = event => {
    if (drag?.id !== event.pointerId) return;
    consume(event);
    const snapshot = getSnapshot();
    if (!valid(snapshot)) { cancel(); return; }
    update(event);
    const completed = drag;
    cancel();
    if (!completed.active) { onSelection([]); return; }
    const rect = completed.rect;
    // Use visible actor centers in the current projection. A clipped or
    // offscreen center is never selected by dragging past the canvas edge.
    const selected = (snapshot.stageScene?.personProjections || []).filter(actor => {
      if (actor.visible === false || !actor.bounds) return false;
      const center = actor.center || { x: actor.bounds.x + actor.bounds.width / 2,
        y: actor.bounds.y + actor.bounds.height / 2 };
      return Number.isFinite(center.x) && Number.isFinite(center.y)
        && center.x >= 0 && center.x <= completed.width && center.y >= 0 && center.y <= completed.height
        && center.x >= rect.left && center.x <= rect.right && center.y >= rect.top && center.y <= rect.bottom;
    }).map(actor => actor.id);
    onSelection([...new Set([...completed.prior, ...selected])]);
  };
  canvas.addEventListener('pointerup', finish, true);
  window.addEventListener('pointerup', finish);
  for (const type of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(type, event => {
    if (drag?.id !== event.pointerId) return;
    consume(event);
    cancel();
  }, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  return { cancel, sync };
}
