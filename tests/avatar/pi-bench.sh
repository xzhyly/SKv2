#!/bin/bash
# Avatar frame-rate bench for the Raspberry Pi (avatar phase). Run it ON THE PI, from a terminal
# on the Pi's own desktop:   bash tests/avatar/pi-bench.sh   [seconds per run, default 15]
#
# It closes the running kiosk Chromium (like start_kiosk.sh does), opens
# http://localhost/SKR/tests/avatar/bench.html in Chromium with the kiosk's own flags
# (start_kiosk.sh), waits for the bench to finish, prints the "AVATAR_BENCH {json}" line and
# saves it to ~/avatar-bench-<date>.json. The bench plays the avatar at the kiosk panel size
# (560x260): first capped at 30 fps (what Let's Talk does), then uncapped. It uses the signs that
# have avatar clips, or a built-in synthetic movement when none exist yet.
# Afterwards it starts the kiosk again (~/.local/bin/sk-kiosk.sh from tools/pi/pi-setup.sh), also when
# run over SSH (pi-fixes 2026-10-21: it sets DISPLAY / WAYLAND_DISPLAY / XDG_RUNTIME_DIR itself and
# removes the lock file left by the Chromium it closed).
# Pi timing was NOT measured when this script was written; this script is how to measure it.

SECONDS_EACH="${1:-15}"
URL="http://localhost/SKR/tests/avatar/bench.html?seconds=${SECONDS_EACH}"
LOG="$(mktemp /tmp/avatar-bench-XXXX.log)"
PROFILE="$(mktemp -d /tmp/avatar-bench-profile-XXXX)"
OUT="$HOME/avatar-bench-$(date +%Y%m%d-%H%M%S).json"

pkill -9 chromium
sleep 2
export DISPLAY="${DISPLAY:-:0}"

echo "Running the avatar bench (about $((SECONDS_EACH * 2 + 10)) s)..."
# Same flags as start_kiosk.sh, with a throw-away profile so the kiosk profile is not touched.
chromium --kiosk --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher \
  --disable-accelerated-video-decode --enable-logging=stderr --user-data-dir="$PROFILE" "$URL" > "$LOG" 2>&1 &
PID=$!

LIMIT=$((SECONDS_EACH * 2 + 90))
for ((i = 0; i < LIMIT; i++)); do
  if grep -q "AVATAR_BENCH" "$LOG"; then break; fi
  sleep 1
done
sleep 1
kill "$PID" 2>/dev/null
pkill -9 chromium
rm -rf "$PROFILE"

# Relaunch the kiosk, whatever happens below (result or not).
relaunch_kiosk() {
  if [ -f "$HOME/.local/bin/sk-kiosk.sh" ]; then
    rm -f /tmp/sk-kiosk.lock
    nohup env DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) bash ~/.local/bin/sk-kiosk.sh >/dev/null 2>&1 &
    echo "Kiosk relaunched (~/.local/bin/sk-kiosk.sh)."
  else
    echo "No ~/.local/bin/sk-kiosk.sh (run tools/pi/pi-setup.sh): start the kiosk yourself."
  fi
}
trap relaunch_kiosk EXIT

LINE="$(grep -o 'AVATAR_BENCH[_A-Z]* .*' "$LOG" | head -1)"
if [ -z "$LINE" ]; then
  echo "No result. Chromium log: $LOG"
  exit 1
fi
case "$LINE" in
  AVATAR_BENCH_FAILED*) echo "$LINE"; echo "Chromium log: $LOG"; exit 1 ;;
esac
# Chromium's log wraps the console text as: "AVATAR_BENCH {...}", source: ... (N)
JSON="$(echo "$LINE" | sed -e 's/^AVATAR_BENCH //' -e 's/", source:.*$//')"
echo "$JSON" > "$OUT"
echo "$JSON"
echo "Saved to $OUT"
echo "capped30.fps = what Let's Talk gets (target 30); uncapped.fps = headroom; drawMs = ms per frame."
rm -f "$LOG"
