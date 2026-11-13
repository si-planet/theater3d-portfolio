import { normalizeSeatMediaContext, seatMediaContextKey } from './seat-media-context.js';
import { privateRegisteredPhotoMatchesSelection } from './private-photo-registration-read-contract.js';
import { createSeatNotes } from './seat-notes.js';

const localURL = value => typeof value === 'string' && value.startsWith('blob:') ? value : null;
const copyContext = value => value ? Object.freeze({ ...value }) : null;
const photoName = item => typeof item?.name === 'string' && item.name ? item.name : '사진';

/** Source2D local originals belong to the manager; private display URLs belong to the app. */
export function createSeatMediaPanel({ container, photoManager, getHostedPhotos = null, onSelectHostedPhoto = null, idPrefix = 'source-seat-media' } = {}) {
  if (!container?.append || !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(idPrefix)) throw new TypeError('A container and a valid idPrefix are required');
  for (const method of ['getSnapshot', 'addFiles', 'saveLocal', 'deleteLocal', 'whenLocalReady', 'subscribe']) {
    if (typeof photoManager?.[method] !== 'function') throw new TypeError(`Photo manager requires ${method}`);
  }
  const doc = container.ownerDocument;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text, action) => {
    const node = element('button', 'seat-media-panel__button', text); node.type = 'button';
    if (action) node.dataset.action = action;
    return node;
  };
  const root = element('section', 'seat-media-panel'); root.id = idPrefix; root.hidden = true;
  const heading = element('h3', 'seat-media-panel__heading', '사진과 의견'); heading.id = `${idPrefix}-title`;
  root.setAttribute('aria-labelledby', heading.id);
  const caption = element('p', 'seat-media-panel__context'); caption.id = `${idPrefix}-context`;
  const help = element('p', 'seat-media-panel__help', '이 브라우저에만 보관됩니다. 사진은 보관 버튼을 눌러야 남습니다.');
  const storageStatus = element('p', 'seat-media-panel__storage-status'); storageStatus.id = `${idPrefix}-storage-status`;
  const add = button('사진 추가'); add.id = `${idPrefix}-add`;
  const files = element('input'); files.id = `${idPrefix}-files`; files.type = 'file'; files.accept = 'image/*'; files.multiple = true; files.hidden = true;
  files.setAttribute('aria-label', '좌석 사진 파일 선택');
  const status = element('p', 'seat-media-panel__status'); status.id = `${idPrefix}-status`; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const gallery = element('div', 'seat-media-panel__photos'); gallery.id = `${idPrefix}-photos`; gallery.setAttribute('role', 'list');
  const notesHost = element('div', 'seat-media-panel__notes'); notesHost.id = `${idPrefix}-notes`;
  const dialog = element('dialog', 'seat-media-panel__delete-dialog'); dialog.id = `${idPrefix}-delete-dialog`;
  const deleteTitle = element('h4', '', '보관본 삭제'); deleteTitle.id = `${idPrefix}-delete-title`; dialog.setAttribute('aria-labelledby', deleteTitle.id);
  const deleteText = element('p');
  const cancelDelete = button('취소'); cancelDelete.id = `${idPrefix}-delete-cancel`;
  const confirmDelete = button('보관본 삭제'); confirmDelete.id = `${idPrefix}-delete-confirm`;
  const deleteActions = element('div', 'seat-media-panel__actions'); deleteActions.append(cancelDelete, confirmDelete);
  dialog.append(deleteTitle, deleteText, deleteActions);
  root.append(heading, caption, help, storageStatus, add, files, status, gallery, notesHost, dialog); container.append(root);

  let context = null, destroyed = false, pendingPick = null, pendingDelete = null, readinessFailed = false;
  let privatePhoto = null;
  const privateCards = new Set();
  let snapshot = { items: [], localStorageStatus: 'loading', localStorageIssues: [] };
  const notices = new Map(), busy = new Map();
  const keyOf = value => seatMediaContextKey(value);
  const currentKey = () => keyOf(context);
  const notes = createSeatNotes({ container: notesHost, idPrefix: `${idPrefix}-notes`, getContext: () => context });
  const currentPhoto = id => snapshot.items.find(item => item.id === id);
  const issueMessage = (issues, hasLocalCopy = false) => {
    const codes = (Array.isArray(issues) ? issues : []).map(issue => String(issue?.code || ''));
    if (codes.some(code => /QUOTA|CAPACITY|SPACE/i.test(code))) return `저장 공간이 부족합니다. 원본${hasLocalCopy ? '과 이전 보관본은' : '은 이 페이지에'} 남아 있습니다.`;
    if (codes.some(code => /BUSY/i.test(code))) return '사진을 처리 중입니다. 잠시 후 다시 시도하세요.';
    if (codes.some(code => /SECURITY|UNAVAILABLE|BLOCKED|UNSUPPORTED/i.test(code))) return '브라우저에서 사진 보관을 사용할 수 없습니다. 원본은 이 페이지에 남아 있습니다.';
    return hasLocalCopy ? '보관하지 못했습니다. 원본과 이전 보관본은 유지됩니다.' : '보관하지 못했습니다. 원본은 이 페이지에 남아 있습니다.';
  };
  const announce = (key, text, kind = 'info') => {
    if (key) notices.set(key, { text, kind });
    if (!destroyed && currentKey() === key) { status.textContent = text; status.dataset.state = kind; }
  };
  const closeDelete = () => {
    pendingDelete = null;
    if (dialog.open) dialog.close();
  };
  const refresh = () => {
    if (destroyed) return;
    try {
      const value = photoManager.getSnapshot();
      if (value && Array.isArray(value.items)) snapshot = value;
    } catch { readinessFailed = true; }
    render();
  };
  const runPhotoAction = async (kind, target) => {
    if (destroyed || busy.has(target.id)) return;
    const found = currentPhoto(target.id);
    if (!found || keyOf(found.seatContext) !== target.key || snapshot.localStorageStatus !== 'ready') return;
    if (found.localStatus === 'saving') { announce(target.key, '사진을 보관 중입니다. 잠시 후 다시 시도하세요.'); return; }
    const token = {}; busy.set(target.id, token); render();
    let result;
    try { result = await photoManager[kind === 'save' ? 'saveLocal' : 'deleteLocal'](target.id); }
    catch { result = { ok: false, issues: [{ code: 'FAILED' }] }; }
    if (busy.get(target.id) === token) busy.delete(target.id);
    if (destroyed) return;
    refresh();
    if (result?.ok) {
      const latest = currentPhoto(target.id);
      const savedText = latest?.hasLocalCopy && latest.localStatus !== 'saved'
        ? '보관했습니다. 이후 변경 내용은 아직 보관하지 않았습니다.' : '이 브라우저에 보관했습니다.';
      announce(target.key, kind === 'save' ? savedText : '보관본을 삭제했습니다. 이 페이지의 원본은 남아 있습니다.', 'success');
    } else announce(target.key, issueMessage(result?.issues, Boolean(found.hasLocalCopy)), 'error');
  };

  const scrubPrivateCards = () => {
    for (const card of privateCards) {
      for (const image of card.querySelectorAll('img')) { image.removeAttribute('src'); image.alt = ''; }
      card.replaceChildren(); card.remove();
    }
    privateCards.clear();
  };
  const dropPrivatePhoto = () => {
    const previous = privatePhoto; privatePhoto = null; scrubPrivateCards();
    if (previous) { try { previous.onClear(); } catch {} }
  };
  const privateIsCurrent = value => {
    if (!value || privatePhoto !== value || !privateRegisteredPhotoMatchesSelection(value.photo.seatContext, context)) return false;
    try { return value.isCurrent() === true && privatePhoto === value; } catch { return false; }
  };

  function render() {
    if (destroyed) return;
    if (privatePhoto && !privateIsCurrent(privatePhoto)) dropPrivatePhoto();
    const key = currentKey(), ready = !readinessFailed && snapshot.localStorageStatus === 'ready';
    root.hidden = !context; add.disabled = files.disabled = !context;
    help.textContent = privatePhoto?.photo.publicSeatRecord?'공개된 FHD 좌석 사진입니다. 원본과 개인 촬영정보는 제공하지 않습니다.':privatePhoto ? '로컬 사진은 보관 버튼을 눌러야 이 브라우저에 남습니다. 개인 계정 표시본은 별도로 보관하지 않습니다.' : '이 브라우저에만 보관됩니다. 사진은 보관 버튼을 눌러야 남습니다.';
    caption.textContent = context ? [context.venueName, context.seatLabel].filter(Boolean).join(' · ') || '선택한 좌석' : '';
    if (readinessFailed || ['error', 'unavailable'].includes(snapshot.localStorageStatus)) {
      storageStatus.textContent = '사진 보관을 불러오지 못했습니다. 원본은 유지됩니다. 새로고침 후 다시 확인하세요.';
      storageStatus.dataset.state = 'error';
    } else {
      storageStatus.textContent = snapshot.localStorageStatus === 'loading' ? '보관한 사진을 불러오는 중입니다.' : '';
      storageStatus.dataset.state = 'info';
    }
    const notice = notices.get(key); status.textContent = notice?.text || ''; status.dataset.state = notice?.kind || 'info';
    const focused = doc.activeElement, focusedId = focused?.closest?.('[data-photo-id]')?.dataset.photoId, focusedAction = focused?.dataset.action;
    scrubPrivateCards(); gallery.replaceChildren();
    const items = key ? snapshot.items.filter(item => keyOf(item.seatContext) === key) : [];
    if (privatePhoto) items.push(privatePhoto.photo);
    let hosted={status:'unconfigured',items:[]};try{hosted=getHostedPhotos?.(context)??hosted;}catch{}
    const existing=new Set(items.map(p=>p.id));
    const hostedItems=(hosted.items??[]).filter(p=>!existing.has(p.photoId)&&privateRegisteredPhotoMatchesSelection(p.sourceSeatContext,context));
    if(!items.length&&!hostedItems.length)gallery.append(element('p','seat-media-panel__empty',hosted.status==='loading'?'이 좌석의 서버 사진을 조회하고 있습니다.':hosted.status==='error'?'서버 사진을 불러오지 못했습니다.':'이 좌석에 추가한 사진이 없습니다.'));
    for(const photo of hostedItems){
      const card=element('article','seat-media-panel__photo');card.dataset.photoId=photo.photoId;card.dataset.privateRecord='true';card.setAttribute('role','listitem');privateCards.add(card);
      const show=button('사진 보기','hosted-photo');
      show.addEventListener('click',async()=>{const captured=currentKey();show.disabled=true;try{await onSelectHostedPhoto?.(photo.photoId,copyContext(context));}catch{if(captured===currentKey())announce(captured,'서버 사진을 불러오지 못했습니다. 다시 시도해 주세요.','error');}finally{if(!destroyed&&captured===currentKey())render();}});
      card.append(element('h4','seat-media-panel__filename',photo.originalFilename),element('p','seat-media-panel__copy-status',photo.publicSeatRecord?'공개 좌석 사진':'개인 계정에 연결된 좌석 사진'),show);gallery.append(card);
    }
    for (const item of items) {
      const card = element('article', 'seat-media-panel__photo'); card.dataset.photoId = item.id; card.setAttribute('role', 'listitem');
      const isPrivate = privatePhoto?.photo === item;
      if (isPrivate) { card.dataset.privateRecord = 'true'; privateCards.add(card); }
      const name = element('h4', 'seat-media-panel__filename', photoName(item));
      const thumbnail = localURL(item.thumbnailUrl) || localURL(item.displayUrl);
      if (thumbnail) {
        const image = element('img', 'seat-media-panel__thumbnail'); image.src = thumbnail; image.alt = `${photoName(item)} 미리보기`; image.loading = 'lazy'; card.append(image);
      } else card.append(element('p', 'seat-media-panel__preview-pending', ['failed', 'cancelled'].includes(item.processingStatus) ? '미리보기를 만들지 못했습니다. 원본은 내려받을 수 있습니다.' : '미리보기 준비 중…'));
      if (isPrivate) {
        card.append(name, element('p', 'seat-media-panel__copy-status', item.publicSeatRecord?'공개 FHD 표시본':'개인 계정 표시본 · 이 브라우저에 보관하지 않음'));
        // Keep the chosen display above the remaining choices, so the click
        // cannot appear to do nothing inside the short scrolling sidebar.
        gallery.replaceChildren(card, ...gallery.children); continue;
      }
      const working = busy.has(item.id) || item.localStatus === 'saving', hasCopy = item.hasLocalCopy === true;
      let copyText = hasCopy ? '브라우저에 보관됨' : '이 페이지에만 있음';
      if (working) copyText = '처리 중…';
      else if (hasCopy && item.localStatus === 'unsaved') copyText = '변경 내용 미보관 · 이전 보관본 있음';
      else if (item.localStatus === 'error') copyText = hasCopy ? '보관 실패 · 이전 보관본 유지' : '보관하지 못함 · 원본 유지';
      const copyStatus = element('p', 'seat-media-panel__copy-status', copyText); copyStatus.dataset.localStatus = item.localStatus || 'unsaved';
      card.append(name, copyStatus);
      if (item.localStatus === 'error' && item.localIssues?.length) card.append(element('p', 'seat-media-panel__error', issueMessage(item.localIssues, hasCopy)));
      if (item.metadataStatus === 'reading') card.append(element('p', 'seat-media-panel__metadata-status', '촬영정보 확인 중…'));
      const actions = element('div', 'seat-media-panel__actions');
      const save = button(hasCopy && item.localStatus === 'unsaved' ? '변경 내용 보관' : '브라우저에 보관', 'save-local');
      save.disabled = !ready || working || (hasCopy && item.localStatus === 'saved');
      save.addEventListener('click', () => { void runPhotoAction('save', { id: item.id, key }); });
      actions.append(save);
      const original = localURL(item.url);
      if (original) {
        const download = element('a', 'seat-media-panel__button', '원본 내려받기'); download.dataset.action = 'download-original'; download.href = original; download.download = photoName(item); actions.append(download);
      }
      if (hasCopy) {
        const remove = button('보관본 삭제', 'delete-local'); remove.disabled = !ready || working;
        remove.addEventListener('click', () => {
          const found = currentPhoto(item.id);
          if (destroyed || currentKey() !== key || !found?.hasLocalCopy || busy.has(item.id) || found.localStatus === 'saving') return;
          pendingDelete = { id: item.id, key };
          deleteText.textContent = `${photoName(found)}의 보관본을 삭제할까요? 이 페이지의 원본은 남습니다.`;
          try { dialog.showModal(); }
          catch { pendingDelete = null; announce(key, '삭제 확인창을 열지 못했습니다. 다시 시도하세요.', 'error'); }
        });
        actions.append(remove);
      }
      card.append(actions); gallery.append(card);
    }
    if (pendingDelete) {
      const item = currentPhoto(pendingDelete.id);
      if (pendingDelete.key !== key || !item?.hasLocalCopy || keyOf(item.seatContext) !== pendingDelete.key) closeDelete();
    }
    if (focusedId && focusedAction) {
      const card = [...gallery.children].find(node => node.dataset.photoId === focusedId);
      const target = card && [...card.querySelectorAll('[data-action]')].find(node => node.dataset.action === focusedAction);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  add.addEventListener('click', () => { if (context && !destroyed) { files.value = ''; files.click(); } });
  files.addEventListener('click', () => { pendingPick = copyContext(normalizeSeatMediaContext(context)); });
  files.addEventListener('cancel', () => { pendingPick = null; files.value = ''; });
  files.addEventListener('change', async () => {
    const captured = pendingPick, incoming = Array.from(files.files || []); pendingPick = null; files.value = '';
    if (destroyed || !incoming.length) return;
    if (!captured) { announce(currentKey(), '사진 추가를 다시 눌러 주세요.', 'error'); return; }
    const capturedKey = keyOf(captured), beforeIds = new Set(snapshot.items.map(item => item.id));
    try {
      const result = await photoManager.addFiles(incoming, { seatContext: captured });
      if (destroyed) return;
      refresh();
      const errors = result?.errors;
      if (Array.isArray(errors) && errors.length) announce(capturedKey, errors.map(String).join(' '), 'error');
      else {
        const count = snapshot.items.filter(item => !beforeIds.has(item.id) && keyOf(item.seatContext) === capturedKey).length;
        announce(capturedKey, count ? `사진 ${count}개를 추가했습니다. 남기려면 브라우저에 보관하세요.` : '추가한 사진이 없습니다.');
      }
    } catch { announce(capturedKey, '사진을 추가하지 못했습니다. 선택한 원본 파일은 변경하지 않았습니다.', 'error'); }
  });
  cancelDelete.addEventListener('click', closeDelete);
  dialog.addEventListener('cancel', () => { pendingDelete = null; });
  dialog.addEventListener('close', () => { pendingDelete = null; });
  confirmDelete.addEventListener('click', () => {
    const target = pendingDelete; closeDelete();
    if (!target || destroyed || target.key !== currentKey()) return;
    void runPhotoAction('delete', target);
  });
  const unsubscribe = photoManager.subscribe(refresh);
  refresh();
  Promise.resolve().then(() => photoManager.whenLocalReady()).then(() => { if (!destroyed) { readinessFailed = false; refresh(); } })
    .catch(() => { if (!destroyed) { readinessFailed = true; render(); } });
  return {
    refreshHostedPhotos() { if(!destroyed)render(); },
    setHostedNotes(connection) { notes.setHosted(connection); },
    getContext() { return destroyed ? null : copyContext(context); },
    setPrivatePhoto(photo, { isCurrent, onClear } = {}) {
      if (destroyed || photo?.privateRecord !== true && photo?.publicSeatRecord !== true || typeof photo.id !== 'string' || !photo.id
          || !localURL(photo.displayUrl) || typeof isCurrent !== 'function' || typeof onClear !== 'function'
          || !privateRegisteredPhotoMatchesSelection(photo.seatContext, context)
          || snapshot.items.some(item => item.id === photo.id)) return false;
      // Identity was matched above. Labels come from the current trusted UI,
      // not the deliberately label-free server/public photo identity.
      const selected = normalizeSeatMediaContext(context);
      if (!selected) return false;
      let valid = false; try { valid = isCurrent() === true; } catch {} if (!valid) return false;
      dropPrivatePhoto();
      const value = { photo: { id: photo.id, name: photoName(photo), privateRecord:photo.privateRecord===true, publicSeatRecord:photo.publicSeatRecord===true, displayUrl: photo.displayUrl,
        seatContext: copyContext(selected), processingStatus: 'ready' }, isCurrent, onClear };
      privatePhoto = value; render();
      return privatePhoto === value && privateIsCurrent(value);
    },
    clearPrivatePhoto() { dropPrivatePhoto(); if (!destroyed) render(); },
    setContext(value) {
      if (destroyed) return;
      const next = normalizeSeatMediaContext(value);
      const changed = keyOf(next) !== currentKey();
      if (changed) closeDelete();
      context = copyContext(next); if (changed) dropPrivatePhoto(); notes.sync(); refresh();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; pendingPick = null; closeDelete(); dropPrivatePhoto();
      if (typeof unsubscribe === 'function') unsubscribe();
      notes.destroy?.(); files.value = ''; root.remove();
    },
  };
}
