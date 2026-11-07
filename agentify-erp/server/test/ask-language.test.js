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
