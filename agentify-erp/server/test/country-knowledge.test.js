import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWLEDGE, COUNTRIES, COUNTRY_CAVEAT, countriesIn, countryDocs } from '../../shared/countryKnowledge.js';
import { search } from '../src/services/bot.js';

test('country knowledge: all five markets have the core topics', () => {
  for (const code of ['PK', 'US', 'UK', 'AE', 'CA']) {
    assert.ok(COUNTRIES[code] && KNOWLEDGE[code]?.length >= 5, code);
    const t = KNOWLEDGE[code].map((e) => e.title.toLowerCase()).join(' | ');
    assert.match(t, /buy/, `${code} buying process`); assert.match(t, /tax|fee|cost/, `${code} costs`); assert.match(t, /rent/, `${code} renting`);
    for (const e of KNOWLEDGE[code]) assert.ok(e.title && e.keywords && e.text.length > 80, `${code}: ${e.title}`);
  }
});

test('country knowledge: never claims to be advice or guarantees compliance', () => {
  assert.match(COUNTRY_CAVEAT, /not legal, tax or financial advice/);
  for (const list of Object.values(KNOWLEDGE)) for (const e of list) assert.ok(!/\b(guarantee|guaranteed|you must pay exactly|complies with)\b/i.test(e.text), e.title);
});

test('country knowledge: a workspace gets its own country and any country the visitor names', () => {
  assert.deepEqual(countriesIn('stamp duty in london'), ['UK']);
  assert.equal(countryDocs('PK', 'hello').every((d) => d.source.includes('Pakistan')), true);
  const both = countryDocs('PK', 'what about buying in Dubai');
  assert.ok(both.some((d) => d.source.includes('Pakistan')) && both.some((d) => d.source.includes('UAE')));
});

test('country knowledge: retrieval finds the right entry', () => {
  const top = (own, q) => search(q, countryDocs(own, q), 1)[0]?.doc;
  assert.match(top('UK', 'how much stamp duty will I pay').title, /Stamp Duty/);
  assert.match(top('AE', 'what is the DLD transfer fee').title, /Fees/);
  assert.match(top('CA', 'do I need a lawyer to buy a house').title, /How buying/);
  assert.match(top('PK', 'what is a marla').title, /marla/i);
  assert.match(top('US', 'how much are closing costs').title, /Costs/);
});
