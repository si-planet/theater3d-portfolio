import { focalControlMm } from './camera-config.js';
import { createCatalogTransport, createCatalogRepository } from './catalog-repository.js';
import { createPhotoRepository } from './photo-repository.js';
import { createAssetRepository } from './asset-repository.js';

const $ = id => document.getElementById(id);
const period = value => !value || value.status === 'unknown' ? '기간 미확인' : `${value.start?.value || '시작 미확인'} ~ ${value.end?.value || '종료 미확인'}`;
const match = (text, query) => String(text || '').normalize('NFKC').toLocaleLowerCase().includes(query.normalize('NFKC').toLocaleLowerCase().trim());

// Public repository DTOs stay separate from session File/EXIF management.
export function createCatalogUI({ baseUrl = location.origin, transport = null, synthetic = false, connected = true, configurationError = '', connectionKind = 'catalog', onContext = () => false, onClear = () => {}, onProject = () => false, onSelection = () => {} } = {}) {
  let selectedTransport = null;
  if (connected && !configurationError) {
    try {
      if (transport !== null && typeof transport?.request !== 'function') throw new Error('Invalid transport');
      selectedTransport = transport || createCatalogTransport({ baseUrl });
    } catch { configurationError = '조회 연결 구성이 올바르지 않습니다. 설정을 확인하세요.'; }
  }
  const catalog = selectedTransport ? createCatalogRepository({ transport: selectedTransport }) : null;
  const photos = selectedTransport ? createPhotoRepository({ transport: selectedTransport }) : null;
  const assets = selectedTransport ? createAssetRepository({ transport: selectedTransport }) : null;
  let controller = new AbortController(), generation = 0, imageController = null, imageGeneration = 0;
  let venues = [], works = [], names = new Map(), runs = [], layouts = [], seats = [], photoList = [], nextCursor = null;
  let selected = { venue: null, work: null, run: null, layout: null, seat: null }, projectionReady = false, activePhoto = null, retry = null;
  const selectedCopy = () => structuredClone(selected);
  function verifyDelivery(delivery, photoId) {
    if (delivery.photoId !== photoId) throw new Error('이미지 연결 불일치');
    if (synthetic) {
      const url = new URL(delivery.deliveryUrl);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.origin !== new URL(baseUrl).origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('합성 표시본 주소가 로컬 연결 범위를 벗어났습니다.');
    }
  }
  function status(message, kind = 'ready') {
    $('catalog-status').textContent = message; $('catalog-status').dataset.state = kind;
    $('catalog-status').dataset.error = String(['error', 'unavailable', 'unconnected', 'configuration-error'].includes(kind));
    $('catalog-retry').hidden = !retry;
  }
  function invalidate() {
    controller.abort(); controller = new AbortController(); generation++;
    cancelImage(); onClear(); projectionReady = false; photoList = []; nextCursor = null;
    $('catalog-photos').replaceChildren(); $('catalog-more').hidden = true;
    $('catalog-photo-dialog').close(); $('catalog-projection-note').textContent = '';
    return { signal: controller.signal, serial: generation };
  }
  function cancelImage() {
    imageController?.abort(); imageGeneration++; activePhoto = null;
    $('catalog-photo-image').removeAttribute('src'); $('catalog-photo-project').disabled = true;
  }
  async function all(method, options, signal) {
    const items = []; let cursor, revision;
    const seen = new Set();
    do {
      const result = await method({ ...options, limit: 100, ...(cursor ? { cursor, revision } : {}), signal });
      if (revision && result.revision !== revision) throw new Error('자료 버전이 바뀌었습니다. 다시 조회하세요.');
      revision = result.revision; items.push(...result.items); cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error('페이지 응답을 확인할 수 없습니다.');
      seen.add(cursor);
      if (seen.size > 1000) throw new Error('목록이 너무 큽니다.');
    } while (cursor);
    return items;
  }
  async function task(action, work) {
    const { signal, serial } = invalidate(); retry = null; status('자료를 불러오고 있습니다.', 'loading');
    try {
      await work(signal, serial);
      if (serial !== generation) return;
      retry = null; status(photoList.length ? `${photoList.length}장 · 게시된 공개 표시본` : selected.seat ? '이 좌석의 게시 사진이 없습니다.' : '조회할 극장·공연·배치·좌석을 선택하세요.', selected.seat && !photoList.length ? 'empty' : 'ready');
    } catch (error) {
      if (serial !== generation || error.name === 'AbortError') return;
      retry = action;
      const kind = error.code === 'NOT_FOUND' && !venues.length ? 'unconnected' : error.code === 'SERVICE_UNAVAILABLE' ? 'unavailable' : 'error';
      status(kind === 'unconnected' ? '온라인 자료 미연결 · 기존 도면과 개인 시뮬레이션은 사용할 수 있습니다.' : kind === 'unavailable' ? '온라인 자료 일시 중지 · 다시 시도하세요.' : '자료 조회 실패 · 다시 시도하세요.', kind);
    }
  }
  function options(id, items, label, placeholder, value) {
    const select = $(id); select.replaceChildren(new Option(placeholder, ''));
    for (const item of items) select.add(new Option(label(item), item.id));
    select.value = value || ''; select.disabled = !items.length;
  }
  function filterVenues() {
    const q = $('catalog-search').value;
    options('catalog-venue', venues.filter(v => [v.displayName, v.officialName, ...(v.aliases || []), ...(names.get(v.id) || []).map(n => n.name)].some(n => match(n, q))), v => `${v.displayName}${q && !match(v.displayName, q) ? ' · 과거 명칭 일치' : ''}`, '극장 선택', selected.venue?.id);
  }
  function filterWorks() {
    const q = $('catalog-work-search').value;
    options('catalog-work', works.filter(w => [w.title, ...(w.alternateTitles || [])].some(n => match(n, q))), w => w.title, '전체 작품', selected.work?.id);
  }
  function filterSeats() { options('catalog-seat', seats.filter(s => match(s.officialLabel, $('catalog-seat-search').value)), s => `${s.officialLabel}${s.projectionEligible ? '' : ' · 위치 미확인'}`, '좌석 선택', selected.seat?.id); }
  function sync() {
    filterVenues(); filterWorks();
    options('catalog-run', runs, r => `${r.displayTitle} · ${period(r.runPeriod)}`, '공연 선택', selected.run?.id);
    options('catalog-layout', selected.run?.layoutVersionId ? layouts.filter(l => l.id === selected.run.layoutVersionId) : layouts, l => `${l.label || l.id} · ${period(l.validPeriod)}`, '배치 선택', selected.layout?.id);
    filterSeats();
    $('catalog-context').textContent = [selected.venue?.displayName, selected.run && `${selected.run.displayTitle} (${period(selected.run.runPeriod)})`, selected.layout?.label || selected.layout?.id, selected.seat?.officialLabel].filter(Boolean).join(' · ');
    // Observation posts use the selected canonical seat even when a 3D
    // projection is unavailable; no coordinate/label matching is introduced.
    onSelection(selectedCopy());
  }
  async function start() {
    if (configurationError) { retry = null; status(configurationError, 'configuration-error'); return; }
    if (!connected) { retry = null; status('온라인 자료 미연결 · 기존 도면과 개인 시뮬레이션은 사용할 수 있습니다.', 'unconnected'); return; }
    await task(start, async(signal, serial) => {
      const found = await all(catalog.listVenues, {}, signal), foundWorks = await all(catalog.listWorks, {}, signal), foundNames = new Map();
      for (const v of found) foundNames.set(v.id, await all(catalog.listVenueNames, { venueId: v.id }, signal));
      if (serial !== generation) return;
      venues = found; works = foundWorks; names = foundNames; sync();
      if (!venues.length) status('게시된 극장이 없습니다.', 'empty');
    });
    if (!venues.length && !retry && $('catalog-status').dataset.state !== 'loading') status('게시된 극장이 없습니다.', 'empty');
  }
  async function chooseVenue() {
    const id = $('catalog-venue').value;
    selected = { venue: venues.find(v => v.id === id) || null, work: null, run: null, layout: null, seat: null }; runs = []; layouts = []; seats = []; sync();
    if (!selected.venue) { invalidate(); status('극장을 선택하세요.'); return; }
    await task(chooseVenue, async(signal, serial) => {
      const venueId = selected.venue.id;
      const foundRuns = await all(catalog.listRuns, { venueId }, signal), foundLayouts = await all(catalog.listLayouts, { venueId }, signal);
      if (serial !== generation) return; runs = foundRuns; layouts = foundLayouts; sync();
    });
  }
  async function chooseWork() {
    selected.work = works.find(w => w.id === $('catalog-work').value) || null;
    selected.run = selected.layout = selected.seat = null; seats = []; sync();
    if (!selected.venue) return;
    await task(chooseWork, async(signal, serial) => {
      const result = await all(catalog.listRuns, { venueId: selected.venue.id, ...(selected.work ? { workId: selected.work.id } : {}) }, signal);
      if (serial !== generation) return; runs = result; sync();
    });
  }
  async function chooseRun() {
    selected.run = runs.find(r => r.id === $('catalog-run').value) || null;
    selected.layout = layouts.find(l => l.id === selected.run?.layoutVersionId) || null; selected.seat = null; seats = []; sync();
    if (selected.run && !selected.run.layoutVersionId) {
      invalidate(); status('이 공연의 배치 미확인 · 사진 갤러리만 조회합니다.'); await gallery(); return;
    }
    await chooseLayout(selected.layout?.id);
  }
  async function chooseLayout(forcedId) {
    const id = typeof forcedId === 'string' ? forcedId : $('catalog-layout').value;
    selected.layout = layouts.find(l => l.id === id) || null; selected.seat = null; seats = []; sync();
    if (!selected.layout) { invalidate(); status('배치를 선택하세요.'); return; }
    await task(() => chooseLayout(id), async(signal, serial) => {
      const result = await all(catalog.listSeats, { venueId: selected.venue.id, layoutVersionId: id }, signal);
      if (serial !== generation) return; seats = result; sync();
    });
  }
  async function chooseSeat() {
    selected.seat = seats.find(s => s.id === $('catalog-seat').value) || null; sync(); await gallery();
  }
  function photoMatches(photo, context) {
    return photo.venueId === context.venue?.id && photo.layoutVersionId === (context.layout?.id || null) && photo.seatId === (context.seat?.id || null)
      && (!context.run || photo.productionRunId === context.run.id);
  }
  function filter() {
    return { venueId: selected.venue.id, ...(selected.layout ? { layoutVersionId: selected.layout.id } : {}), ...(selected.seat ? { seatId: selected.seat.id } : {}), ...(selected.run ? { productionRunId: selected.run.id } : {}) };
  }
  async function gallery() {
    if (!selected.venue) return;
    await task(gallery, async(signal, serial) => {
      const context = selectedCopy();
      const eligible = Boolean(context.layout && context.seat?.projectionEligible);
      projectionReady = eligible && Boolean(await onContext(context, { signal }));
      if (serial !== generation) return;
      $('catalog-projection-note').textContent = projectionReady ? '선택 배치의 정확한 좌석에서 3D 비교할 수 있습니다.' : '배치·좌표 또는 모델 연결 미확인 · 전체보기만 가능합니다. 아래 3D는 별도 도면입니다.';
      const result = await photos.listPhotos({ ...filter(), limit: 12, signal });
      if (serial !== generation) return; photoList = result.items; nextCursor = result.nextCursor;
      await drawPhotos(signal, serial);
    });
  }
  async function drawPhotos(signal, serial) {
    $('catalog-photos').replaceChildren();
    for (const photo of photoList) {
      const button = document.createElement('button'), image = document.createElement('img'), caption = document.createElement('span');
      button.type = 'button'; button.dataset.photoId = photo.id; image.alt = ''; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
      caption.textContent = `${photo.caption || '공개 표시본'} · ${focalControlMm(photo.metadata.focalLength35Mm) ?? '화각 미확인'}${photo.metadata.focalLength35Mm ? ' mm 환산' : ''}`;
      button.append(image, caption); button.addEventListener('click', () => openPhoto(photo)); $('catalog-photos').append(button);
      try {
        const delivery = await assets.getDelivery(photo.displayAssetId, { signal });
        if (serial !== generation) return;
        verifyDelivery(delivery.item, photo.id);
        image.src = delivery.item.deliveryUrl;
        image.onerror = () => { image.removeAttribute('src'); caption.textContent = '이미지 로딩 실패 · 전체보기에서 다시 조회'; };
      } catch (error) { if (error.name === 'AbortError') return; caption.textContent = '이미지 조회 실패 · 전체보기에서 다시 조회'; }
    }
    $('catalog-more').hidden = !nextCursor;
  }
  async function more() {
    if (!nextCursor || !selected.venue) return;
    const serial = generation, signal = controller.signal; $('catalog-more').disabled = true; retry = null; status('다음 사진을 불러옵니다.', 'loading');
    try {
      const result = await photos.listPhotos({ ...filter(), limit: 12, cursor: nextCursor, signal });
      if (serial !== generation) return;
      const ids = new Set(photoList.map(p => p.id)); photoList.push(...result.items.filter(p => !ids.has(p.id))); nextCursor = result.nextCursor;
      await drawPhotos(signal, serial); if (serial === generation) status(`${photoList.length}장 · 게시된 공개 표시본`);
    } catch (error) { if (serial === generation && error.name !== 'AbortError') { retry = more; status('다음 사진 조회 실패 · 다시 시도하세요.', 'error'); } }
    finally { $('catalog-more').disabled = false; }
  }
  async function openPhoto(photo) {
    cancelImage(); imageController = new AbortController(); const serial = imageGeneration, catalogSerial = generation, context = selectedCopy(), signal = imageController.signal;
    $('catalog-photo-dialog').showModal(); $('catalog-photo-title').textContent = photo.caption || '공개 표시본 전체보기';
    $('catalog-photo-status').textContent = '표시본을 조회합니다.'; $('catalog-photo-retry').hidden = true;
    try {
      const fresh = (await photos.getPhoto(photo.id, { signal })).item;
      if (!photoMatches(fresh, context) && context.seat) throw new Error('사진 선택 문맥 불일치');
      const delivery = (await assets.getDelivery(fresh.displayAssetId, { signal })).item;
      verifyDelivery(delivery, fresh.id);
      if (serial !== imageGeneration || catalogSerial !== generation) return;
      activePhoto = { record: fresh, delivery, context };
      const image = $('catalog-photo-image'); image.onload = () => {
        if (serial !== imageGeneration) return;
        $('catalog-photo-status').textContent = `${fresh.creditText || fresh.rightsRecord.creditText || '출처 표기 미확인'} · ${focalControlMm(fresh.metadata.focalLength35Mm) ?? '미확인'}${fresh.metadata.focalLength35Mm ? ' mm 환산' : ' 화각'}${fresh.metadataSources.focalLength35Mm ? ` (${fresh.metadataSources.focalLength35Mm})` : ''} · 공개 표시본 전체 구도 · 원본 다운로드 없음`;
        $('catalog-photo-project').disabled = !(projectionReady && fresh.projectionEligible && photoMatches(fresh, context));
      };
      image.onerror = () => { if (serial !== imageGeneration) return; image.removeAttribute('src'); $('catalog-photo-status').textContent = '표시본 로딩 실패 · 다시 조회하세요.'; $('catalog-photo-retry').hidden = false; $('catalog-photo-project').disabled = true; };
      image.referrerPolicy = 'no-referrer'; image.src = delivery.deliveryUrl;
    } catch (error) {
      if (error.name === 'AbortError' || serial !== imageGeneration) return;
      $('catalog-photo-status').textContent = '표시본 조회 실패 또는 게시 중지 · 다시 조회하세요.'; $('catalog-photo-retry').hidden = false;
    }
    $('catalog-photo-retry').onclick = () => openPhoto(photo);
  }
  $('catalog-photo-project').addEventListener('click', async() => {
    const active = activePhoto; if (!active || !projectionReady) return;
    const serial = generation, imageSerial = imageGeneration, signal = imageController.signal;
    $('catalog-photo-project').disabled = true;
    try {
      const record = (await photos.getPhoto(active.record.id, { signal })).item;
      if (!record.projectionEligible || !photoMatches(record, selected) || serial !== generation || imageSerial !== imageGeneration) return;
      const delivery = (await assets.getDelivery(record.displayAssetId, { signal })).item;
      if (serial !== generation || imageSerial !== imageGeneration) return;
      verifyDelivery(delivery, record.id);
      if (!await onProject({ record, delivery, context: selectedCopy() })) throw new Error('모델 문맥 불일치');
      $('catalog-photo-dialog').close();
    } catch (error) { if (error.name !== 'AbortError' && serial === generation) { $('catalog-photo-status').textContent = '투영 실패 · 사진과 좌석을 다시 조회하세요.'; $('catalog-photo-retry').hidden = false; } }
  });
  $('catalog-search').addEventListener('input', filterVenues); $('catalog-work-search').addEventListener('input', filterWorks); $('catalog-seat-search').addEventListener('input', filterSeats);
  $('catalog-venue').addEventListener('change', chooseVenue); $('catalog-work').addEventListener('change', chooseWork); $('catalog-run').addEventListener('change', chooseRun); $('catalog-layout').addEventListener('change', chooseLayout); $('catalog-seat').addEventListener('change', chooseSeat);
  $('catalog-retry').addEventListener('click', () => retry?.()); $('catalog-more').addEventListener('click', more);
  $('catalog-photo-close').addEventListener('click', () => $('catalog-photo-dialog').close()); $('catalog-photo-dialog').addEventListener('close', cancelImage);
  $('catalog-scope').textContent = configurationError ? '연결 구성 오류' : !connected ? '온라인 자료 미설정' : synthetic ? `합성 자료 · ${connectionKind === 'supabase' ? 'Supabase REST 모의 연결' : '로컬 모의 API'}` : '온라인 조회 · 연결 전 실제 자료 없음';
  $('catalog-scope').dataset.connectionKind = connectionKind;
  return { start, clearProjection() { invalidate(); selected.seat = null; sync(); status('3D 선택이 바뀌었습니다. 공개 좌석을 다시 선택하세요.'); }, getContext: selectedCopy };
}
