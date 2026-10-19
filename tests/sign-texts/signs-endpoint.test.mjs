import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { callApi, saveApi, signsApi, save, row, dir, samples, signJson, cleanZz } from './api-helper.mjs';

before(cleanZz);
after(cleanZz);

const bytes = (key) => samples(key).map(f => fs.readFileSync(path.join(dir(key), f), 'utf8'));
const upd = (o) => signsApi({ body: { action: 'update', ...o } });

test('GET shape and a real sign (read-only)', () => {
  const r = signsApi({ method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  const keys = Object.keys(r.json.signs);
  assert.ok(keys.length > 100);
  for (const k of keys) {
    const s = r.json.signs[k];
    for (const f of ['set', 'textEn', 'textFil', 'category', 'assetPath', 'samples', 'avatar', 'audio']) assert.ok(f in s, `${k}.${f}`);
    assert.deepEqual(Object.keys(s.audio), ['en', 'fil'], `${k}.audio`);   // talk-turns-audio phase
    assert.ok(Number.isInteger(s.samples), `${k}.samples int`);
    assert.ok(['ESL', 'FSL', 'BOTH'].includes(s.set));
  }
  const h = r.json.signs.how_are_you;
  assert.equal(h.set, 'BOTH'); assert.equal(h.textEn, 'How are you'); assert.equal(h.textFil, 'Kamusta ka');
  assert.ok(h.samples >= 1);
});

test('update ESL -> BOTH with textFil; samples untouched; survives full sync', () => {
  assert.equal(save({ sign_language: 'ESL', text_en: 'Zz Edit Probe' }).status, 200);
  const before = bytes('zz_edit_probe'); const names = samples('zz_edit_probe');
  const r = upd({ key: 'zz_edit_probe', set: 'BOTH', textEn: 'Zz Edit Probe', textFil: ' Zz Binago? ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.sign, { key: 'zz_edit_probe', set: 'BOTH', textEn: 'Zz Edit Probe', textFil: 'Zz Binago?' });
  const sj = signJson('zz_edit_probe');
  assert.equal(sj.set, 'BOTH'); assert.equal(sj.textFil, 'Zz Binago?');
  const d = row('zz_edit_probe');
  assert.equal(d.sign_language, 'BOTH'); assert.equal(d.text_fil, 'Zz Binago?');
  assert.deepEqual(samples('zz_edit_probe'), names);
  assert.deepEqual(bytes('zz_edit_probe'), before);
  assert.equal(saveApi({ method: 'GET' }).json.success, true);
  assert.equal(row('zz_edit_probe').sign_language, 'BOTH');
  const list = signsApi({ method: 'GET' }).json.signs.zz_edit_probe;
  assert.equal(list.set, 'BOTH'); assert.equal(list.samples, 1);
});

test('narrowing BOTH -> ESL without textFil keeps the stored textFil', () => {
  const r = upd({ key: 'zz_edit_probe', set: 'ESL', textEn: 'Zz Edit Probe', textFil: null });
  assert.equal(r.status, 200);
  assert.equal(r.json.sign.set, 'ESL');
  assert.equal(r.json.sign.textFil, 'Zz Binago?');
  assert.equal(signJson('zz_edit_probe').textFil, 'Zz Binago?');
  assert.equal(row('zz_edit_probe').text_fil, 'Zz Binago?');
  const r2 = upd({ key: 'zz_edit_probe', set: 'ESL', textEn: 'Zz Edit Probe' }); // textFil absent
  assert.equal(r2.json.sign.textFil, 'Zz Binago?');
});

test('validation: 400 / 404 / 405', () => {
  const before = row('zz_edit_probe');
  const noEn = upd({ key: 'zz_edit_probe', set: 'ESL', textEn: '' });
  assert.equal(noEn.status, 400); assert.equal(noEn.json.success, false);
  assert.equal(upd({ key: 'zz_edit_probe', set: 'ESL', textEn: 'a'.repeat(256) }).status, 400);
  assert.equal(upd({ key: 'zz_edit_probe', set: 'NOPE', textEn: 'x' }).status, 400);
  assert.deepEqual(row('zz_edit_probe'), before);
  const nf = upd({ key: 'zz_does_not_exist', set: 'ESL', textEn: 'x' });
  assert.equal(nf.status, 404); assert.equal(nf.json.success, false);
  assert.equal(upd({ key: 'Zz Bad Key', set: 'ESL', textEn: 'x' }).status, 404);
  assert.equal(upd({ key: '../saved_gestures', set: 'ESL', textEn: 'x' }).status, 404);
  assert.equal(signsApi({ body: { action: 'frobnicate' } }).status, 400);
  assert.equal(callApi('signs.php', { rawBody: 'not json' }).status, 400);
  assert.equal(callApi('signs.php', { method: 'PUT', body: {} }).status, 405);
});

test('FSL update with no stored/sent textFil -> 400 and nothing changes', () => {
  assert.equal(save({ sign_language: 'ESL', text_en: 'Zz Edit Two' }).status, 200);
  const r = upd({ key: 'zz_edit_two', set: 'FSL', textEn: 'Zz Edit Two' });
  assert.equal(r.status, 400);
  assert.equal(row('zz_edit_two').sign_language, 'ESL');
  assert.equal(signJson('zz_edit_two').set, 'ESL');
});
