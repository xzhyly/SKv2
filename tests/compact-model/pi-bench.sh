#!/bin/bash
# Compact recognition model bench for the Raspberry Pi (compact-model phase). Run it ON THE PI,
# from a terminal on the Pi's own desktop:   bash tests/compact-model/pi-bench.sh
# Needs models/knn_ESL.bin and models/knn_FSL.bin next to this script's repo (the copy Apache serves
# as /SKR/), built on the laptop by Compile and copied to the Pi; the script checks they exist
# before it closes the kiosk. No camera, no PIN.
#
# It closes the running kiosk Chromium (like start_kiosk.sh does), opens
# http://localhost/SKR/tests/compact-model/bench.html in Chromium with the kiosk's own flags
# (start_kiosk.sh) and a throw-away profile (the kiosk profile and its model cache are not
# touched), waits for the bench to finish, prints the "COMPACT_BENCH {json}" line and saves it to
# ~/compact-bench-<date>.json. Its run time on the Pi is NOT measured (67 s on the laptop); it
# gives up after 20 minutes, or as soon as Chromium exits. Ctrl-C stops it cleanly.
# The bench measures:
#   - load.ESL / load.FSL: cold = first load (HEAD + download + decode + IndexedDB write), warm =
#     every later kiosk start (HEAD + IndexedDB read + decode), 3 runs each, ms;
#   - predict: knnPredict (the kiosk's own code, a fresh instance per timing) per call on the real
#     ESL and FSL models and on synthetic models of 2,047 / 9,164 / 10,196 / 14,140 / 24,007 /
#     89,887 rows; median and p90 ms, plain arrays (what the kiosk uses) and Float32 views. Sizes
#     stop once a median passes 1,000 ms (the rest say "skipped").
# What to compare: the kiosk predicts every 150 ms, so knnPredict must stay WELL under 150 ms
# (MediaPipe runs on the same CPU in that tick and its Pi cost is not in this bench). The rows a
# new dataset gives are in the model file header (rowCount); read the synthetic size nearest it.
# Afterwards (whatever happened), restart the kiosk with the SKR_Kiosk desktop entry (or
# start_kiosk.sh); the script says so on every exit after it closed the kiosk.
# Pi timing was NOT measured when this script was written; this script is how to measure it.

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="http://localhost/SKR/tests/compact-model/bench.html"
RESTART="Now restart the kiosk with the SKR_Kiosk desktop entry (or start_kiosk.sh)."

for f in models/knn_ESL.bin models/knn_FSL.bin; do
  if [ ! -f "$REPO/$f" ]; then
    echo "Missing $REPO/$f."
    echo "Build the model on the laptop (Train Gestures, Compile), then copy models/knn_ESL.bin and"
    echo "models/knn_FSL.bin to the Pi, and run this again. The kiosk was not closed."
    exit 1
  fi
done

LOG="$(mktemp /tmp/compact-bench-XXXX.log)"
PROFILE="$(mktemp -d /tmp/compact-bench-profile-XXXX)"
OUT="$HOME/compact-bench-$(date +%Y%m%d-%H%M%S).json"
PID=""

close_bench() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null; fi
  pkill -9 chromium
  rm -rf "$PROFILE"
}
on_interrupt() {
  echo
  echo "Stopped before the bench finished; nothing saved."
  close_bench
  rm -f "$LOG"
  echo "$RESTART"
  exit 130
}
trap on_interrupt INT TERM

pkill -9 chromium
sleep 2
export DISPLAY="${DISPLAY:-:0}"

echo "Running the compact model bench (time on the Pi not measured; gives up after 20 minutes)..."
# Same flags as start_kiosk.sh, with a throw-away profile so the kiosk profile is not touched.
chromium --kiosk --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher \
  --disable-accelerated-video-decode --enable-logging=stderr --user-data-dir="$PROFILE" "$URL" > "$LOG" 2>&1 &
PID=$!

LIMIT=1200
EXITED=""
for ((i = 0; i < LIMIT; i++)); do
  if grep -q "COMPACT_BENCH" "$LOG"; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then EXITED=1; break; fi
  sleep 1
done
sleep 1
close_bench
trap - INT TERM

LINE="$(grep -o 'COMPACT_BENCH[_A-Z]* .*' "$LOG" | head -1)"
if [ -z "$LINE" ]; then
  if [ -n "$EXITED" ]; then
    echo "No result: Chromium exited before the bench finished."
  else
    echo "No result after $LIMIT s."
  fi
  echo "Chromium log: $LOG"
  echo "$RESTART"
  exit 1
fi
case "$LINE" in
  COMPACT_BENCH_FAILED*) echo "$LINE"; echo "Chromium log: $LOG"; echo "$RESTART"; exit 1 ;;
esac
# Chromium's log wraps the console text as: "COMPACT_BENCH {...}", source: ... (N)
JSON="$(echo "$LINE" | sed -e 's/^COMPACT_BENCH //' -e 's/", source:.*$//')"
echo "$JSON" > "$OUT"
echo "$JSON"
echo "Saved to $OUT"
echo "predict[].plain.median = ms per knnPredict call on the kiosk's arrays; compare with the 150 ms tick."
echo "load.*.warm = model load at every kiosk start; load.*.cold = the first start after a new model file."
echo "$RESTART"
rm -f "$LOG"
