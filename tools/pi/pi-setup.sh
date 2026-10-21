#!/bin/bash
# tools/pi/pi-setup.sh — one-command kiosk setup on a Raspberry Pi 4 (Raspberry Pi OS 64-bit, Bookworm).
# Step-by-step guide: docs/system/PI-SETUP.md. Safe to re-run: every step checks before it changes
# anything, and a second run converges on the same state. Logs to ~/pi-setup.log.
#
#   bash tools/pi/pi-setup.sh [--dev] [--sql DUMP.sql] [REPO_PATH]
#
#   REPO_PATH   the SKv2 checkout to serve (default: the repo this script is in)
#   --dev       developing from the PC: VNC stays on and Chromium opens --remote-debugging-port=9222
#               (localhost only; reach it with `ssh -L 9222:localhost:9222`). Without --dev both are off.
#   --sql FILE  import this mysqldump into sining_kamay_db (the laptop's dump; see tools/pi/transfer.md)
#
# Run it as the kiosk user (the one that logs in to the desktop), not as root: it calls sudo itself.
set -euo pipefail

DEV=0
SQL=""
REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DEV=1 ;;
    --sql) shift; SQL="${1:-}"; [ -n "$SQL" ] || { echo "--sql needs a file" >&2; exit 2; } ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) REPO="$1" ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
REPO="$(cd "$REPO" && pwd)"
KIOSK_USER="${SUDO_USER:-$USER}"
if [ "$KIOSK_USER" = "root" ]; then
  echo "Run this as the kiosk user (e.g. 'bash tools/pi/pi-setup.sh'), not as root." >&2
  exit 2
fi
HOME_DIR="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
LOG="$HOME_DIR/pi-setup.log"
URL="http://localhost/SKR/"
DB="sining_kamay_db"

exec > >(tee -a "$LOG") 2>&1
echo
echo "=== pi-setup $(date '+%Y-%m-%d %H:%M:%S')  user=$KIOSK_USER  repo=$REPO  dev=$DEV  sql=${SQL:-none} ==="

step() { echo; echo "--- $* ---"; }
have() { command -v "$1" >/dev/null 2>&1; }

[ -f "$REPO/index.html" ] && [ -f "$REPO/php/connect.php" ] || { echo "Not an SKv2 checkout: $REPO" >&2; exit 1; }
if [ -n "$SQL" ] && [ ! -f "$SQL" ]; then echo "SQL dump not found: $SQL" >&2; exit 1; fi

# ── 1. Packages ──
step "1. Packages"
PKGS=(apache2 php libapache2-mod-php php-mysql php-mbstring mariadb-server chromium unclutter acl
      speech-dispatcher espeak-ng alsa-utils curl fonts-noto-color-emoji)
# fonts-noto-color-emoji: without it every emoji in the UI (the speaker, hand and mic icons) is a box.
# php-json is built into PHP 8 (no separate package on Bookworm); php-mysql provides mysqli.
MISSING=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "Installing: ${MISSING[*]}"
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${MISSING[@]}"
else
  echo "All packages present."
fi
sudo systemctl enable --now apache2 mariadb

# ── 2. Serve the repo at http://localhost/SKR/ ──
step "2. Apache: /var/www/html/SKR -> $REPO"
if [ -L /var/www/html/SKR ]; then
  [ "$(readlink -f /var/www/html/SKR)" = "$REPO" ] || sudo ln -sfn "$REPO" /var/www/html/SKR
elif [ -e /var/www/html/SKR ]; then
  echo "/var/www/html/SKR exists and is not a symlink: moved to /var/www/html/SKR.bak-$(date +%s)"
  sudo mv /var/www/html/SKR "/var/www/html/SKR.bak-$(date +%s)"
  sudo ln -s "$REPO" /var/www/html/SKR
else
  sudo ln -s "$REPO" /var/www/html/SKR
fi
# Apache (www-data) must be able to walk into the home folder (Bookworm homes are 0700): execute only.
p="$REPO"
while [ "$p" != "/" ]; do sudo setfacl -m u:www-data:x "$p"; p="$(dirname "$p")"; done
sudo setfacl -R -m u:www-data:rX "$REPO"
# PHP writes saved_gestures/, models/ (and config/, bulk_import_cache/). Shared group www-data, setgid
# directories, and Apache's umask 002, so both the kiosk user (git pull) and PHP can change the files.
sudo usermod -aG www-data "$KIOSK_USER"
for d in saved_gestures models config; do
  sudo mkdir -p "$REPO/$d"
  sudo chown -R "$KIOSK_USER":www-data "$REPO/$d"
  sudo chmod -R g+rwX "$REPO/$d"
  sudo find "$REPO/$d" -type d -exec chmod g+s {} +
  sudo setfacl -R -m u:www-data:rwX -m d:u:www-data:rwX "$REPO/$d"
done
grep -q '^umask 002' /etc/apache2/envvars || echo 'umask 002' | sudo tee -a /etc/apache2/envvars >/dev/null
# The Pi is a Pi: Compile stays disabled here (php/api/knn_model_lib.php reads config/device.txt first).
[ -f "$REPO/config/device.txt" ] || { echo pi | sudo -u "$KIOSK_USER" tee "$REPO/config/device.txt" >/dev/null; }

# ── 3. PHP limits ──
step "3. PHP limits"
PHPV="$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')"
INI="/etc/php/$PHPV/apache2/conf.d/99-sining-kamay.ini"
# post: Compile's model upload is 32 MB (compile_model.php:11), a bulk video 8 MB (bulk_import.php:15);
# files: sign audio 2 MB (sign_audio_lib.php:9). memory_limit as on the laptop (XAMPP php.ini).
sudo tee "$INI" >/dev/null <<'EOF'
; Sining Kamay (tools/pi/pi-setup.sh)
upload_max_filesize = 16M
post_max_size = 64M
memory_limit = 512M
max_execution_time = 120
EOF
echo "Wrote $INI"
sudo systemctl reload apache2 || sudo systemctl restart apache2

# ── 4. Database: what php/connect.php expects (root, empty password, sining_kamay_db) ──
step "4. Database $DB"
# connect.php logs in as root with an empty password on localhost (the XAMPP default). Keep sudo's
# socket login and add that empty password login; MariaDB listens on 127.0.0.1 only (Debian default).
sudo mariadb -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD('');"
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
if [ -n "$SQL" ]; then
  echo "Importing $SQL ..."
  # shellcheck disable=SC2024  # the kiosk user reads its own dump; only mariadb needs root
  sudo mariadb "$DB" < "$SQL"
fi
TABLES="$(sudo mariadb -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB'")"
echo "Tables in $DB: $TABLES (the laptop has 7)"
[ "$TABLES" -ge 7 ] || echo "!! The database is empty or incomplete: import the laptop's dump (tools/pi/import-on-pi.sh)."
# shellcheck disable=SC2016  # PHP code: its $ variables are PHP's, not the shell's
php -r '$c=@mysqli_connect("localhost","root","","'"$DB"'"); echo $c ? "PHP connects to the DB: OK\n" : "PHP cannot connect: ".mysqli_connect_error()."\n";'

# ── 5. Display 1024x600 ──
step "5. Display 1024x600"
# KMS (Bookworm): the mode is forced on the kernel command line. "D" = output on even with nothing
# plugged in, so VNC/headless and an HDMI 7" 1024x600 LCD get the same size.
CMDLINE=/boot/firmware/cmdline.txt; [ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
if grep -q 'video=HDMI-A-1:' "$CMDLINE"; then
  sudo sed -i -E 's/video=HDMI-A-1:[^ ]*/video=HDMI-A-1:1024x600@60D/' "$CMDLINE"
else
  sudo sed -i -E '1 s/$/ video=HDMI-A-1:1024x600@60D/' "$CMDLINE"
fi
echo "$CMDLINE: $(grep -o 'video=HDMI-A-1:[^ ]*' "$CMDLINE")"
CONFIG=/boot/firmware/config.txt; [ -f "$CONFIG" ] || CONFIG=/boot/config.txt
grep -q '^hdmi_force_hotplug=1' "$CONFIG" || echo 'hdmi_force_hotplug=1' | sudo tee -a "$CONFIG" >/dev/null
echo "$CONFIG: hdmi_force_hotplug=1"

# ── 6. Chromium policy: camera/mic for localhost, the glove's serial port without a picker ──
step "6. Chromium policy"
POLICY_DIR=/etc/chromium/policies/managed
sudo mkdir -p "$POLICY_DIR"
sudo tee "$POLICY_DIR/sining-kamay.json" >/dev/null <<'EOF'
{
  "VideoCaptureAllowedUrls": ["http://localhost"],
  "AudioCaptureAllowedUrls": ["http://localhost"],
  "AutoplayAllowed": true,
  "SerialAllowAllPortsForUrls": ["http://localhost"],
  "TranslateEnabled": false,
  "RestoreOnStartup": 5,
  "PasswordManagerEnabled": false,
  "BrowserSignin": 0,
  "MetricsReportingEnabled": false
}
EOF
echo "Wrote $POLICY_DIR/sining-kamay.json"

# ── 7. Kiosk launcher + ONE autostart (labwc / wayfire Wayland, X11 fallback) ──
step "7. Kiosk autostart"
CHROME="$(command -v chromium || command -v chromium-browser || echo chromium)"
LAUNCH="$HOME_DIR/.local/bin/sk-kiosk.sh"
AUDIO="$REPO/tools/pi/sk-audio.sh"
sudo -u "$KIOSK_USER" mkdir -p "$HOME_DIR/.local/bin" "$HOME_DIR/.config/autostart" "$HOME_DIR/.config/labwc"
DEVFLAG=""
[ "$DEV" = 1 ] && DEVFLAG="--remote-debugging-port=9222"
# Two "Sining Kamay Kiosk" tabs (pi-fixes 2026-10-21, docs/reports/2026-10-21-pi-fixes-final.md), causes
# closed here:
#  - Chromium restored the previous session (the kiosk is always ended by pkill, so it looks crashed)
#    next to the --kiosk URL: policy RestoreOnStartup=5 (step 6), the profile is marked cleanly closed
#    before each launch, --hide-crash-restore-bubble.
#  - Up to three autostarts (labwc, wayfire, XDG .desktop) could each run the launcher, and the old
#    start_kiosk.sh / SKR_Kiosk.desktop has no lock at all: one autostart only, old ones disabled.
#  - The launcher exec'd Chromium, so the lock lived in Chromium; a second launcher could kill it with
#    SIGTERM and start a new one while the old was still shutting down. Now the launcher's own shell
#    keeps the lock (Chromium does not inherit it) and waits for an old Chromium to exit first.
sudo -u "$KIOSK_USER" tee "$LAUNCH" >/dev/null <<EOF
#!/bin/bash
# Generated by tools/pi/pi-setup.sh ($(date '+%Y-%m-%d')). Re-run pi-setup.sh to change it.
#   sk-kiosk.sh            start the kiosk unless one is already running (what autostart runs)
#   sk-kiosk.sh --restart  close the running kiosk and start a new one (from SSH: tools/pi/README.md)
LOG="\$HOME/kiosk.log"
LOCK=/tmp/sk-kiosk.lock
echo "=== kiosk \$(date)  pid \$\$  started by: \$(ps -o args= -p "\$PPID" 2>/dev/null) ===" >> "\$LOG"
if [ "\${1:-}" = "--restart" ]; then
  pkill -u "\$USER" -f 'sk-kiosk\.sh\$' || true      # the running launcher (it holds the lock)
  pkill -u "\$USER" -f 'chromium.*--kiosk' || true
fi
exec 9>"\$LOCK"
if ! flock -w 10 9; then
  echo "another kiosk launcher holds \$LOCK: not starting a second Chromium" >> "\$LOG"
  exit 0
fi
# Close a Chromium kiosk still running and WAIT until it has exited (max 10 s, then SIGKILL):
# a new one started while the old one shuts down can hand its URL to the old one (a second tab).
pkill -u "\$USER" -f 'chromium.*--kiosk' || true
for _ in \$(seq 20); do pgrep -u "\$USER" -f 'chromium.*--kiosk' >/dev/null || break; sleep 0.5; done
pkill -9 -u "\$USER" -f 'chromium.*--kiosk' || true
rm -f "\$HOME/.config/chromium/Singleton"*
# The kiosk is always ended by pkill, so Chromium thinks it crashed: mark the profile cleanly closed
# so nothing is restored next to the kiosk URL.
PREFS="\$HOME/.config/chromium/Default/Preferences"
[ -f "\$PREFS" ] && sed -i -e 's/"exited_cleanly":false/"exited_cleanly":true/' -e 's/"exit_type":"[^"]*"/"exit_type":"Normal"/' "\$PREFS"
# Speaker and microphone by name, volume <= 0.8 (tools/pi/sk-audio.sh), in the background.
[ -f "$AUDIO" ] && { bash "$AUDIO" >> "\$LOG" 2>&1 9>&- & }
# wait (max 60 s) for Apache, so the first page is not an error page
for _ in \$(seq 60); do curl -fs -o /dev/null "$URL" 9>&- && break; sleep 1; done
command -v unclutter >/dev/null && [ -n "\${DISPLAY:-}" ] && { unclutter -idle 3 9>&- & }
# Not exec: this shell keeps the lock while Chromium runs (9>&-: Chromium does not inherit it), so the
# lock is free again exactly when the kiosk Chromium exits.
# WebRtcPipeWireCamera off: there is no xdg-desktop-portal, so the camera must be opened through V4L2.
"$CHROME" --kiosk "$URL" \\
  --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars \\
  --check-for-update-interval=31536000 --overscroll-history-navigation=0 \\
  --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher \\
  --no-first-run --no-default-browser-check \\
  --disable-session-crashed-bubble --hide-crash-restore-bubble \\
  --disable-features=Translate,WebRtcPipeWireCamera \\
  --enable-logging=stderr $DEVFLAG >> "\$LOG" 2>&1 9>&-
echo "=== kiosk Chromium exited \$(date) (code \$?) ===" >> "\$LOG"
EOF
sudo chmod +x "$LAUNCH"

# Disable old launchers that start a second Chromium without the lock (start_kiosk.sh +
# SKR_Kiosk.desktop from before pi-setup, or a hand-made chromium --kiosk autostart).
shopt -s nullglob
for f in "$HOME_DIR"/.config/autostart/*.desktop; do
  [ "$(basename "$f")" = "sk-kiosk.desktop" ] && continue
  if grep -Eq 'start_kiosk\.sh|chromium.*--kiosk' "$f"; then
    sudo -u "$KIOSK_USER" mv "$f" "$f.disabled-by-pi-setup"
    echo "Disabled old kiosk autostart: $f"
  fi
done
shopt -u nullglob
for f in "$HOME_DIR/.config/labwc/autostart" "$HOME_DIR/.config/lxsession/LXDE-pi/autostart"; do
  [ -f "$f" ] || continue
  if grep -Eq '^[^#]*(start_kiosk\.sh|chromium.*--kiosk)' "$f"; then
    sudo -u "$KIOSK_USER" sed -i -E 's/^([^#]*(start_kiosk\.sh|chromium.*--kiosk).*)$/# disabled by pi-setup: \1/' "$f"
    echo "Disabled old kiosk line(s) in $f"
  fi
done

# Exactly ONE autostart, for the session this Pi logs in to (lightdm's autologin-session /
# user-session: LXDE-pi-labwc, LXDE-pi-wayfire or LXDE-pi-x). The labwc and wayfire sessions also
# run ~/.config/autostart/*.desktop, so writing all three could start the launcher two or three
# times. After switching the desktop (raspi-config), re-run pi-setup.sh.
SESSION="$(grep -hEo '^(autologin-session|user-session)=.*' /etc/lightdm/lightdm.conf 2>/dev/null | head -1 | cut -d= -f2)"
case "$SESSION" in
  *labwc*) DESK=labwc ;;
  *wayfire*) DESK=wayfire ;;
  ?*) DESK=x11 ;;
  *) if pgrep -x labwc >/dev/null || have labwc; then DESK=labwc
     elif pgrep -x wayfire >/dev/null || have wayfire; then DESK=wayfire
     else DESK=x11; fi ;;
esac
LABWC="$HOME_DIR/.config/labwc/autostart"
WF="$HOME_DIR/.config/wayfire.ini"
XDG_ENTRY="$HOME_DIR/.config/autostart/sk-kiosk.desktop"
# remove what an earlier pi-setup wrote for the other desktops
[ -f "$LABWC" ] && sudo -u "$KIOSK_USER" sed -i '/sk-kiosk\.sh/d' "$LABWC"
[ -f "$WF" ] && sudo -u "$KIOSK_USER" sed -i '/^sk_kiosk *=/d' "$WF"
rm -f "$XDG_ENTRY"
case "$DESK" in
  labwc)
    sudo -u "$KIOSK_USER" touch "$LABWC"
    echo "$LAUNCH &" | sudo -u "$KIOSK_USER" tee -a "$LABWC" >/dev/null
    WHERE="$LABWC" ;;
  wayfire)
    sudo -u "$KIOSK_USER" touch "$WF"
    if grep -q '^\[autostart\]' "$WF"; then
      sudo -u "$KIOSK_USER" sed -i "/^\[autostart\]/a sk_kiosk = $LAUNCH" "$WF"
    else
      printf '\n[autostart]\nsk_kiosk = %s\n' "$LAUNCH" | sudo -u "$KIOSK_USER" tee -a "$WF" >/dev/null
    fi
    WHERE="$WF [autostart]" ;;
  *)
    sudo -u "$KIOSK_USER" tee "$XDG_ENTRY" >/dev/null <<EOF
[Desktop Entry]
Type=Application
Name=Sining Kamay kiosk
Exec=$LAUNCH
X-GNOME-Autostart-enabled=true
EOF
    WHERE="$XDG_ENTRY" ;;
esac
echo "Desktop session: ${SESSION:-unknown} -> $DESK. Launcher: $LAUNCH, started from $WHERE only."
[ "$DEV" = 1 ] && echo "Dev: Chromium has --remote-debugging-port=9222 (localhost only)."


# ── 8. Desktop: auto-login, no blanking, VNC per --dev ──
step "8. Desktop settings"
if have raspi-config; then
  sudo raspi-config nonint do_boot_behaviour B4 || true   # desktop, auto-login
  sudo raspi-config nonint do_blanking 1 || true          # 1 = screen blanking off
  if [ "$DEV" = 1 ]; then
    sudo raspi-config nonint do_vnc 0 || true             # 0 = VNC on
    echo "Auto-login desktop, blanking off, VNC ON."
  else
    sudo raspi-config nonint do_vnc 1 || true             # 1 = VNC off
    echo "Auto-login desktop, blanking off, VNC OFF."
  fi
else
  echo "raspi-config not found: set auto-login and blanking yourself (docs/system/PI-SETUP.md)."
fi

# ── 9. Glove (Web Serial) and audio: what to check ──
step "9. Glove and audio"
sudo usermod -aG dialout "$KIOSK_USER"
echo "User $KIOSK_USER groups: $(id -nG "$KIOSK_USER")  (needs dialout for the glove; takes effect after a reboot)"
shopt -s nullglob
PORTS=(/dev/ttyUSB* /dev/ttyACM*)
shopt -u nullglob
if [ ${#PORTS[@]} -gt 0 ]; then echo "Serial ports now: ${PORTS[*]}"; else echo "No /dev/ttyUSB* or /dev/ttyACM* now (plug the glove to see one)."; fi
if have wpctl; then sudo -u "$KIOSK_USER" XDG_RUNTIME_DIR="/run/user/$(id -u "$KIOSK_USER")" wpctl status 2>/dev/null | sed -n '/Sinks:/,/Sources:/p' || true; else aplay -l 2>/dev/null || true; fi
cat <<EOF

Check after the reboot:
  - Glove: Settings -> Glove -> Connect glove lists the ESP32 (USB serial). 'ls /dev/ttyUSB* /dev/ttyACM*'
    shows it; 'groups' includes dialout. Debug shows ~30 lines/s.
  - Sound: every kiosk start sets the speaker and mic by name (tools/pi/sk-audio.sh; its
    '[sk-audio ...]' lines are in ~/kiosk.log). 'speaker-test -t wav -c 2 -l 1' plays "front left /
    front right". Volume stays <= 0.8 (higher browns out the LCDs). Browser voice: 'spd-say hello'.
  - Camera: 'ls /dev/video*'; Let's Talk -> Sign shows the picture.
EOF

# ── 10. Admin power and volume buttons (Settings -> System, php/api/system_power.php) ──
step "10. Admin power and volume buttons"
# Apache's user may run exactly these as root, without a password: poweroff, reboot, and the
# sk-volume wrapper (which accepts only `get` / `set 0.00..MAX_VOLUME` and runs wpctl as the kiosk user,
# because Apache cannot reach the kiosk user's PipeWire session). tools/pi/README.md.
APACHE_USER="$( (set +eu; . /etc/apache2/envvars >/dev/null 2>&1; echo "${APACHE_RUN_USER:-}") )"
[ -n "$APACHE_USER" ] || APACHE_USER="$(ps -eo user=,comm= | awk '$2 == "apache2" && $1 != "root" { print $1; exit }')"
[ -n "$APACHE_USER" ] || APACHE_USER=www-data
if ! [[ "$APACHE_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || ! id "$APACHE_USER" >/dev/null 2>&1; then
  echo "!! Apache user '$APACHE_USER' not found: power and volume buttons not set up." >&2
else
  MAXV="$(sed -n 's/^MAX_VOLUME="\{0,1\}\([0-9.]*\)"\{0,1\}.*/\1/p' "$AUDIO" 2>/dev/null | head -1)"
  [[ "$MAXV" =~ ^0?\.[0-9]+$|^1(\.0+)?$ ]] || MAXV="0.8"
  KIOSK_UID="$(id -u "$KIOSK_USER")"
  TMPD="$(mktemp -d)"

  # install_if_changed SRC DEST MODE: install only when the content or mode differs; says which.
  install_if_changed() {
    if sudo test -f "$2" && sudo cmp -s "$1" "$2" && [ "$(sudo stat -c %a "$2")" = "$3" ]; then
      echo "$2: unchanged"
    else
      sudo install -o root -g root -m "$3" "$1" "$2"
      echo "$2: installed (mode $3)"
    fi
  }

  cat > "$TMPD/sk-volume" <<EOF
#!/bin/bash
# /usr/local/bin/sk-volume — generated by tools/pi/pi-setup.sh ($(date '+%Y-%m-%d')). Re-run pi-setup.sh to change it.
# Run as root by Apache (sudoers: /etc/sudoers.d/sk-power) for Settings -> System -> Speaker volume.
#   sk-volume get           the default speaker's volume (wpctl get-volume)
#   sk-volume set 0.00-$MAXV  set it, and save SINK_VOLUME in ~/.config/sk-audio.conf (restored at kiosk start)
set -u
KIOSK_USER="$KIOSK_USER"
KIOSK_UID="$KIOSK_UID"
MAX="$MAXV"
CONF="$HOME_DIR/.config/sk-audio.conf"
as_kiosk() { sudo -u "\$KIOSK_USER" env XDG_RUNTIME_DIR="/run/user/\$KIOSK_UID" "\$@"; }
case "\${1:-}" in
  get)
    [ \$# -eq 1 ] || { echo "usage: sk-volume get | set 0.00-\$MAX" >&2; exit 2; }
    as_kiosk wpctl get-volume @DEFAULT_AUDIO_SINK@ ;;
  set)
    [ \$# -eq 2 ] && [[ "\$2" =~ ^(0|1)?(\.[0-9]{1,2})?\$ ]] && [ -n "\$2" ] && [ "\$2" != "." ] \\
      || { echo "usage: sk-volume set 0.00-\$MAX" >&2; exit 2; }
    awk -v v="\$2" -v m="\$MAX" 'BEGIN { exit !(v + 0 <= m + 0) }' || { echo "above MAX \$MAX" >&2; exit 2; }
    V="\$(awk -v v="\$2" 'BEGIN { printf "%.2f", v + 0 }')"
    as_kiosk wpctl set-volume @DEFAULT_AUDIO_SINK@ "\$V" || exit 1
    as_kiosk mkdir -p "\$(dirname "\$CONF")"
    if [ -f "\$CONF" ] && grep -q '^SINK_VOLUME=' "\$CONF"; then
      as_kiosk sed -i "s/^SINK_VOLUME=.*/SINK_VOLUME=\"\$V\"/" "\$CONF"
    else
      echo "SINK_VOLUME=\"\$V\"" | as_kiosk tee -a "\$CONF" >/dev/null
    fi
    echo "Volume: \$V" ;;
  *) echo "usage: sk-volume get | set 0.00-\$MAX" >&2; exit 2 ;;
esac
EOF
  install_if_changed "$TMPD/sk-volume" /usr/local/bin/sk-volume 755

  cat > "$TMPD/sk-power" <<EOF
# /etc/sudoers.d/sk-power — generated by tools/pi/pi-setup.sh. Settings -> System (php/api/system_power.php).
$APACHE_USER ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot
$APACHE_USER ALL=(root) NOPASSWD: /usr/local/bin/sk-volume
EOF
  if sudo visudo -cf "$TMPD/sk-power" >/dev/null; then
    install_if_changed "$TMPD/sk-power" /etc/sudoers.d/sk-power 440
  else
    echo "!! $TMPD/sk-power failed visudo -c: /etc/sudoers.d/sk-power NOT changed." >&2
  fi
  rm -rf "$TMPD"
  echo "Apache user: $APACHE_USER. Kiosk user: $KIOSK_USER (uid $KIOSK_UID). Max volume: $MAXV."
  if sudo -u "$APACHE_USER" sudo -n -l /usr/bin/systemctl poweroff >/dev/null 2>&1; then
    echo "Check: $APACHE_USER may run systemctl poweroff/reboot: OK"
  else
    echo "!! Check: $APACHE_USER may NOT run systemctl poweroff (see /etc/sudoers.d/sk-power)."
  fi
fi

step "Done"
echo "Served at $URL from $REPO. Log: $LOG"
echo "Reboot to start the kiosk:  sudo reboot"
