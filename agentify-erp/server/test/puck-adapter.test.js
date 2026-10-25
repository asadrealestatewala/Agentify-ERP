import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-puck-'));
process.env.ERP_DATA_DIR = dir;
process.env.ERP_UPLOAD_DIR = path.join(dir, 'uploads');
process.env.ERP_DB = path.join(dir, 'test.db');

const { all } = await import('../src/db.js');
const { defaultPages } = await import('../src/services/siteDefaults.js');
const { toPuck, fromPuck } = await import('../../shared/puckAdapter.js');

const roundTrip = (sections) => fromPuck(JSON.parse(JSON.stringify(toPuck(sections))));

test('every stored page comes back unchanged after a trip through the visual editor’s format', () => {
  const pages = [...defaultPages(), ...all('SELECT sections FROM site_pages').map((p) => ({ sections: JSON.parse(p.sections) }))];
  assert.ok(pages.length >= 3);
  for (const p of pages) assert.deepEqual(roundTrip(p.sections), p.sections);
});

test('odd stored sections survive too: numeric ids, styles, no props, extra keys', () => {
  const odd = [
    { id: 7, type: 'text', props: { title: 'Seven', html: '<p>x</p>', align: 'left' } },
    { id: 's1', type: 'hero', props: { headline: 'H' }, style: { desktop: { pad_top: 40 }, mobile: { hide: true }, anchor: 'top' } },
    { id: 's2', type: 'spacer' },
    { id: 's3', type: 'banner', props: { text: 'B' }, legacy_flag: true },
    { id: 's4', type: 'gallery', props: { title: '', images: [{ src: 'media/a.png', caption: 'A' }] } },
  ];
  assert.deepEqual(roundTrip(odd), odd);
  const data = toPuck(odd);
  assert.equal(data.content.length, 5);
  assert.ok(data.content.every((c) => typeof c.props.id === 'string'), 'Puck always gets string ids');
});
