const MODES = new Set(['seat', 'plan', 'orbit']);
const DEFAULT_CAMERA = Object.freeze({ yawDeg: 28, elevationDeg: 34, zoom: 1 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizedYaw = value => ((value + 180) % 360 + 360) % 360 - 180;

/**
 * Controls only the whole-theater inspection camera. The seat-view and actor
 * editor cameras remain owned by their existing controllers.
 * Call setMode when changing the visible view so an active drag is cancelled.
 */
export function createModelOrbitControls({ canvas, onChange = () => {}, onSeatPick = () => {}, getMode } = {}) {
  if (!canvas?.addEventListener) throw new TypeError('A canvas event target is required');
  let mode = 'seat', observedMode = 'seat', pointer = null, destroyed = false;
  let camera = { ...DEFAULT_CAMERA };
  const listeners = [];
  const cancelPointer = () => {
    const previous = pointer;
    pointer = null;
    if (previous && canvas.hasPointerCapture?.(previous.id)) canvas.releasePointerCapture(previous.id);
  };
  const activeMode = () => {
    const requested = typeof getMode === 'function' ? getMode() : mode;
    const next = MODES.has(requested) ? requested : 'seat';
    if (next !== observedMode) { cancelPointer(); observedMode = next; }
    return next;
  };
  const notify = reason => onChange({ ...camera }, { mode: activeMode(), reason });
  const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const listen = (type, handler, options = { capture: true }) => {
    canvas.addEventListener(type, handler, options);
    listeners.push([type, handler, options]);
  };

  listen('pointerdown', event => {
    const current = activeMode();
    if (current === 'seat' || event.button !== 0 || event.isPrimary === false) return;
    consume(event);
    if (pointer) return;
    pointer = { id: event.pointerId, mode: current, x: event.clientX, y: event.clientY, camera: { ...camera } };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus?.({ preventScroll: true });
  });
  listen('pointermove', event => {
    const current = activeMode();
    if (current === 'seat') return;
    event.stopImmediatePropagation();
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    if (current !== 'orbit') return;
    camera = {
      yawDeg: normalizedYaw(pointer.camera.yawDeg + (event.clientX - pointer.x) * .4),
      elevationDeg: clamp(pointer.camera.elevationDeg - (event.clientY - pointer.y) * .25, 10, 80),
      zoom: pointer.camera.zoom,
    };
    notify('orbit-drag');
  });
  listen('pointerup', event => {
    const current = activeMode();
    if (current === 'seat') return;
    consume(event);
    const previous = pointer;
    if (!previous || previous.id !== event.pointerId) return;
    const click = previous.mode === 'plan' && current === 'plan'
      && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6;
    cancelPointer();
    if (click) onSeatPick(event);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) listen(type, event => {
    if (activeMode() === 'seat') return;
    event.stopImmediatePropagation();
    if (pointer?.id === event.pointerId) cancelPointer();
  });
  listen('wheel', event => {
    if (activeMode() !== 'orbit') return;
    consume(event);
    // Normalise line/page wheel deltas before applying a bounded zoom change.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
    const delta = clamp(event.deltaY * unit, -200, 200);
    camera = { ...camera, zoom: clamp(camera.zoom * Math.exp(-delta * .0015), .5, 2) };
    // A wheel event during a drag must not be undone by the next pointer move.
    if (pointer) pointer.camera.zoom = camera.zoom;
    notify('orbit-zoom');
  }, { capture: true, passive: false });
  listen('keydown', event => {
    const current = activeMode();
    if (current === 'seat' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    consume(event);
    if (current !== 'orbit') return;
    cancelPointer();
    const step = event.shiftKey ? 1 : 5;
    if (event.key === 'Home') camera = { ...DEFAULT_CAMERA };
    else camera = {
      ...camera,
      yawDeg: normalizedYaw(camera.yawDeg + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)),
      elevationDeg: clamp(camera.elevationDeg + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 10, 80),
    };
    notify(event.key === 'Home' ? 'orbit-reset' : 'orbit-keyboard');
  });

  return {
    getCamera: () => ({ ...camera }),
    setMode(next) {
      if (destroyed) return;
      cancelPointer();
      mode = MODES.has(next) ? next : 'seat';
      observedMode = mode;
    },
    reset() { if (!destroyed) { cancelPointer(); camera = { ...DEFAULT_CAMERA }; notify('orbit-reset'); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPointer();
      for (const [type, handler, options] of listeners) canvas.removeEventListener(type, handler, options);
      listeners.length = 0;
    },
  };
}
