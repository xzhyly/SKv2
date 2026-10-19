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
      speech-dispatcher espeak-ng alsa-utils curl)
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
  "PasswordManagerEnabled": false,
  "BrowserSignin": 0,
  "MetricsReportingEnabled": false
}
EOF
echo "Wrote $POLICY_DIR/sining-kamay.json"

# ── 7. Kiosk launcher + autostart (labwc / wayfire Wayland, X11 fallback) ──
step "7. Kiosk autostart"
CHROME="$(command -v chromium || command -v chromium-browser || echo chromium)"
LAUNCH="$HOME_DIR/.local/bin/sk-kiosk.sh"
sudo -u "$KIOSK_USER" mkdir -p "$HOME_DIR/.local/bin" "$HOME_DIR/.config/autostart" "$HOME_DIR/.config/labwc"
DEVFLAG=""
[ "$DEV" = 1 ] && DEVFLAG="--remote-debugging-port=9222"
sudo -u "$KIOSK_USER" tee "$LAUNCH" >/dev/null <<EOF
#!/bin/bash
# Generated by tools/pi/pi-setup.sh ($(date '+%Y-%m-%d')). Re-run pi-setup.sh to change it.
exec 9>/tmp/sk-kiosk.lock
flock -n 9 || exit 0                     # one kiosk, whichever autostart fired
LOG="\$HOME/kiosk.log"
echo "=== kiosk \$(date) ===" >> "\$LOG"
pkill -u "\$USER" -f 'chromium.*--kiosk' || true
rm -f "\$HOME/.config/chromium/Singleton"*
# wait (max 60 s) for Apache, so the first page is not an error page
for _ in \$(seq 60); do curl -fs -o /dev/null "$URL" && break; sleep 1; done
command -v unclutter >/dev/null && [ -n "\${DISPLAY:-}" ] && { unclutter -idle 3 & }
exec "$CHROME" --kiosk "$URL" \\
  --autoplay-policy=no-user-gesture-required --noerrdialogs --disable-infobars \\
  --check-for-update-interval=31536000 --overscroll-history-navigation=0 \\
  --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher \\
  --disable-session-crashed-bubble --disable-features=Translate \\
  --enable-logging=stderr $DEVFLAG >> "\$LOG" 2>&1
EOF
sudo chmod +x "$LAUNCH"
# labwc (Bookworm default since late 2024)
LABWC="$HOME_DIR/.config/labwc/autostart"
sudo -u "$KIOSK_USER" touch "$LABWC"
grep -q 'sk-kiosk.sh' "$LABWC" || echo "$LAUNCH &" | sudo -u "$KIOSK_USER" tee -a "$LABWC" >/dev/null
# wayfire (earlier Bookworm images)
WF="$HOME_DIR/.config/wayfire.ini"
if [ -f "$WF" ] || pgrep -x wayfire >/dev/null; then
  sudo -u "$KIOSK_USER" touch "$WF"
  if ! grep -q 'sk_kiosk' "$WF"; then
    if grep -q '^\[autostart\]' "$WF"; then
      sudo -u "$KIOSK_USER" sed -i "/^\[autostart\]/a sk_kiosk = $LAUNCH" "$WF"
    else
      printf '\n[autostart]\nsk_kiosk = %s\n' "$LAUNCH" | sudo -u "$KIOSK_USER" tee -a "$WF" >/dev/null
    fi
  fi
fi
# X11 / LXDE fallback (XDG autostart)
sudo -u "$KIOSK_USER" tee "$HOME_DIR/.config/autostart/sk-kiosk.desktop" >/dev/null <<EOF
[Desktop Entry]
Type=Application
Name=Sining Kamay kiosk
Exec=$LAUNCH
X-GNOME-Autostart-enabled=true
EOF
echo "Launcher: $LAUNCH  (labwc autostart, wayfire [autostart], ~/.config/autostart/sk-kiosk.desktop)"
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
  - Sound: 'speaker-test -t wav -c 2 -l 1' plays "front left / front right". Pick the output with the
    speaker icon (top right) or 'wpctl set-default <id>'. Browser voice: 'spd-say hello'.
  - Camera: 'ls /dev/video*'; Let's Talk -> Sign shows the picture.
EOF

step "Done"
echo "Served at $URL from $REPO. Log: $LOG"
echo "Reboot to start the kiosk:  sudo reboot"
