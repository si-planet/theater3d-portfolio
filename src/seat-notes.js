import { normalizeSeatMediaContext, seatMediaContextKey } from './seat-media-context.js';
import { createOwnedSeatNotes } from './private-seat-notes-owner-ui.js';

const STORAGE_KEY = 'theater3d-portfolio.seat-notes.v1';
const MAX_LENGTH = 2000;

/** Private notes for one exact venue/layout/seat. Drafts never autosave. */
export function createSeatNotes({ container, getContext, idPrefix = '', hosted = null }) {
  if (typeof idPrefix !== 'string' || idPrefix.length > 300 || /[\s\u0000-\u001f\u007f]/.test(idPrefix)) {
    throw new TypeError('idPrefix must be an ID prefix without whitespace');
  }
  const doc = container.ownerDocument;
  const id = suffix => idPrefix ? `${idPrefix}-${suffix}` : suffix;
  const section = doc.createElement('section');
  section.className = 'seat-notes';
  const label = doc.createElement('label');
  label.htmlFor = id('seat-opinion');
  const input = doc.createElement('textarea');
  input.id = id('seat-opinion');
  input.rows = 3;
  input.maxLength = MAX_LENGTH;
  input.placeholder = '이 좌석에서 확인한 내용을 적어 두세요.';
  input.setAttribute('aria-describedby', id('seat-opinion-status'));
  const save = doc.createElement('button');
  save.id = id('seat-opinion-save');
  save.type = 'button';
  save.className = 'quiet-button';
  save.textContent = '이 브라우저에 저장';
  const status = doc.createElement('p');
  status.id = id('seat-opinion-status');
  status.className = 'small-note';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  section.append(label, input, save, status);
  container.append(section);

  const drafts = new Map();
  let currentKey = null;
  let destroyed = false;
  let hostedNotes = null;
  function setHosted(connection) {
    hostedNotes?.destroy(); hostedNotes = null;
    if (destroyed || connection === null) return;
    hostedNotes = createOwnedSeatNotes({ container, getContext, idPrefix, connection,
      getBrowserDraft() {
        const selected = context();
        return !destroyed && selected?.key === currentKey
          ? { contextKey: currentKey, text: input.value } : null;
      },
    });
  }

  function context() {
    try {
      const value = getContext();
      if (!value || typeof value !== 'object') return null;
      if ('kind' in value) {
        const kind = Object.getOwnPropertyDescriptor(value, 'kind');
        // Do not evaluate getters or accept an inherited/unsupported kind.
        if (!kind || !Object.hasOwn(kind, 'value')) return null;
        if (kind.value === 'source2d') {
          const selected = normalizeSeatMediaContext(value);
          return selected ? { key: seatMediaContextKey(selected), label: selected.seatLabel } : null;
        }
        if (kind.value !== undefined) return null;
      }
      if (!value.venueId || !value.layoutVersionId ||
          value.seat?.row === null || value.seat?.row === undefined ||
          value.seat?.number === null || value.seat?.number === undefined) return null;
      const parts = [value.venueId, value.layoutVersionId, value.seat.row, value.seat.number];
      if (parts.some(part => !['string', 'number'].includes(typeof part) ||
          (typeof part === 'number' && !Number.isFinite(part)) || part === '')) return null;
      return {
        key: JSON.stringify(parts),
        label: value.seatLabel || `${value.seat.row}열 ${value.seat.number}번`,
      };
    } catch { return null; }
  }

  function readNotes() {
    const raw = doc.defaultView.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return Object.create(null);
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) {
      throw new Error('Unrecognized seat-note storage');
    }
    const notes = Object.create(null);
    for (const [key, text] of Object.entries(data.notes)) {
      if (typeof text !== 'string' || text.length > MAX_LENGTH) throw new Error('Invalid seat note');
      notes[key] = text;
    }
    return notes;
  }

  function draftFor(key) {
    if (drafts.has(key)) return drafts.get(key);
    let text = '', message = '저장된 의견이 없습니다. 저장하면 이 브라우저에만 보관됩니다.';
    try {
      text = readNotes()[key] || '';
      if (text) message = '이 브라우저에 저장된 의견입니다.';
    } catch {
      message = '이 브라우저의 저장된 의견을 읽지 못했습니다. 입력한 글은 저장 전까지 메모리에만 보관됩니다.';
    }
    const draft = { text, persistedText: text, message };
    drafts.set(key, draft);
    return draft;
  }

  function rememberInput() {
    if (!currentKey) return;
    const draft = draftFor(currentKey);
    if (draft.text !== input.value) {
      draft.text = input.value;
      draft.message = input.value.length > MAX_LENGTH
        ? '의견은 2,000자까지 저장할 수 있습니다. 입력한 글은 유지했습니다.'
        : input.value !== draft.persistedText
          ? '미저장 의견입니다. 좌석을 옮겨도 이 페이지에서 초안을 보관합니다.'
          : draft.persistedText ? '이 브라우저에 저장된 의견입니다.' : '저장된 의견이 없습니다.';
    }
    status.textContent = draft.message;
  }

  function sync() {
    if (destroyed) return;
    const next = context();
    if (next?.key !== currentKey) {
      rememberInput();
      currentKey = next?.key || null;
      input.value = currentKey ? draftFor(currentKey).text : '';
    }
    label.textContent = next ? `${next.label} · 개인 의견` : '좌석 개인 의견';
    input.disabled = save.disabled = !next;
    status.textContent = currentKey
      ? draftFor(currentKey).message
      : '좌석을 선택하면 개인 의견을 적을 수 있습니다.';
    hostedNotes?.sync();
  }

  input.addEventListener('input', rememberInput);
  function saveNote() {
    if (destroyed) return;
    const next = context();
    if (!next || next.key !== currentKey) {
      sync();
      if (next) status.textContent = '좌석이 바뀌었습니다. 입력 내용을 확인한 뒤 저장하세요.';
      return;
    }
    rememberInput();
    const draft = draftFor(currentKey);
    if (draft.text.length > MAX_LENGTH) {
      draft.message = '의견은 2,000자까지 저장할 수 있습니다. 입력한 글은 유지했습니다.';
      status.textContent = draft.message;
      return;
    }
    try {
      // Re-read before writing so another seat's stored note is not lost.
      const notes = readNotes();
      if (draft.text === '') delete notes[currentKey];
      else notes[currentKey] = draft.text;
      doc.defaultView.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, notes }));
      draft.persistedText = draft.text;
      draft.message = draft.text === ''
        ? '이 브라우저에 저장된 현재 좌석의 의견을 지웠습니다.'
        : '이 브라우저에 저장했습니다.';
    } catch {
      draft.message = '저장하지 못했습니다. 입력한 글은 이 페이지에 유지됩니다. 다시 저장해 주세요.';
    }
    status.textContent = draft.message;
  }
  save.addEventListener('click', saveNote);

  sync();
  if (hosted !== null) setHosted(hosted);
  return {
    sync,
    setHosted,
    destroy() {
      if (destroyed) return;
      rememberInput(); destroyed = true;
      hostedNotes?.destroy(); hostedNotes = null;
      input.removeEventListener('input', rememberInput);
      save.removeEventListener('click', saveNote);
      section.remove();
    },
  };
}
