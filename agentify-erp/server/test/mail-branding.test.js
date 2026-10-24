import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../src/services/mailer.js';
import { als } from '../src/context.js';

test('platform mail carries the Agentify identity and details', () => {
  process.env.PLATFORM_SUPPORT_EMAIL = 'support@agentifyerp.co';
  const m = layout({ brand: 'platform', heading: 'Hello', lines: ['Body <b>'], button: { label: 'Go', url: 'https://x.test/a' } });
  assert.match(m.html, /Agentify ERP/);
  assert.match(m.html, /#0e7c6b/);
  assert.match(m.html, /support@agentifyerp\.co/);
  assert.match(m.text, /support@agentifyerp\.co/);
  assert.ok(!m.html.includes('Body <b>'), 'content is escaped');
  delete process.env.PLATFORM_SUPPORT_EMAIL;
});

test('mail outside a workspace defaults to the platform brand, inside it to the workspace', () => {
  assert.match(layout({ heading: 'H' }).text, /- Agentify ERP/);
  const m = als.run({ tenant: { name: 'Acme Homes' }, db: null }, () => layout({ heading: 'H' }));
  assert.ok(!m.text.includes('- Agentify ERP'));
  assert.match(m.html, /Sent through Agentify ERP/);
  assert.ok(!m.text.includes('- Agentify ERP'));
});
