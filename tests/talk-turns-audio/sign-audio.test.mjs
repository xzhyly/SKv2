// js/sign-audio.js (talk-turns-audio phase) under node:vm with a fake Audio and speechSynthesis:
// the signs of a message play in order, a recording where the sign has one for the language, the
// browser voice for the rest (consecutive ones as one utterance), skipped silently with no voice;
// a recording that fails is read by the voice; stop() ends it at once; one message at a time.
// Run: node --test tests/talk-turns-audio/sign-audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', '..', 'js', 'sign-audio.js'), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

function load({ voices = [{ lang: 'en-US' }, { lang: 'fil-PH' }], badUrls = [] } = {}) {
  const log = [];
  function Audio(url) {
    this.url = url;
    this.play = () => {
      log.push('audio:' + url);
      setTimeout(() => (badUrls.includes(url) ? this.onerror : this.onended)?.(), 5);
      return Promise.resolve();
    };
    this.pause = () => log.push('pause:' + url);
  }
  const speechSynthesis = {
    getVoices: () => voices, addEventListener() {}, removeEventListener() {},
    speak(u) { log.push(`voice(${u.lang}):${u.text}`); setTimeout(() => u.onend && u.onend(), 5); },
    cancel() { log.push('cancel'); },
  };
  function SpeechSynthesisUtterance(t) { this.text = t; }
  const window = { speechSynthesis };
  const ctx = { window, Audio, SpeechSynthesisUtterance, console, Promise, setTimeout, clearTimeout, String };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { SignAudio: window.SignAudio, log };
}
const AUDIO = { hello: { en: 'a/hello_en.webm', fil: 'a/hello_fil.webm' }, thanks: { en: 'a/thanks_en.mp3', fil: null } };
const ITEMS = [{ key: 'hello', text: 'Hello' }, { key: 'my_name', text: 'My name' }, { key: 'is', text: 'is' }, { key: 'thanks', text: 'Thank you' }];

test('segments: recordings per language, the rest grouped into utterances', () => {
  const { SignAudio } = load();
  assert.deepEqual(plain(SignAudio.segments(ITEMS, 'en', AUDIO)), [
    { type: 'audio', url: 'a/hello_en.webm', text: 'Hello' },
    { type: 'voice', text: 'My name is' },
    { type: 'audio', url: 'a/thanks_en.mp3', text: 'Thank you' },
  ]);
  assert.deepEqual(plain(SignAudio.segments(ITEMS, 'fil', AUDIO)), [
    { type: 'audio', url: 'a/hello_fil.webm', text: 'Hello' },
    { type: 'voice', text: 'My name is Thank you' },
  ]);
});

test('play: in order, recordings then voice, onEnd once', async () => {
  const { SignAudio, log } = load();
  let ends = 0;
  await SignAudio.play(ITEMS, 'en', AUDIO, { onEnd: () => ends++ });
  assert.deepEqual(log.filter((l) => l !== 'cancel'), ['audio:a/hello_en.webm', 'voice(en-US):My name is', 'audio:a/thanks_en.mp3']);
  assert.equal(ends, 1);
  assert.equal(SignAudio.isPlaying(), false);
});

test('a recording that cannot play is read by the voice instead', async () => {
  const { SignAudio, log } = load({ badUrls: ['a/hello_en.webm'] });
  await SignAudio.play(ITEMS.slice(0, 1), 'en', AUDIO);
  assert.deepEqual(log.filter((l) => l !== 'cancel'), ['audio:a/hello_en.webm', 'voice(en-US):Hello']);
});

test('no voice at all: signs without a recording are skipped silently', async () => {
  const { SignAudio, log } = load({ voices: [] });
  await SignAudio.play(ITEMS, 'en', AUDIO);
  assert.deepEqual(log.filter((l) => l !== 'cancel'), ['audio:a/hello_en.webm', 'audio:a/thanks_en.mp3']);
});

test('stop() ends at once (onEnd called); a new play() stops the previous message', async () => {
  const { SignAudio, log } = load();
  let ends = 0;
  const p = SignAudio.play(ITEMS, 'en', AUDIO, { onEnd: () => ends++ });
  assert.equal(SignAudio.isPlaying(), true);
  SignAudio.stop();
  assert.equal(ends, 1);
  assert.equal(SignAudio.isPlaying(), false);
  await p;
  assert.equal(ends, 1);
  assert.ok(!log.includes('voice(en-US):My name is'), JSON.stringify(log));
  let firstEnded = 0;
  SignAudio.play(ITEMS, 'en', AUDIO, { onEnd: () => firstEnded++ });
  await SignAudio.play([{ key: 'x', text: 'Next' }], 'en', AUDIO);
  assert.equal(firstEnded, 1, 'the first message was stopped by the second');
  assert.equal(log[log.length - 1], 'voice(en-US):Next');
});
