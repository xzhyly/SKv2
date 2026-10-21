# PI-SETUP.md — setting up the kiosk on a Raspberry Pi 4 (pi-setup phase, 2026-10-20)

Target: a Raspberry Pi 4B 8 GB, **Raspberry Pi OS (64-bit) Bookworm with desktop**.

You first build and debug the kiosk from the PC (the Pi's screen shown on the PC through VNC, at 1024x600), then move
it to the 7" LCD.

| Tool | What it does |
|---|---|
| `tools/pi/pi-setup.sh` | the whole setup, safe to re-run, logs to `~/pi-setup.log` |
| `tools/pi/export-from-laptop.cmd`, `tools/pi/import-on-pi.sh` | move the data (`tools/pi/transfer.md`) |

**Nothing here has been run on a real Pi yet** (`docs/reports/2026-10-20-pi-setup.md`). Where a step fails, the
troubleshooting section is at the end; send `~/pi-setup.log` with the problem.

## a) Write the SD card (Raspberry Pi Imager, on the PC)

1. Raspberry Pi Imager:
   - Device **Raspberry Pi 4**.
   - OS **Raspberry Pi OS (64-bit)** (Bookworm, with desktop).
   - Storage: the SD card.
2. **Next -> Edit settings** (OS customisation):
   - **General:**
     - hostname `sk-kiosk`;
     - username and password: e.g. `sk` / a password you keep. Every command below uses `$USER`, so any name works;
     - Wi-Fi SSID and password (country **PH**);
     - locale Asia/Manila.
   - **Services:** **Enable SSH**, password authentication.
3. Write, put the card in the Pi, power it on, and wait about 2 minutes for the first boot.

## b) Reach the Pi from the PC: SSH, then VNC

1. In a Command Prompt or PowerShell on the PC:

   ```bash
   ssh sk@sk-kiosk.local
   ```

   If `sk-kiosk.local` is not found, use the Pi's IP from your router's device list: `ssh sk@192.168.x.y`.
2. Turn VNC on now; `pi-setup.sh --dev` keeps it on later:

   ```bash
   sudo raspi-config nonint do_vnc 0
   ```

3. On the PC, install **RealVNC Viewer**, or **TigerVNC** (works with Bookworm's wayvnc). Connect to `sk-kiosk.local`
   with the Pi's user and password. You now see the Pi's desktop on the PC.

## c) Get the code, run the setup, move the data

1. On the Pi (SSH):

   ```bash
   sudo apt-get update && sudo apt-get install -y git
   git clone https://github.com/xzhyly/SKv2.git ~/SKv2
   cd ~/SKv2
   git switch revision
   ```

   If the repository is private, git asks for a GitHub username and a **personal access token** (not your password).
   Later updates: `cd ~/SKv2 && git pull`.
2. Run the setup in development mode:

   ```bash
   bash tools/pi/pi-setup.sh --dev
   ```

   It asks for your password once (sudo) and takes 5-15 minutes the first time (package installs). It prints a
   numbered section per step and ends with "Done".

   | Step | What it does |
   |---|---|
   | 1. Packages | installs Apache, PHP (`php-mysql` = mysqli, `php-mbstring`; JSON is built into PHP 8), MariaDB, Chromium, unclutter, `speech-dispatcher` + `espeak-ng` (the browser voice), acl, curl |
   | 2. Apache | `/var/www/html/SKR` -> `~/SKv2`, so the kiosk is at `http://localhost/SKR/` as on the laptop. Apache may read the repo and write `saved_gestures/`, `models/`, `config/`; Apache's umask is 002 so your `git pull` can still change its files. `config/device.txt` = `pi` (Compile stays disabled on the Pi) |
   | 3. PHP limits | `/etc/php/<ver>/apache2/conf.d/99-sining-kamay.ini`: upload 16M, post 64M, memory 512M, time 120 s |
   | 4. Database | creates `sining_kamay_db`, lets PHP log in as `root` with an empty password on localhost (what `php/connect.php` expects); `sudo mariadb` still works |
   | 5. Display | 1024x600 (below) |
   | 6. Chromium policy | `/etc/chromium/policies/managed/sining-kamay.json`: camera and mic allowed for `http://localhost`, autoplay, the glove's serial port without a picker (`SerialAllowAllPortsForUrls`) |
   | 7. Kiosk | the launcher `~/.local/bin/sk-kiosk.sh`, started by labwc's autostart, wayfire's `[autostart]` or the X11 `~/.config/autostart/sk-kiosk.desktop`, whichever desktop runs (only one kiosk starts) |
   | 8. Desktop | auto-login to the desktop, screen blanking off, VNC on (`--dev`) or off |
   | 9. Glove and audio | adds you to `dialout` (the glove's USB serial) and prints what to check |

3. Move the data from the laptop (details: `tools/pi/transfer.md`):
   - laptop: `tools\pi\export-from-laptop.cmd F:\` (F: = the USB drive);
   - Pi: plug the drive in, then:

     ```bash
     bash tools/pi/import-on-pi.sh
     ```

     It ends with one `OK` line per count.
4. Reboot. The kiosk opens by itself (you see it in VNC):

   ```bash
   sudo reboot
   ```

**Display (1024x600).** One setting covers VNC/headless and an HDMI 7" 1024x600 LCD:
- `video=HDMI-A-1:1024x600@60D` at the end of the single line in **`/boot/firmware/cmdline.txt`**. The `D` means
  "this output is on even with nothing plugged in".
- `hdmi_force_hotplug=1` in **`/boot/firmware/config.txt`**.
- Both are written by step 5 and take effect after a reboot. To change them later, edit the same two lines, or use
  `sudo raspi-config` -> Display Options -> VNC Resolution.
- An official Raspberry Pi 7" **DSI** panel is 800x480, not 1024x600: see troubleshooting.

## d) Debug from the PC

- **See the screen:** VNC (above). Do not leave a VNC viewer open while measuring speed (it costs CPU).
- **Chromium DevTools.** With `--dev`, the kiosk Chromium listens on `localhost:9222` on the Pi only. Tunnel it from
  the PC:

  ```bash
  ssh -L 9222:localhost:9222 sk@sk-kiosk.local
  ```

  Keep that window open. In Chrome on the PC, open `chrome://inspect` -> Configure… -> add `localhost:9222`.
  The kiosk page appears under Remote Target -> **inspect**: console, network and elements, live.
- **Logs on the Pi:**

  ```bash
  tail -f ~/kiosk.log
  tail -n 50 ~/pi-setup.log
  sudo tail -f /var/log/apache2/error.log
  ```

- **Restart only the kiosk** (no reboot): `pkill -f 'chromium.*--kiosk'; ~/.local/bin/sk-kiosk.sh &` in a terminal
  on the Pi's desktop (VNC).

## e) Measure and check

1. Avatar speed, on the Pi's desktop (VNC terminal, not SSH):

   ```bash
   bash ~/SKv2/tests/avatar/pi-bench.sh
   ```

   It prints `capped30.fps` (target 30) and saves `~/avatar-bench-<date>.json`. Then reboot, or restart the kiosk.
   Optional, the model speed: `bash ~/SKv2/tests/compact-model/pi-bench.sh`.
2. Short checklist on the kiosk (VNC, or the LCD):
   - [ ] **Recognition:** Let's Talk -> Sign: the camera shows; sign hello, then thank you: the words appear.
     Send 🔊.
   - [ ] **Audio:** Send 🔊 speaks the message (recorded audio or the browser voice). `speaker-test -t wav -c 2 -l 1`
     in a terminal plays "front left / front right".
   - [ ] **Let's Talk, Speak or Type:** type `hello mabuti ako`, Translate: the avatar signs; Send.
   - [ ] **Quiz:** start one, answer 2 questions.
   - [ ] **Glove simulator:** log in as admin -> name chip -> Settings -> Glove -> Use simulator: "Not set up yet"
     (the simulator's setup lives in each browser); Debug shows about 30 lines/s.
   - [ ] **Glove (if plugged):** it connects by itself thanks to the policy (no port picker) and shows
     "setup saved on glove …": the setup made on the laptop comes from the glove, so **no Set up glove on the
     Pi** (run it again only if the camera differs: its step 3 is about this kiosk's camera).
     `ls /dev/ttyUSB* /dev/ttyACM*` shows it.
   - [ ] Train Gestures Step 2 says "build the model on the laptop" (Compile disabled on the Pi).

## f) Final: the 7" LCD, no dev mode

1. Shut down: `sudo poweroff`. Connect the 7" LCD (HDMI + its USB cable for touch and power), the camera, the speaker.
2. Power on, SSH in, and run the setup **without** `--dev`:

   ```bash
   cd ~/SKv2 && git pull && bash tools/pi/pi-setup.sh
   ```

   This turns VNC off and removes the remote-debugging port.
3. `sudo reboot`. The Pi boots straight into the kiosk on the LCD.

## Troubleshooting

| Problem | Check / fix |
|---|---|
| **Camera not found** ("Starting camera…" stays, or an error in Sign) | `ls /dev/video*` must list a device. A **USB webcam** works directly. A **ribbon-cable camera** (CSI) does not appear in Chromium on Bookworm without an extra bridge (libcamera only), so use a USB webcam. Try another USB port; `dmesg \| tail` after plugging. In DevTools: `navigator.mediaDevices.enumerateDevices()`. |
| **No sound** | Every kiosk start sets the speaker / mic by name (`tools/pi/sk-audio.sh`, its `[sk-audio …]` lines in `~/kiosk.log`; names and volume, max 0.8, in [tools/pi/README.md](../../tools/pi/README.md)). By hand: `wpctl status` (Sinks): the speaker must be the `*` default; `wpctl set-default <id>`. Or the speaker icon (top right) -> choose the output; for HDMI audio pick the LCD's HDMI. `speaker-test -t wav -c 2 -l 1`. Browser voice only: `spd-say hello` (needs `speech-dispatcher` + `espeak-ng`, installed by step 1). |
| **Black screen** (on the LCD, or VNC shows nothing) | Wait 60 s: the launcher waits for Apache. In VNC, check `~/kiosk.log`. LCD stays black: check `/boot/firmware/cmdline.txt` has `video=HDMI-A-1:1024x600@60D` on its one line (not a second line), and the LCD's power. An official **DSI** 7" panel: remove `video=HDMI-A-1:…` and set the page to its native 800x480 (it is not 1024x600). VNC "cannot currently show the desktop": run `sudo raspi-config` -> Display Options -> VNC Resolution -> 1024x600, then reboot. |
| **Web Serial port not listed** (Settings -> Glove -> Connect glove shows nothing) | `ls /dev/ttyUSB* /dev/ttyACM*` must show the glove (try another cable: many USB cables are power-only). `groups` must include `dialout`: re-run `pi-setup.sh` and reboot. The page must be `http://localhost/SKR/…` (not an IP address). Close the Arduino Serial Monitor or any `screen` / `minicom` that holds the port. Policy loaded: `chrome://policy` shows `SerialAllowAllPortsForUrls`. |
| **Page not loading** ("This site can't be reached", 404, or a blank error) | `systemctl status apache2 mariadb` (both "active"); `curl -I http://localhost/SKR/` -> 200; `ls -l /var/www/html/SKR` -> points at `~/SKv2`; `sudo tail /var/log/apache2/error.log` ("Permission denied" -> re-run `pi-setup.sh`). DB errors in the page: `sudo mariadb -e 'SHOW TABLES' sining_kamay_db` lists 7 tables, else run `import-on-pi.sh`. |
| **The kiosk opens twice, or not at all after an OS upgrade** | Since pi-fixes (2026-10-21) `pi-setup.sh` writes ONE autostart, for the session in `/etc/lightdm/lightdm.conf`, disables old `start_kiosk.sh` / `SKR_Kiosk.desktop` autostarts, and Chromium no longer restores the previous session (policy `RestoreOnStartup` 5). `~/kiosk.log` has one `=== kiosk … started by: …` line per launcher run. After switching desktop (raspi-config), re-run `pi-setup.sh`. Restart from SSH: [tools/pi/README.md](../../tools/pi/README.md). Hardware (power-on order, speaker port, volume, splitter EDID): same file. |
| **"Model out of date" / old signs** | The Pi uses the models compiled on the laptop: compile there, `git pull` on the Pi (or re-export / import), then reload. |
