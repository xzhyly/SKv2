# tools/pi — Raspberry Pi kiosk scripts

| File | What |
|---|---|
| `pi-setup.sh` | one-command kiosk setup on the Pi (packages, Apache, DB, display, Chromium policy, the launcher `~/.local/bin/sk-kiosk.sh` and its ONE autostart). Guide: [docs/system/PI-SETUP.md](../../docs/system/PI-SETUP.md) |
| `sk-audio.sh` | run by the launcher at every kiosk start: sets the default speaker and microphone **by name** and the speaker volume (≤ 0.8) |
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
