#!/bin/bash
# Stop existing chromium processes
pkill -9 chromium
sleep 2

# Clean browser lock files
rm -rf /home/crystelle/.config/chromium/Singleton*

# Set display env variable for X11 server
export DISPLAY=:0

# Log file location in home directory
LOG_FILE="/home/crystelle/kiosk_logs.log"
echo "=== Kiosk Launch: $(date) ===" > "$LOG_FILE"

# Start Chromium in kiosk mode and redirect all logs (Console logs + errors) to the log file
chromium --kiosk --password-store=basic --use-fake-ui-for-media-stream --enable-speech-dispatcher --disable-accelerated-video-decode --enable-logging=stderr http://localhost/SKR/index.html >> "$LOG_FILE" 2>&1
