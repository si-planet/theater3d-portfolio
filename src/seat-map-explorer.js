import { createSeatList } from './geometry.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const keyOf = seat => `${seat.row}:${seat.number}`;
const display = seat => seat.displayLabel || seat.label || seat.officialLabel;
const rawLabel = value => text(value) ? value : finite(value) ? String(value) : '';
const floorOf = seat => rawLabel(seat.floorLabel) || rawLabel(seat.floor) || rawLabel(seat.level);
const sectionOf = seat => rawLabel(seat.section);
const rowOf = seat => rawLabel(seat.rowLabel);
const spelling = value => String(value).normalize('NFC').trim().replace(/\s+/gu, '').toUpperCase();
const searchLabels = seat => [seat.displayLabel, seat.label, seat.officialLabel, seat.numberText, String(seat.number),
  ...(Array.isArray(seat.aliases) ? seat.aliases.map(alias => typeof alias === 'string' ? alias : alias?.label) : [])]
  .filter(value => text(value) || finite(value)).map(spelling);

/** A separate, pannable seat-selection surface; never changes model geometry. */
export function createSeatMapExplorer({ getSnapshot, onSelect } = {}) {
  if (typeof getSnapshot !== 'function' || typeof onSelect !== 'function') throw new TypeError('getSnapshot and onSelect are required');
  const dialog = document.createElement('dialog');
  dialog.id = 'seat-map-dialog'; dialog.className = 'workspace-dialog seat-map-dialog';
  dialog.setAttribute('aria-labelledby', 'seat-map-title');
  dialog.innerHTML = `<div class="seat-map-heading dialog-heading"><h2 id="seat-map-title">좌석 지도</h2><button id="seat-map-close" type="button" class="quiet-button" aria-label="좌석 지도 닫기">닫기</button></div>
    <div class="seat-map-toolbar" role="group" aria-label="지도 보기"><button id="seat-map-fit" type="button" class="quiet-button">전체 보기</button><div class="seat-map-zoom-controls" role="group" aria-label="좌석 지도 확대와 축소"><button id="seat-map-zoom-out" type="button" class="quiet-button" aria-label="좌석 지도 축소">−</button><output id="seat-map-zoom-value" aria-live="off"></output><button id="seat-map-zoom-in" type="button" class="quiet-button" aria-label="좌석 지도 확대">＋</button></div></div>
    <div class="seat-map-filters"><label id="seat-map-floor-label">층<select id="seat-map-floor-filter" aria-label="좌석 지도 층"></select></label><label id="seat-map-section-label">구역<select id="seat-map-section-filter" aria-label="좌석 지도 구역"></select></label><label id="seat-map-row-label">구역·열<select id="seat-map-row-filter" aria-label="좌석 지도 등록 구역·열 표기"></select></label></div>
    <div class="seat-map-body"><div class="seat-map-canvas-wrap"><canvas id="seat-map-canvas" tabindex="0" role="img" aria-label="확대·이동할 수 있는 실제 등록 좌석 지도" aria-describedby="seat-map-instructions"></canvas></div><aside class="seat-map-sidebar"><form class="seat-map-search-form"><label for="seat-map-search">좌석 찾기</label><input id="seat-map-search" type="search" placeholder="등록된 좌석 표기 또는 번호" autocomplete="off"><button id="seat-map-search-button" type="submit" class="quiet-button">찾기</button></form><div id="seat-map-results" class="seat-map-results" role="group" aria-label="일치하는 좌석 후보"></div><section id="seat-map-candidates" class="seat-map-candidates" aria-label="겹친 좌석 중 선택" hidden></section></aside></div>
    <div class="seat-map-footer"><strong id="seat-map-selected"></strong><p id="seat-map-status" role="status" aria-live="polite"></p><p id="seat-map-instructions" class="small-note">드래그로 이동 · 휠·두 손가락으로 확대. 키보드: 방향키 이동, +/− 확대, Home 전체, Enter 후보.</p></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#${id}`), canvas = $('seat-map-canvas');
  // Touch handling belongs only to this popup, independently of scene orbit.
  canvas.style.touchAction = 'none';
  const disposers = [], pointers = new Map();
  let seats = [], polygon = [], filtered = [], geometryRef = null, contextKey = '', selected = null;
  let valid = false, destroyed = false, width = 0, height = 0, fitScale = 1, pitch = null;
  let view = { scale: 1, offsetX: 0, offsetY: 0 }, drag = null, pinch = null, multiTouch = false, frame = 0;
  let hits = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    disposers.push(() => target.removeEventListener(type, handler, options));
  };
  const status = message => { $('seat-map-status').textContent = message; };
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const world = point => ({ x: (point.x - view.offsetX) / view.scale, z: (point.y - view.offsetY) / view.scale });
  const screen = seat => ({ x: seat.x * view.scale + view.offsetX, y: seat.z * view.scale + view.offsetY });
  const stableId = seat => rawLabel(seat.seatId) || rawLabel(seat.id) || `${contextKey}:${keyOf(seat)}`;
  function cancelPointers() {
    const ids = [...pointers.keys()]; pointers.clear(); drag = null; pinch = null; multiTouch = false;
    for (const id of ids) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function queueDraw() { if (!frame && dialog.open && !destroyed) frame = requestAnimationFrame(() => { frame = 0; draw(); }); }
  function bounds() {
    const points = [...polygon, ...filtered];
    return { xMin: Math.min(...points.map(p => p.x)), xMax: Math.max(...points.map(p => p.x)), zMin: Math.min(...points.map(p => p.z)), zMax: Math.max(...points.map(p => p.z)) };
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), nextWidth = Math.max(1, rect.width), nextHeight = Math.max(1, rect.height);
    if (width && height && (nextWidth !== width || nextHeight !== height)) {
      view.offsetX += (nextWidth - width) / 2; view.offsetY += (nextHeight - height) / 2;
    }
    width = nextWidth; height = nextHeight;
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 3);
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d'); ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); return ctx;
  }
  function fit() {
    if (!valid) return; resize(); const b = bounds();
    fitScale = Math.max(.001, Math.min(Math.max(1, width - 96) / Math.max(.1, b.xMax - b.xMin), Math.max(1, height - 64) / Math.max(.1, b.zMax - b.zMin)));
    view = { scale: fitScale, offsetX: width / 2 - (b.xMin + b.xMax) / 2 * fitScale, offsetY: height / 2 - (b.zMin + b.zMax) / 2 * fitScale };
    queueDraw();
  }
  function zoom(factor, anchor = { x: width / 2, y: height / 2 }) {
    if (!valid) return; const before = world(anchor), scale = clamp(view.scale * factor, fitScale * .35, fitScale * 24);
    view = { scale, offsetX: anchor.x - before.x * scale, offsetY: anchor.y - before.z * scale }; queueDraw();
  }
  function focusSeat(seat) {
    if (!seat) return;
    if (!filtered.some(item => keyOf(item) === keyOf(seat))) {
      for (const id of ['seat-map-floor-filter', 'seat-map-section-filter', 'seat-map-row-filter']) $(id).value = '';
      applyFilters(false);
    }
    view.offsetX = width / 2 - seat.x * view.scale; view.offsetY = height / 2 - seat.z * view.scale; queueDraw();
  }
  function clearCandidates() { const holder = $('seat-map-candidates'); holder.replaceChildren(); holder.hidden = true; }
  function revealChoice(control) {
    if (control) requestAnimationFrame(() => {
      if (!dialog.open || !control.isConnected) return;
      const container=dialog.querySelector(matchMedia('(max-width:640px)').matches?'.seat-map-body':'.seat-map-sidebar');
      const clip=container.getBoundingClientRect(), target=control.getBoundingClientRect();
      const top=clip.top+container.clientTop, bottom=top+container.clientHeight;
      if(target.bottom>bottom)container.scrollTop+=target.bottom-bottom;
      else if(target.top<top)container.scrollTop-=top-target.top;
    });
  }
  function seatButton(seat, jump = false) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'quiet-button'; button.dataset.seatKey = keyOf(seat);
    button.dataset.seatId = stableId(seat);
    const extra = [floorOf(seat), sectionOf(seat)].filter(Boolean);
    button.textContent = display(seat) + (extra.length ? ` · ${extra.join(' · ')}` : '');
    button.setAttribute('aria-label', `${button.textContent} 선택`);
    button.onclick = () => selectSeat(seat, jump); return button;
  }
  function selectSeat(seat, jump = false) {
    if (!valid) return;
    try {
      if (onSelect({ row: seat.row, number: seat.number }) === false) { status('이 좌석을 선택하지 못했습니다.'); return; }
      clearCandidates(); sync(); if (jump) focusSeat(seat);
      status(`${display(seat)} 선택`);
    } catch { status('좌석 선택을 완료하지 못했습니다. 다시 선택해 주세요.'); }
  }
  function pick(point, pointerType) {
    const radius = pointerType === 'touch' ? 20 : 12;
    const candidates = hits.map(hit => ({ ...hit, distance: Math.hypot(hit.x - point.x, hit.y - point.y) }))
      .filter(hit => hit.distance <= Math.max(radius, hit.radius)).sort((a, b) => a.distance - b.distance);
    clearCandidates();
    if (candidates.length === 1) { selectSeat(candidates[0].seat); return; }
    if (!candidates.length) { status('이 위치에 선택할 좌석이 없습니다. 확대하거나 좌석 표기를 검색하세요.'); return; }
    const holder = $('seat-map-candidates'), heading = document.createElement('h3'); heading.textContent = `${candidates.length}개 좌석 중 선택`;
    holder.append(heading, ...candidates.map(hit => seatButton(hit.seat))); holder.hidden = false;
    status('좌석이 가까이 모여 있습니다. 목록에서 정확한 좌석을 선택하세요.');
    revealChoice(holder.querySelector('button'));
  }
  function search() {
    const holder = $('seat-map-results'), query = spelling($('seat-map-search').value); holder.replaceChildren(); clearCandidates();
    if (!query || !valid) { if (valid) status('좌석 표기나 번호를 입력하세요.'); return; }
    const exact = filtered.filter(seat => searchLabels(seat).includes(query));
    const found = exact.length ? exact : filtered.filter(seat => searchLabels(seat).some(label => label.includes(query)));
    holder.dataset.matchKind = exact.length ? 'exact' : found.length ? 'partial' : 'none';
    holder.append(...found.map(seat => seatButton(seat, true)));
    status(found.length ? `${exact.length ? '일치' : '부분 일치'} ${found.length}개 · 목록에서 선택하세요.` : '일치하는 좌석이 없습니다. 필터도 확인하세요.');
    revealChoice(holder.querySelector('button'));
  }
  function options(id, label, values) {
    const control = $(id); control.replaceChildren(new Option(label, ''));
    for (const [value, caption] of values) control.add(new Option(caption, value));
  }
  function setupFilters() {
    const floors = [...new Set(seats.map(floorOf).filter(Boolean))], sections = [...new Set(seats.map(sectionOf).filter(Boolean))];
    options('seat-map-floor-filter', '전체 층', floors.map(value => [value, value]));
    options('seat-map-section-filter', '전체 구역', sections.map(value => [value, value]));
    $('seat-map-floor-label').hidden = !floors.length; $('seat-map-section-label').hidden = !sections.length;
    const rows = [...new Set(seats.map(rowOf).filter(Boolean))];
    options('seat-map-row-filter', '전체 구역·열', rows.map(label => [label, label]));
    $('seat-map-row-label').hidden = !rows.length;
  }
  function applyFilters(refit = true) {
    const floor = $('seat-map-floor-filter').value, section = $('seat-map-section-filter').value, row = $('seat-map-row-filter').value;
    filtered = seats.filter(seat => (!floor || floorOf(seat) === floor) && (!section || sectionOf(seat) === section) && (!row || rowOf(seat) === row));
    clearCandidates(); $('seat-map-results').replaceChildren(); $('seat-map-results').dataset.matchKind = 'none'; status(`표시 좌석 ${filtered.length}개`);
    if (refit) fit(); else queueDraw();
  }
  function measurePitch() {
    if (seats.length < 2) return null;
    const distances = [], step = Math.max(1, Math.floor(seats.length / 160));
    for (let i = 0; i < seats.length; i += step) {
      let nearest = Infinity;
      for (let j = 0; j < seats.length; j++) if (i !== j) { const d = Math.hypot(seats[i].x - seats[j].x, seats[i].z - seats[j].z); if (d > .000001) nearest = Math.min(nearest, d); }
      if (Number.isFinite(nearest)) distances.push(nearest);
    }
    distances.sort((a, b) => a - b); return distances.length ? distances[Math.floor(distances.length / 2)] : null;
  }
  function drawGuides(ctx, { panel, ink, line, radius, occupied }) {
    const groups = new Map(), sections = new Map(), candidates = [];
    const physicalOf = seat => rawLabel(seat.physicalRowLabel) || rawLabel(seat.physicalRow);
    // An explicit unknown source numeral must stay unknown. The registered
    // model number is used only when no separate source-number field exists.
    const numberOf = seat => Object.hasOwn(seat.sourceLabels || {}, 'numberText') ? rawLabel(seat.sourceLabels.numberText)
      : Object.hasOwn(seat, 'numberText') ? rawLabel(seat.numberText) : rawLabel(seat.number);
    for (const seat of filtered) {
      const row = rowOf(seat), section = sectionOf(seat);
      if (row) {
        const key = JSON.stringify([floorOf(seat), section, row]);
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(seat);
      }
      if (section) {
        const key = JSON.stringify([floorOf(seat), section]);
        if (!sections.has(key)) sections.set(key, []); sections.get(key).push(seat);
      }
    }
    const segmentsOf = items => {
      const ordered = [...items].sort((a, b) => a.x - b.x || a.z - b.z), segments = [[]];
      for (const seat of ordered) {
        const segment = segments.at(-1), previous = segment.at(-1);
        if (previous && pitch && seat.x - previous.x > pitch * 2.4) segments.push([]);
        segments.at(-1).push(seat);
      }
      return segments;
    };
    const preferred = items => Boolean(selected && items.some(seat => keyOf(seat) === keyOf(selected)));
    const addHeading = (items, label, kind, groupKey) => {
      const xMin = Math.min(...items.map(seat => seat.x)), xMax = Math.max(...items.map(seat => seat.x));
      const zMin = Math.min(...items.map(seat => seat.z)), zMax = Math.max(...items.map(seat => seat.z));
      candidates.push({ text: label, kind, groupKey, selected: preferred(items), placements: [
        { side: 'above', anchor: screen({ x: (xMin + xMax) / 2, z: zMin }) },
        { side: 'below', anchor: screen({ x: (xMin + xMax) / 2, z: zMax }) },
        { side: 'left', anchor: screen({ x: xMin, z: (zMin + zMax) / 2 }) },
        { side: 'right', anchor: screen({ x: xMax, z: (zMin + zMax) / 2 }) },
      ] });
    };
    for (const [groupKey, items] of groups) {
      const physicalRows = new Map();
      for (const seat of items) {
        const physical = physicalOf(seat);
        if (!physicalRows.has(physical)) physicalRows.set(physical, []);
        physicalRows.get(physical).push(seat);
      }
      // Repeated official lettering across explicitly registered physical rows
      // describes one block. Physical-row names remain placement metadata.
      const compact = physicalRows.size > 1 && !physicalRows.has('');
      if (compact) addHeading(items, rowOf(items[0]), 'block', groupKey);
      for (const rowSeats of physicalRows.values()) for (const segment of segmentsOf(rowSeats)) {
        const first = segment[0], last = segment.at(-1), label = compact ? numberOf(first) : rowOf(first);
        if (!label) continue;
        candidates.push({ text: label, kind: compact ? 'row-start' : 'row', groupKey,
          seatKey: compact ? keyOf(first) : null, selected: preferred(segment), placements: [
            { side: 'left', anchor: screen(first) },
            // An ordinary row may use its other end as a fallback, but a start
            // numeral must stay beside its actual source seat.
            ...(!compact && segment.length > 1 ? [{ side: 'right', anchor: screen(last) }] : []),
          ] });
      }
    }
    for (const [groupKey, items] of sections) {
      const section = sectionOf(items[0]);
      if (items.every(seat => rowOf(seat) === section)) continue;
      addHeading(items, section, 'section', groupKey);
    }
    const priority = candidate => ['block', 'section'].includes(candidate.kind) ? 0 : 1;
    candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || priority(a) - priority(b));
    const drawn = [], overlaps = (a, b) => a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x && a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
    for (const candidate of candidates) {
      ctx.font = candidate.selected ? '600 12px system-ui' : '11px system-ui';
      const boxWidth = ctx.measureText(candidate.text).width + 8, boxHeight = candidate.selected ? 20 : 18;
      let box = null, placement = null;
      for (const option of candidate.placements) {
        const x = option.side === 'left' ? option.anchor.x - radius - 7 - boxWidth : option.side === 'right' ? option.anchor.x + radius + 7 : option.anchor.x - boxWidth / 2;
        const y = option.side === 'above' ? option.anchor.y - radius - 7 - boxHeight : option.side === 'below' ? option.anchor.y + radius + 7 : option.anchor.y - boxHeight / 2;
        // A heading above/below a block must remain over that block's center.
        // Try another side rather than silently drifting into the next bank.
        const offsets = ['above', 'below'].includes(option.side) ? [0] : [0, -18, 18, -36, 36];
        for (const offset of offsets) {
          const proposed = { x, y: y + offset, width: boxWidth, height: boxHeight };
          if (proposed.x < 2 || proposed.y < 2 || proposed.x + boxWidth > width - 2 || proposed.y + boxHeight > height - 2 || occupied.some(other => overlaps(proposed, other))) continue;
          box = proposed; placement = option; break;
        }
        if (box) break;
      }
      if (!box) continue;
      if (['left', 'right'].includes(placement.side) && Math.abs(box.y + boxHeight / 2 - placement.anchor.y) > 1) {
        ctx.beginPath(); ctx.moveTo(placement.anchor.x + (placement.side === 'left' ? -radius : radius), placement.anchor.y);
        ctx.lineTo(placement.side === 'left' ? box.x + box.width : box.x, box.y + boxHeight / 2);
        ctx.strokeStyle = line; ctx.lineWidth = .7; ctx.stroke();
      }
      ctx.fillStyle = panel; ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(candidate.text, box.x + 4, box.y + boxHeight / 2);
      occupied.push(box);
      drawn.push({ text: candidate.text, kind: candidate.kind, groupKey: candidate.groupKey, seatKey: candidate.seatKey ?? null,
        side: placement.side, x: box.x + 4, y: box.y + boxHeight / 2, selected: candidate.selected });
    }
    return { drawn, suppressed: candidates.length - drawn.length };
  }
  function draw() {
    if (!dialog.open || destroyed) return; const ctx = resize(); if (!ctx) { status('좌석 지도를 그릴 수 없는 브라우저입니다.'); return; }
    const css = getComputedStyle(dialog), color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const panel = color('--panel', '#fff'), ink = color('--text', '#252b33'), line = color('--control-line', '#a9afb8');
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = panel; ctx.fillRect(0, 0, width, height); hits = [];
    if (!valid) {
      Object.assign(canvas.dataset, { visibleSeatCount: '0', filteredSeatCount: '0', labelsCount: '0', selectedSeatKey: '', selectedSeatId: '', contextKey,
        guideLabels: '[]', guideLabelsCount: '0', guideSuppressedCount: '0', rowLabelValues: '[]', sectionLabelValues: '[]', floorLabelValues: '[]' });
      $('seat-map-zoom-value').textContent = '—'; return;
    }
    ctx.beginPath(); polygon.forEach((vertex, index) => { const p = screen(vertex); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath();
    ctx.fillStyle = color('--panel-deep', '#edf0f3'); ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.stroke();
    const stage = polygon.map(screen), stageCenter = { x: stage.reduce((sum, p) => sum + p.x, 0) / stage.length, y: stage.reduce((sum, p) => sum + p.y, 0) / stage.length };
    ctx.fillStyle = ink; ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('무대', stageCenter.x, stageCenter.y);
    const pitchPx = pitch ? pitch * view.scale : 40, radius = clamp(pitchPx * .27, 3, 9), labels = pitchPx >= 26;
    let labelsCount = 0, visibleCount = 0;
    const occupied = [{ x: stageCenter.x - 18, y: stageCenter.y - 9, width: 36, height: 18 }];
    for (const seat of filtered) {
      const p = screen(seat), isSelected = selected && keyOf(selected) === keyOf(seat);
      hits.push({ seat, ...p, radius });
      if (p.x < -20 || p.x > width + 20 || p.y < -30 || p.y > height + 30) continue;
      visibleCount++;
      occupied.push({ x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2 });
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fillStyle = isSelected ? ink : color('--hover', '#e2e5e9'); ctx.fill();
      ctx.strokeStyle = isSelected ? ink : line; ctx.lineWidth = isSelected ? 2 : 1; ctx.stroke();
      if (labels && !isSelected) {
        const number = String(seat.numberText ?? seat.number); ctx.font = '10px system-ui'; ctx.fillStyle = ink; ctx.fillText(number, p.x, p.y + radius + 8); labelsCount++;
        const numberWidth = ctx.measureText(number).width;
        occupied.push({ x: p.x - numberWidth / 2, y: p.y + radius + 2, width: numberWidth, height: 12 });
      }
    }
    if (selected && filtered.some(seat => keyOf(seat) === keyOf(selected))) {
      const p = screen(selected);
      if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) {
        const label = display(selected); ctx.font = '600 12px system-ui'; const labelWidth = ctx.measureText(label).width + 16;
        const x = clamp(p.x - labelWidth / 2, 2, Math.max(2, width - labelWidth - 2)), y = clamp(p.y - radius - 30, 2, Math.max(2, height - 26));
        ctx.fillStyle = panel; ctx.fillRect(x, y, labelWidth, 24); ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(x, y, labelWidth, 24);
        ctx.fillStyle = ink; ctx.fillText(label, x + labelWidth / 2, y + 12); labelsCount++;
        occupied.push({ x, y, width: labelWidth, height: 24 });
      }
    }
    const guides = drawGuides(ctx, { panel, ink, line, radius, occupied });
    Object.assign(canvas.dataset, { scale: String(view.scale), zoom: String(view.scale / fitScale), offsetX: String(view.offsetX), offsetY: String(view.offsetY), visibleSeatCount: String(visibleCount), filteredSeatCount: String(filtered.length), labelsCount: String(labelsCount), selectedSeatKey: selected ? keyOf(selected) : '', selectedSeatId: selected ? stableId(selected) : '', contextKey,
      guideLabels: JSON.stringify(guides.drawn), guideLabelsCount: String(guides.drawn.length), guideSuppressedCount: String(guides.suppressed),
      rowLabelValues: JSON.stringify([...new Set(seats.map(rowOf).filter(Boolean))]), sectionLabelValues: JSON.stringify([...new Set(seats.map(sectionOf).filter(Boolean))]), floorLabelValues: JSON.stringify([...new Set(seats.map(floorOf).filter(Boolean))]) });
    $('seat-map-zoom-value').textContent = `${Math.round(view.scale / fitScale * 100)}%`;
  }
  function sync() {
    if (!dialog.open || destroyed) return;
    let snapshot; try { snapshot = getSnapshot(); } catch { snapshot = null; }
    const g = snapshot?.geometry, sourceSeats = g?.seats, sourcePolygon = g?.stagePolygon;
    const structurallyValid = Array.isArray(sourceSeats) && sourceSeats.length > 0 && Array.isArray(sourcePolygon) && sourcePolygon.length >= 3
      && sourcePolygon.every(p => p && finite(p.x) && finite(p.z))
      && sourceSeats.every(seat => seat && Number.isInteger(seat.row) && seat.row > 0 && Number.isInteger(seat.number) && seat.number > 0
        && ['x', 'z', 'floorY'].every(field => finite(seat[field])) && text(display(seat)));
    const nextKey = snapshot ? JSON.stringify([snapshot.state?.venueId ?? null, snapshot.state?.modelMode ?? null, snapshot.context ?? null]) : '';
    const changed = geometryRef !== g || contextKey !== nextKey;
    valid = Boolean(structurallyValid);
    if (valid && changed) {
      const originals = new Map(sourceSeats.map(seat => [keyOf(seat), seat]));
      const candidate = createSeatList({ ...g, seats: sourceSeats.map(seat => ({ ...seat, label: text(seat.label) ? seat.label : display(seat) })) })
        .map(seat => ({ ...seat, rowLabel: originals.get(keyOf(seat))?.rowLabel ?? null }));
      valid = candidate.length === sourceSeats.length && new Set(candidate.map(keyOf)).size === candidate.length;
      if (valid) { seats = candidate; polygon = sourcePolygon.map(p => ({ x: p.x, z: p.z })); geometryRef = g; contextKey = nextKey; pitch = measurePitch(); cancelPointers(); setupFilters(); $('seat-map-search').value = ''; $('seat-map-results').replaceChildren(); clearCandidates(); applyFilters(false); fit(); }
    }
    for (const control of dialog.querySelectorAll('button,input,select')) if (control.id !== 'seat-map-close') control.disabled = !valid;
    if (!valid) {
      cancelPointers(); seats = []; filtered = []; selected = null; hits = []; geometryRef = null; contextKey = nextKey;
      if (changed) {
        $('seat-map-search').value = '';
        options('seat-map-floor-filter', '전체 층', []); options('seat-map-section-filter', '전체 구역', []); options('seat-map-row-filter', '전체 구역·열', []);
        $('seat-map-floor-label').hidden = true; $('seat-map-section-label').hidden = true; $('seat-map-row-label').hidden = true;
        view = { scale: 1, offsetX: 0, offsetY: 0 }; fitScale = 1;
      }
      $('seat-map-selected').textContent = '선택 가능한 좌석 지도 없음'; clearCandidates(); $('seat-map-results').replaceChildren();
      status('좌석 위치가 등록된 극장을 먼저 선택하세요. 미확인 좌표로 좌석을 만들지 않습니다.'); queueDraw(); return;
    }
    selected = seats.find(seat => seat.row === snapshot.state?.seat?.row && seat.number === snapshot.state?.seat?.number) || null;
    $('seat-map-selected').textContent = selected ? `현재 선택 · ${snapshot.seatLabel || display(selected)}` : '현재 선택한 좌석 없음';
    queueDraw();
  }

  function resetTransient() {
    cancelPointers();
    $('seat-map-search').value = '';
    $('seat-map-results').replaceChildren(); $('seat-map-results').dataset.matchKind = 'none';
    clearCandidates();
    for (const id of ['seat-map-floor-filter', 'seat-map-section-filter', 'seat-map-row-filter']) $(id).value = '';
    if (valid) applyFilters(false);
    view = { scale: 1, offsetX: 0, offsetY: 0 }; fitScale = 1;
  }
  listen($('seat-map-close'), 'click', () => dialog.close());
  listen(dialog, 'close', resetTransient); listen(dialog, 'cancel', resetTransient);
  listen($('seat-map-zoom-in'), 'click', () => zoom(1.3)); listen($('seat-map-zoom-out'), 'click', () => zoom(1 / 1.3));
  listen($('seat-map-fit'), 'click', fit);
  for (const id of ['seat-map-floor-filter', 'seat-map-section-filter', 'seat-map-row-filter']) listen($(id), 'change', () => { cancelPointers(); applyFilters(); });
  listen(dialog.querySelector('form'), 'submit', event => { event.preventDefault(); search(); });
  listen(canvas, 'wheel', event => { if (!valid) return; event.preventDefault(); cancelPointers(); const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1; zoom(Math.exp(-clamp(event.deltaY * unit, -240, 240) * .002), point(event)); }, { passive: false });
  listen(canvas, 'pointerdown', event => {
    if (!valid || event.button !== 0 || pointers.has(event.pointerId)) return;
    event.preventDefault(); canvas.focus({ preventScroll: true }); const p = point(event); pointers.set(event.pointerId, p); canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) { multiTouch = false; drag = { id: event.pointerId, start: p, camera: { ...view }, moved: false, type: event.pointerType }; }
    else { multiTouch = true; const [a, b] = [...pointers.values()]; const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: view.scale, anchor: world(middle) }; }
  });
  listen(canvas, 'pointermove', event => {
    if (!pointers.has(event.pointerId)) return; event.preventDefault(); const p = point(event); pointers.set(event.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()], middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clamp(pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, fitScale * .35, fitScale * 24);
      view = { scale, offsetX: middle.x - pinch.anchor.x * scale, offsetY: middle.y - pinch.anchor.z * scale }; queueDraw(); return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    drag.moved ||= Math.hypot(dx, dy) > 4;
    if (drag.moved) { view = { ...drag.camera, offsetX: drag.camera.offsetX + dx, offsetY: drag.camera.offsetY + dy }; queueDraw(); }
  });
  const endPointer = event => {
    if (!pointers.has(event.pointerId)) return; const old = drag, p = point(event);
    const click = event.type === 'pointerup' && pointers.size === 1 && !multiTouch && old?.id === event.pointerId && !old.moved && Math.hypot(p.x - old.start.x, p.y - old.start.y) <= 4;
    pointers.delete(event.pointerId); if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId); pinch = null;
    if (pointers.size === 1) { const [id, current] = [...pointers][0]; drag = { id, start: current, camera: { ...view }, moved: true, type: 'touch' }; }
    else if (!pointers.size) drag = null;
    if (click) pick(p, old.type);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, type, endPointer);
  listen(canvas, 'keydown', event => {
    if (!valid) return; const pans = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (event.key in pans) { event.preventDefault(); cancelPointers(); const [x, y] = pans[event.key]; view.offsetX += x; view.offsetY += y; queueDraw(); }
    else if (['+', '=', '-', '_', 'Home', 'Enter'].includes(event.key)) {
      event.preventDefault(); cancelPointers();
      if (event.key === 'Home') fit(); else if (event.key === '-' || event.key === '_') zoom(1 / 1.3); else if (event.key === 'Enter') {
        const candidate = $('seat-map-candidates').querySelector('button') || $('seat-map-results').querySelector('button');
        if (candidate) candidate.focus(); else { $('seat-map-search').focus(); status('좌석 표기를 검색하고 결과를 선택하세요.'); }
      } else zoom(1.3);
    }
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => queueDraw()) : null; observer?.observe(canvas.parentElement);
  function clear() {
    if (destroyed) return;
    cancelPointers(); if (frame) cancelAnimationFrame(frame); frame = 0;
    seats = []; polygon = []; filtered = []; hits = []; geometryRef = null; contextKey = ''; selected = null; valid = false; pitch = null;
    view = { scale: 1, offsetX: 0, offsetY: 0 }; fitScale = 1;
    $('seat-map-search').value = ''; $('seat-map-results').replaceChildren(); clearCandidates();
    for (const name of ['floor','section','row']) { $('seat-map-'+name+'-filter').replaceChildren(); $('seat-map-'+name+'-label').hidden = true; }
    $('seat-map-selected').textContent = ''; $('seat-map-status').textContent = ''; $('seat-map-zoom-value').textContent = '';
    for (const key of Object.keys(canvas.dataset)) delete canvas.dataset[key];
    const ctx = canvas.getContext('2d'); if (ctx) { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height); }
    canvas.setAttribute('aria-label','좌석 지도 없음');
    if (dialog.open) dialog.close('runtime-change');
  }
  return {
    open() { if (destroyed) return false; resetTransient(); if (!dialog.open) dialog.showModal(); sync(); fit(); canvas.focus({ preventScroll: true }); return valid; },
    sync, clear,
    destroy() { if (destroyed) return; destroyed = true; cancelPointers(); if (frame) cancelAnimationFrame(frame); observer?.disconnect(); for (const dispose of disposers) dispose(); if (dialog.open) dialog.close(); dialog.remove(); },
  };
}
