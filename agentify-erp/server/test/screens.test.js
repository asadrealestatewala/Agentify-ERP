import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildScreens, render } from '../../scripts/gen-screens.mjs';
import { SCREENS } from '../../shared/screens.generated.js';
import { SCREEN_NOTES } from '../../shared/screenNotes.js';
import { searchKnowledge } from '../../shared/guides.js';

test('screens: generated list matches the app menu (run node scripts/gen-screens.mjs)', () => {
  const file = fs.readFileSync(new URL('../../shared/screens.generated.js', import.meta.url), 'utf8');
  assert.equal(file, render(buildScreens()));
  assert.ok(SCREENS.length > 100);
});

test('screens: every menu screen has a plain-words note', () => {
  for (const s of SCREENS) assert.ok(SCREEN_NOTES[s.path], `add a note for ${s.path} (${s.label}) in shared/screenNotes.js`);
});

test('screens: Ask can find a screen by name or by what it does', () => {
  assert.equal(searchKnowledge('where is the sales pipeline')[0].screen?.path, '/pipeline');
  assert.equal(searchKnowledge('what is the audit log')[0].screen?.path, '/settings/audit');
  assert.equal(searchKnowledge('where do I approve leave requests')[0].screen?.path, '/hrm/leave');
});
