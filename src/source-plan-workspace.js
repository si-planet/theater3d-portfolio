import { normalizeSourceSeatPlan, findSourcePlanSeats, hitSourcePlanSeats } from './source-plan-seats.js';
import { normalizeSeatMediaContext } from './seat-media-context.js';
import { sourcePlanChoiceKey, snapshotSourcePlanChoice, readSourcePlanChoice, writeSourcePlanChoice } from './source-plan-choice.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const radians = degrees => degrees * Math.PI / 180;
const yaw = degrees => ((degrees + 180) % 360 + 360) % 360 - 180;
const sameSelection = selection => selection ? JSON.stringify([selection.informationRecordId, selection.frameId, selection.seat.id]) : '';
const sourceText = value => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const selectableWheelchairKinds = new Set(['wheelchair', 'wheelchair_pictogram', 'wheelchair_source_symbol', 'wheelchair_symbol_unnumbered']);
const isSelectableWheelchair = seat => Boolean(seat && (selectableWheelchairKinds.has(seat.kind) || selectableWheelchairKinds.has(seat.sourceSeat?.kind)));
const seatDisplayLabel = seat => typeof seat?.displayLabel === 'string' && seat.displayLabel.trim() ? seat.displayLabel : seat?.label || '';

/**
 * Source chair-symbol inspection only. The 3D view rotates the drawing plane;
 * it does not assign a physical floor height, seat identity or room datum.
 */
export function createSourcePlanWorkspace({ container, onSelection = () => {}, selectionStorage } = {}) {
  if (!container?.append || typeof onSelection !== 'function') throw new TypeError('A container and an optional selection callback are required');
  const doc = container.ownerDocument;
  const make = (tag, id, text, className) => {
    const element = doc.createElement(tag);
    if (id) element.id = id;
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (id, text) => {
    const element = make('button', id, text, 'source-seat-button');
    element.type = 'button'; return element;
  };
  const root = make('section', 'source-seat-workspace', '', 'source-seat-workspace');
  root.hidden = true;
  root.setAttribute('aria-labelledby', 'source-seat-title');
  const heading = make('div', '', '', 'source-seat-heading');
  const title = make('h2', 'source-seat-title');
  const badge = make('span', 'source-seat-badge', '도면 좌석 · 치수 추정', 'source-seat-badge');
  const sourceInfo = make('details', 'source-seat-info', '', 'source-seat-info');
  const sourceInfoSummary = make('summary', '', '?'); sourceInfoSummary.setAttribute('aria-label', '좌석도 정보');
  const sourceInfoContent = make('div', 'source-seat-info-content', '', 'source-seat-info-content');
  const sourceInfoDescription = make('p', 'source-seat-info-description');
  sourceInfo.append(sourceInfoSummary, sourceInfoContent);
  heading.append(title, badge, sourceInfo);
  const scope = make('p', 'source-seat-scope', '', 'source-seat-scope');
  scope.hidden = true;
  const toolbar = make('div', '', '', 'source-seat-toolbar');
  const modes = make('div', '', '', 'source-seat-modes');
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '좌석 도면 보기');
  const flat = button('source-seat-view-2d', '2D 평면');
  const orbit = button('source-seat-view-3d', '평면 회전');
  modes.append(flat, orbit);
  const frameLabel = make('label', '', '층·도면');
  frameLabel.htmlFor = 'source-seat-frame';
  const frameSelect = make('select', 'source-seat-frame');
  frameLabel.append(frameSelect);
  const zoomOut = button('source-seat-zoom-out', '−'); zoomOut.setAttribute('aria-label', '좌석 도면 축소');
  const zoomIn = button('source-seat-zoom-in', '+'); zoomIn.setAttribute('aria-label', '좌석 도면 확대');
  const zoomLabel = make('output', 'source-seat-zoom', '100%', 'source-seat-count');
  const fitButton = button('source-seat-fit', '전체 보기');
  toolbar.append(modes, frameLabel, zoomOut, zoomLabel, zoomIn, fitButton);
  const direction = make('span', 'source-seat-direction', '', 'source-seat-count');toolbar.append(direction);
  const worksheetTools = make('div', 'source-seat-worksheet-tools', '', 'source-seat-worksheet-tools');
  worksheetTools.hidden = true;
  const worksheetSections = make('span', 'source-seat-worksheet-sections');
  const worksheetRowLabel = make('label', '', '열 확대');
  worksheetRowLabel.htmlFor = 'source-seat-row';
  const worksheetRow = make('select', 'source-seat-row');
  worksheetRow.setAttribute('aria-label', '원문 열 확대');
  worksheetRowLabel.append(worksheetRow); worksheetTools.append(worksheetSections, worksheetRowLabel);
  const body = make('div', '', '', 'source-seat-body');
  const canvasWrap = make('div', '', '', 'source-seat-canvas-wrap');
  const canvas = make('canvas', 'source-seat-canvas');
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-describedby', 'source-seat-help');
  canvas.style.touchAction = 'none';
  canvasWrap.style.position = 'relative';
  const hoverLabel = make('output', 'source-seat-hover', '', 'source-seat-hover');
  hoverLabel.hidden = true;
  Object.assign(hoverLabel.style, { position: 'absolute', pointerEvents: 'none', zIndex: '1', maxWidth: 'calc(100% - 16px)', padding: '6px 8px', border: '1px solid var(--control-line)', borderRadius: '6px', background: 'var(--panel)', color: 'var(--text)', font: '12px system-ui', whiteSpace: 'pre-line' });
  canvasWrap.append(canvas, hoverLabel);
  const sidebar = make('aside', '', '', 'source-seat-sidebar');
  const search = make('form', '', '', 'source-seat-search-form');
  const searchLabel = make('label', '', '좌석 기호 찾기');
  searchLabel.htmlFor = 'source-seat-search';
  const query = make('input', 'source-seat-search');
  query.type = 'search'; query.maxLength = 100; query.autocomplete = 'off';
  query.placeholder = '도면 표기 또는 기호 이름';
  const searchButton = button('source-seat-search-button', '찾기'); searchButton.type = 'submit';
  search.append(searchLabel, query, searchButton);
  const results = make('div', 'source-seat-results', '', 'source-seat-results');
  results.setAttribute('role', 'group'); results.setAttribute('aria-label', '일치하는 좌석 기호');
  const candidates = make('div', 'source-seat-candidates', '', 'source-seat-candidates');
  candidates.hidden = true; candidates.setAttribute('role', 'group'); candidates.setAttribute('aria-label', '가까운 좌석 기호 중 선택');
  sidebar.append(search, results, candidates);
  body.append(canvasWrap, sidebar);
  const selectionLabel = make('strong', 'source-seat-selection', '선택한 좌석 기호 없음');
  const count = make('span', 'source-seat-count', '', 'source-seat-count');
  const numberHint = make('span', 'source-seat-number-hint', '번호는 +로 확대하거나 기호를 선택해 확인', 'source-seat-count');
  numberHint.hidden = true;
  const status = make('p', 'source-seat-status', '', 'source-seat-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const referenceNote = make('p', 'source-seat-reference-note', '회색 WC: 참고기호 · 선택 불가', 'source-seat-reference-note');
  referenceNote.hidden = true;
  const wheelchairNote = make('p', 'source-seat-wheelchair-note', '', 'source-seat-reference-note');
  wheelchairNote.hidden = true;
  const readingNote = make('p', 'source-seat-reading-legend', '', 'source-seat-reading-legend');
  readingNote.hidden = true;
  const worksheetLegend = make('p', 'source-seat-worksheet-legend', '', 'source-seat-worksheet-legend');
  worksheetLegend.hidden = true;
  const help = make('p', 'source-seat-help', '드래그 · 휠/두 손가락 확대 · 방향키 · Home 전체 보기', 'source-seat-help');
  sourceInfoContent.append(sourceInfoDescription, scope, referenceNote, wheelchairNote, readingNote, worksheetLegend);
  root.append(heading, toolbar, worksheetTools, body, selectionLabel, count, numberHint, status, help);
  container.append(root);

  let plan = null, frameId = '', view = '2d', destroyed = false, queued = 0, projectedSeats = [], renderedLabels = [];
  let worksheetRowFocus = '';
  let selectedByFrame = new Map(), lastNotified = '';
  const initialViews = () => ({
    '2d': { zoom: 1, panX: 0, panY: 0 },
    '3d': { zoom: 1, panX: 0, panY: 0, yawDeg: 28, elevationDeg: 55 },
  });
  let cameras = initialViews(), drag = null, pinch = null, wasMultiTouch = false;
  const pointers = new Map(), disposers = [];
  const listen = (element, type, listener, options) => {
    element.addEventListener(type, listener, options);
    disposers.push(() => element.removeEventListener(type, listener, options));
  };
  const activeFrame = () => plan?.frames.find(frame => frame.id === frameId) || null;
  let choiceRestored = false, choicePersisted = false;
  const choiceStorage = () => {
    try { return selectionStorage === undefined ? doc.defaultView?.localStorage : selectionStorage; }
    catch { return null; }
  };
  function rememberChoice() {
    if (!sourcePlanChoiceKey(plan)) return;
    choicePersisted = writeSourcePlanChoice(plan,
      snapshotSourcePlanChoice(plan, { frameId, selectedByFrame }), choiceStorage());
  }
  const isWorksheet = frame => Boolean(frame?.worksheetGeometry && typeof frame.worksheetGeometry === 'object');
  const seatRow = seat => sourceText(seat.sourceLabels?.rowLabel ?? seat.rowLabel);
  const isCapturePlan = () => plan?.variantProfile?.variantKind === 'user_capture';
  const captureRows = frame => {
    if (!isCapturePlan() || !frame) return [];
    const rows = new Map();
    for (const seat of frame.seats) {
      const row = seatRow(seat); if (!row) continue;
      const section = sourceText(seat.sourceLabels?.section);
      const key = JSON.stringify([sourceText(seat.sourceLabels?.floorLabel), section, row]);
      if (!rows.has(key)) rows.set(key, { key, row, section, label: `${section ? section + ' ' : ''}${row.endsWith('열') ? row : row + '열'}`, seats: [] });
      rows.get(key).seats.push(seat);
    }
    return [...rows.values()];
  };
  const worksheetRows = frame => !isWorksheet(frame) ? [] : [...new Set(frame.seats.map(seatRow).filter(Boolean))];
  const worksheetSectionNames = frame => !isWorksheet(frame) ? [] : [...new Set(frame.seats.map(seat => sourceText(seat.sourceLabels?.section)).filter(Boolean))];
  function updateWorksheetControls() {
    const frame = activeFrame(), worksheet = isWorksheet(frame), rows = worksheetRows(frame), sections = worksheetSectionNames(frame);
    const capture = isCapturePlan(), captureChoices = captureRows(frame);
    worksheetTools.hidden = !worksheet && !capture; worksheetLegend.hidden = !worksheet;
    worksheetRowLabel.firstChild.textContent = capture ? '구역·열 ' : '열 확대';
    worksheetRow.setAttribute('aria-label', capture ? '구역과 열 선택' : '원문 열 확대');
    worksheetSections.textContent = capture ? `전체 ${captureChoices.length}열` : worksheet ? `원문 구역: ${sections.join(' · ')}` : '';
    worksheetRow.replaceChildren(); const placeholder = make('option', '', '전체 보기'); placeholder.value = ''; worksheetRow.append(placeholder);
    for (const row of rows) { const option = make('option', '', row.endsWith('열') ? row : `${row}열`); option.value = row; worksheetRow.append(option); }
    for (const row of captureChoices) { const option = make('option', '', row.label); option.value = row.key; worksheetRow.append(option); }
    worksheetRow.value = worksheetRowFocus;
    const legend = !worksheet ? [] : [...new Set((frame.annotations || []).filter(mark => mark.kind !== 'stage').map(mark => sourceText(mark.label))
      .filter(text => text && !sections.includes(text) && !/^\d+열$/.test(text) && !text.includes('좌석배치도')))];
    worksheetLegend.textContent = worksheet ? `원문 범례: ${legend.join(' · ')} · 개별 좌석 분류 미확인` : '';
  }
  const stageMarkers = frame => Array.isArray(frame?.annotations) ? frame.annotations.filter(mark =>
    mark && mark.kind === 'stage' && typeof mark.label === 'string' && mark.label.trim() && Number.isFinite(mark.x) && Number.isFinite(mark.z)).map(mark => isCapturePlan() && mark.label === 'STAGE · 원문 도식' ? { ...mark, label: 'STAGE', sourceLabel: mark.label } : mark) : [];
  const sourceGuideMarkers = frame => !Array.isArray(frame?.annotations) ? [] : frame.annotations.flatMap(mark => {
    const box = mark?.sourceBBox;
    if (mark?.kind !== 'source_stairs_label' || !/^(Stairs|계단)$/i.test(mark.label || '') ||
      !Number.isFinite(mark.x) || !Number.isFinite(mark.z) || !Array.isArray(box) || box.length !== 4 ||
      !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1] ||
      mark.x < box[0] || mark.x > box[2] || mark.z < box[1] || mark.z > box[3]) return [];
    return [{ ...mark, description: `${mark.label} · 계단 표식 · 선택 불가` }];
  });
  const sourceGuideAt = (frame, point) => sourceGuideMarkers(frame).find(mark =>
    point.x >= mark.sourceBBox[0] && point.x <= mark.sourceBBox[2] && point.z >= mark.sourceBBox[1] && point.z <= mark.sourceBBox[3]);
  const sourceGuideLabelAt = (frame, point) => {
    const label = renderedLabels.find(item => item.kind === 'source-guide' &&
      point.x >= item.left && point.x <= item.right && point.y >= item.top && point.y <= item.bottom);
    return label && sourceGuideMarkers(frame).find(mark => mark.id === label.sourceGuideId);
  };
  // Reference glyphs retain their source bounds. They never enter the seat hit
  // list, search results, selection count or selection callback.
  const referenceMarks = frame => !Array.isArray(frame?.referenceMarks) ? [] : frame.referenceMarks.flatMap(mark => {
    const original = mark?.source?.metadata?.originalFields;
    const box = mark?.sourceBBox ?? original?.sourceBBox;
    const kind = mark?.kind ?? original?.kind;
    if (mark?.selectable !== false || !['wheelchair_symbol', 'unknown_symbol', 'console', 'bar_table', 'other_floor_area'].includes(kind) ||
      !Number.isFinite(mark.x) || !Number.isFinite(mark.z) || !Array.isArray(box) || box.length !== 4 ||
      !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) return [];
    const sourceLabel = sourceText(mark.label ?? original?.label).slice(0, 24);
    const capture = plan?.variantProfile?.variantKind === 'user_capture';
    const displayKind = kind === 'wheelchair_symbol' ? 'wheelchair' : kind === 'console' ? 'console' : kind === 'bar_table' ? 'bar-table' : kind === 'other_floor_area' ? 'other-floor-area' : capture && /^accessibility-outline-/.test(mark.id || '') ? 'outline' : capture && mark.id === 'source-console' && sourceLabel === 'CONSOLE' ? 'console' : 'unknown';
    const label = displayKind === 'wheelchair' ? '♿' : displayKind === 'outline' ? '' : displayKind === 'console' ? '콘솔' : sourceLabel || '?';
    return [{ id: typeof mark.id === 'string' ? mark.id : '', x: mark.x, z: mark.z, kind, label, sourceLabel, displayKind,
      description: displayKind === 'wheelchair' ? '휠체어 표식 · 번호 미확인 · 선택 불가' : displayKind === 'console' ? '콘솔 · 좌석 아님' : displayKind === 'bar-table' ? '바 테이블 · 좌석 아님' : displayKind === 'other-floor-area' ? `${label} 안내 · 이 도면의 선택 좌석 아님` : displayKind === 'outline' ? '원문 보조선 · 선택 불가' : `${label} · 의미 미확인 표식 · 선택 불가`,
      outline: [{ x: box[0], z: box[1] }, { x: box[2], z: box[1] }, { x: box[2], z: box[3] }, { x: box[0], z: box[3] }] }];
  });
  const referenceAt = (frame, point) => referenceMarks(frame).find(mark =>
    point.x >= mark.outline[0].x && point.x <= mark.outline[2].x && point.z >= mark.outline[0].z && point.z <= mark.outline[2].z);
  // A capture outline is a reference around existing seat glyphs, not a mask.
  // Only a true interior seat hit may pass through an unknown reference box;
  // WC pictograms, console-only space and nearby outside hits remain references.
  const interactionReferenceAt = (frame, point) => {
    const mark = referenceAt(frame, point);
    if (mark?.kind === 'unknown_symbol' && plan?.variantProfile?.variantKind === 'user_capture'
        && hitSourcePlanSeats(frame, point, 0).some(hit => hit.inside)) return null;
    return mark;
  };
  const currentSeat = () => activeFrame()?.seats.find(seat => seat.id === selectedByFrame.get(frameId)) || null;
  const getSelection = () => {
    const seat = currentSeat();
    return seat ? { informationRecordId: plan.informationRecordId, frameId, seat: JSON.parse(JSON.stringify(seat)) } : null;
  };
  function getMediaContext() {
    const selection = getSelection();
    if (!selection || !plan) return null;
    const sourceHash = /^[a-f0-9]{64}$/.test(plan.source?.inputSha256 || '') ? plan.source.inputSha256 : null;
    const sourceSnapshot = sourceHash ? `source-snapshot:${sourceHash}` : null;
    // A source snapshot namespace is an internal version identity, never a
    // claim of measured geometry or an official/current layout version.
    return normalizeSeatMediaContext({ kind: 'source2d', informationRecordId: plan.informationRecordId,
      layoutVersionId: plan.layoutVersionId || sourceSnapshot,
      configurationKey: plan.selectionContext?.key || sourceSnapshot,
      frameId: selection.frameId, seatId: selection.seat.id,
      venueName: plan.title.slice(0, 500), seatLabel: String(seatDisplayLabel(selection.seat) || '선택한 기호').slice(0, 500) });
  }
  function notifySelection() {
    const selection = getSelection(), key = sameSelection(selection);
    if (key === lastNotified) return;
    lastNotified = key; onSelection(selection);
  }
  function cancelPointers() {
    const previous = [...pointers.keys()]; pointers.clear(); drag = null; pinch = null; wasMultiTouch = false;
    for (const id of previous) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function queueDraw() {
    if (!destroyed && plan && !queued) queued = requestAnimationFrame(() => { queued = 0; draw(); });
  }
  const corners = seat => {
    // This is the original drawing cell, not an inferred physical chair yaw.
    if (Array.isArray(seat.drawingOutline) && seat.drawingOutline.length >= 3 &&
      seat.drawingOutline.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z))) {
      return seat.drawingOutline.map(point => ({ x: point.x, z: point.z }));
    }
    const angle = radians(seat.rotationDeg ?? 0), cosine = Math.cos(angle), sine = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const dx = u * seat.widthM / 2, dz = v * seat.depthM / 2;
      return { x: seat.x + cosine * dx - sine * dz, z: seat.z + sine * dx + cosine * dz };
    });
  };
  function projection() {
    const frame = activeFrame(); if (!frame) return null;
    const rectangle = canvas.getBoundingClientRect();
    const width = Math.max(1, rectangle.width || canvas.clientWidth || 480);
    const height = Math.max(1, rectangle.height || canvas.clientHeight || 390);
    const points = [...frame.stagePolygon, ...frame.seats.flatMap(corners), ...stageMarkers(frame), ...sourceGuideMarkers(frame), ...referenceMarks(frame).flatMap(mark => mark.outline)];
    if (!points.length) return null;
    const xMin = Math.min(...points.map(point => point.x)), xMax = Math.max(...points.map(point => point.x));
    const zMin = Math.min(...points.map(point => point.z)), zMax = Math.max(...points.map(point => point.z));
    const centerX = (xMin + xMax) / 2, centerZ = (zMin + zMax) / 2, camera = cameras[view];
    const angle = view === '3d' ? radians(camera.yawDeg) : 0;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const vertical = view === '3d' ? Math.sin(radians(camera.elevationDeg)) : 1;
    const plane = point => ({
      x: cosine * (point.x - centerX) + sine * (point.z - centerZ),
      y: (-sine * (point.x - centerX) + cosine * (point.z - centerZ)) * vertical,
    });
    const projected = points.map(plane);
    const left = Math.min(...projected.map(point => point.x)), right = Math.max(...projected.map(point => point.x));
    const top = Math.min(...projected.map(point => point.y)), bottom = Math.max(...projected.map(point => point.y));
    const hasGuides = frame.seats.some(seat => sourceText(seat.sourceLabels?.rowLabel ?? seat.rowLabel) || sourceText(seat.sourceLabels?.section));
    const fitScale = Math.max(.001, Math.min(Math.max(1, width - (hasGuides ? 120 : 48)) / Math.max(.01, right - left), Math.max(1, height - 64) / Math.max(.01, bottom - top)));
    const scale = fitScale * camera.zoom;
    const originX = width / 2 + camera.panX, originY = height / 2 + camera.panY;
    return {
      width, height, scale, vertical,
      map(point) { const p = plane(point); return { x: originX + p.x * scale, y: originY + p.y * scale }; },
      inverse(point) {
        const horizontal = (point.x - originX) / scale, depth = (point.y - originY) / (scale * vertical);
        return { x: centerX + cosine * horizontal - sine * depth, z: centerZ + sine * horizontal + cosine * depth };
      },
    };
  }
  function clearCandidates() { candidates.replaceChildren(); candidates.hidden = true; }
  function clearSurface() {
    projectedSeats = []; renderedLabels = []; canvas.dataset.visibleSeatCount = '0';
    canvas.dataset.localRowGuides='[]';canvas.dataset.localRowCandidateCounts='[]';canvas.dataset.localRowSearchVisits='0';canvas.dataset.rowLeaderLineCount='0';
    for (const name of ['numberLabelCount', 'knownNumberCount', 'visibleKnownNumberCount', 'numberFontSize', 'rowLabelCount', 'rowLabelTotal', 'sectionLabelCount', 'sectionLabelTotal', 'outlineSeatCount']) canvas.dataset[name] = '0';
    for (const name of ['rowLabels', 'sectionLabels', 'rowLabelKeys', 'numberLabelIds']) canvas.dataset[name] = '[]';
    canvas.dataset.referenceMarkCount = '0'; canvas.dataset.visibleReferenceMarkCount = '0'; canvas.dataset.referenceMarkIds = '[]';
    canvas.dataset.sourceGuideMarkerCount = '0'; canvas.dataset.sourceGuideRenderedCount = '0';
    canvas.dataset.sourceGuideMarkerLabels = '[]'; canvas.dataset.sourceGuideMarkerIds = '[]';
    canvas.dataset.worksheet = 'false'; canvas.dataset.worksheetRowChoices = '[]'; canvas.dataset.worksheetRowFocus = '';
    canvas.dataset.emptyCellCount = '0'; canvas.dataset.worksheetMergeCount = '0'; canvas.dataset.worksheetSourceAnnotationCount = '0';
    canvas.dataset.readingDirectCount = '0'; canvas.dataset.readingAutoCount = '0'; canvas.dataset.readingUnreadCount = '0';
    canvas.dataset.selectionContextKey = ''; canvas.dataset.choiceRestored = 'false'; canvas.dataset.choicePersisted = 'false';
    canvas.dataset.numberLabelMode = 'none'; numberHint.hidden = true;
    canvas.dataset.selectedNumberPresentation = ''; canvas.dataset.captureRowChoices = '[]';
    canvas.dataset.selectableWheelchairCount = '0'; canvas.dataset.visibleWheelchairCount = '0'; canvas.dataset.wheelchairMarkerCount = '0'; canvas.dataset.compactWheelchairCount = '0'; canvas.dataset.unmarkedWheelchairCount = '0';
    canvas.dataset.selectableWheelchairIds = '[]'; canvas.dataset.wheelchairMarkerIds = '[]';
    wheelchairNote.textContent = ''; wheelchairNote.hidden = true; clearHover();
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
  function updateSelectionDisplay() {
    const frame = activeFrame(), seat = currentSeat();
    const markers = stageMarkers(frame), marker = markers[0], references = referenceMarks(frame);
    // A shared-sheet direction guide is UI guidance, not a second printed
    // stage label or a fabricated stage outline in this floor's source plane.
    const directionGuides = [...new Set((frame?.annotations || []).filter(mark =>
      mark?.kind === 'stage_direction' && /^무대 방향 [↑↓←→]$/.test(mark.label || '')).map(mark => mark.label))];
    const directionGuide = directionGuides.length === 1 ? directionGuides[0] : '';
    direction.textContent=directionGuide||(marker?'원문 무대 표식':frame?.stagePolygon.length>=3?'무대 표시':frame?.directionStatus==='not_separately_marked_in_source'?'무대 방향 별도 표기 없음':'');
    canvas.dataset.stageDirectionGuideLabel = directionGuide;
    canvas.dataset.stageMarkerCount=String(markers.length);canvas.dataset.stageMarkerX=marker?String(marker.x):'';canvas.dataset.stageMarkerZ=marker?String(marker.z):'';
    canvas.dataset.stageMarkerLabels = JSON.stringify(markers.map(mark => mark.label));
    const sourceGuides = sourceGuideMarkers(frame);
    canvas.dataset.sourceGuideMarkerCount = String(sourceGuides.length);
    canvas.dataset.sourceGuideMarkerLabels = JSON.stringify(sourceGuides.map(mark => mark.label));
    canvas.dataset.sourceGuideMarkerIds = JSON.stringify(sourceGuides.map(mark => mark.id));
    canvas.dataset.referenceMarkCount = String(references.length); canvas.dataset.referenceMarkIds = JSON.stringify(references.map(mark => mark.id));
    referenceNote.hidden = references.length === 0;
    referenceNote.textContent = [...new Set(references.map(mark => mark.description))].join(' / ');
    const wheelchairs = frame?.seats.filter(isSelectableWheelchair) || [];
    wheelchairNote.hidden = wheelchairs.length === 0;
    wheelchairNote.textContent = wheelchairs.length ? `♿ 휠체어 기호 ${wheelchairs.length}개 · 위치 선택` : '';
    canvas.dataset.selectableWheelchairCount = String(wheelchairs.length);
    canvas.dataset.selectableWheelchairIds = JSON.stringify(wheelchairs.map(seat => seat.id));
    const worksheet = isWorksheet(frame), readings = frame?.seats.filter(seat => seat.numberReading && typeof seat.numberReading.status === 'string') || [];
    const readingDirect = readings.filter(seat => seat.numberReading.status === 'direct_manual_seed_read').length;
    const readingAuto = readings.filter(seat => seat.numberReading.status.startsWith('unique_exact_pixel_template_match')).length;
    const readingUnread = readings.filter(seat => seat.sourceLabels?.numberText === null).length;
    readingNote.hidden = readings.length === 0;
    readingNote.textContent = readings.length ? `번호 표시 ${readings.length - readingUnread} · 번호 미확인 ${readingUnread} (점선 기호)` : '';
    badge.hidden = !plan;
    const sourceHelpNotes = Array.isArray(plan?.presentation?.helpNotes) ? plan.presentation.helpNotes.map(sourceText).filter(Boolean) : [];
    scope.textContent = [sourceText(plan?.presentation?.notice), ...sourceHelpNotes].filter(Boolean).join(' '); scope.hidden = !scope.textContent;
    sourceInfoDescription.textContent = plan ? plan.title + (isCapturePlan() ? ' · 사용자 제공 공연별 좌석도. 번호가 확인된 10곳 외에는 번호를 추정하지 않습니다. 휠체어 표식과 콘솔은 별도 참고 표식이며 좌석 수에 더하지 않습니다.' : '') : '';
    selectionLabel.textContent = seat ? `선택: ${seatDisplayLabel(seat)}` : '선택한 좌석 기호 없음';
    count.textContent = frame ? `기호 ${frame.seats.length}개 · 선택 ${seat ? 1 : 0}개` : '';
    Object.assign(canvas.dataset, {
      informationRecordId: plan?.informationRecordId || '', frameId, view,
      unitScope: plan?.unitScope || '',
      selectionContextKey: plan?.selectionContext?.key || '', choiceRestored: String(choiceRestored), choicePersisted: String(choicePersisted),
      seatCount: String(frame?.seats.length || 0), selectedId: seat?.id || '',
      selectedLabel: seat ? seatDisplayLabel(seat) : '', selectedDisplayLabel: seat ? seatDisplayLabel(seat) : '',
      zoom: String(cameras[view].zoom), yaw: String(cameras['3d'].yawDeg), elevation: String(cameras['3d'].elevationDeg),
      worksheet: String(worksheet), worksheetRowChoices: JSON.stringify(worksheetRows(frame)), worksheetRowFocus,
      captureRowChoices: JSON.stringify(captureRows(frame).map(({ key, label }) => ({ key, label }))),
      emptyCellCount: String(worksheet && Array.isArray(frame.emptyCellOutlines) ? frame.emptyCellOutlines.length : 0),
      worksheetMergeCount: String(worksheet && Array.isArray(frame.worksheetGeometry.mergesRowFirstLastColFirstLast) ? frame.worksheetGeometry.mergesRowFirstLastColFirstLast.length : 0),
      worksheetSourceAnnotationCount: String(worksheet && Array.isArray(frame.annotations) ? frame.annotations.length : 0),
      readingDirectCount: String(readingDirect), readingAutoCount: String(readingAuto), readingUnreadCount: String(readingUnread),
    });
    zoomLabel.textContent = `${Math.round(cameras[view].zoom * 100)}%`;
    for (const [name, control] of [['2d', flat], ['3d', orbit]]) {
      control.setAttribute('aria-pressed', String(view === name));
      control.tabIndex = view === name ? 0 : -1;
    }
    for (const choice of root.querySelectorAll('[data-source-seat-id]')) {
      choice.setAttribute('aria-pressed', String(choice.dataset.sourceSeatId === seat?.id && choice.dataset.frameId === frameId));
    }
    canvas.setAttribute('aria-label', frame ? `${plan.title}, ${frame.label}, ${view === '2d' ? '2D 평면' : '회전 가능한 도면 평면'}. ${plan.unitScope === 'selection_diagram' ? '좌석 배치도, 거리 비례 아님. ' : ''}좌석 기호 ${frame.seats.length}개. ${wheelchairs.length ? `휠체어 기호 ${wheelchairs.length}개, 위치 선택. ` : ''}${references.length ? `${references.every(mark => mark.kind === 'wheelchair_symbol') ? '별도 휠체어 참고기호' : '별도 참고기호'} ${references.length}개, 선택 불가. ` : ''}${seat ? `${seatDisplayLabel(seat)} 선택.` : '선택 없음.'}` : '좌석 도면 없음');
  }
  function draw() {
    if (!plan || destroyed || root.hidden) return;
    updateSelectionDisplay();
    const frame = activeFrame(), project = projection(), ctx = canvas.getContext('2d');
    if (!ctx) { clearSurface(); status.textContent = '좌석 도면을 표시할 수 없습니다.'; return; }
    if (!project) { clearSurface(); status.textContent = '등록된 좌석 기호가 없습니다.'; return; }
    const dpr = clamp(globalThis.devicePixelRatio || 1, 1, 3);
    const pixelWidth = Math.round(project.width * dpr), pixelHeight = Math.round(project.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(root), color = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const background = color('--panel-deep', '#eef0f3'), surface = color('--panel', '#fff');
    const line = color('--control-line', '#9ba5b4'), ink = color('--text', '#26313e'), accent = color('--accent', '#3a6fd8');
    renderedLabels = [];
    const textLabel = (kind, text, x, y, width, height, extra = {}) => renderedLabels.push({ kind, text, left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2, ...extra });
    ctx.clearRect(0, 0, project.width, project.height); ctx.fillStyle = background; ctx.fillRect(0, 0, project.width, project.height);
    const path = points => { ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath(); };
    if (frame.stagePolygon.length >= 3) {
      const polygon = frame.stagePolygon.map(project.map); path(polygon);
      ctx.fillStyle = surface; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.stroke();
      const center = polygon.reduce((result, point) => ({ x: result.x + point.x / polygon.length, y: result.y + point.y / polygon.length }), { x: 0, y: 0 });
      if (!stageMarkers(frame).length) {
        ctx.fillStyle = ink; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('무대', center.x, center.y);
        textLabel('stage', '무대', center.x, center.y, ctx.measureText('무대').width, 14);
      }
    }
    const stageLabels = [];
    ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const marker of stageMarkers(frame)) {
      const p = project.map(marker), lines = [''], maxTextWidth = Math.max(1, project.width - 18);
      for (const character of marker.label) {
        const last = lines.length - 1;
        if (lines[last] && ctx.measureText(lines[last] + character).width > maxTextWidth) lines.push(character);
        else lines[last] += character;
      }
      const width = Math.min(project.width - 6, Math.max(...lines.map(text => ctx.measureText(text).width)) + 12), height = lines.length * 18 + 8;
      const x = clamp(p.x, width / 2 + 3, project.width - width / 2 - 3);
      const minY = height / 2 + 3, maxY = Math.max(minY, project.height - height / 2 - 3), preferredY = clamp(p.y, minY, maxY);
      const positions = [preferredY, ...stageLabels.flatMap(label => [label.top - 4 - height / 2, label.bottom + 4 + height / 2])]
        .map(y => clamp(y, minY, maxY)).sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY));
      const y = positions.find(y => stageLabels.every(label => x + width / 2 + 4 <= label.left || x - width / 2 >= label.right + 4 || y + height / 2 + 4 <= label.top || y - height / 2 >= label.bottom + 4)) ?? preferredY;
      stageLabels.push({ marker, p, lines, x, y, width, height, left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 });
    }
    // Keep displaced stage callouts above seats instead of placing them over chairs.
    const stageSeatBounds = frame.seats.map(seat => {
      const points = corners(seat).map(project.map), center = project.map(seat);
      return { left: Math.min(...points.map(point => point.x), center.x - 3), right: Math.max(...points.map(point => point.x), center.x + 3), top: Math.min(...points.map(point => point.y), center.y - 3), bottom: Math.max(...points.map(point => point.y), center.y + 3) };
    });
    const stageOverlapsSeat = label => stageSeatBounds.some(seat => label.left < seat.right + 2 && label.right > seat.left - 2 && label.top < seat.bottom + 2 && label.bottom > seat.top - 2);
    if (stageLabels.length > 1 && stageLabels.some(stageOverlapsSeat)) {
      const groupHeight = stageLabels.reduce((sum, label) => sum + label.height, 0) + (stageLabels.length - 1) * 4;
      const groupWidth = Math.max(...stageLabels.map(label => label.width)), minX = groupWidth / 2 + 3, maxX = project.width - groupWidth / 2 - 3;
      const preferredX = clamp(stageLabels.reduce((sum, label) => sum + label.x, 0) / stageLabels.length, minX, maxX);
      const positions = [preferredX, project.width / 2, minX, maxX];
      let safeGroup = null;
      for (let top = 3; !safeGroup && top + groupHeight <= project.height - 3; top += 4) {
        for (const x of positions) {
          let y = top;
          const labels = stageLabels.map(label => {
            const next = { ...label, x, y: y + label.height / 2, left: x - label.width / 2, right: x + label.width / 2, top: y, bottom: y + label.height };
            y += label.height + 4; return next;
          });
          if (!labels.some(stageOverlapsSeat)) { safeGroup = labels; break; }
        }
      }
      if (safeGroup) stageLabels.splice(0, stageLabels.length, ...safeGroup);
    }
    // Paint connectors first so a shifted marker cannot draw through another label.
    for (const label of stageLabels) {
      const x = clamp(label.p.x, label.left, label.right), y = clamp(label.p.y, label.top, label.bottom);
      if (x !== label.p.x || y !== label.p.y) { ctx.beginPath(); ctx.moveTo(label.p.x, label.p.y); ctx.lineTo(x, y); ctx.strokeStyle = line; ctx.lineWidth = .8; ctx.stroke(); }
    }
    for (const label of stageLabels) textLabel('stage', label.marker.label, label.x, label.y, label.width, label.height);
    let visibleReferenceCount = 0;
    for (const mark of referenceMarks(frame)) {
      const outline = mark.outline.map(project.map), center = project.map(mark);
      const left = Math.min(...outline.map(p => p.x)), right = Math.max(...outline.map(p => p.x));
      const top = Math.min(...outline.map(p => p.y)), bottom = Math.max(...outline.map(p => p.y));
      if (right < 0 || bottom < 0 || left > project.width || top > project.height) continue;
      visibleReferenceCount++;
      const cellWidth = right - left, cellHeight = bottom - top;
      if (mark.displayKind !== 'wheelchair') {
        path(outline);
        // The source accessibility box is an unfilled outline, not generated text across seats.
        if (mark.displayKind !== 'outline') { ctx.fillStyle = '#d9dde1'; ctx.fill(); }
        ctx.strokeStyle = '#7c838b'; ctx.lineWidth = .8; ctx.stroke();
      }
      let fontSize = mark.displayKind === 'wheelchair' ? Math.min(16, cellWidth - 2, cellHeight - 2) : Math.min(12, cellHeight - 3);
      if (mark.label && fontSize >= 9) {
        ctx.font = `${fontSize}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const labelWidth = ctx.measureText(mark.label).width;
        if (labelWidth + 3 <= cellWidth) {
          ctx.save(); path(outline); ctx.clip(); ctx.fillStyle = '#4f565e'; ctx.fillText(mark.label, center.x, center.y); ctx.restore();
          textLabel('reference', mark.label, center.x, center.y, labelWidth, fontSize + 1, { referenceId: mark.id, selectable: false });
        }
      } else if (mark.displayKind === 'wheelchair') {
        // A small non-seat diamond fits the original pictogram bounds; help/hover gives its meaning.
        const half = Math.max(.5, Math.min(3, cellWidth / 2 - 1, cellHeight / 2 - 1));
        path([{x:center.x,y:center.y-half},{x:center.x+half,y:center.y},{x:center.x,y:center.y+half},{x:center.x-half,y:center.y}]);
        ctx.strokeStyle = '#4f565e'; ctx.lineWidth = .8; ctx.stroke();
      }
    }
    canvas.dataset.visibleReferenceMarkCount = String(visibleReferenceCount);
    const selected = currentSeat(); let visibleCount = 0; projectedSeats = [];
    const visibleSeats = [], overlaps = (a, b, gap = 2) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
    const drawSeat = seat => {
      const polygon = corners(seat).map(project.map);
      const xMin = Math.min(...polygon.map(p => p.x)), xMax = Math.max(...polygon.map(p => p.x));
      const yMin = Math.min(...polygon.map(p => p.y)), yMax = Math.max(...polygon.map(p => p.y));
      const center = project.map(seat);
      // Tiny source text boxes need a pointer affordance; world geometry and hit candidates stay unchanged.
      const width = Math.max(6, xMax - xMin), height = Math.max(6, yMax - yMin);
      const bounds = { left: Math.min(xMin, center.x - width / 2), right: Math.max(xMax, center.x + width / 2), top: Math.min(yMin, center.y - height / 2), bottom: Math.max(yMax, center.y + height / 2) };
      const visible = !(bounds.right < 0 || bounds.bottom < 0 || bounds.left > project.width || bounds.top > project.height);
      projectedSeats.push({ id: seat.id, sourceGeometryId: seat.sourceGeometryId, frameId, x: center.x, y: center.y, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top, visible, selected: seat.id === selected?.id });
      if (!visible) return;
      visibleSeats.push({ seat, center, bounds, width, height, polygon,
        sourceBounds: { left: xMin, right: xMax, top: yMin, bottom: yMax } });
      visibleCount++;
      if (xMax - xMin < 6 || yMax - yMin < 6) path([{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }]);
      else path(polygon);
      ctx.fillStyle = seat.id === selected?.id ? accent : surface; ctx.fill();
      const focusedRow = isWorksheet(frame) && worksheetRowFocus && seatRow(seat) === worksheetRowFocus;
      const unread = Boolean(seat.numberReading && seat.sourceLabels?.numberText === null);
      ctx.strokeStyle = seat.id === selected?.id || focusedRow ? ink : line; ctx.lineWidth = seat.id === selected?.id ? 2 : focusedRow ? 1.4 : .8;
      if (unread) ctx.setLineDash?.([2, 2]);
      ctx.stroke(); if (unread) ctx.setLineDash?.([]);
    };
    for (const seat of frame.seats) if (seat.id !== selected?.id) drawSeat(seat);
    if (selected) drawSeat(selected);
    const occupiedLabels = renderedLabels.map(label => ({ ...label })), numberLabels = [], guideLabels = [];
    const withinCanvas = box => box.left >= 3 && box.top >= 3 && box.right <= project.width - 3 && box.bottom <= project.height - 3;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // One font and one simultaneous test for all visible source numbers: never sample alternate rows by draw order.
    const knownNumbers = visibleSeats.filter(record => sourceText(record.seat.sourceLabels?.numberText) && record.center.x >= 0 && record.center.x <= project.width && record.center.y >= 0 && record.center.y <= project.height);
    let numberFontSize = 0, numberBoxes = [];
    for (const size of isCapturePlan() ? [16, 14, 12, 10] : [16, 14, 12, 10, 9, 8]) {
      ctx.font = `${size}px system-ui`;
      const boxes = knownNumbers.map(record => {
        const text = sourceText(record.seat.sourceLabels.numberText), metrics = ctx.measureText(text), width = metrics.width + 1, { x, y } = record.center;
        if (isCapturePlan()) {
          const edge = (record.seat.id === selected?.id ? .75 : 0) + .5;
          const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : width / 2;
          const right = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : width / 2;
          const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : (size + 1) / 2;
          const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : (size + 1) / 2;
          return { record, text, left: x - left - edge, right: x + right + edge, top: y - ascent - edge, bottom: y + descent + edge };
        }
        return { record, text, left: x - width / 2, right: x + width / 2, top: y - (size + 1) / 2, bottom: y + (size + 1) / 2 };
      });
      // Sparse capture numbers must still fit their own source glyph. If they
      // cannot, keep the number in the selected-seat detail instead of spilling
      // over anonymous neighbors. Other drawing consumers keep their policy.
      const captureFits = !isCapturePlan() || boxes.every(box =>
        box.left >= box.record.bounds.left + 2 && box.right <= box.record.bounds.right - 2 &&
        box.top >= box.record.bounds.top + 2 && box.bottom <= box.record.bounds.bottom - 2);
      if (captureFits && !boxes.some((box, index) => boxes.slice(index + 1).some(other => overlaps(box, other, .5)))) { numberFontSize = size; numberBoxes = boxes; break; }
    }
    ctx.font = `${numberFontSize || 10}px system-ui`;
    for (const box of numberBoxes) {
      const { record, text } = box;
      occupiedLabels.push(box); numberLabels.push(record.seat.id);
    }
    const groups = (kind, valueFor) => {
      const grouped = new Map();
      for (const record of visibleSeats) {
        const value = valueFor(record.seat); if (!value) continue;
        const section = kind === 'row' && isWorksheet(frame) ? '' : sourceText(record.seat.sourceLabels?.section);
        const key = JSON.stringify([sourceText(record.seat.sourceLabels?.floorLabel), kind === 'row' ? section : '', value]);
        if (!grouped.has(key)) grouped.set(key, { kind, value, key, section, records: [] });
        grouped.get(key).records.push(record);
      }
      return [...grouped.values()];
    };
    // Explicit selectable WC glyphs are a display overlay only: source geometry,
    // hit windows, identities and the simultaneous number policy stay unchanged.
    const wheelchairMarkers = []; let compactWheelchairCount = 0;
    for (const record of visibleSeats.filter(record => isSelectableWheelchair(record.seat)).sort((a, b) => a.seat.id.localeCompare(b.seat.id))) {
      const numbered = Boolean(sourceText(record.seat.sourceLabels?.numberText));
      const selectedWC = record.seat.id === selected?.id;
      if (!numbered) {
        // Fit the actual emoji ink inside the original cell, not its minimum
        // pointer affordance. Dense cells use a compact cue and the same detail
        // readout; source coordinates and hit candidates never change.
        const cell = record.sourceBounds, { x, y } = record.center;
        let pictogram = null;
        for (const size of [14, 12, 10]) {
          ctx.font = `600 ${size}px system-ui`;
          const metrics = ctx.measureText('♿');
          const left = metrics.actualBoundingBoxLeft ?? metrics.width / 2;
          const right = metrics.actualBoundingBoxRight ?? metrics.width / 2;
          const ascent = metrics.actualBoundingBoxAscent ?? size / 2;
          const descent = metrics.actualBoundingBoxDescent ?? size / 2;
          const box = { left: x - left - 1, right: x + right + 1, top: y - ascent - 1, bottom: y + descent + 1 };
          if (box.left >= cell.left + 1 && box.right <= cell.right - 1 && box.top >= cell.top + 1 && box.bottom <= cell.bottom - 1 &&
              withinCanvas(box) && !occupiedLabels.some(other => overlaps(box, other, .5)) &&
              !visibleSeats.some(other => other !== record && overlaps(box, other.sourceBounds, .5))) {
            pictogram = { size, box }; break;
          }
        }
        ctx.save(); path(record.polygon); ctx.clip();
        let box, presentation;
        if (pictogram) {
          box = pictogram.box; presentation = 'pictogram';
          ctx.fillStyle = selectedWC ? accent : surface;
          ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
          ctx.font = `600 ${pictogram.size}px system-ui`; ctx.fillStyle = selectedWC ? surface : ink;
          ctx.fillText('♿', x, y);
        } else {
          let half = Math.min(6, cell.right - cell.left - 2, cell.bottom - cell.top - 2) / 2;
          const clearance = obstacle => Math.max(obstacle.left - x, x - obstacle.right, obstacle.top - y, y - obstacle.bottom);
          // Neighboring tiny seats already have a minimum painted footprint.
          // Leave its stroke and this cue's stroke/AA room without enlarging hits.
          for (const other of visibleSeats) if (other !== record) {
            half = Math.min(half, clearance(other.bounds) - (other.seat.id === selected?.id ? 1 : .4) - 1);
          }
          for (const obstacle of occupiedLabels) half = Math.min(half, clearance(obstacle) - 1);
          half = Math.max(0, half);
          box = { left: Math.max(0, cell.left, x - half - .5), right: Math.min(project.width, cell.right, x + half + .5),
            top: Math.max(0, cell.top, y - half - .5), bottom: Math.min(project.height, cell.bottom, y + half + .5) };
          presentation = 'compact'; compactWheelchairCount++;
          path([{ x, y: y - half }, { x: x + half, y }, { x, y: y + half }, { x: x - half, y }]);
          ctx.fillStyle = selectedWC ? surface : ink; ctx.fill();
          ctx.strokeStyle = selectedWC ? ink : surface; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.restore(); occupiedLabels.push(box); wheelchairMarkers.push(record.seat.id);
        textLabel('wheelchair', pictogram ? '♿' : '◆', x, y, box.right - box.left, box.bottom - box.top,
          { ...box, seatId: record.seat.id, selectable: true, numbered: false, presentation });
        continue;
      }
      // Numbered WC cells keep the same number policy and hit geometry. At
      // dense scales, use the same bounded cue/detail contract as unnumbered WC.
      if (!numberFontSize) {
        const cell = record.sourceBounds, { x, y } = record.center;
        let half = Math.min(3, (cell.right - cell.left - 2) / 2, (cell.bottom - cell.top - 2) / 2);
        const clearance = obstacle => Math.max(obstacle.left - x, x - obstacle.right, obstacle.top - y, y - obstacle.bottom);
        for (const other of visibleSeats) if (other !== record) half = Math.min(half, clearance(other.bounds) - 1.5);
        for (const obstacle of occupiedLabels) half = Math.min(half, clearance(obstacle) - 1);
        if (half < .25) continue;
        const bounds = { left: x - half - .5, right: x + half + .5, top: y - half - .5, bottom: y + half + .5 };
        if (!withinCanvas(bounds)) continue;
        ctx.save(); path(record.polygon); ctx.clip();
        path([{ x, y: y - half }, { x: x + half, y }, { x, y: y + half }, { x: x - half, y }]);
        ctx.fillStyle = selectedWC ? surface : ink; ctx.fill();
        ctx.strokeStyle = selectedWC ? ink : surface; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
        occupiedLabels.push(bounds); wheelchairMarkers.push(record.seat.id); compactWheelchairCount++;
        textLabel('wheelchair', '◆', x, y, bounds.right - bounds.left, bounds.bottom - bounds.top,
          { ...bounds, seatId: record.seat.id, selectable: true, numbered: true, presentation: 'compact' });
        continue;
      }
      // An optional icon must fit near its own source cell without clamping onto
      // a neighboring number, painted seat, earlier icon or canvas edge.
      let placement = null;
      for (const size of [12, 10]) {
        ctx.font = `600 ${size}px system-ui`;
        const metrics = ctx.measureText('♿');
        const left = metrics.actualBoundingBoxLeft ?? metrics.width / 2;
        const right = metrics.actualBoundingBoxRight ?? metrics.width / 2;
        const ascent = metrics.actualBoundingBoxAscent ?? size / 2;
        const descent = metrics.actualBoundingBoxDescent ?? size / 2;
        const { x, y } = record.center, cell = record.sourceBounds;
        for (const point of [{ x, y: cell.top - descent - 3 }, { x, y: cell.bottom + ascent + 3 },
          { x: cell.left - right - 3, y }, { x: cell.right + left + 3, y }]) {
          const bounds = { left: point.x - left - 1, right: point.x + right + 1,
            top: point.y - ascent - 1, bottom: point.y + descent + 1 };
          if (withinCanvas(bounds) && !occupiedLabels.some(other => overlaps(bounds, other, .5)) &&
              !visibleSeats.some(other => other !== record && overlaps(bounds, other.bounds, .5))) {
            placement = { size, point, bounds }; break;
          }
        }
        if (placement) break;
      }
      // The confirmed W label and selected-seat detail remain when no duplicate
      // icon has a safe nearby position. Do not mark an omitted icon as drawn.
      if (!placement) continue;
      const { size, point, bounds } = placement;
      ctx.fillStyle = selectedWC ? accent : surface;
      ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      ctx.font = `600 ${size}px system-ui`; ctx.fillStyle = selectedWC ? surface : ink; ctx.fillText('♿', point.x, point.y);
      occupiedLabels.push(bounds); wheelchairMarkers.push(record.seat.id);
      textLabel('wheelchair', '♿', (bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2,
        bounds.right - bounds.left, bounds.bottom - bounds.top,
        { ...bounds, seatId: record.seat.id, selectable: true, numbered: true, presentation: 'pictogram' });
    }
    canvas.dataset.visibleWheelchairCount = String(visibleSeats.filter(record => isSelectableWheelchair(record.seat)).length);
    canvas.dataset.wheelchairMarkerCount = String(wheelchairMarkers.length);
    canvas.dataset.wheelchairMarkerIds = JSON.stringify(wheelchairMarkers);
    canvas.dataset.compactWheelchairCount = String(compactWheelchairCount);
    if (compactWheelchairCount) wheelchairNote.textContent += ' · ◆는 선택하거나 확대해 확인';
    const rowGroups = groups('row', seat => sourceText(seat.sourceLabels?.rowLabel ?? seat.rowLabel));
    const sectionGroups = groups('section', seat => sourceText(seat.sourceLabels?.section));
    // Worksheet row annotations are repeated in four source columns. At fit
    // scale they would overlap even though their source coordinates are valid.
    // Keep every source row in the external selector; draw one rail per row
    // only when the unchanged row spacing is large enough on screen.
    const worksheetDepths = isWorksheet(frame) ? [...new Set(frame.seats.map(seat => seat.z))].sort((a, b) => a - b) : [];
    const worksheetRowPitch = worksheetDepths.length > 1 ? Math.min(...worksheetDepths.slice(1).map((z, index) => z - worksheetDepths[index])) : Infinity;
    const captureGaps = [];
    if (isCapturePlan()) {
      const banks = new Map();
      for (const group of rowGroups) {
        if (!banks.has(group.section)) banks.set(group.section, []);
        banks.get(group.section).push(group.records.reduce((sum, record) => sum + record.center.y, 0) / group.records.length);
      }
      for (const depths of banks.values()) {
        depths.sort((a,b) => a-b);
        for (let i=1;i<depths.length;i++) if (depths[i]-depths[i-1]>.25) captureGaps.push(depths[i]-depths[i-1]);
      }
      captureGaps.sort((a,b)=>a-b);
    }
    const captureRowPitch = captureGaps.length ? captureGaps[Math.floor(captureGaps.length/2)] : Infinity;
    const captureOverview = isCapturePlan() && captureRowPitch < 18;
    const selectedCaptureRowKey = selected ? JSON.stringify([sourceText(selected.sourceLabels?.floorLabel), sourceText(selected.sourceLabels?.section), sourceText(selected.sourceLabels?.rowLabel ?? selected.rowLabel)]) : '';
    const visibleRowGroups = isWorksheet(frame) && worksheetRowPitch * project.scale < 20 ? [] : captureOverview
      ? rowGroups.filter(group => group.key === worksheetRowFocus || group.key === selectedCaptureRowKey) : rowGroups;
    canvas.dataset.rowLabelDetailMode = isCapturePlan() ? captureOverview ? 'section-overview' : 'row-detail' : 'existing';
    // Labels stay at true row endpoints, never on a viewport rail. Infer each
    // row axis from its projected source centers; no venue-specific yaw or IDs.
    const localGuides = [];
    let collectingRows = true;const rowOptions=new Map();
    const seatById = new Map(frame.seats.map(seat => [seat.id, seat]));
    const allGuideRecords = projectedSeats.map(item => ({ seat: seatById.get(item.id),
      center: { x: item.x, y: item.y }, width: item.width, height: item.height,
      bounds: { left: item.x-item.width/2, right:item.x+item.width/2, top:item.y-item.height/2, bottom:item.y+item.height/2 } }));
    const completeGroup = group => {
      const records = allGuideRecords.filter(record => {
        const seat=record.seat, value=sourceText(group.kind==='row' ? seat.sourceLabels?.rowLabel ?? seat.rowLabel : seat.sourceLabels?.section);
        const section=group.kind==='row'&&!isWorksheet(frame)?sourceText(seat.sourceLabels?.section):'';
        return JSON.stringify([sourceText(seat.sourceLabels?.floorLabel), section, value])===group.key;
      });
      return records.length?records:group.records;
    };
    const localPlace = (group, text, center, angle, anchor, fontSize) => {
      ctx.font=`${group.kind==='section'?'600 ':''}${fontSize}px system-ui`;
      const w=ctx.measureText(text).width+4,h=fontSize+3,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
      const bw=w*c+h*s,bh=w*s+h*c,box={left:center.x-bw/2,right:center.x+bw/2,top:center.y-bh/2,bottom:center.y+bh/2};
      if(!withinCanvas(box)||occupiedLabels.some(other=>overlaps(box,other,1))||visibleSeats.some(record=>overlaps(box,record.bounds,1)))return false;
      if(collectingRows){if(!rowOptions.has(group.key))rowOptions.set(group.key,[]);rowOptions.get(group.key).push({group,text,center,angle,anchor,fontSize,box});return false;}
      ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle);ctx.fillStyle=background;ctx.fillRect(-w/2,-h/2,w,h);ctx.fillStyle=ink;ctx.fillText(text,0,0);ctx.restore();
      textLabel(group.kind,text,center.x,center.y,bw,bh,{rowKey:group.key,angleRad:angle,anchorX:anchor.x,anchorY:anchor.y,local:true});
      occupiedLabels.push(box);guideLabels.push({kind:group.kind,value:group.value,key:group.key});
      localGuides.push({kind:group.kind,key:group.key,value:group.value,text,angleRad:angle,anchor,center,bounds:box,distancePx:Math.hypot(center.x-anchor.x,center.y-anchor.y)});return true;
    };
    const seatsCenterX=allGuideRecords.reduce((sum,r)=>sum+r.center.x,0)/Math.max(1,allGuideRecords.length);
    for(const group of visibleRowGroups){
      const records=completeGroup(group),mx=records.reduce((s,r)=>s+r.center.x,0)/records.length,my=records.reduce((s,r)=>s+r.center.y,0)/records.length;
      let xx=0,yy=0,xy=0;for(const r of records){const x=r.center.x-mx,y=r.center.y-my;xx+=x*x;yy+=y*y;xy+=x*y;}
      const angle=.5*Math.atan2(2*xy,xx-yy),axis={x:Math.cos(angle),y:Math.sin(angle)};
      const ordered=[...records].sort((a,b)=>(a.center.x-b.center.x)*axis.x+(a.center.y-b.center.y)*axis.y);
      const sectionRecords=allGuideRecords.filter(r=>sourceText(r.seat.sourceLabels?.section)===group.section);
      const bankX=sectionRecords.length?sectionRecords.reduce((s,r)=>s+r.center.x,0)/sectionRecords.length:mx;
      const rightFirst=bankX>seatsCenterX+project.width*.12;
      let placed=false;
      for(const right of rightFirst?[true,false]:[false,true]){
        const endpoint=right?ordered.at(-1):ordered[0],neighbor=right?ordered.at(-2):ordered[1];
        let dx=neighbor?endpoint.center.x-neighbor.center.x:(right?1:-1),dy=neighbor?endpoint.center.y-neighbor.center.y:0;const length=Math.hypot(dx,dy)||1;dx/=length;dy/=length;
        let rotation=Math.atan2(dy,dx);if(rotation>Math.PI/2)rotation-=Math.PI;if(rotation< -Math.PI/2)rotation+=Math.PI;
        for(const size of (project.width<400?[10,11,12]:[12,11,10])){
          // Only a small local extension is allowed. If crowded, keep the row
          // available in the selector instead of sending it to another bank.
          const half=Math.abs(dx)*endpoint.width/2+Math.abs(dy)*endpoint.height/2;
          for(const gap of Array.from({length:25},(_,i)=>4+i*2)){
            const distance=half+size/2+gap,center={x:endpoint.center.x+dx*distance,y:endpoint.center.y+dy*distance};
            if(localPlace(group,group.value,center,rotation,endpoint.center,size)){placed=true;break;}
          }if(placed)break;
        }if(placed)break;
      }
    }
    collectingRows=false;
    // Resolve row labels together: a sparse row must not consume the only local
    // space available to a neighboring short row. Bound the search per draw.
    const selectedRowKey=isCapturePlan()&&worksheetRowFocus?worksheetRowFocus:selected&&cameras[view].zoom>1?JSON.stringify([sourceText(selected.sourceLabels?.floorLabel),isWorksheet(frame)?'':sourceText(selected.sourceLabels?.section),sourceText(selected.sourceLabels?.rowLabel??selected.rowLabel)]):null;
    let best=[];let visits=0;
    const resolve=(pending,placed)=>{
      if(placed.length>best.length)best=[...placed];
      if(!pending.length||visits++>4000)return placed.length===rowOptions.size;
      const available=pending.map(([key,options])=>[key,options.filter(option=>!placed.some(other=>overlaps(option.box,other.box,1)))]).sort((a,b)=>Number(b[0]===selectedRowKey)-Number(a[0]===selectedRowKey)||a[1].length-b[1].length);
      const [key,options]=available[0],rest=pending.filter(entry=>entry[0]!==key);
      if(!options.length)return cameras[view].zoom>1?resolve(rest,placed):false;
      for(const option of options){if(resolve(rest,[...placed,option]))return true;if(visits>4000)break;}
      return false;
    };
    resolve([...rowOptions],[]);
    for(const option of best)localPlace(option.group,option.text,option.center,option.angle,option.anchor,option.fontSize);
    for(const group of sectionGroups){
      const records=completeGroup(group),box=records.reduce((b,r)=>({left:Math.min(b.left,r.bounds.left),right:Math.max(b.right,r.bounds.right),top:Math.min(b.top,r.bounds.top),bottom:Math.max(b.bottom,r.bounds.bottom)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
      const cx=(box.left+box.right)/2,cy=(box.top+box.bottom)/2;
      for(const center of [{x:cx,y:box.top-18},{x:cx,y:box.bottom+18},...[.25,.75,0,1].flatMap(t=>[{x:box.left+(box.right-box.left)*t,y:box.top-18},{x:box.left+(box.right-box.left)*t,y:box.bottom+18}]),{x:box.left-20,y:cy},{x:box.right+20,y:cy}]){
        const anchor={x:clamp(center.x,box.left,box.right),y:clamp(center.y,box.top,box.bottom)};
        if(localPlace(group,group.value,center,0,anchor,13))break;
      }
    }
    canvas.dataset.localRowGuides=JSON.stringify(localGuides);
    canvas.dataset.localRowCandidateCounts=JSON.stringify([...rowOptions].map(([key,options])=>({key,count:options.length})));canvas.dataset.localRowSearchVisits=String(visits);
    canvas.dataset.rowLeaderLineCount='0';
    ctx.font = `${numberFontSize || 10}px system-ui`;
    for (const box of numberBoxes) {
      const { record, text } = box;
      const selectedNumber = record.seat.id === selected?.id;
      if (selectedNumber && plan?.variantProfile?.variantKind === 'user_capture') {
        // This branch is reached only when the number and halo fit this cell.
        ctx.save();
        ctx.strokeStyle = surface; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
        ctx.strokeText(text, record.center.x, record.center.y);
        ctx.fillStyle = ink; ctx.fillText(text, record.center.x, record.center.y);
        ctx.restore();
      } else {
        ctx.fillStyle = selectedNumber ? surface : ink; ctx.fillText(text, record.center.x, record.center.y);
      }
      textLabel('number', text, (box.left + box.right) / 2, (box.top + box.bottom) / 2, box.right - box.left, box.bottom - box.top, { seatId: record.seat.id });
    }
    // Source stairs are nonseat callouts; keep their anchors and avoid covering numbered cells.
    let visibleGuideCount = 0;
    ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const marker of sourceGuideMarkers(frame)) {
      const point = project.map(marker);
      if (point.x < 0 || point.y < 0 || point.x > project.width || point.y > project.height) continue;
      const width = ctx.measureText(marker.label).width + 8, height = 18;
      const boxAt = (x, y) => ({ left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 });
      const cx = clamp(point.x, width / 2 + 3, project.width - width / 2 - 3);
      const cy = clamp(point.y, height / 2 + 3, project.height - height / 2 - 3);
      const offsets = [0, -8, 8, -16, 16, -24, 24, -36, 36, -48, 48];
      const localOffsets = offsets.flatMap(dx => offsets.map(dy => ({ dx, dy })))
        .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
      const choices = localOffsets.map(({ dx, dy }) => boxAt(
        clamp(cx + dx, width / 2 + 3, project.width - width / 2 - 3),
        clamp(cy + dy, height / 2 + 3, project.height - height / 2 - 3)));
      for (let offset = 16; offset <= project.height; offset += 16) {
        for (const delta of [-offset, offset]) {
          const y = clamp(cy + delta, height / 2 + 3, project.height - height / 2 - 3);
          choices.push(boxAt(cx, y), boxAt(width / 2 + 3, y), boxAt(project.width - width / 2 - 3, y));
        }
      }
      const placement = choices.find(box => withinCanvas(box) &&
        !occupiedLabels.some(other => overlaps(box, other, 1)) && !visibleSeats.some(record => overlaps(box, record.bounds, .5)));
      if (!placement) continue;
      const x = (placement.left + placement.right) / 2, y = (placement.top + placement.bottom) / 2;
      if (Math.abs(x - point.x) > 1 || Math.abs(y - point.y) > 1) {
        ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(x, y);
        ctx.strokeStyle = line; ctx.lineWidth = .6; ctx.stroke();
      }
      ctx.fillStyle = surface; ctx.fillRect(placement.left, placement.top, width, height);
      ctx.fillStyle = ink; ctx.fillText(marker.label, x, y);
      textLabel('source-guide', marker.label, x, y, width, height, { sourceGuideId: marker.id, sourceX: point.x, sourceY: point.y, selectable: false });
      occupiedLabels.push(placement); visibleGuideCount++;
    }
    canvas.dataset.sourceGuideRenderedCount = String(visibleGuideCount);
    // Render stage plates last: later row/section connectors cannot cross their text.
    ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const label of stageLabels) {
      ctx.fillStyle = surface; ctx.fillRect(label.left, label.top, label.width, label.height);
      ctx.fillStyle = ink; label.lines.forEach((text, index) => ctx.fillText(text, label.x, label.y + (index - (label.lines.length - 1) / 2) * 18));
    }
    Object.assign(canvas.dataset, {
      numberLabelCount: String(numberLabels.length),
      knownNumberCount: String(frame.seats.filter(seat => sourceText(seat.sourceLabels?.numberText)).length),
      visibleKnownNumberCount: String(knownNumbers.length), numberFontSize: String(knownNumbers.length ? numberFontSize : 0),
      numberLabelMode: knownNumbers.length ? numberFontSize ? 'all' : 'zoom-needed' : 'none', numberLabelIds: JSON.stringify(numberLabels),
      rowLabelCount: String(guideLabels.filter(label => label.kind === 'row').length),
      rowLabelTotal: String(rowGroups.length), sectionLabelTotal: String(sectionGroups.length),
      sectionLabelCount: String(guideLabels.filter(label => label.kind === 'section').length),
      rowLabels: JSON.stringify(guideLabels.filter(label => label.kind === 'row').map(label => label.value)),
      rowLabelKeys: JSON.stringify(guideLabels.filter(label => label.kind === 'row').map(label => label.key)),
      sectionLabels: JSON.stringify(guideLabels.filter(label => label.kind === 'section').map(label => label.value)),
      outlineSeatCount: String(frame.seats.filter(seat => Array.isArray(seat.drawingOutline) && seat.drawingOutline.length >= 3 && seat.drawingOutline.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.z))).length),
    });
    const unmarkedWheelchairCount = visibleSeats.filter(record => isSelectableWheelchair(record.seat) &&
      sourceText(record.seat.sourceLabels?.numberText) && !wheelchairMarkers.includes(record.seat.id) &&
      !numberLabels.includes(record.seat.id)).length;
    canvas.dataset.unmarkedWheelchairCount = String(unmarkedWheelchairCount);
    numberHint.hidden = unmarkedWheelchairCount === 0 && (!knownNumbers.length || numberFontSize > 0);
    const numberHintText = isCapturePlan() ? '번호는 기호를 선택해 아래에서 확인하거나 확대' : '번호는 +로 확대하거나 기호를 선택해 확인';
    numberHint.textContent = unmarkedWheelchairCount ? `${numberHintText} · 작은 휠체어 기호 ${unmarkedWheelchairCount}개는 +로 확대해 확인` : numberHintText;
    canvas.dataset.selectedNumberPresentation = isCapturePlan() && selected && sourceText(selected.sourceLabels?.numberText)
      ? numberLabels.includes(selected.id) ? 'in-cell-and-detail' : 'selection-detail' : '';
    if (isCapturePlan()) {
      const total = captureRows(frame).length, shown = guideLabels.filter(label => label.kind === 'row').length;
      worksheetSections.textContent = '구역·열 찾기';
    }
    canvas.dataset.visibleSeatCount = String(visibleCount);
  }
  function fit() {
    if (destroyed || !plan) return;
    cancelPointers(); clearHover(); Object.assign(cameras[view], { zoom: 1, panX: 0, panY: 0 });
    worksheetRowFocus = ''; worksheetRow.value = '';
    updateSelectionDisplay(); queueDraw();
  }
  function focusWorksheetRow(row) {
    const frame = activeFrame();
    if (!isWorksheet(frame) || !worksheetRows(frame).includes(row)) return;
    const seats = frame.seats.filter(seat => seatRow(seat) === row), current = projection();
    if (!seats.length || !current) return;
    cancelPointers(); clearHover(); clearCandidates(); view = '2d';
    const depths = [...new Set(frame.seats.map(seat => seat.z))].sort((a, b) => a - b);
    const gaps = depths.slice(1).map((z, index) => z - depths[index]).filter(gap => gap > 0);
    const rowPitch = gaps.length ? Math.min(...gaps) : Math.min(...seats.map(seat => seat.depthM));
    const width = Math.min(...seats.map(seat => seat.widthM));
    const requiredScale = Math.max(22 / Math.max(.01, rowPitch), 20 / Math.max(.01, width));
    const fitScale = current.scale / cameras[view].zoom;
    Object.assign(cameras[view], { zoom: clamp(requiredScale / fitScale, 1, 24), panX: 0, panY: 0 });
    const project = projection(), center = {
      x: (Math.min(...seats.map(seat => seat.x)) + Math.max(...seats.map(seat => seat.x))) / 2,
      z: seats.reduce((sum, seat) => sum + seat.z, 0) / seats.length,
    };
    const position = project.map(center);
    cameras[view].panX += project.width / 2 - position.x; cameras[view].panY += project.height / 2 - position.y;
    worksheetRowFocus = row; worksheetRow.value = row;
    status.textContent = `${row.endsWith('열') ? row : `${row}열`} 확대 · 선택은 유지됩니다.`;
    updateSelectionDisplay(); queueDraw(); canvas.focus({ preventScroll: true });
  }
  function focusCaptureRow(key) {
    const row = captureRows(activeFrame()).find(row => row.key === key), current = projection();
    if (!row || !current) return;
    cancelPointers(); clearHover(); clearCandidates(); view = '2d';
    const cellSize = Math.min(...row.seats.map(seat => Math.min(seat.widthM, seat.depthM)));
    const fitScale = current.scale / cameras[view].zoom;
    const rowWidth = Math.max(...row.seats.map(seat => seat.x + seat.widthM / 2))
      - Math.min(...row.seats.map(seat => seat.x - seat.widthM / 2));
    // Keep both true endpoints and their local labels in view. Detail text
    // remains below the drawing when a full row cannot also fit large cells.
    const rowScale = Math.min(20 / Math.max(.01, cellSize), Math.max(1, current.width - 80) / Math.max(.01, rowWidth));
    Object.assign(cameras[view], { zoom: clamp(rowScale / fitScale, 1, 24), panX: 0, panY: 0 });
    const project = projection(), center = {
      x: (Math.min(...row.seats.map(seat => seat.x)) + Math.max(...row.seats.map(seat => seat.x))) / 2,
      z: row.seats.reduce((sum, seat) => sum + seat.z, 0) / row.seats.length,
    };
    const point = project.map(center);
    cameras[view].panX += project.width / 2 - point.x; cameras[view].panY += project.height / 2 - point.y;
    worksheetRowFocus = row.key; worksheetRow.value = row.key;
    status.textContent = `${row.label} 확대 · 선택은 유지됩니다.`;
    updateSelectionDisplay(); queueDraw(); canvas.focus({ preventScroll: true });
  }
  function resetTransient() {
    if (destroyed) return;
    cancelPointers(); clearHover(); clearCandidates(); results.replaceChildren(); query.value = '';
    worksheetRowFocus = ''; sourceInfo.open = false; cameras = initialViews(); view = '2d';
    // Frame and selectedByFrame are saved seat context, not temporary search filters.
    updateWorksheetControls(); status.textContent = ''; updateSelectionDisplay(); queueDraw();
  }
  function setView(next) {
    if (!plan || destroyed || !['2d', '3d'].includes(next) || next === '3d' && plan.unitScope === 'selection_diagram') return;
    cancelPointers(); clearHover(); clearCandidates(); view = next; updateSelectionDisplay(); queueDraw();
  }
  function focusSeat(seat) {
    const project = projection(); if (!project) return;
    const position = project.map(seat), camera = cameras[view];
    camera.panX += project.width / 2 - position.x; camera.panY += project.height / 2 - position.y;
  }
  function selectSeat(seat, { focus = false } = {}) {
    const frame = activeFrame(); if (!frame?.seats.some(item => item.id === seat.id)) return;
    selectedByFrame.set(frameId, seat.id); clearCandidates();
    rememberChoice();
    if (focus) focusSeat(seat);
    status.textContent = `${seatDisplayLabel(seat)} 선택`; updateSelectionDisplay(); queueDraw(); notifySelection();
  }
  function seatButton(seat, targetFrameId, focus = true) {
    const control = button('', seatDisplayLabel(seat));
    control.dataset.sourceSeatId = seat.id; control.dataset.frameId = targetFrameId;
    control.setAttribute('aria-label', `${seatDisplayLabel(seat)} 선택`);
    control.setAttribute('aria-pressed', String(frameId === targetFrameId && currentSeat()?.id === seat.id));
    control.onclick = () => { if (frameId === targetFrameId) selectSeat(seat, { focus }); };
    return control;
  }
  function searchSeats() {
    results.replaceChildren(); clearCandidates();
    if (!plan || !query.value.trim()) { if (plan) status.textContent = '좌석 기호 이름이나 도면 표기를 입력하세요.'; return; }
    // Add display text only to a detached search view; source labels and the
    // seat returned through getSelection remain untouched.
    const searchable = { ...plan, frames: plan.frames.map(frame => ({ ...frame, seats: frame.seats.map(seat =>
      seatDisplayLabel(seat) === seat.label ? seat : { ...seat, aliases: [...(Array.isArray(seat.aliases) ? seat.aliases : []), seatDisplayLabel(seat)] }) })) };
    const matches = findSourcePlanSeats(searchable, { frameId, query: query.value });
    for (const match of matches) results.append(seatButton(match.seat, match.frameId));
    status.textContent = matches.length ? `일치하는 기호 ${matches.length}개` : '일치하는 좌석 기호가 없습니다.';
  }
  const localPoint = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  function clearHover() {
    hoverLabel.hidden = true; hoverLabel.textContent = '';
    canvas.dataset.hoverId = ''; canvas.dataset.hoverLabel = ''; canvas.dataset.hoverNumberText = ''; canvas.dataset.hoverReferenceId = '';
  }
  function showHover(point) {
    const frame = activeFrame(), project = projection(); if (!frame || !project) { clearHover(); return; }
    const world = project.inverse(point), reference = interactionReferenceAt(frame, world) || sourceGuideAt(frame, world) || sourceGuideLabelAt(frame, point);
    if (reference) {
      clearHover(); hoverLabel.textContent = reference.description; hoverLabel.hidden = false;
      hoverLabel.style.left = `${clamp(point.x + 12, 8, Math.max(8, project.width - hoverLabel.offsetWidth - 8))}px`;
      hoverLabel.style.top = `${clamp(point.y + 12, 8, Math.max(8, project.height - hoverLabel.offsetHeight - 8))}px`;
      canvas.dataset.hoverReferenceId = reference.id; return;
    }
    canvas.dataset.hoverReferenceId = '';
    const hits = hitSourcePlanSeats(frame, world, 3 / (project.scale * project.vertical));
    const inside = hits.filter(hit => hit.inside), choices = inside.length ? inside : hits;
    if (!choices.length) { clearHover(); return; }
    const seat = choices[0].seat;
    hoverLabel.textContent = choices.slice(0, 3).map(hit => seatDisplayLabel(hit.seat)).join('\n') + (choices.length > 3 ? `\n외 ${choices.length - 3}개 기호` : '');
    hoverLabel.hidden = false;
    hoverLabel.style.left = `${clamp(point.x + 12, 8, Math.max(8, project.width - hoverLabel.offsetWidth - 8))}px`;
    hoverLabel.style.top = `${clamp(point.y + 12, 8, Math.max(8, project.height - hoverLabel.offsetHeight - 8))}px`;
    canvas.dataset.hoverId = seat.id; canvas.dataset.hoverLabel = seatDisplayLabel(seat); canvas.dataset.hoverNumberText = sourceText(seat.sourceLabels?.numberText);
  }
  function pick(point, pointerType = 'mouse') {
    const frame = activeFrame(), project = projection(); if (!frame || !project) return;
    const world = project.inverse(point);
    const reference = interactionReferenceAt(frame, world) || sourceGuideAt(frame, world) || sourceGuideLabelAt(frame, point);
    if (reference) { clearCandidates(); status.textContent = reference.description; return; }
    const radiusM = (pointerType === 'touch' ? 18 : 10) / (project.scale * project.vertical);
    const hits = hitSourcePlanSeats(frame, world, radiusM);
    const inside = hits.filter(hit => hit.inside), choices = inside.length ? inside : hits;
    clearCandidates();
    if (!choices.length) { status.textContent = '기호를 선택하거나 확대해서 다시 선택하세요.'; return; }
    if (choices.length === 1) { selectSeat(choices[0].seat); return; }
    candidates.append(make('strong', '', `가까운 기호 ${choices.length}개 중 선택`));
    for (const hit of choices) candidates.append(seatButton(hit.seat, frameId, false));
    candidates.hidden = false; status.textContent = '겹친 기호를 목록에서 선택하세요.';
  }
  function zoomAt(nextZoom, anchor, anchoredWorld = null) {
    const before = projection(); if (!before) return;
    clearHover();
    const world = anchoredWorld || before.inverse(anchor), camera = cameras[view];
    camera.zoom = clamp(nextZoom, .35, 24);
    const after = projection(), position = after.map(world);
    camera.panX += anchor.x - position.x; camera.panY += anchor.y - position.y;
    updateSelectionDisplay(); queueDraw();
  }
  const consume = event => { event.preventDefault(); event.stopPropagation(); };
  listen(flat, 'click', () => setView('2d')); listen(orbit, 'click', () => setView('3d'));
  listen(fitButton, 'click', fit);
  for (const [control, factor] of [[zoomOut, .8], [zoomIn, 1.25]]) listen(control, 'click', () => {
    const project = projection(); if (!project) return;
    cancelPointers(); zoomAt(cameras[view].zoom * factor, { x: project.width / 2, y: project.height / 2 });
  });
  listen(modes, 'keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    consume(event); const next = plan?.unitScope === 'selection_diagram' || ['ArrowLeft', 'Home'].includes(event.key) ? '2d' : '3d';
    setView(next); (next === '2d' ? flat : orbit).focus({ preventScroll: true });
  });
  listen(frameSelect, 'change', () => {
    if (!plan?.frames.some(frame => frame.id === frameSelect.value)) return;
    cancelPointers(); frameId = frameSelect.value; cameras = initialViews(); worksheetRowFocus = '';
    clearSurface(); clearCandidates(); results.replaceChildren(); query.value = '';
    updateWorksheetControls();
    status.textContent = `${activeFrame().label} · 기호 ${activeFrame().seats.length}개`;
    rememberChoice();
    updateSelectionDisplay(); queueDraw(); notifySelection();
  });
  listen(worksheetRow, 'change', () => { if (worksheetRow.value) { if (isCapturePlan()) focusCaptureRow(worksheetRow.value); else focusWorksheetRow(worksheetRow.value); } else fit(); });
  listen(sourceInfo, 'keydown', event => {
    if (event.key === 'Escape' && sourceInfo.open) { consume(event); sourceInfo.open = false; sourceInfoSummary.focus({ preventScroll: true }); }
  });
  listen(search, 'submit', event => { consume(event); searchSeats(); });
  listen(query, 'input', () => { results.replaceChildren(); clearCandidates(); });
  listen(canvas, 'pointerdown', event => {
    if (!plan || (event.pointerType !== 'touch' && event.button !== 0)) return;
    clearHover();
    consume(event); const point = localPoint(event); pointers.set(event.pointerId, point);
    canvas.setPointerCapture?.(event.pointerId); canvas.focus({ preventScroll: true });
    if (pointers.size >= 2) {
      wasMultiTouch = true; drag = null;
      const [a, b] = [...pointers.values()], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: cameras[view].zoom, world: projection().inverse(center) };
    } else drag = { id: event.pointerId, point, camera: { ...cameras[view] }, active: false, pointerType: event.pointerType };
  });
  listen(canvas, 'pointermove', event => {
    if (!plan) return;
    if (!pointers.has(event.pointerId)) { if (event.pointerType !== 'touch') showHover(localPoint(event)); return; }
    consume(event); const point = localPoint(event); pointers.set(event.pointerId, point);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomAt(pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance, center, pinch.world); return;
    }
    if (!drag || drag.id !== event.pointerId || wasMultiTouch) return;
    const dx = point.x - drag.point.x, dy = point.y - drag.point.y;
    if (!drag.active && Math.hypot(dx, dy) <= 5) return;
    drag.active = true; clearCandidates();
    if (view === '2d') Object.assign(cameras[view], { panX: drag.camera.panX + dx, panY: drag.camera.panY + dy });
    else Object.assign(cameras[view], { yawDeg: yaw(drag.camera.yawDeg + dx * .4), elevationDeg: clamp(drag.camera.elevationDeg - dy * .25, 10, 85) });
    updateSelectionDisplay(); queueDraw();
  });
  listen(canvas, 'pointerleave', clearHover);
  listen(canvas, 'pointerup', event => {
    if (!pointers.has(event.pointerId)) return;
    consume(event); const point = localPoint(event);
    const click = !wasMultiTouch && drag?.id === event.pointerId && !drag.active && Math.hypot(point.x - drag.point.x, point.y - drag.point.y) <= 5;
    pointers.delete(event.pointerId); drag = null; pinch = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!pointers.size) wasMultiTouch = false;
    if (click) pick(point, event.pointerType);
  });
  for (const type of ['pointercancel', 'lostpointercapture']) listen(canvas, type, event => {
    if (pointers.has(event.pointerId)) { consume(event); cancelPointers(); }
  });
  listen(canvas, 'wheel', event => {
    if (!plan) return; consume(event);
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 300 : 1;
    const delta = clamp(event.deltaY * unit, -300, 300);
    cancelPointers(); zoomAt(cameras[view].zoom * Math.exp(-delta * .0015), localPoint(event));
  }, { passive: false });
  listen(canvas, 'keydown', event => {
    if (!plan || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', '+', '=', '-', '_', 'Enter', 'Escape'].includes(event.key)) return;
    if (event.key === 'Escape' && candidates.hidden && hoverLabel.hidden && !sourceInfo.open && root.closest('dialog')?.open) return;
    consume(event); cancelPointers();
    if (event.key === 'Home') { fit(); return; }
    if (event.key === 'Escape') { clearCandidates(); clearHover(); sourceInfo.open = false; return; }
    const project = projection(); if (!project) return;
    if (event.key === 'Enter') { pick({ x: project.width / 2, y: project.height / 2 }); return; }
    if (['+', '=', '-', '_'].includes(event.key)) { zoomAt(cameras[view].zoom * (['+', '='].includes(event.key) ? 1.25 : .8), { x: project.width / 2, y: project.height / 2 }); return; }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (view === '2d') { cameras[view].panX += direction[0] * 30; cameras[view].panY += direction[1] * 30; }
    else { cameras[view].yawDeg = yaw(cameras[view].yawDeg + direction[0] * (event.shiftKey ? 1 : 5)); cameras[view].elevationDeg = clamp(cameras[view].elevationDeg - direction[1] * (event.shiftKey ? 1 : 5), 10, 85); }
    updateSelectionDisplay(); queueDraw();
  });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(queueDraw) : null;
  observer?.observe(canvasWrap);
  listen(globalThis, 'resize', queueDraw);
  // Read-only projected positions support accessible overlays and actual
  // pointer verification without exposing or mutating the controller state.
  Object.defineProperty(canvas, 'getSourceSeatProjectedHits', { configurable: true, value: () => projectedSeats.map(hit => ({ ...hit })) });
  Object.defineProperty(canvas, 'getSourceSeatRenderedLabels', { configurable: true, value: () => renderedLabels.map(label => ({ ...label })) });
  Object.defineProperty(canvas, 'getSourceGuideProjectedMarkers', { configurable: true, value: () => {
    const project = projection();
    return !project ? [] : sourceGuideMarkers(activeFrame()).map(mark => ({ id: mark.id, label: mark.label, kind: mark.kind,
      ...project.map(mark), selectable: false }));
  } });
  Object.defineProperty(canvas, 'getSourceSeatProjectedReferences', { configurable: true, value: () => {
    const project = projection();
    return !project ? [] : referenceMarks(activeFrame()).map(mark => ({ id: mark.id, label: mark.label, kind: mark.kind,
      ...project.map(mark), outline: mark.outline.map(project.map), selectable: false }));
  } });

  function setPlan(input, { preserveSelection = false } = {}) {
    if (destroyed) return false;
    const previous = preserveSelection && plan ? { content: JSON.stringify(plan), frameId, selectedByFrame: new Map(selectedByFrame) } : null;
    cancelPointers(); if (queued) cancelAnimationFrame(queued); queued = 0;
    plan = null; frameId = ''; selectedByFrame = new Map(); cameras = initialViews(); view = '2d'; projectedSeats = []; renderedLabels = []; worksheetRowFocus = ''; choiceRestored = false; choicePersisted = false;
    clearCandidates(); results.replaceChildren(); frameSelect.replaceChildren(); query.value = ''; sourceInfo.open = false;
    title.textContent = ''; badge.textContent = ''; status.textContent = ''; root.hidden = true;
    clearSurface();
    updateWorksheetControls();
    updateSelectionDisplay(); notifySelection();
    if (input === null) return true;
    try { plan = normalizeSourceSeatPlan(input); }
    catch { root.hidden = false; status.textContent = '좌석 도면을 불러오지 못했습니다.'; return false; }
    frameId = plan.frames[0].id;
    const choice = sourcePlanChoiceKey(plan) ? readSourcePlanChoice(plan, choiceStorage()) : null;
    if (choice) {
      frameId = choice.frameId; selectedByFrame = new Map(choice.selections.map(entry => [entry.frameId, entry.seatId]));
      choiceRestored = true;
    }
    // Reopening an unchanged drawing may clear its search/view without losing
    // the session selection of legacy plans that have no persistent choice key.
    if (previous && previous.content === JSON.stringify(plan)) {
      if (plan.frames.some(frame => frame.id === previous.frameId)) frameId = previous.frameId;
      selectedByFrame = new Map([...previous.selectedByFrame].filter(([id, seatId]) =>
        plan.frames.find(frame => frame.id === id)?.seats.some(seat => seat.id === seatId)));
    }
    title.textContent = plan.title; root.hidden = false;
    const diagram = plan.unitScope === 'selection_diagram';
    badge.textContent = isCapturePlan() ? '2D만 제공' : sourceText(plan.presentation?.badge) || (diagram ? '좌석 배치도 · 거리 비례 아님' : '도면 좌석 · 치수 추정');
    orbit.hidden = diagram; orbit.disabled = diagram;
    for (const frame of plan.frames) {
      const option = make('option', '', frame.label); option.value = frame.id; frameSelect.append(option);
    }
    frameSelect.value = frameId;
    updateWorksheetControls();
    status.textContent = `${activeFrame().label} · 기호 ${activeFrame().seats.length}개`;
    updateSelectionDisplay(); queueDraw(); notifySelection(); return true;
  }
  return {
    setPlan, fit, resetTransient, getSelection, getMediaContext,
    destroy() {
      if (destroyed) return;
      setPlan(null); destroyed = true;
      observer?.disconnect(); for (const dispose of disposers) dispose();
      delete canvas.getSourceSeatProjectedHits;
      delete canvas.getSourceSeatRenderedLabels;
      delete canvas.getSourceGuideProjectedMarkers;
      delete canvas.getSourceSeatProjectedReferences;
      root.remove();
    },
  };
}
