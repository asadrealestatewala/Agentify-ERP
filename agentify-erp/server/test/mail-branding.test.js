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

test('email layout is table-based with preheader, bulletproof button, dark-mode palette and a hosted PNG logo', () => {
  process.env.PLATFORM_WEBSITE = 'https://agentifyerp.co/';
  const m = layout({ brand: 'platform', heading: 'Verify', lines: ['Confirm your email to finish signup.'], button: { label: 'Confirm email', url: 'https://x.test/v?a=1&b=2' } });
  assert.match(m.html, /^<!doctype html>/);
  assert.match(m.html, /<table role="presentation"/);
  assert.match(m.html, /display:none;max-height:0[^>]*>Confirm your email to finish signup\./, 'preheader is the first line');
  assert.match(m.html, /<v:roundrect/, 'Outlook button fallback');
  assert.match(m.html, /prefers-color-scheme:dark/);
  assert.match(m.html, /src="https:\/\/agentifyerp\.co\/email-logo\.png"/);
  assert.ok(!/<svg|\.svg/.test(m.html), 'no SVG: Gmail and Outlook drop it');
  assert.match(m.html, /a=1&amp;b=2/, 'urls are escaped');
  assert.match(m.text, /Confirm email: https:\/\/x\.test\/v\?a=1&b=2/, 'plain-text part carries the link');
  assert.match(layout({ brand: 'platform', heading: 'H', lines: ['x'], preheader: 'Custom preview' }).html, />Custom preview/);
  delete process.env.PLATFORM_WEBSITE;
});
