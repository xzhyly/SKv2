# tools/pi — Raspberry Pi kiosk scripts

| File | What |
|---|---|
| `pi-setup.sh` | one-command kiosk setup on the Pi (packages, Apache, DB, display, Chromium policy, the launcher `~/.local/bin/sk-kiosk.sh` and its ONE autostart). Guide: [docs/system/PI-SETUP.md](../../docs/system/PI-SETUP.md) |
| `sk-audio.sh` | run by the launcher at every kiosk start: sets the default speaker and microphone **by name** and the speaker volume (≤ 0.8) |
| (installed by `pi-setup.sh`) `/etc/sudoers.d/sk-power`, `/usr/local/bin/sk-volume` | let the admin Shut down / Restart the Pi and set the volume from Settings → System: [below](#admin-power-and-volume-buttons-settings--system) |
| `export-from-laptop.cmd`, `import-on-pi.sh` | move the laptop's data (DB, `saved_gestures/`, `models/`) to the Pi: [transfer.md](transfer.md) |

## Pi hardware notes

From the owner's tests on the kiosk build (2026-10-21; Pi 4B, two 7" 1024×600 LCDs through an HDMI splitter, powered USB hub,
USB speaker `CD002-AUDIO`, USB headset adapter `AB13X` for the microphone):

1. **Power-on order: the hub and the LCDs first, then the Pi.** The Pi reads the display's EDID and
   enumerates USB at boot; a display or hub that comes up later can leave the screen black or a
   USB device missing until the next reboot.
2. **The speaker goes into a USB port on the Pi itself, not into the hub.** On the hub it shares the
   hub's power with the LCDs.
3. **Speaker volume ≤ 0.8.** The speaker and the LCDs share power; above 0.8 loud sounds brown out
   the LCDs (they flicker or go black). `sk-audio.sh` sets 0.75 and clamps anything higher to
   `MAX_VOLUME` (0.8). Do not raise the volume with the desktop's speaker icon either.
4. **LCD splitter and EDID.** Through an HDMI splitter the Pi sees the EDID the splitter reports
   (one of the screens, or the splitter's own default), not both screens. So the mode is not taken
   from the EDID: `pi-setup.sh` forces `video=HDMI-A-1:1024x600@60D` on the kernel command line and
   `hdmi_force_hotplug=1`, and both LCDs get the same 1024×600 picture. If one LCD shows "no signal"
   or a cropped picture, check the splitter's EDID switch (copy from output 1 / default) and reboot
   with everything powered first (note 1). `cat /sys/class/drm/card?-HDMI-A-1/modes` lists what the
   Pi read.

## Speaker and microphone (`sk-audio.sh`)

PipeWire numbers devices anew on every boot and replug, so the script looks them up by name in
`wpctl status` (Audio → Sinks / Sources), makes them the defaults, unmutes the speaker and sets its
volume. It waits up to 30 s for the devices to appear. Its lines (`[sk-audio …]`) are in
`~/kiosk.log`.

Names and volume are at the top of the script (`SINK_NAME`, `SOURCE_NAME`, `SINK_VOLUME`,
`MAX_VOLUME`). To change them without editing the tracked file, put the same variables in
`~/.config/sk-audio.conf`, e.g.:

```bash
SINK_NAME="USB Audio"
SINK_VOLUME="0.6"
```

Run it by hand to check: `bash tools/pi/sk-audio.sh`, then `wpctl status` (the `*` marks the defaults).

## Admin power and volume buttons (Settings → System)

The kiosk has no keyboard or mouse, so an admin turns it off from the screen: log in as an admin →
name chip → Settings → **System**.

- **Shut down** / **Restart** ask first (EN/FIL), then show a full-screen message; the Pi powers off or
  reboots about 3 s later. **To turn it on again, plug the power back in** (the Pi has no power button).
- **Unplug only after the green LED stops blinking.** The green ACT LED blinks while the Pi writes to
  the SD card during shutdown; pulling the power before it stops can corrupt the card.
- **Speaker volume**: a slider up to 80 % (`MAX_VOLUME` in `sk-audio.sh`; louder browns out the LCDs,
  note 3 above) and **Test sound**. The value is also saved as `SINK_VOLUME` in
  `~/.config/sk-audio.conf`, so `sk-audio.sh` restores it at every kiosk start.
- On the laptop (or any non-Pi) the buttons are disabled with "Raspberry Pi only"; the API
  (`php/api/system_power.php`) refuses and runs nothing.

`pi-setup.sh` step 10 installs what this needs (re-run it after a `git pull` that changes it; it prints
`installed` or `unchanged` for each file):

| File | What |
|---|---|
| `/etc/sudoers.d/sk-power` (root, 0440, checked with `visudo -cf` before it is installed) | Apache's user (`APACHE_RUN_USER`, normally `www-data`) may run, as root and without a password, only `/usr/bin/systemctl poweroff`, `/usr/bin/systemctl reboot` and `/usr/local/bin/sk-volume` |
| `/usr/local/bin/sk-volume` (root, 0755) | accepts only `get` or `set 0.00..0.80`, then runs `wpctl` as the kiosk user with `XDG_RUNTIME_DIR=/run/user/<uid>` (Apache cannot reach the kiosk user's PipeWire session) and writes `SINK_VOLUME` |

Checks on the Pi:

```bash
sudo -u www-data sudo -n -l /usr/bin/systemctl poweroff   # prints the command = allowed
sudo -u www-data sudo -n /usr/local/bin/sk-volume get     # Volume: 0.75
grep sk-power /var/log/apache2/error.log                  # one "[sk-power] user=... action=..." line per request
```

If Settings → System says "Not set up: run tools/pi/pi-setup.sh", one of these checks fails.

## Restarting the kiosk from SSH

Over SSH there is no `$DISPLAY`, and the running kiosk holds `/tmp/sk-kiosk.lock`. Either:

```bash
nohup env DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) bash ~/.local/bin/sk-kiosk.sh --restart >/dev/null 2>&1 &
```

(`--restart` closes the running kiosk and its launcher first), or, if no kiosk is running any more but
the lock file is left over:

```bash
rm -f /tmp/sk-kiosk.lock
nohup env DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) bash ~/.local/bin/sk-kiosk.sh >/dev/null 2>&1 &
```

`tests/avatar/pi-bench.sh` does the second one by itself when the bench ends.

## One kiosk tab only

`~/kiosk.log` gets one `=== kiosk … started by: …` line per launcher run. After a boot there should be
exactly one, and DevTools (`chrome://inspect`, `--dev` setups) should list one "Sining Kamay Kiosk"
page. If there are two launcher lines, two autostarts are active: re-run `pi-setup.sh` (it keeps only
the one for the desktop session in `/etc/lightdm/lightdm.conf` and disables old `start_kiosk.sh` /
`SKR_Kiosk.desktop` entries).
