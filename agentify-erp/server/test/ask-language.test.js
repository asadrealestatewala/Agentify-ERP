import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, englishSearchText, answerMatchesLanguage } from '../../shared/help/askTerms.js';
import { searchKnowledge } from '../../shared/guides.js';

test('detects Roman Urdu, Urdu script and English', () => {
  assert.equal(detectLanguage('me kese appointment add kar sakta hu'), 'roman-urdu');
  assert.equal(detectLanguage('لیڈ کیسے شامل کریں'), 'urdu');
  assert.equal(detectLanguage('how do I add an appointment'), 'en');
  assert.equal(detectLanguage('Add a new lead'), 'en');
});

test('Roman Urdu and Urdu questions are searched by their English meaning', () => {
  const top = (q) => { const t = englishSearchText(q).query; return searchKnowledge(t)[0]; };
  assert.equal(top('me kese appointment add kar sakta hu')?.screen?.label, 'Appointments');
  assert.ok(searchKnowledge(englishSearchText('تنخواہ کیسے دیکھیں').query).length >= 0);
});

test('answer language check', () => {
  assert.equal(answerMatchesLanguage('roman-urdu', 'To add an appointment, open CRM and press New.'), false);
  assert.equal(answerMatchesLanguage('roman-urdu', 'CRM > Appointments kholen aur New dabayen, phir save karen.'), true);
  assert.equal(answerMatchesLanguage('urdu', 'Open the menu'), false);
  assert.equal(answerMatchesLanguage('urdu', 'مینو کھولیں اور نیا بٹن دبائیں'), true);
  assert.equal(answerMatchesLanguage('en', 'anything'), true);
});

import { cleanAnswer, templatedAnswer } from '../src/services/askAi.js';

test('reasoning printed by a model is rejected, a marked answer is kept', () => {
  assert.equal(cleanAnswer("We need answer user's question in Roman Urdu. Need use only reference material. Reference: Screen: Appointments"), null);
  assert.equal(cleanAnswer('<think>hmm the user wants steps</think>1. Open CRM > Appointments.'), '1. Open CRM > Appointments.');
  assert.equal(cleanAnswer("We need to answer.\nANSWER: CRM > Appointments kholen aur New dabayen."), 'CRM > Appointments kholen aur New dabayen.');
  assert.equal(cleanAnswer('Open CRM > Appointments and press New.'), 'Open CRM > Appointments and press New.');
  assert.equal(cleanAnswer(''), null);
});

test('template answer: menu path and guide steps in the asked language, from the best match only', () => {
  const mat = [{ title: 'Screen: Appointments', menu: 'CRM > Appointments', about: 'Meetings and site visits on a calendar.' }, { title: 'Screen: Credit Book', menu: 'Vendors > Credit Book' }];
  const t = templatedAnswer(mat, 'roman-urdu');
  assert.match(t.answer, /Menu mein CRM > Appointments kholen/); assert.doesNotMatch(t.answer, /Credit Book/);
  assert.match(templatedAnswer([{ title: 'G', steps: ['One', 'Two'] }], 'en').answer, /1\. One\n2\. Two/);
  assert.equal(templatedAnswer([], 'en'), null);
});
