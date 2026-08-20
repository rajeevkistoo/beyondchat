#!/bin/bash
# Daily token refresh — the job Vercel would have run.
#
# Instagram long-lived tokens last 60 days and die silently: no error, no
# notification, comments simply stop being answered. The endpoint only acts on
# accounts within 10 days of expiry, so running this daily is cheap and the
# window for a missed run is wide.

set -uo pipefail

APP_DIR="$HOME/BeyondChat"
LOG="$APP_DIR/logs/cron.log"
PORT=3010

mkdir -p "$APP_DIR/logs"
cd "$APP_DIR" || exit 1

# Read CRON_SECRET without sourcing .env — that file holds keys with characters
# a shell would happily interpret.
SECRET=$(grep -E '^CRON_SECRET=' .env | head -1 | cut -d= -f2-)
[ -z "$SECRET" ] && SECRET=$(grep -E '^NEXTAUTH_SECRET=' .env | head -1 | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  echo "$(date "+%F %T") ERROR: no CRON_SECRET in .env" >> "$LOG"
  exit 1
fi

for job in refresh-tokens snapshot-followers attach-next-reel; do
  response=$(curl -fsS --max-time 60 \
    -H "Authorization: Bearer $SECRET" \
    "http://localhost:$PORT/api/cron/$job" 2>&1)
  echo "$(date "+%F %T") $job: ${response:-FAILED (is the web server up?)}" >> "$LOG"
done
