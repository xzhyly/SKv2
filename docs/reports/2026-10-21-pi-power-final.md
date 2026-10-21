Phase: pi-power (admin Shut down / Restart / speaker volume)
Date: 2026-10-21
Status: DONE
Decision needed from owner: none (Pi-side checks below still to run on the Pi)

# pi-power — final report

Branch `pi-power`, off `pi-fixes` (`a6be8f4`). Not pushed, not merged. No tables touched.
`docs/revision/MEMORY.md`, `docs/system/MANUAL-CHECKS.md`, videos and `unzipping` untouched.

## What changed

Admin → Settings now has a **System** section (the kiosk has no keyboard or mouse):

- **Power card**: "⏻ Shut down" and "↻ Restart". Each asks first in English and Filipino
  ("Shut down the kiosk? / Papatayin ang kiosk?", Cancel / Shut down; "Restart the kiosk? /
  I-restart ang kiosk?"). After the confirm, a full-screen dark message with no buttons:
  - Shut down: "Shutting down… Wait until the green light stops blinking, then unplug. Plug in again
    to turn on." / "Pinapatay… Hintaying tumigil ang kumikislap na green light bago hugutin. Isaksak
    ulit para buksan."
  - Restart: "Restarting… The kiosk comes back in about 1 minute." / "Nagre-restart… Babalik ang
    kiosk sa loob ng mga 1 minuto." (the Filipino line for Restart was not in the request; it is my
    translation, change it in `settings.html` `TEXT.reboot.fil` if wanted.)
- **Speaker volume card**: slider 0–80 % (the slider's max is `MAX_VOLUME` × 100, read from
  `tools/pi/sk-audio.sh:18` by the API), the current volume loaded when the page opens, set on release,
  "🔈 Test sound" (two short Web Audio tones played in the page after the set finishes; no file, no
  network), and the note "Max 80% — higher turns off the screens / Hanggang 80% lang — lalakas pa ay
  namamatay ang screen".
- Not a Pi (the laptop): all buttons and the slider stay disabled with "Raspberry Pi only".
- On a Pi without `pi-setup.sh` step 10: disabled with "Not set up: run tools/pi/pi-setup.sh on the Pi".

**Not done:** the optional third button "Restart kiosk app" (Chromium only). It would need a third
root-run command (sudo to the kiosk user + its display variables); left out to keep the sudo rule to
poweroff / reboot / sk-volume. Restarting the Pi does the same in ~1 minute.

## Files

| File | What |
|---|---|
| `php/api/system_power.php` (new) | POST JSON only (GET → 405). Actions `status`, `shutdown`, `reboot`, `get_volume`, `set_volume`. Admin only: guest/user → 403 through `sk_forbidden` (`php/session.php:81`). Every request is logged first: `[sk-power] user=<name>(<role>) action=<action> ip=<addr>` to the PHP error log. Pi = Linux and `/proc/device-tree/model` contains "Raspberry Pi" (`is_pi()`, line 36; `config/device.txt` deliberately not used). Not a Pi → 409 "Raspberry Pi only" and nothing runs. `status` → `{isPi, canPower, canVolume, maxVolume}`; canPower = `sudo -n -l /usr/bin/systemctl poweroff` and `… reboot` both succeed. Shutdown/reboot send the JSON first (`answer_now`, line 122: Content-Length + Connection: close + flush) and then start `nohup sh -c 'sleep 3; sudo -n /usr/bin/systemctl poweroff' &` (line 123). Command strings are constants; the only value passed on is the volume, clamped to MAX (line 153) and re-formatted as `%.2f`. |
| `settings.html` | "⏻ System" nav item + section, confirm dialog, full-screen message, volume slider + Test sound (separate IIFE after the glove code). |
| `tools/pi/pi-setup.sh` | New step 10 (line 334): finds Apache's user (`APACHE_RUN_USER` from `/etc/apache2/envvars`, else the non-root `apache2` process owner from `ps`, else `www-data`); writes `/usr/local/bin/sk-volume` (root, 0755) and `/etc/sudoers.d/sk-power` (root, 0440, checked with `visudo -cf` before installing; never installed when the check fails). Each file is installed only when content or mode differs and prints `installed` / `unchanged`. Ends with a check that Apache's user may run `systemctl poweroff`. |
| `tools/pi/README.md` | New section "Admin power and volume buttons (Settings → System)": the buttons, **unplug only after the green LED stops blinking**, the two installed files, check commands. |
| `tools/pi/sk-audio.sh` | Comment only: sk-volume writes `SINK_VOLUME` to `~/.config/sk-audio.conf`; the API reads `MAX_VOLUME` from this file. |
| `tests/pi-power/system-power.test.mjs` (new) | Laptop endpoint tests (below). |

### `/etc/sudoers.d/sk-power`

```
<apache user> ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot
<apache user> ALL=(root) NOPASSWD: /usr/local/bin/sk-volume
```

### `/usr/local/bin/sk-volume`

Accepts only `get` or `set <v>` with `v` matching `^(0|1)?(\.[0-9]{1,2})?$` and ≤ MAX (MAX baked in at
install from `sk-audio.sh`'s `MAX_VOLUME`); anything else exits 2. Runs
`sudo -u <kiosk user> env XDG_RUNTIME_DIR=/run/user/<uid> wpctl get-volume|set-volume @DEFAULT_AUDIO_SINK@ <v>`.
The kiosk user is the one that ran `pi-setup.sh` (not hard-coded `sk`). `set` also writes / replaces
`SINK_VOLUME="<v>"` in `<kiosk home>/.config/sk-audio.conf` as the kiosk user, which `sk-audio.sh`
sources at every kiosk start.

## Tests run (laptop, Windows/XAMPP)

| Check | Result |
|---|---|
| `node --test --test-concurrency=1 tests/pi-power/*.test.mjs` (node v24.11.1; `node` is not on PATH on this laptop, the Playwright-bundled `node.exe` was used) | **4/4**: guest and user get 403 for all 5 actions; GET 405, unknown action 400; admin `status` = `{success:true, isPi:false, canPower:false, canVolume:false, maxVolume:0.8}`; shutdown/reboot/get_volume/set_volume → 409 "Raspberry Pi only" |
| `php -l php/api/system_power.php`, `bash -n tools/pi/pi-setup.sh` | no syntax errors |
| Generated `sk-volume` run under Git Bash with stub `sudo`/`wpctl` | `get`, `set 0.6`, `set 0.80`, `set .5`, `set 0` → OK (`%.2f` passed to wpctl); `set 0.81`, `set 1`, `set 0.5;rm`, `set -0.1`, `set 0.555`, `set`, `get x`, `foo` → exit 2, wpctl not run. Conf: appends `SINK_VOLUME` when missing, replaces it when present, keeps other lines. |
| Browser pane, admin logged in, viewport 1024×600, `settings.html` → System | both buttons and slider disabled, "Raspberry Pi only" twice; volume note shown. With `fetch` stubbed in the page: Shut down → EN/FIL confirm → full-screen "Shutting down…" message, no buttons. |
| Apache error log | `[sk-power] user=admin(admin) action=status ip=::1` written by the page load |

`visudo -cf`, `wpctl` and the real power commands cannot run on Windows: **not verified on the Pi yet**.

## How to test on the Pi

1. `git fetch` / check out `pi-power` in the kiosk checkout, then `bash tools/pi/pi-setup.sh` (as the
   kiosk user). Step 10 should print `Apache user: www-data …`, both files `installed`, and
   `Check: www-data may run systemctl poweroff/reboot: OK`. A second run prints `unchanged` twice.
2. Shell checks:
   ```bash
   sudo -u www-data sudo -n -l /usr/bin/systemctl poweroff
   sudo -u www-data sudo -n /usr/local/bin/sk-volume get
   sudo -u www-data sudo -n /usr/local/bin/sk-volume set 0.95   # must fail: above MAX
   ```
3. Kiosk: log in as admin → name chip → Settings → System. Power note empty and buttons enabled
   (= status `canPower: true`); slider shows the current volume (0.75 → 75 %).
4. Move the slider to 60 %, tap Test sound: quieter tones; `cat ~/.config/sk-audio.conf` shows
   `SINK_VOLUME="0.60"`. The slider cannot go above 80 %.
5. Restart → confirm → "Restarting…" message → Pi reboots and the kiosk comes back (~1 min); System
   still shows 60 %.
6. Shut down → confirm → message → wait until the green ACT LED stops blinking → unplug → plug in →
   the Pi boots into the kiosk.
7. `grep sk-power /var/log/apache2/error.log` lists every request above.

If step 3 shows "Not set up" although step 2 works, Apache's systemd unit may block sudo
(e.g. `NoNewPrivileges=`): `systemctl show apache2 -p NoNewPrivileges` must say `no`.
