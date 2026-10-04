import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { saveApi, save, sql, row, dir, samples, signJson, cleanZz, savedFsl } from './api-helper.mjs';

before(cleanZz);
after(cleanZz);

const readSample = (key, f) => JSON.parse(fs.readFileSync(path.join(dir(key), f), 'utf8'));

test('BOTH save: key from English text, one folder, sign.json, DB row', () => {
  const r = save({ sign_language: 'BOTH', text_en: 'Zz Both Probe?', text_fil: 'Zz Pareho?' });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.label, 'zz_both_probe');
  assert.equal(r.json.set, 'BOTH');
  assert.equal(r.json.signLanguage, 'BOTH');
  assert.equal(r.json.textEn, 'Zz Both Probe?');
  assert.equal(r.json.textFil, 'Zz Pareho?');
  assert.equal(r.json.labelSampleCount, 1);
  assert.equal(samples('zz_both_probe').length, 1);
  const sj = signJson('zz_both_probe');
  assert.deepEqual(Object.keys(sj), ['key', 'set', 'textEn', 'textFil', 'updatedAt']);
  assert.equal(sj.set, 'BOTH'); assert.equal(sj.textEn, 'Zz Both Probe?'); assert.equal(sj.textFil, 'Zz Pareho?');
  assert.equal(readSample('zz_both_probe', samples('zz_both_probe')[0]).signLanguage, 'ESL');
  const d = row('zz_both_probe');
  assert.equal(d.sign_language, 'BOTH'); assert.equal(d.text_en, 'Zz Both Probe?'); assert.equal(d.text_fil, 'Zz Pareho?');
  save({ sign_language: 'BOTH', text_en: 'Zz Both Probe?', text_fil: 'Zz Pareho?' });
  const r3 = save({ sign_language: 'BOTH', text_en: 'Zz Both Probe?', text_fil: 'Zz Pareho?' });
  assert.equal(r3.json.labelSampleCount, 3);
  assert.equal(samples('zz_both_probe').length, 3);
  assert.equal(fs.existsSync(path.join(savedFsl, 'zz_both_probe')), false);
});

test('FSL save: key from Filipino text, stored in saved_gestures', () => {
  const r = save({ sign_language: 'FSL', text_fil: 'Zz Pilipino Lang' });
  assert.equal(r.status, 200);
  assert.equal(r.json.label, 'zz_pilipino_lang');
  assert.equal(r.json.set, 'FSL');
  assert.equal(readSample('zz_pilipino_lang', samples('zz_pilipino_lang')[0]).signLanguage, 'FSL');
  const sj = signJson('zz_pilipino_lang');
  assert.equal(sj.set, 'FSL'); assert.equal(sj.textFil, 'Zz Pilipino Lang'); assert.equal(sj.textEn, null);
  const d = row('zz_pilipino_lang');
  assert.equal(d.sign_language, 'FSL'); assert.equal(d.text_en, null); assert.equal(d.text_fil, 'Zz Pilipino Lang');
  assert.equal(fs.existsSync(path.join(savedFsl, 'zz_pilipino_lang')), false);
});

test('ESL save with English text only; missing required text -> 400, nothing written', () => {
  const r = save({ sign_language: 'ESL', text_en: 'Zz Esl Probe' });
  assert.equal(r.status, 200);
  assert.equal(r.json.set, 'ESL');
  assert.equal(row('zz_esl_probe').text_fil, null);
  assert.equal(signJson('zz_esl_probe').set, 'ESL');

  const bad = save({ sign_language: 'BOTH', text_en: 'Zz Missing Fil' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.success, false);
  assert.equal(fs.existsSync(dir('zz_missing_fil')), false);
  assert.equal(row('zz_missing_fil'), undefined);
  const bad2 = save({ sign_language: 'FSL', text_en: 'Zz Only En' });
  assert.equal(bad2.status, 400);
  assert.equal(fs.existsSync(dir('zz_only_en')), false);
  const tooLong = save({ sign_language: 'ESL', text_en: 'Zz ' + 'a'.repeat(260) });
  assert.equal(tooLong.status, 400);
});

test('collision with a different set -> 409, nothing changes', () => {
  const beforeSamples = samples('zz_esl_probe');
  const beforeSign = fs.readFileSync(path.join(dir('zz_esl_probe'), 'sign.json'), 'utf8');
  const beforeRow = JSON.stringify(row('zz_esl_probe'));
  const r = save({ sign_language: 'FSL', text_fil: 'Zz Esl Probe' });
  assert.equal(r.status, 409);
  assert.equal(r.json.success, false);
  assert.equal(r.json.existingSet, 'ESL');
  assert.match(r.json.error, /already exists as ESL/);
  assert.deepEqual(samples('zz_esl_probe'), beforeSamples);
  assert.equal(fs.readFileSync(path.join(dir('zz_esl_probe'), 'sign.json'), 'utf8'), beforeSign);
  assert.equal(JSON.stringify(row('zz_esl_probe')), beforeRow);
});

test('ESL save onto an existing FSL key -> 409 and no new sample', () => {
  const n = samples('zz_pilipino_lang').length;
  const r = save({ sign_language: 'ESL', text_en: 'zz pilipino lang' });
  assert.equal(r.status, 409);
  assert.equal(r.json.existingSet, 'FSL');
  assert.equal(samples('zz_pilipino_lang').length, n);
});

test('same set re-save with texts replaces the stored texts', () => {
  const r = save({ sign_language: 'ESL', text_en: 'Zz Esl Probe!' });
  assert.equal(r.status, 200);
  assert.equal(r.json.label, 'zz_esl_probe');
  assert.equal(signJson('zz_esl_probe').textEn, 'Zz Esl Probe!');
  assert.equal(row('zz_esl_probe').text_en, 'Zz Esl Probe!');
});

test('legacy call (label, no texts) works and keeps stored texts on re-save', () => {
  const r = save({ label: 'zz_legacy_probe', sign_language: 'ESL' });
  assert.equal(r.status, 200);
  assert.equal(r.json.label, 'zz_legacy_probe');
  const sj = signJson('zz_legacy_probe');
  assert.equal(sj.set, 'ESL'); assert.equal(sj.textEn, 'Zz legacy probe'); assert.equal(sj.textFil, null);
  assert.equal(row('zz_legacy_probe').text_en, 'Zz legacy probe');
  const r2 = save({ label: 'zz_esl_probe', sign_language: 'ESL' });
  assert.equal(r2.status, 200);
  assert.equal(signJson('zz_esl_probe').textEn, 'Zz Esl Probe!');
  const r3 = save({ label: 'zz_legacy_fsl', dataset: 'FSL' });
  assert.equal(r3.status, 200);
  assert.equal(signJson('zz_legacy_fsl').textFil, 'Zz legacy fsl');
  assert.equal(signJson('zz_legacy_fsl').textEn, null);
  save({ label: 'zz_legacy_both', sign_language: 'BOTH' });
  assert.equal(signJson('zz_legacy_both').textEn, 'Zz legacy both');
  assert.equal(signJson('zz_legacy_both').textFil, 'Zz legacy both');
});

test('legacy call with a different set on an existing key -> 409', () => {
  const r = save({ label: 'zz_esl_probe', sign_language: 'FSL' });
  assert.equal(r.status, 409);
  assert.equal(r.json.existingSet, 'ESL');
});

test('GET list: signs map and categories follow the set', () => {
  const r = saveApi({ method: 'GET', query: 'no_sync=1' });
  assert.equal(r.json.success, true);
  assert.deepEqual(r.json.signs.zz_both_probe, { set: 'BOTH', textEn: 'Zz Both Probe?', textFil: 'Zz Pareho?' });
  assert.equal(r.json.signs.zz_pilipino_lang.set, 'FSL');
  assert.ok('zz_both_probe' in r.json.categories.ESL);
  assert.ok('zz_both_probe' in r.json.categories.FSL);
  assert.ok('zz_pilipino_lang' in r.json.categories.FSL);
  assert.ok(!('zz_pilipino_lang' in r.json.categories.ESL));
  assert.ok('zz_esl_probe' in r.json.categories.ESL);
  assert.ok(!('zz_esl_probe' in r.json.categories.FSL));
  assert.equal(r.json.signs.how_are_you.set, 'BOTH');
});

test('full sync: DB follows an edited sign.json', () => {
  const f = path.join(dir('zz_esl_probe'), 'sign.json');
  const sj = JSON.parse(fs.readFileSync(f, 'utf8'));
  sj.set = 'BOTH'; sj.textFil = 'Zz Esl Probe Fil';
  fs.writeFileSync(f, JSON.stringify(sj, null, 2));
  const r = saveApi({ method: 'GET' });
  assert.equal(r.json.success, true);
  const d = row('zz_esl_probe');
  assert.equal(d.sign_language, 'BOTH'); assert.equal(d.text_fil, 'Zz Esl Probe Fil'); assert.equal(d.text_en, 'Zz Esl Probe!');
  assert.deepEqual(r.json.signs.zz_esl_probe, { set: 'BOTH', textEn: 'Zz Esl Probe!', textFil: 'Zz Esl Probe Fil' });
});

test('delete_gesture removes folder (incl. sign.json) and DB row', () => {
  const r = saveApi({ body: { action: 'delete_gesture', label: 'zz_both_probe' } });
  assert.equal(r.json.success, true);
  assert.equal(fs.existsSync(dir('zz_both_probe')), false);
  assert.equal(row('zz_both_probe'), undefined);
  assert.equal(sql(`SELECT COUNT(*) c FROM gesture_recordings WHERE sample_path LIKE 'saved_gestures/zz_both_probe/%'`)[0].c, '0');
});
