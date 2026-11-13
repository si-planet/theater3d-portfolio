/** Native 2D structure outlines. A v axis is a drawing axis, never a world height. */
const ROOT_KEYS = ['schemaVersion', 'informationRecordId', 'title', 'unitScope', 'verticalAxis', 'layers', 'capabilities'];
const CAPABILITIES = ['seatSelection', 'sightline', 'metric3D'];

function record(value, allowed, name, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${name}: object required`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new TypeError(`${name}: unsupported field ${String(key)}`);
    if (!Object.hasOwn(Object.getOwnPropertyDescriptors(value)[key], 'value')) throw new TypeError(`${name}: accessors are unsupported`);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) throw new TypeError(`${name}: missing field ${key}`);
}
function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name}: nonempty text required`);
  return value;
}
function array(value, name) {
  if (!Array.isArray(value) || !value.length) throw new TypeError(`${name}: nonempty array required`);
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new TypeError(`${name}: sparse array unsupported`);
  return value;
}

/** Returns a detached strict asset, without guessing units, heights, seats or names. */
export function normalizeStructureAsset(input) {
  record(input, ROOT_KEYS, 'structure');
  if (input.schemaVersion !== 1) throw new TypeError('structure: schemaVersion must be 1');
  if (!['source_plane', 'metric_local'].includes(input.unitScope)) throw new TypeError('structure: unsupported unitScope');
  if (!['up', 'down'].includes(input.verticalAxis)) throw new TypeError('structure: explicit verticalAxis required');
  record(input.capabilities, CAPABILITIES, 'capabilities');
  for (const key of CAPABILITIES) if (input.capabilities[key] !== false) throw new TypeError(`capabilities.${key}: must be false`);
  const ids = new Set();
  const layers = array(input.layers, 'layers').map((layer, layerIndex) => {
    const name = `layers[${layerIndex}]`;
    record(layer, ['id', 'label', 'polylines', 'closed'], name, ['id', 'label', 'polylines']);
    const id = text(layer.id, `${name}.id`);
    if (ids.has(id)) throw new TypeError(`${name}: duplicate layer id`);
    ids.add(id);
    if (layer.closed !== undefined && typeof layer.closed !== 'boolean') throw new TypeError(`${name}.closed: boolean required`);
    const closed = layer.closed === true;
    const polylines = array(layer.polylines, `${name}.polylines`).map((path, pathIndex) => {
      array(path, `${name}.polylines[${pathIndex}]`);
      if (path.length < (closed ? 3 : 2)) throw new TypeError(`${name}.polylines[${pathIndex}]: insufficient points`);
      return path.map((point, pointIndex) => {
        record(point, ['u', 'v'], `${name}.point[${pointIndex}]`);
        if (typeof point.u !== 'number' || !Number.isFinite(point.u) || typeof point.v !== 'number' || !Number.isFinite(point.v)) {
          throw new TypeError(`${name}.point[${pointIndex}]: explicit finite u/v required`);
        }
        return { u: point.u, v: point.v };
      });
    });
    const all = polylines.flat();
    const bounds = boundsFor(all, input.verticalAxis);
    if (![bounds.width, bounds.height].every(Number.isFinite) || (!bounds.width && !bounds.height)) throw new TypeError(`${name}: nonzero finite drawing extent required`);
    return { id, label: text(layer.label, `${name}.label`), polylines, closed };
  });
  return {
    schemaVersion: 1,
    informationRecordId: text(input.informationRecordId, 'informationRecordId'),
    title: text(input.title, 'title'),
    unitScope: input.unitScope,
    verticalAxis: input.verticalAxis,
    layers,
    capabilities: { seatSelection: false, sightline: false, metric3D: false },
  };
}

function boundsFor(points, axis) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    const y = axis === 'up' ? -point.v : point.v;
    minX = Math.min(minX, point.u); maxX = Math.max(maxX, point.u);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Embedded outline explorer. All interaction remains on its own canvas. */
export function createStructureExplorer({ container } = {}) {
  if (!container || typeof container.append !== 'function') throw new TypeError('structure explorer: container required');
  const doc = container.ownerDocument || globalThis.document;
  if (!doc?.createElement) throw new TypeError('structure explorer: document required');
  const win = doc.defaultView || globalThis;
  const disposers = [];
  const el = (tag, className, id, content) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (id) element.id = id;
    if (content !== undefined) element.textContent = content;
    return element;
  };
  const on = (element, event, handler, options) => {
    element.addEventListener(event, handler, options);
    disposers.push(() => element.removeEventListener(event, handler, options));
  };
  const button = (id, content, label = content) => {
    const element = el('button', '', id, content);
    element.type = 'button'; element.setAttribute('aria-label', label);
    return element;
  };
  const root = el('section', 'structure-explorer'); root.hidden = true;
  root.setAttribute('aria-label', '무대 구조');
  const heading = el('div', 'structure-explorer-heading');
  const title = el('strong', 'structure-explorer-title', '', '무대 구조');
  const badge = el('span', 'structure-explorer-badge');
  heading.append(title, badge);
  const toolbar = el('div', 'structure-explorer-toolbar');
  const layerLabel = el('label', 'structure-explorer-layer');
  layerLabel.append(el('span', '', '', '구조'));
  const layerSelect = el('select', '', 'structure-explorer-layer'); layerSelect.setAttribute('aria-label', '구조 선택');
  layerLabel.append(layerSelect);
  const fitButton = button('structure-explorer-fit', '전체 보기');
  const tools = el('details', 'structure-explorer-zoom-tools', 'structure-explorer-zoom-tools');
  tools.append(el('summary', '', '', '확대 도구'));
  const zoomControls = el('div', 'structure-explorer-zoom-controls');
  const zoomOut = button('structure-explorer-zoom-out', '−', '구조 축소');
  const zoomIn = button('structure-explorer-zoom-in', '+', '구조 확대');
  const zoomOutput = el('output', '', 'structure-explorer-zoom', '100%'); zoomOutput.setAttribute('aria-label', '전체 보기 기준 확대율');
  zoomControls.append(zoomOut, zoomOutput, zoomIn); tools.append(zoomControls);
  toolbar.append(layerLabel, fitButton, tools);
  const wrap = el('div', 'structure-explorer-canvas-wrap');
  const canvas = el('canvas', 'structure-explorer-canvas', 'structure-explorer-canvas');
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '무대 구조 평면. 드래그와 스크롤로 이동, 더하기와 빼기로 확대, Home으로 전체 보기');
  canvas.setAttribute('aria-describedby', 'structure-explorer-status');
  wrap.append(canvas);
  const status = el('p', 'structure-explorer-status', 'structure-explorer-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  root.append(heading, toolbar, wrap, status); container.append(root);
  const ctx = canvas.getContext('2d');
  let asset = null, activeLayer = null, destroyed = false;
  let scale = 1, offsetX = 0, offsetY = 0, fitScale = 1, frame = null;
  let width = 0, height = 0, resizeObserver = null;
  const pointers = new Map();
  let gesture = null;
  const requestFrame = win.requestAnimationFrame?.bind(win);
  const cancelFrame = win.cancelAnimationFrame?.bind(win);
  const visibleLayers = () => !asset ? [] : activeLayer ? [activeLayer] : asset.layers;

  function dimensions() {
    const rect = canvas.getBoundingClientRect?.();
    return { width: Math.max(1, rect?.width || canvas.clientWidth || 640), height: Math.max(1, rect?.height || canvas.clientHeight || 400) };
  }
  function diagnostics() {
    const paths = visibleLayers().flatMap(layer => layer.polylines);
    Object.assign(canvas.dataset, {
      informationRecordId: asset?.informationRecordId || '', unitScope: asset?.unitScope || '', verticalAxis: asset?.verticalAxis || '',
      layerIds: JSON.stringify(asset?.layers.map(layer => layer.id) || []), activeLayerId: asset ? activeLayer?.id || 'all' : '',
      pathCount: String(paths.length), vertexCount: String(paths.reduce((sum, path) => sum + path.length, 0)),
      totalPathCount: String(asset?.layers.reduce((sum, layer) => sum + layer.polylines.length, 0) || 0),
      totalVertexCount: String(asset?.layers.reduce((sum, layer) => sum + layer.polylines.reduce((count, path) => count + path.length, 0), 0) || 0),
      mapping: 'false', seatSelection: 'false', sightline: 'false', metric3D: 'false',
      scale: asset ? String(scale) : '', offsetX: asset ? String(offsetX) : '', offsetY: asset ? String(offsetY) : '',
    });
    zoomOutput.textContent = asset ? `${Math.round(scale / fitScale * 100)}%` : '';
  }
  function draw() {
    frame = null;
    const size = dimensions(); width = size.width; height = size.height;
    const dpr = Math.min(3, Math.max(1, Number(win.devicePixelRatio) || 1));
    const desiredWidth = Math.round(width * dpr), desiredHeight = Math.round(height * dpr);
    if (canvas.width !== desiredWidth) canvas.width = desiredWidth;
    if (canvas.height !== desiredHeight) canvas.height = desiredHeight;
    diagnostics();
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!asset) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = win.getComputedStyle?.(root);
    ctx.strokeStyle = styles?.getPropertyValue('--text').trim() || '#334155';
    ctx.lineWidth = 1.25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const layer of visibleLayers()) for (const path of layer.polylines) {
      ctx.beginPath();
      for (let index = 0; index < path.length; index++) {
        const point = path[index];
        const x = point.u * scale + offsetX;
        const y = (asset.verticalAxis === 'up' ? -point.v : point.v) * scale + offsetY;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      if (layer.closed) ctx.closePath();
      ctx.stroke();
    }
  }
  function schedule() {
    diagnostics();
    if (frame !== null || destroyed) return;
    if (requestFrame) frame = requestFrame(draw); else draw();
  }
  function releasePointers() {
    for (const id of pointers.keys()) { try { canvas.releasePointerCapture?.(id); } catch {} }
    pointers.clear(); gesture = null;
  }
  function clear() {
    releasePointers();
    asset = null; activeLayer = null; scale = fitScale = 1; offsetX = offsetY = 0;
    root.hidden = true; layerSelect.replaceChildren(); badge.textContent = ''; status.textContent = '';
    root.setAttribute('aria-label', '무대 구조'); canvas.setAttribute('aria-label', '무대 구조 평면');
    layerLabel.hidden = true; tools.open = false;
    if (frame !== null) { cancelFrame?.(frame); frame = null; }
    diagnostics();
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  function fit() {
    if (destroyed || !asset) return false;
    releasePointers();
    const size = dimensions(), bounds = boundsFor(visibleLayers().flatMap(layer => layer.polylines.flat()), asset.verticalAxis);
    width = size.width; height = size.height;
    const padding = Math.min(32, Math.max(4, Math.min(size.width, size.height) * .06));
    const usableWidth = Math.max(1, size.width - padding * 2), usableHeight = Math.max(1, size.height - padding * 2);
    const proposed = Math.min(bounds.width ? usableWidth / bounds.width : Infinity, bounds.height ? usableHeight / bounds.height : Infinity);
    if (!Number.isFinite(proposed) || proposed <= 0) { clear(); throw new RangeError('structure: drawing scale unavailable'); }
    scale = fitScale = proposed;
    offsetX = size.width / 2 - (bounds.minX / 2 + bounds.maxX / 2) * scale;
    offsetY = size.height / 2 - (bounds.minY / 2 + bounds.maxY / 2) * scale;
    schedule(); return true;
  }
  function zoom(factor, x = width / 2, y = height / 2) {
    if (!asset || !Number.isFinite(factor) || factor <= 0) return;
    const next = Math.min(fitScale * 100, Math.max(fitScale * .1, scale * factor));
    const ratio = next / scale;
    offsetX = x - (x - offsetX) * ratio; offsetY = y - (y - offsetY) * ratio; scale = next;
    schedule();
  }
  function local(event) {
    const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function beginGesture() {
    const list = [...pointers.values()];
    if (list.length >= 2) {
      const [a, b] = list;
      gesture = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(a.x - b.x, a.y - b.y) };
    } else gesture = list[0] ? { ...list[0], distance: 0 } : null;
  }
  on(layerSelect, 'change', () => {
    if (!asset) return;
    activeLayer = layerSelect.value === 'all' ? null : asset.layers.find(layer => `layer:${layer.id}` === layerSelect.value) || null;
    status.textContent = activeLayer?.label || '전체 구조'; fit();
  });
  on(fitButton, 'click', fit);
  on(zoomIn, 'click', () => zoom(1.25));
  on(zoomOut, 'click', () => zoom(1 / 1.25));
  on(canvas, 'wheel', event => {
    if (!asset) return;
    event.preventDefault(); event.stopPropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    if (event.ctrlKey || event.metaKey) {
      const point = local(event); zoom(Math.exp(-Math.max(-400, Math.min(400, event.deltaY * unit)) * .002), point.x, point.y);
    } else {
      offsetX -= (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
      if (!event.shiftKey) offsetY -= event.deltaY * unit;
      schedule();
    }
  }, { passive: false });
  on(canvas, 'pointerdown', event => {
    if (!asset || (event.pointerType !== 'touch' && event.button !== 0)) return;
    event.preventDefault(); event.stopPropagation();
    canvas.focus?.({ preventScroll: true }); pointers.set(event.pointerId, local(event));
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    beginGesture();
  });
  on(canvas, 'pointermove', event => {
    if (!asset || !pointers.has(event.pointerId)) return;
    event.preventDefault(); event.stopPropagation();
    const previous = gesture; pointers.set(event.pointerId, local(event)); beginGesture();
    if (!previous || !gesture) return;
    offsetX += gesture.x - previous.x; offsetY += gesture.y - previous.y;
    if (gesture.distance > 0 && previous.distance > 0) zoom(gesture.distance / previous.distance, gesture.x, gesture.y);
    else schedule();
  });
  const endPointer = event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault(); event.stopPropagation(); pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    beginGesture();
  };
  on(canvas, 'pointerup', endPointer); on(canvas, 'pointercancel', endPointer); on(canvas, 'lostpointercapture', endPointer);
  on(canvas, 'keydown', event => {
    if (!asset) return;
    const actions = {
      ArrowLeft: () => { offsetX += 32; schedule(); }, ArrowRight: () => { offsetX -= 32; schedule(); },
      ArrowUp: () => { offsetY += 32; schedule(); }, ArrowDown: () => { offsetY -= 32; schedule(); },
      '+': () => zoom(1.25), '=': () => zoom(1.25), '-': () => zoom(.8), _: () => zoom(.8), Home: fit,
    };
    if (!actions[event.key]) return;
    event.preventDefault(); event.stopPropagation(); actions[event.key]();
  });
  const resized = () => { if (asset) fit(); };
  const Observer = win.ResizeObserver || globalThis.ResizeObserver;
  if (Observer) { resizeObserver = new Observer(resized); resizeObserver.observe(canvas); }
  else if (win.addEventListener) on(win, 'resize', resized);
  diagnostics();
  return {
    setAsset(next) {
      if (destroyed) throw new Error('structure explorer: already destroyed');
      clear();
      if (next === null) return;
      const normalized = normalizeStructureAsset(next);
      asset = normalized; activeLayer = null;
      root.hidden = false;
      badge.textContent = asset.unitScope === 'source_plane' ? '상대비율' : '부분구조';
      root.setAttribute('aria-label', `${asset.title} 무대 구조`);
      canvas.setAttribute('aria-label', `${asset.title} 무대 구조 평면. 드래그와 스크롤로 이동, 더하기와 빼기로 확대, Home으로 전체 보기`);
      const allOption = el('option', '', '', '전체'); allOption.value = 'all'; layerSelect.append(allOption);
      for (const layer of asset.layers) {
        const option = el('option', '', '', layer.label); option.value = `layer:${layer.id}`; layerSelect.append(option);
      }
      layerSelect.value = 'all'; layerLabel.hidden = asset.layers.length < 2;
      status.textContent = ctx ? '전체 구조' : '이 브라우저에서 구조 화면을 표시할 수 없습니다.';
      fit();
    },
    fit,
    destroy() {
      if (destroyed) return;
      clear(); destroyed = true; resizeObserver?.disconnect();
      for (const dispose of disposers) dispose();
      root.remove();
    },
  };
}
