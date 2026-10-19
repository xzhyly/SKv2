#!/bin/bash
# tools/pi/import-on-pi.sh — restore the laptop's kiosk data on the Pi (tools/pi/transfer.md).
#   bash tools/pi/import-on-pi.sh [/media/<user>/<USB>/sk-transfer] [REPO_PATH]
# Without a path it uses the first /media/$USER/*/sk-transfer it finds. It makes the Pi an exact
# mirror of the laptop:
#   1. imports sining_kamay_db.sql into sining_kamay_db (the dump drops and recreates each table);
#   2. mirrors saved_gestures/ and models/ into the repo (rsync --delete);
#   3. restores the group permissions pi-setup.sh set;
#   4. compares the counts with manifest.txt.
# The Pi's own saved_gestures/models are backed up first to ~/sk-backup-<date>/.
# Logs to ~/pi-setup.log. Run tools/pi/pi-setup.sh first.
set -euo pipefail

SRC="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${2:-$SCRIPT_DIR/../..}" && pwd)"
LOG="$HOME/pi-setup.log"
DB="sining_kamay_db"
exec > >(tee -a "$LOG") 2>&1
echo
echo "=== import-on-pi $(date '+%Y-%m-%d %H:%M:%S')  repo=$REPO ==="

if [ -z "$SRC" ]; then
  for d in /media/"$USER"/*/sk-transfer; do [ -d "$d" ] && { SRC="$d"; break; }; done
fi
[ -n "$SRC" ] && [ -d "$SRC" ] || { echo "No sk-transfer folder found. Give its path: bash $0 /media/$USER/<USB>/sk-transfer" >&2; exit 1; }
for f in sining_kamay_db.sql manifest.txt saved_gestures models; do
  [ -e "$SRC/$f" ] || { echo "Missing $SRC/$f (run tools/pi/export-from-laptop.cmd on the laptop)" >&2; exit 1; }
done
echo "From: $SRC"
cat "$SRC/manifest.txt"
command -v rsync >/dev/null || { sudo apt-get update; sudo apt-get install -y rsync; }

BK="$HOME/sk-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
echo "Backing up the Pi's current data to $BK ..."
# shellcheck disable=SC2024  # the backup goes to the kiosk user's own home, written as that user
sudo mariadb-dump --single-transaction "$DB" > "$BK/$DB.sql" 2>/dev/null || echo "(no DB to back up yet)"
cp -a "$REPO/saved_gestures" "$BK/" 2>/dev/null || true
cp -a "$REPO/models" "$BK/" 2>/dev/null || true

echo "1. Database..."
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
# shellcheck disable=SC2024  # the kiosk user reads the dump; only mariadb needs root
sudo mariadb "$DB" < "$SRC/sining_kamay_db.sql"

echo "2. saved_gestures/ and models/ (mirror)..."
# FAT/exFAT USB drives keep no Unix permissions or owners: copy contents only, then set them below.
rsync -rt --delete --modify-window=2 "$SRC/saved_gestures/" "$REPO/saved_gestures/"
rsync -rt --delete --modify-window=2 --exclude '*.tmp' "$SRC/models/" "$REPO/models/"

echo "3. Permissions..."
for d in saved_gestures models; do
  sudo chown -R "$USER":www-data "$REPO/$d"
  sudo find "$REPO/$d" -type d -exec chmod 2775 {} +
  sudo find "$REPO/$d" -type f -exec chmod 664 {} +
  sudo setfacl -R -m u:www-data:rwX -m d:u:www-data:rwX "$REPO/$d" 2>/dev/null || true
done

echo "4. Check against manifest.txt..."
val() { grep -E "^$1=" "$SRC/manifest.txt" | head -1 | cut -d= -f2 | tr -d '\r '; }
cmp() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then echo "  OK   $name: $got"; else echo "  DIFF $name: laptop $want, Pi $got"; FAIL=1; fi
}
FAIL=0
cmp saved_gestures_files "$(val saved_gestures_files)" "$(find "$REPO/saved_gestures" -type f | wc -l)"
cmp audio_files "$(val audio_files)" "$(find "$REPO/saved_gestures" -type f -name 'audio_*' | wc -l)"
cmp avatar_files "$(val avatar_files)" "$(find "$REPO/saved_gestures" -type f -name avatar.json | wc -l)"
cmp models_files "$(val models_files)" "$(find "$REPO/models" -type f ! -name '*.tmp' | wc -l)"
q() { sudo mariadb -N -e "SELECT COUNT(*) FROM \`$DB\`.$1"; }
cmp db_gestures "$(val db_gestures)" "$(q gestures)"
cmp db_recordings "$(val db_recordings)" "$(q gesture_recordings)"
cmp db_users "$(val db_users)" "$(q users)"
if [ "$FAIL" = 0 ]; then
  echo "The Pi now mirrors the laptop. Reload the kiosk (or reboot)."
else
  echo "!! Some counts differ (see DIFF above). Re-run the export on the laptop, then this script."
  exit 1
fi
