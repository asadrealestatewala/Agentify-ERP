// Place search through Photon (default), the LocationIQ key option, the Nominatim last resort, and rate-limit handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-photon-'));
Object.assign(process.env, { ERP_DATA_DIR: dir, ERP_UPLOAD_DIR: path.join(dir, 'uploads'), ERP_DB: path.join(dir, 'test.db') });
delete process.env.GEOCODE_PROVIDER; delete process.env.LOCATIONIQ_KEY;
const { geocode, geocodeParts, providerChain, photonRows } = await import('../src/services/geocode.js');

const feat = (name, lon, lat, props = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { name, countrycode: 'PK', city: 'Rawalpindi', state: 'Punjab', country: 'Pakistan', ...props } });
const calls = [];
let script = () => new Response('{}', { status: 200 });
globalThis.fetch = async (url, opts) => { calls.push(String(url)); return script(String(url), opts); };
const J = (x, status = 200, headers = {}) => new Response(JSON.stringify(x), { status, headers });

test('provider order: Photon first by default, LocationIQ first when keyed, Nominatim always last', () => {
  assert.deepEqual(providerChain({}), ['photon', 'nominatim']);
  assert.deepEqual(providerChain({ LOCATIONIQ_KEY: 'pk.abcdef123456' }), ['locationiq', 'photon', 'nominatim']);
  assert.deepEqual(providerChain({ GEOCODE_PROVIDER: 'nominatim' }), ['nominatim']);
  assert.deepEqual(providerChain({ GEOCODE_PROVIDER: 'locationiq' }), ['photon', 'nominatim'], 'locationiq without a key is ignored');
});

test('Photon answers become labelled candidates, narrowed to the workspace country', async () => {
  script = () => J({ features: [feat('Dhamial Road', 73.024, 33.554, { type: 'street', district: 'Dhamial', extent: [73.02, 33.56, 73.03, 33.55] }), feat('Dhamial Road', 0.1, 51.5, { countrycode: 'GB', type: 'street' })] });
  const { results } = await geocode('dhamial road photon-1', 'PK');
  assert.equal(results.length, 1, 'the UK road is dropped');
  assert.equal(results[0].lat, 33.554); assert.equal(results[0].lng, 73.024);
  assert.match(results[0].label, /Dhamial Road/);
  assert.equal(results[0].level, 'street');
  assert.match(calls.at(-1), /photon\.komoot\.io\/api\//);
});

test('a city is an area, and a viewbox becomes a Photon bbox (minLon,minLat,maxLon,maxLat)', async () => {
  const rows = photonRows({ features: [feat('Rawalpindi', 73.05, 33.6, { type: 'city', extent: [72.9, 33.8, 73.2, 33.4] })] });
  assert.equal(rows[0].addresstype, 'city');
  assert.deepEqual(rows[0].boundingbox, ['33.4', '33.8', '72.9', '73.2']);
  script = (u) => (new URL(u).searchParams.get('q') === 'Rawalpindi' ? J({ features: [feat('Rawalpindi', 73.05, 33.6, { type: 'city', extent: [72.9, 33.8, 73.2, 33.4] })] }) : J({ features: [feat('Chakri Road', 73.0, 33.5, { type: 'street' })] }));
  const r = await geocodeParts(['chakri road', 'Rawalpindi'], 'PK');
  assert.equal(r.approximate, false);
  const inside = calls.find((u) => /chakri/i.test(u));
  assert.ok(new URL(inside).searchParams.get('bbox'), 'the street search is bounded to the city');
});

test('a Photon failure or rate limit falls back to Nominatim, and the person gets an answer', async () => {
  calls.length = 0;
  script = (u) => (u.includes('photon') ? new Response('slow down', { status: 429, headers: { 'retry-after': '0' } })
    : J([{ display_name: 'Saddar, Rawalpindi', name: 'Saddar', lat: '33.59', lon: '73.04', addresstype: 'suburb', address: { city: 'Rawalpindi' } }]));
  const { results } = await geocode('saddar fallback-1', 'PK');
  assert.equal(results[0].label.startsWith('Saddar'), true);
  assert.ok(calls.some((u) => u.includes('photon')) && calls.some((u) => u.includes('nominatim')));
});

test('when every provider fails the error reaches the caller (the route turns it into a friendly 502)', async () => {
  script = () => new Response('down', { status: 503 });
  await assert.rejects(geocode('nowhere-at-all x1', 'PK'), /answered 503/);
});

test('answers are cached so repeated typing does not hit the provider again', async () => {
  script = () => J({ features: [feat('Bahria Town', 73.1, 33.5, { type: 'district' })] });
  calls.length = 0;
  await geocode('bahria town cache-1', 'PK');
  const n = calls.length;
  const again = await geocode('bahria town cache-1', 'PK');
  assert.equal(calls.length, n);
  assert.equal(again.cached, true);
});
