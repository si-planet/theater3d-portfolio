// Workspace presentation stays independent from the three canvas edit modes.
export function createWorkspaceUI({ onModeChange, onLayoutChange } = {}) {
  const $ = id => document.getElementById(id);
  const buttons = [...document.querySelectorAll('button[data-workspace-mode]')];
  const workspace = document.querySelector('.workspace');
  let mode = 'seat';
  let activeHelp = null;
  let closeTimer = null;
  let restoringHelpFocus = false;

  function closeHelp({ restoreFocus = false } = {}) {
    clearTimeout(closeTimer);
    if (!activeHelp) return;
    const { button, popup } = activeHelp;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    activeHelp = null;
    if (restoreFocus && button.isConnected && document.activeElement !== button) {
      restoringHelpFocus = true;
      try { button.focus({ preventScroll: true }); } finally { restoringHelpFocus = false; }
    }
  }

  function placeHelp() {
    if (!activeHelp) return;
    const { button, popup } = activeHelp;
    const dialog = button.closest('dialog');
    if (dialog && !dialog.open) { closeHelp(); return; }
    const rect = button.getBoundingClientRect();
    if (!button.getClientRects().length || rect.bottom < 0 || rect.top > innerHeight) { closeHelp(); return; }
    popup.style.maxHeight = `${Math.max(100, innerHeight - 32)}px`;
    const width = popup.offsetWidth, height = popup.offsetHeight;
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, innerWidth - width - 12));
    const below = rect.bottom + 8;
    const top = below + height <= innerHeight - 12 ? below : Math.max(12, rect.top - height - 8);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function showHelp(button, popup, pinned = false) {
    clearTimeout(closeTimer);
    if (activeHelp?.button !== button) closeHelp();
    activeHelp = { button, popup, pinned: pinned || Boolean(activeHelp?.pinned) };
    // A body portal cannot rise above a modal's top layer, regardless of z-index.
    const dialog = button.closest('dialog');
    const host = dialog?.open ? dialog : document.body;
    if (popup.parentElement !== host) host.append(popup);
    popup.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    placeHelp();
  }

  function deferClose(button) {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (activeHelp?.button === button && !activeHelp.pinned && document.activeElement !== button && !activeHelp.popup.matches(':hover')) closeHelp();
    }, 140);
  }

  // Move the original nodes, including dynamic IDs, rather than copying text.
  function help(key, label, selectors, anchorSelector) {
    const sources = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
    const anchor = document.querySelector(anchorSelector);
    if (!sources.length || !anchor) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'help-trigger'; button.dataset.helpTrigger = key;
    button.textContent = '?'; button.setAttribute('aria-label', `${label} 도움말`);
    const popup = document.createElement('div');
    popup.id = `help-${key}`; popup.className = 'help-popover'; popup.hidden = true;
    popup.setAttribute('role', 'tooltip');
    const heading = document.createElement('strong'); heading.className = 'help-title'; heading.textContent = label;
    popup.append(heading, ...sources);
    for (const source of sources) source.classList.add('help-content');
    button.setAttribute('aria-controls', popup.id); button.setAttribute('aria-describedby', popup.id);
    button.setAttribute('aria-expanded', 'false');
    anchor.append(button); document.body.append(popup);
    button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') showHelp(button, popup); });
    button.addEventListener('pointerleave', () => deferClose(button));
    popup.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    popup.addEventListener('pointerleave', () => deferClose(button));
    button.addEventListener('focus', () => { if (!restoringHelpFocus) showHelp(button, popup); });
    button.addEventListener('blur', () => { if (!activeHelp?.pinned) deferClose(button); });
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (activeHelp?.button === button && activeHelp.pinned) closeHelp();
      else showHelp(button, popup, true);
    });
    new MutationObserver(() => { if (activeHelp?.button === button) placeHelp(); }).observe(popup, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  }

  help('geometry', '자료와 모델의 해석 범위', ['.intro-copy', '#geometry-description'], '.data-notice');
  help('model-mode', '모델 선택', ['#model-mode-note'], '.model-selector');
  help('seat', '좌석 번호와 배치', ['#seat-picker-description', '#seat-layout-note'], '#seat-panel > summary');
  help('audience', '관객 편집', ['#audience-body-assumption-note', '.audience-fill-controls > .small-note', '.audience-edit-guide', '#audience-note'], '#audience-panel > summary');
  help('camera-direction', '화면 조작과 조준', ['#view-direction-note'], '#camera-direction-panel > summary');
  help('framing', '시야 비교의 한계', ['#framing-note', '.view-surface-legend > p'], '.framing-note');
  help('focal', '초점거리와 화면 크기', ['.focal-section > .small-note', '#sight-view-controls > .small-note'], '#camera-panel > summary');
  help('lens-range', '렌즈 환산과 즐겨찾기', ['#lens-settings > .small-note:not(#lens-storage-note)', '.favorite-lens-editor > .small-note'], '#lens-settings > summary');
  help('camera-height', '카메라 높이 기준', ['.camera-height-section > .small-note'], '.camera-height-section > .control-heading');
  help('stage-walls', '무대 벽의 가정', ['#stage-wall-note'], '.stage-wall-section > .check-label');
  help('auditorium-barrier', '객석 앞 낮은 벽', ['#auditorium-barrier-note'], '#auditorium-barrier-section > .check-label');
  help('obstruction', '가림 요소', ['.obstruction-section > .small-note'], '.obstruction-section > .toggle-row');
  help('framing-guide', '구도 예측', ['#lens-estimate-note', '.lens-estimate > small:not(#lens-estimate-note)'], '.lens-estimate > strong');
  help('editor', '오브젝트 편집', ['#stage-object-editor .card-description', '#scene-note', '.person-edit-view-controls > .small-note'], '#object-panel > summary');
  help('person-body', '참고 체형과 체중 추정', ['#person-body-note'], '.person-body-controls > .assumption-label');
  help('person-position', '인물의 위치와 방향', ['#editor-person-fields > .small-note'], '#editor-person-fields > label[for="person-position"]');
  help('arrangement', '여러 인물 배치', ['#person-arrangement-note'], '#person-arrangement-panel > summary');
  help('structure-position', '구조물 좌표', ['.structure-picker > .small-note', '.structure-position > .small-note'], '.structure-picker > .field-label');
  help('model-evidence', '형상과 높이의 해석', ['#model-info', '#model-limits', '#model-auditorium-barrier-note', '.model-heading .card-description'], '#model-panel > summary');
  help('photo-registration', '사진의 좌석 연결', ['#seat-photo-registration-note', '.photo-heading .card-description'], '.photo-heading > div:first-child');
  help('photo-metadata', '원본 사진과 촬영정보', ['.photo-metadata-note', '#photo-labeling-note', '.photo-privacy > p'], '#photo-panel > summary');
  // The explanations now live in help popovers; discard their empty ornaments.
  document.querySelectorAll('.framing-note > .info-icon, .layout-note, .photo-privacy').forEach(element => { if (!element.querySelector('p')) element.remove(); });

  function setPanel(id, open) {
    const panel = $(id);
    if (!panel || panel.open === open) return;
    if (!open && panel.contains(document.activeElement) && document.activeElement !== panel.querySelector(':scope > summary')) {
      const modeButton = buttons.find(button => button.dataset.workspaceMode === mode);
      modeButton?.focus({ preventScroll: true });
    }
    panel.open = open;
  }

  function syncButtons() {
    workspace.dataset.workspaceMode = mode;
    for (const button of buttons) {
      const selected = button.dataset.workspaceMode === mode;
      button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected));
    }
  }

  function setMode(next) {
    if (!['seat', 'camera', 'person', 'stage'].includes(next)) next = 'seat';
    if (next === mode) { syncButtons(); return; }
    mode = next; closeHelp(); syncButtons();
    const viewing = mode === 'seat' || mode === 'camera';
    setPanel('seat-panel', mode === 'seat');
    setPanel('camera-panel', viewing);
    setPanel('camera-details', false);
    setPanel('camera-direction-panel', mode === 'camera');
    setPanel('audience-panel', false);
    setPanel('person-arrangement-panel', false);
    if (!viewing) setPanel('object-panel', true);
    onLayoutChange?.();
  }

  for (const button of buttons) button.addEventListener('click', () => {
    const next = button.dataset.workspaceMode;
    if (next === mode) return;
    setMode(next);
    onModeChange?.(next === 'person' || next === 'stage' ? next : 'view');
  });

  function openPanel(id) {
    let node = $(id);
    while (node) { if (node.tagName === 'DETAILS') node.open = true; node = node.parentElement; }
    onLayoutChange?.();
  }

  const errors = [...document.querySelectorAll('.error-message[role="alert"], #person-arrangement-feedback, #simulation-status, #catalog-status')];
  const errorKey = element => !element.hidden && (!['person-arrangement-feedback', 'simulation-status', 'catalog-status'].includes(element.id) || element.dataset.error === 'true') && element.dataset.state !== 'unconnected' ? element.textContent.trim() : '';
  const previousErrors = new Map(errors.map(element => [element, errorKey(element)]));
  const panels = [...document.querySelectorAll('details')];
  const errorLabels = new Map();
  for (const panel of panels) {
    const label = document.createElement('span'); label.className = 'panel-error-status'; label.hidden = true;
    label.setAttribute('role', 'status'); panel.querySelector(':scope > summary')?.append(label); errorLabels.set(panel, label);
    panel.addEventListener('toggle', () => {
      if (activeHelp && panel.contains(activeHelp.button) && !panel.open) closeHelp();
      onLayoutChange?.();
    });
  }
  function updateErrors() {
    for (const element of errors) {
      const current = errorKey(element);
      if (current && current !== previousErrors.get(element)) openPanel(element.id);
      previousErrors.set(element, current);
    }
    for (const panel of panels) {
      const messages = errors.filter(element => panel.contains(element)).map(errorKey).filter(Boolean);
      const label = errorLabels.get(panel); label.hidden = !messages.length;
      label.textContent = [...new Set(messages)].join(' ');
    }
  }
  const errorObserver = new MutationObserver(updateErrors);
  for (const element of errors) errorObserver.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-error'] });

  document.addEventListener('pointerdown', event => {
    if (activeHelp && !activeHelp.button.contains(event.target) && !activeHelp.popup.contains(event.target)) closeHelp();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !activeHelp) return;
    event.preventDefault(); event.stopPropagation(); closeHelp({ restoreFocus: true });
  });
  const closeDialogHelp = event => {
    if (activeHelp && event.target?.tagName === 'DIALOG' &&
        (event.target.contains(activeHelp.button) || event.target.contains(activeHelp.popup))) closeHelp();
  };
  document.addEventListener('close', closeDialogHelp, true);
  document.addEventListener('cancel', closeDialogHelp, true);
  document.addEventListener('focusin', event => {
    if (activeHelp && !activeHelp.button.contains(event.target) && !activeHelp.popup.contains(event.target)) closeHelp();
  });
  window.addEventListener('resize', placeHelp);
  document.addEventListener('scroll', placeHelp, true);
  syncButtons(); updateErrors();
  return {
    syncEditMode(editMode) { setMode(editMode === 'view' ? (mode === 'camera' ? 'camera' : 'seat') : editMode); },
    openPanel,
    closeHelp,
  };
}
