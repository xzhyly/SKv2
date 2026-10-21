// php/api/system_power.php (pi-power phase) on the laptop: admin only (403 for a guest or a user),
// POST only, status says isPi false, and every power/volume action is refused with 409 before any
// command runs. The Pi side is checked by hand (docs/reports/2026-10-21-pi-power-final.md).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeUser, cleanupAccounts, adminCookie, callPhp } from '../accounts-quiz/helper.mjs';

const power = (body, cookie = '', method = 'POST') => callPhp({ script: 'system_power.php', method, body, cookie });

before(cleanupAccounts);
after(cleanupAccounts);

test('guest and user get 403 for every action', () => {
  const u = makeUser();
  for (const action of ['status', 'shutdown', 'reboot', 'get_volume', 'set_volume']) {
    assert.equal(power({ action, value: 0.5 }).status, 403, `guest ${action}`);
    assert.equal(power({ action, value: 0.5 }, u.cookie).status, 403, `user ${action}`);
  }
});

test('GET is 405, unknown action is 400', () => {
  assert.equal(power(undefined, adminCookie(), 'GET').status, 405);
  const r = power({ action: 'rm -rf' }, adminCookie());
  assert.equal(r.status, 400);
  assert.equal(r.json.success, false);
});

test('laptop: status isPi false, canPower false, maxVolume 0.8 from sk-audio.sh', () => {
  const r = power({ action: 'status' }, adminCookie());
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { success: true, isPi: false, canPower: false, canVolume: false, maxVolume: 0.8 });
});

test('laptop: shutdown, reboot and volume actions are refused (409, Raspberry Pi only)', () => {
  for (const action of ['shutdown', 'reboot', 'get_volume', 'set_volume']) {
    const r = power({ action, value: 0.5 }, adminCookie());
    assert.equal(r.status, 409, action);
    assert.equal(r.json.error, 'Raspberry Pi only', action);
  }
});
