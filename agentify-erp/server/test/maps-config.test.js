import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-maps-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'test.db') });
const { publicMapsConfig } = await import('../src/services/maps.js');
const { fieldSettings, saveFieldSettings, DEFAULTS } = await import('../src/services/fieldLocation.js');

test('Google Maps stays off until a well-formed browser key is configured', () => {
  assert.equal(publicMapsConfig({}).google, null);
  assert.equal(publicMapsConfig({ GOOGLE_MAPS_API_KEY: 'short' }).google, null);
  assert.equal(publicMapsConfig({ GOOGLE_MAPS_API_KEY: 'AIza"><script>alert(1)</script>0123456789' }).google, null, 'no markup or quotes can reach the page');
  const ok = publicMapsConfig({ GOOGLE_MAPS_API_KEY: ' AIzaSyExampleExampleExample_123456 ', GOOGLE_MAPS_MAP_ID: 'abc123def456' });
  assert.deepEqual(ok.google, { key: 'AIzaSyExampleExampleExample_123456', mapId: 'abc123def456' });
  assert.equal(publicMapsConfig({ GOOGLE_MAPS_API_KEY: 'AIzaSyExampleExampleExample_123456', GOOGLE_MAPS_MAP_ID: 'bad id!' }).google.mapId, null);
});

test('the field map option defaults to the live map; the older OpenStreetMap value is read as the same choice', () => {
  assert.equal(DEFAULTS.map_provider, 'auto');
  assert.equal(fieldSettings().map_provider, 'auto');
  assert.throws(() => saveFieldSettings({ map_provider: 'bing' }), /Unknown map option/);
});
