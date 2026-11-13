import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual UI synchronization and click handlers without a server.
const source = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const lock = source.match(/^const photoFocalLocked = .*;$/m)?.[0];
const sync = source.slice(source.indexOf('function syncFocalPresets()'), source.indexOf('\nfunction fillFavoriteEditor('));
const cameraBinding = source.split('\n').find(line => line.includes("document.querySelector('.camera-focal-presets').addEventListener('click'"));
const sightBinding = source.split('\n').find(line => line.includes("for (const button of document.querySelectorAll('[data-sight-focal-preset]')) button.addEventListener('click'"));
assert(lock && sync.startsWith('function syncFocalPresets()') && cameraBinding && sightBinding);

function fixture(patch = {}) {
  const state = { focalLength35Mm:24, sightFocalLength35Mm:13, sightViewEnabled:false, stagePhotoId:null, lockedPhotoFocalMm:null, ...patch };
  const button = (name, value) => ({ dataset:{[name]:String(value)}, disabled:false, attrs:{}, active:false, handlers:{},
    classList:{toggle(name, active) { this.owner.active = active; }},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; } });
  const camera = [24,35,50,105].map(value => button('focalPreset', value));
  const sight = [13,15,20].map(value => button('sightFocalPreset', value));
  for (const item of [...camera,...sight]) item.classList.owner = item;
  const root = {addEventListener(name, handler) { this[name] = handler; }};
  let refreshes = 0;
  const context = {state, document:{querySelector:() => root, querySelectorAll:selector => selector === '[data-focal-preset]' ? camera : sight},
    cameraFocalRange:() => ({minMm:18,maxMm:70}), normalizeFocalLength:Number, normalizeSightFocalLength:Number,
    scheduleRender:() => { refreshes++; }, syncControls:() => context.update()};
  vm.runInNewContext(`${lock}\n${sync}\n${cameraBinding}\n${sightBinding}\nglobalThis.update = syncFocalPresets;`, context);
  context.update();
  return {state,camera,sight,update:context.update,get refreshes(){return refreshes;},
    cameraClick:value => root.click({target:{closest:() => camera.find(item => Number(item.dataset.focalPreset) === value)}}),
    sightClick:value => sight.find(item => Number(item.dataset.sightFocalPreset) === value).handlers.click()};
}

const cases = [];
function test(name, run) { run(); cases.push(name); }
test('camera lock selects the displayed photo focal and disables every preset', () => {
  const f=fixture({stagePhotoId:'synthetic-photo',lockedPhotoFocalMm:35});
  assert(f.camera.every(button => button.disabled));
  assert.equal(f.camera.find(button => button.dataset.focalPreset === '35').attrs['aria-pressed'],'true');
  assert.equal(f.camera.find(button => button.dataset.focalPreset === '24').attrs['aria-pressed'],'false');
});
test('locked camera click never changes saved focal even before disabled UI refresh', () => {
  const f=fixture({stagePhotoId:'synthetic-photo',lockedPhotoFocalMm:35});
  f.camera.find(button => button.dataset.focalPreset === '50').disabled=false;
  f.cameraClick(50);assert.equal(f.state.focalLength35Mm,24);assert.equal(f.refreshes,0);
  f.state.lockedPhotoFocalMm=null;f.update();
  assert.equal(f.camera.find(button => button.dataset.focalPreset === '24').attrs['aria-pressed'],'true');
});
test('unlocked camera preset still updates the focal and selection', () => {
  const f=fixture();f.cameraClick(50);assert.equal(f.state.focalLength35Mm,50);
  assert.equal(f.camera.find(button => button.dataset.focalPreset === '50').attrs['aria-pressed'],'true');assert.equal(f.refreshes,1);
});
test('preset outside the active lens range stays disabled', () => {
  const f=fixture();f.cameraClick(105);assert.equal(f.state.focalLength35Mm,24);assert.equal(f.refreshes,0);
});
test('sight lock uses the photo focal and blocks both preset families', () => {
  const f=fixture({sightViewEnabled:true,stagePhotoId:'synthetic-photo',lockedPhotoFocalMm:15});
  assert([...f.camera,...f.sight].every(button => button.disabled));
  assert.equal(f.sight.find(button => button.dataset.sightFocalPreset === '15').attrs['aria-pressed'],'true');
  f.sight.find(button => button.dataset.sightFocalPreset === '20').disabled=false;
  f.sightClick(20);assert.equal(f.state.sightFocalLength35Mm,13);assert.equal(f.refreshes,0);
});
test('unlock restores the prior sight setting and permits deliberate new selection', () => {
  const f=fixture({sightViewEnabled:true,stagePhotoId:'synthetic-photo',lockedPhotoFocalMm:15});
  f.state.lockedPhotoFocalMm=null;f.update();
  assert.equal(f.sight.find(button => button.dataset.sightFocalPreset === '13').attrs['aria-pressed'],'true');
  f.sightClick(20);assert.equal(f.state.sightFocalLength35Mm,20);assert.equal(f.refreshes,1);
});
test('inactive sight controls cannot change the stored sight setting', () => {
  const f=fixture();f.sight.find(button => button.dataset.sightFocalPreset === '20').disabled=false;
  f.sightClick(20);assert.equal(f.state.sightFocalLength35Mm,13);assert.equal(f.refreshes,0);
});
test('a stale focal without an active projected photo does not lock the camera', () => {
  const f=fixture({lockedPhotoFocalMm:35});f.cameraClick(50);assert.equal(f.state.focalLength35Mm,50);
});
test('fractional photo focal remains precise and does not claim an exact preset match', () => {
  const f=fixture({stagePhotoId:'synthetic-photo',lockedPhotoFocalMm:35.4});
  assert(f.camera.every(button => button.attrs['aria-pressed'] === 'false'));
  assert.equal(f.state.lockedPhotoFocalMm,35.4);assert.equal(f.state.focalLength35Mm,24);
});
console.log(JSON.stringify({suite:'photo focal lock preset interaction',passed:cases.length,failed:0,cases,actualBrowser:false,actualStorage:false}));
