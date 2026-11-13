import { createSupabaseCatalogTransport } from './supabase-catalog-transport.js';

// Preparation only: never accepts a real credential or sends validation requests.
export const syntheticPublicPlaceholder = 'sb_publishable_theater3d_synthetic_mock_only';
export function validateSupabaseConnectionConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['supabaseUrl','publishableKey','deliveryEndpoint','mode'].includes(key))) return { state: 'invalid', code: 'INVALID_CONFIG' };
  const { supabaseUrl = '', publishableKey = '', deliveryEndpoint, mode = 'validate' } = input;
  if (!supabaseUrl && !publishableKey && deliveryEndpoint === undefined) return { state: 'unconfigured', code: 'NOT_CONFIGURED' };
  if (!supabaseUrl || !publishableKey) return { state: 'invalid', code: 'MISSING_FIELDS' };
  if (publishableKey !== syntheticPublicPlaceholder) return { state: 'invalid', code: 'PLACEHOLDER_REQUIRED' };
  if (!['validate', 'synthetic'].includes(mode)) return { state: 'invalid', code: 'INVALID_MODE' };
  let url;
  try { url = new URL(supabaseUrl); } catch { return { state: 'invalid', code: 'INVALID_URL' }; }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const state = createSupabaseCatalogTransport({ supabaseUrl, publishableKey, deliveryEndpoint, fetchImpl: () => { throw Error('Validation never fetches'); } }).getConnectionState();
  if (state.state !== 'configured') return { state: 'invalid', code: 'INVALID_CONFIG' };
  if (mode === 'synthetic' && !local) return { state: 'invalid', code: 'LOOPBACK_REQUIRED' };
  return { state: mode === 'synthetic' ? 'synthetic-ready' : 'validated-only', origin: url.origin };
}

// Compatibility for the already handed-off preparation smoke; canonical fields above.
export function validateSupabasePreparation({ endpoint = '', placeholder = '', mode = 'validate' } = {}) {
  return validateSupabaseConnectionConfig({ supabaseUrl: endpoint, publishableKey: placeholder, mode });
}

export function createSupabaseConnectionUI({ onApply, onDisconnect } = {}) {
  const panel = document.createElement('details'); panel.id = 'supabase-connection-panel'; panel.className = 'catalog-panel card';
  const title = document.createElement('summary'); title.textContent = 'Supabase 연결 준비'; panel.append(title);
  const body = document.createElement('div'); body.className = 'catalog-content'; panel.append(body);
  const note = document.createElement('p'); note.className = 'small-note'; note.textContent = '실제 키를 입력하지 마세요. 주소 형식 검증은 요청을 보내지 않습니다. 합성 로컬 서버만 적용할 수 있습니다.'; body.append(note);
  const fields = document.createElement('div'); fields.className = 'catalog-selectors'; body.append(fields);
  function field(id, text, type) {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement(type === 'select' ? 'select' : 'input'); input.id = id;
    if (type !== 'select') { input.type = type; input.autocomplete = 'off'; input.spellcheck = false; }
    label.append(input); fields.append(label); return input;
  }
  const endpoint = field('supabase-connection-url', '프로젝트 주소', 'text'); endpoint.placeholder = 'https://PROJECT.supabase.co';
  const key = field('supabase-connection-placeholder', '합성 공개 키 placeholder', 'password'); key.placeholder = syntheticPublicPlaceholder;
  const mode = field('supabase-connection-mode', '검증 범위', 'select');
  for (const [value, text] of [['validate','주소 형식만 검증'],['synthetic','합성 loopback 연결']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; mode.append(option); }
  const status = document.createElement('p'); status.id = 'supabase-connection-status'; status.className = 'small-note'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); body.append(status);
  const buttons = document.createElement('div'); buttons.className = 'button-row'; body.append(buttons);
  function button(id, text) { const el = document.createElement('button'); el.id = id; el.type = 'button'; el.className = 'quiet-button'; el.textContent = text; buttons.append(el); return el; }
  const validate = button('supabase-connection-validate','구성 검증');
  const apply = button('supabase-connection-apply','합성 연결 적용'); apply.disabled = true;
  const disconnect = button('supabase-connection-disconnect','조회 연결 해제');
  let result = null;
  function show(state, text) { status.dataset.state = state; status.textContent = text; }
  function reset() { result = null; apply.disabled = true; delete status.dataset.code; show('unconfigured','미연결 · 구성을 검증해도 실제 서비스에는 연결하지 않습니다.'); }
  reset();
  for (const input of [endpoint,key,mode]) input.addEventListener('input',reset);
  validate.addEventListener('click', () => {
    result = validateSupabaseConnectionConfig({ supabaseUrl: endpoint.value, publishableKey: key.value, mode: mode.value });
    if (result.state === 'invalid' || result.state === 'unconfigured') {
      key.value = ''; apply.disabled = true; status.dataset.code = result.code;
      show(result.state, result.state === 'unconfigured' ? '미연결 · 프로젝트 주소와 합성 placeholder를 입력하세요.' : '구성 오류 · 주소와 합성 placeholder 및 검증 범위를 확인하세요.'); return;
    }
    delete status.dataset.code;
    apply.disabled = result.state !== 'synthetic-ready';
    show(result.state, result.state === 'synthetic-ready' ? '합성 로컬 구성 검증 완료 · 적용하면 페이지를 다시 엽니다.' : '주소 형식 검증 완료 · 실제 인증·권한·자료 상태는 확인하지 않았습니다.');
  });
  apply.addEventListener('click', () => { if (result?.state === 'synthetic-ready') onApply?.({ origin: result.origin }); });
  disconnect.addEventListener('click', () => { key.value = ''; reset(); onDisconnect?.(); });
  document.getElementById('catalog-panel')?.before(panel);
  return { dispose() { key.value = ''; panel.remove(); result = null; } };
}
