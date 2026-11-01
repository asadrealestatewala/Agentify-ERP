import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-maps-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'test.db') });
const { publicMapsConfig } = await import('../src/services/maps.js');
const { fieldSettings, saveFieldSettings, DEFAULTS } = await import('../src/services/fieldLocation.js');

const GKEY = 'AIzaSyExampleExampleExample_123456';
test('the free MapLibre map is the default and needs no key', () => {
  const c = publicMapsConfig({});
  assert.equal(c.provider, 'maplibre');
  assert.equal(c.google, null);
  assert.match(c.maplibre.styles.streets, /^https:\/\/tiles\.openfreemap\.org\//);
  assert.equal(c.maplibre.maptiler, null);
});

test('Google is used only when chosen AND a well-formed key exists', () => {
  assert.equal(publicMapsConfig({ GOOGLE_MAPS_API_KEY: GKEY }).provider, 'maplibre', 'a key alone does not switch the provider');
  assert.equal(publicMapsConfig({ MAP_PROVIDER: 'google' }).provider, 'maplibre', 'asking for Google without a key stays free');
  assert.equal(publicMapsConfig({ MAP_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'short' }).provider, 'maplibre');
  assert.equal(publicMapsConfig({ MAP_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'AIza"><script>alert(1)</script>0123456789' }).provider, 'maplibre', 'no markup or quotes can reach the page');
  const ok = publicMapsConfig({ MAP_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: ` ${GKEY} `, GOOGLE_MAPS_MAP_ID: 'abc123def456' });
  assert.equal(ok.provider, 'google');
  assert.deepEqual(ok.google, { key: GKEY, mapId: 'abc123def456' });
  assert.equal(publicMapsConfig({ MAP_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: GKEY, GOOGLE_MAPS_MAP_ID: 'bad id!' }).google.mapId, null);
  assert.equal(publicMapsConfig({ GOOGLE_MAPS_API_KEY: GKEY }, 'google').provider, 'google', 'the console choice works like the env setting');
  assert.equal(publicMapsConfig({ MAP_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: GKEY }, 'maplibre').provider, 'maplibre', 'the console choice wins');
});

test('an optional MapTiler key is passed on only when well formed', () => {
  assert.equal(publicMapsConfig({ MAPTILER_API_KEY: 'x"y' }).maplibre.maptiler, null);
  assert.deepEqual(publicMapsConfig({ MAPTILER_API_KEY: ' abcdEFGH12345678wxyz ' }).maplibre.maptiler, { key: 'abcdEFGH12345678wxyz' });
});

test('the field map option defaults to the live map; the older OpenStreetMap value is read as the same choice', () => {
  assert.equal(DEFAULTS.map_provider, 'auto');
  assert.equal(fieldSettings().map_provider, 'auto');
  assert.throws(() => saveFieldSettings({ map_provider: 'bing' }), /Unknown map option/);
});
