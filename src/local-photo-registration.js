import { evaluatePhotoRegistrationLimits } from './photo-registration-preflight.js';

/** Presentation-only local synthetic management panel. Server callbacks are
 * wired by app.js after the model contract is confirmed. No public repository,
 * credential, storage or endpoint is selected by this module. onRegister must
 * resolve {confirmed:true} only after its server acknowledgement is validated.
 */
// Descriptor facts come only from the existing processor. No file bytes are read.
export function assessRegistrationSnapshot({ target, photo, assets = photo?.assets, requireBlobs = false } = {}) {
  const input = { target, processingStatus: photo?.processingStatus, fileByteSize: photo?.size, assets };
  const reported = evaluatePhotoRegistrationLimits(input);
  if (!requireBlobs || !['local','ts'].includes(target)) return reported;
  const measured = {}, mismatches = [];
  for (const role of ['original','display','thumbnail']) {
    const asset = assets?.[role], size = asset?.blob instanceof Blob ? asset.blob.size : undefined;
    measured[role] = asset ? { role, byteSize: size, pixelWidth: asset.pixelWidth, pixelHeight: asset.pixelHeight } : undefined;
    if (size !== asset?.byteSize || !Number.isSafeInteger(size) || size <= 0) mismatches.push({code:'asset-size-mismatch',role,actual:Number.isSafeInteger(size)&&size>0?size:null,limit:Number.isSafeInteger(asset?.byteSize)&&asset.byteSize>0?asset.byteSize:null,unit:'bytes'});
  }
  const actual = evaluatePhotoRegistrationLimits({ ...input, fileByteSize: measured.original?.byteSize, assets: measured });
  const issues = [...reported.issues,...actual.issues,...mismatches].filter((issue,index,all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(issue)) === index);
  const state = [reported.state,actual.state].includes('blocked') ? 'blocked' : photo?.processingStatus !== 'ready' ? 'not-ready' : reported.state === 'unknown' || actual.state === 'unknown' || mismatches.length ? 'unknown' : 'within-limits';
  return { ...reported, state, canSubmit: state === 'within-limits', issues };
}

export function createLocalPhotoRegistrationUI({ manager, getSelected = () => manager.getSnapshot().selected, onRegister = null, onReload = null, onRestore = null, target: registrationTarget = null } = {}) {
  const panel = document.createElement('details'); panel.id = 'local-photo-registration'; panel.className = 'catalog-panel card'; panel.open = true;
  const summary = document.createElement('summary'); summary.textContent = '합성 로컬 관리 · 비공개 사진'; panel.append(summary);
  const content = document.createElement('div'); content.className = 'catalog-content'; panel.append(content);
  const note = document.createElement('p'); note.className = 'small-note'; note.textContent = '합성 이미지의 격리된 로컬 저장만 사용합니다. 공개 조회·게시·외부 전송과 구분합니다.'; content.append(note);
  const target = document.createElement('p'); target.id = 'local-registration-target'; target.className = 'small-note'; content.append(target);
  const consent = document.createElement('label'); consent.className = 'check-label';
  const checkbox = document.createElement('input'); checkbox.id = 'local-registration-synthetic'; checkbox.type = 'checkbox'; consent.append(checkbox, document.createTextNode('선택한 파일이 합성 테스트 이미지임을 확인합니다.')); content.append(consent);
  const actions = document.createElement('div'); actions.className = 'simulation-actions'; content.append(actions);
  const button = (id, text, parent = actions) => { const element = document.createElement('button'); element.id = id; element.type = 'button'; element.className = 'quiet-button'; element.textContent = text; parent.append(element); return element; };
  const save = button('local-registration-save', '비공개 로컬 등록'), cancel = button('local-registration-cancel', '등록 요청 취소'), reload = button('local-registration-reload', '저장 목록 다시 읽기');
  const preflight = document.createElement('p'); preflight.id = 'local-registration-preflight'; preflight.className = 'small-note'; preflight.setAttribute('role','status'); preflight.setAttribute('aria-live','polite'); actions.after(preflight); save.setAttribute('aria-describedby',preflight.id);
  const status = document.createElement('p'); status.id = 'local-registration-status'; status.className = 'small-note'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); content.append(status);
  const list = document.createElement('div'); list.id = 'local-registration-list'; list.setAttribute('aria-label','비공개 로컬 관리 자료'); content.append(list);
  const preview = document.createElement('div'); preview.className = 'photo-dialog-preview'; preview.hidden = true;
  const image = document.createElement('img'); image.id = 'local-registration-preview'; image.alt = '비공개 로컬 저장 표시본 전체 구도 · 원본 HTTP 제공 없음'; preview.append(image); content.append(preview);
  document.querySelector('.photo-card').before(panel);
  let serial = 0, active = null, lastSelectedId = null, disposed = false;
  function message(text, state = 'ready') { status.textContent = text; status.dataset.state = state; status.dataset.error = String(state === 'failed'); }
  function showAssessment(result, photo, assets) {
    const route = result.target === 'local' ? '로컬 등록' : result.target === 'ts' ? 'TS 등록 · 합성 검사' : '등록 경로 미연결';
    const roleName = role => ({original:'원본',display:'표시본',thumbnail:'썸네일'})[role] || '사진';
    const bytes = value => Number.isSafeInteger(value) && value > 0 ? `${value} byte (${(value/1048576).toFixed(2)} MiB)` : '미확인';
    const explain = issue => {
      const name = roleName(issue.role), asset = assets?.[issue.role];
      if (issue.code === 'size-exceeded') return `${name} ${bytes(issue.actual)} · ${bytes(issue.limit)} 한도 초과`;
      if (issue.code === 'dimension-exceeded') { const dimensions = [asset?.pixelWidth,asset?.pixelHeight].every(v => Number.isSafeInteger(v)&&v>0) ? `${asset.pixelWidth}×${asset.pixelHeight} px` : `${issue.actual} px`; return `${name} ${dimensions} · 한 변 ${issue.limit} px 초과`; }
      if (issue.code === 'pixel-count-exceeded') return `${name} ${issue.actual} pixels · ${issue.limit} pixels 초과`;
      if (issue.code === 'asset-size-mismatch') return `${name} 실제 Blob 용량·processor 용량 불일치 또는 측정 불가`;
      if (issue.code === 'processing-not-ready') return ({processing:'사진 처리 중',failed:'사진 처리 실패',cancelled:'사진 처리 취소'})[photo?.processingStatus] || '사진 처리 준비 전';
      if (issue.code === 'target-unknown') return '명시한 등록 경로가 없습니다';
      return `${name} ${issue.code === 'dimensions-unknown' ? 'processor 치수' : issue.code === 'size-unknown' ? '용량' : '자산'} 측정 확인 불가`;
    };
    const primary = result.issues.find(issue => issue.code.endsWith('-exceeded')) || result.issues.find(issue => issue.code === 'asset-size-mismatch') || (result.state === 'not-ready' ? result.issues.find(issue => issue.code === 'processing-not-ready') : result.issues[0]);
    const reason = result.canSubmit ? '측정된 용량·치수 한도 확인 · 저장 확인 전' : primary ? explain(primary) : '등록 한도 확인 불가';
    preflight.textContent = `${route} · ${reason}${result.state === 'blocked' && photo?.processingStatus === 'failed' ? ' · 사진 처리 실패' : ''}`;
    preflight.dataset.state = result.state; preflight.dataset.target = result.target || 'unconnected'; preflight.dataset.code = primary?.code || '';
    const details = `${result.policy ? `${result.target==='browser-fhd'?`원본 ${bytes(result.policy.maxBytes)} · 파생본 ${bytes(25*1048576)}`:`자산별 ${bytes(result.policy.maxBytes)}`}, 한 변 ${result.policy.maxDimension} px${result.policy.maxPixels === null ? '' : `, ${result.policy.maxPixels} pixels`}. ` : ''}${result.issues.map(explain).join('; ')} 서버의 형식·복호화·권한·저장 검증은 별도이며 이 확인은 저장 완료가 아닙니다. 원본을 축소하거나 다시 인코딩하지 않습니다.`;
    preflight.title = details; preflight.setAttribute('aria-description',details);
  }
  function assessSelected(selected) {
    const ready = selected?.processingStatus === 'ready' ? manager.getReadyAssets(selected.id) : null;
    const photo = ready?.ok ? ready.value.photo : selected;
    const assets = ready?.ok ? ready.value.assets : selected?.assets;
    const result = assessRegistrationSnapshot({ target: registrationTarget, photo, assets, requireBlobs: selected?.processingStatus === 'ready' });
    showAssessment(result,photo,assets); return result;
  }
  function sync() {
    const selected = getSelected();
    if (selected?.id !== lastSelectedId) { checkbox.checked = false; lastSelectedId = selected?.id || null; }
    target.textContent = selected ? `${selected.name} · 등록 대상 ${selected.seatContext?.venueName || '극장 미확인'} / ${selected.seatContext?.seatLabel || '좌석 미확인'} · 파일 추가 당시 문맥 유지` : '현재 좌석에서 처리가 완료된 사진을 선택하세요.';
    const assessment = assessSelected(selected);
    save.disabled = !assessment.canSubmit || disposed || !!active || !onRegister || !checkbox.checked || selected?.processingStatus !== 'ready' || selected?.metadataStatus === 'loading' || !selected?.seatContext;
    reload.disabled = disposed || !!active || !onReload; cancel.hidden = !active || active.kind !== 'register';
    if (active?.kind === 'register' && active.photoId && !manager.getSnapshot().items.some(item => item.id === active.photoId)) cancelRequest();
  }
  function cancelRequest() {
    active?.controller.abort(); serial++; active = null;
    message('요청을 취소했습니다. 서버 저장 여부는 미확인입니다. 목록을 다시 읽어 확인하세요.', 'cancelled-unconfirmed'); sync();
  }
  async function operation(kind, work, success) {
    if (disposed || active) return;
    const controller = new AbortController(), generation = ++serial;
    active = { kind, controller }; sync();
    message(kind === 'register' ? '원본·표시본·썸네일을 로컬 등록 중입니다. 저장 확인 전에는 완료가 아닙니다.' : '비공개 로컬 자료를 읽고 있습니다.', 'loading');
    try {
      const value = await work(controller.signal);
      if (disposed || generation !== serial) return;
      success(value);
    } catch (error) {
      if (disposed || generation !== serial) return;
      if (error?.code === 'REGISTRATION_PREFLIGHT') { message('등록 한도 확인에서 중단했습니다. 원본과 기존 작업은 유지합니다.', 'preflight-blocked'); return; }
      message(error?.name === 'AbortError' ? '요청이 중단됐습니다. 저장 여부는 목록에서 다시 확인하세요.' : '로컬 작업에 실패했습니다. 원본은 유지합니다. 재시도하거나 목록을 확인하세요.', error?.name === 'AbortError' ? 'cancelled-unconfirmed' : 'failed');
    } finally { if (generation === serial) { active = null; sync(); } }
  }
  function renderList(rows) {
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || typeof row.label !== 'string')) throw new Error('Invalid management list');
    list.replaceChildren();
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'small-note'; empty.textContent = '저장한 비공개 관리 자료가 없습니다.'; list.append(empty); return; }
    for (const row of rows) {
      const article = document.createElement('div'); article.className = 'simulation-actions';
      const text = document.createElement('span'); text.textContent = `${row.label} · 비공개 로컬 자료`; article.append(text);
      const restore = button('', '이 자료 불러오기', article); restore.removeAttribute('id'); restore.dataset.photoId = row.id;
      restore.disabled = !onRestore;
      restore.addEventListener('click', () => operation('restore', signal => onRestore(row.id, { signal }), value => {
        if (!value?.previewUrl) throw new Error('Stored preview not loaded');
        image.src = value.previewUrl; preview.hidden = false;
        message(value.projected ? '비공개 로컬 표시본을 불러와 선택 좌석에 투영했습니다. 공개 목록에는 추가하지 않았습니다.' : '비공개 로컬 표시본 전체보기입니다. 배치·좌표가 미확인이므로 투영하지 않았습니다.');
      }));
      list.append(article);
    }
  }
  checkbox.addEventListener('change', sync);
  save.addEventListener('click', () => {
    sync(); const selected = getSelected(); if (save.disabled || !selected) return;
    const ready = manager.getReadyAssets(selected.id); if (!ready.ok) { message('사진 처리가 완료되지 않았습니다.', 'failed'); return; }
    const captured = ready.value;
    const assessment = assessRegistrationSnapshot({target:registrationTarget,photo:captured.photo,assets:captured.assets,requireBlobs:true});
    showAssessment(assessment,captured.photo,captured.assets);
    if (!assessment.canSubmit) { sync(); return; }
    operation('register', signal => { active.photoId = selected.id; return onRegister(captured, { signal }); }, value => {
      if (value?.confirmed !== true) throw new Error('Storage acknowledgement unconfirmed');
      message(`${captured.photo.name} · ${captured.photo.seatContext.seatLabel} 비공개 로컬 저장을 확인했습니다. 공개하지 않았습니다.`, 'saved-private');
    });
  });
  cancel.addEventListener('click', cancelRequest);
  reload.addEventListener('click', () => operation('list', signal => onReload({ signal }), rows => { renderList(rows); message(`${rows.length}개 비공개 로컬 관리 자료를 읽었습니다.`, rows.length ? 'ready' : 'empty'); }));
  message('로컬 서버 계약 연결 준비 중입니다. 저장 완료 상태가 아닙니다.', 'unconnected'); sync();
  return {
    sync,
    connect(callbacks) { const interrupted = active?.kind === 'register'; active?.controller.abort(); serial++; active = null; registrationTarget = callbacks.target ?? null; onRegister = callbacks.onRegister; onReload = callbacks.onReload; onRestore = callbacks.onRestore; message(interrupted ? '연결을 변경해 이전 요청을 중단했습니다. 서버 저장 여부는 미확인이므로 목록에서 확인하세요.' : '합성 로컬 관리 연결 준비됨 · 아직 등록하지 않았습니다.', interrupted ? 'cancelled-unconfirmed' : 'ready'); sync(); },
    load() { reload.click(); },
    fail(messageText) { message(messageText, 'failed'); },
    dispose() { disposed = true; active?.controller.abort(); serial++; active = null; panel.remove(); }
  };
}
