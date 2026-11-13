import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createTheaterAvailability, theaterSelectionIntent} from '../src/theater-availability.js';
import {normalizeTheaterModelRegistry} from '../src/theater-model-registry.js';
import {normalizeHistoricalSourceRegistry, createHistoricalSourceLoader} from '../src/historical-source-plans.js';
import {prepareApproximateScenario} from '../src/approximate-scenario.js';
import {defaultStageWallSides} from '../src/stage-wall-settings.js';
import {createSimulationStorage, SIMULATION_STORAGE_KEY} from '../src/simulation-storage.js';
import {loadVenuePreference, VENUE_PREFERENCE_KEY} from '../src/venue-preferences.js';
const root = new URL('../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
let passed = 0;
const check = (name, fn) => { fn(); passed++; };
const models = normalizeTheaterModelRegistry(json('data/catalog/theater-model-registry.json'));
const records = json('data/catalog/portfolio-venue-information.json').records;
const availability = createTheaterAvailability(json('data/catalog/theater-selection-availability.json'));
check('one synthetic model', () => { assert.equal(models.entries.length, 1); assert.match(models.entries[0].venueId, /^synthetic-/); });
check('one available and one generic disabled record', () => {
  assert.equal(records.length, 2);
  const statuses = records.map(record => availability.forRecord(record, {modelEntry: models.entries.find(entry => entry.informationRecordId === record.informationRecordId)}));
  assert.equal(statuses.filter(status => status.selectable).length, 1);
  assert.equal(theaterSelectionIntent(statuses[1]), 'reject');
  assert.equal(statuses[1].state, 'demo_disabled');
});
check('unregistered record cannot become selectable', () => assert.equal(availability.forRecord({informationRecordId:'synthetic-unknown'}, {modelEntry:{informationRecordId:'synthetic-unknown',status:'stage_ready',venueId:'synthetic-unknown'}}).selectable,false));
check('historical registry stays empty', () => assert.deepEqual(normalizeHistoricalSourceRegistry({entries:[{variants:[{}]}]}, ['synthetic-unknown']), []));
let reads = 0;
await assert.rejects(createHistoricalSourceLoader(() => { reads++; }).load({}, 'synthetic-unknown'), /DISABLED_IN_PORTFOLIO/);
check('disabled historical loader does not read', () => assert.equal(reads, 0));
check('real-venue approximation disabled', () => assert.throws(() => prepareApproximateScenario({}), /DISABLED_IN_PORTFOLIO/));
check('wall defaults are generic', () => assert.deepEqual(defaultStageWallSides('synthetic-unknown'), {back:true,left:true,right:true}));
check('storage namespaces isolated', () => { assert.match(SIMULATION_STORAGE_KEY,/^theater3d-portfolio\./); assert.match(VENUE_PREFERENCE_KEY,/^theater3d-portfolio\./); });
check('preferences only read demo key', () => {
  const requested = [];
  loadVenuePreference({storage:{getItem:key => { requested.push(key); return null; }},allowedVenueIds:models.entries.map(entry=>entry.venueId)});
  assert.deepEqual(requested,[VENUE_PREFERENCE_KEY]);
});
check('simulation reads only demo key', () => {
  const requested = [];
  const storage = createSimulationStorage({storage:{getItem:key => { requested.push(key); return null; },setItem(){}}});
  storage.list({venueId:models.entries[0].venueId,layoutVersionId:models.entries[0].layoutVersionId});
  assert(requested.length > 0); assert(requested.every(key => key === SIMULATION_STORAGE_KEY));
});
check('local photo database and export keys isolated', () => {
  assert(read('src/local-photo-store.js').includes("'theater3d-portfolio.local-photos.v1'"));
  for (const file of ['src/app.js','src/seat-notes.js','src/personal-data-export.js','src/personal-workspace.js','src/source-plan-choice.js']) {
    assert(!/['"]theater3[dD]\.(?:camera-lens-settings|seat-notes|information-selection|source-seat-choice)/.test(read(file)),file);
  }
});
check('query-driven services removed', () => {
  const app = read('src/app.js');
  assert(!app.includes('setupLocalRegistration')); assert(!app.includes('legacyCatalogConnectionConfig')); assert(!app.includes("query.get('localApi')"));
  assert(app.includes("code:'HOSTED_DISABLED_IN_PORTFOLIO'"));
});
const refs = [...read('index.html').matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g)].map(match=>match[1]);
refs.push(...models.definitions.flatMap(model => [model.venuePath,model.modelPath]));
for (const base of ['https://public.invalid/','https://public.invalid/theater3d-portfolio/','https://public.invalid/review/nested/theater3d-portfolio/']) {
  for (const suffix of ['', 'index.html', '?review=1#seat-view', 'index.html?review=1#seat-view']) {
    check('relative assets remain beneath ' + new URL(base+suffix).pathname, () => {
      for (const ref of refs) {
        const target = new URL(ref,base+suffix); assert(target.href.startsWith(base));
        const local = new URL(ref,root); assert(fs.existsSync(fileURLToPath(local)), ref);
      }
    });
  }
}
console.log(JSON.stringify({suite:'portfolio boundaries and static paths',passed,failed:0,browserExecuted:false}));
