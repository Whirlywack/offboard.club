#!/bin/bash
# Saves the LinkedIn app's Client ID and Client Secret into .env.local.
# Double-click this file in Finder, or run it in a terminal.
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(cd "$(dirname "$0")/.." && pwd)/.env.local}"

echo "LinkedIn keys for Offboard"
echo "They will be saved to: $ENV_FILE"
echo
read -r -p "Paste the Client ID, then press Enter: " id
read -r -s -p "Paste the Primary Client Secret, then press Enter (it stays hidden): " secret
echo
id="$(printf '%s' "$id" | tr -d '[:space:]')"
secret="$(printf '%s' "$secret" | tr -d '[:space:]')"
if [ -z "$id" ] || [ -z "$secret" ]; then
  echo "Nothing saved: one of the two values was empty."
  exit 1
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
tmp="$(mktemp)"
grep -v -E '^LINKEDIN_CLIENT_(ID|SECRET)=' "$ENV_FILE" > "$tmp" || true
printf 'LINKEDIN_CLIENT_ID="%s"\nLINKEDIN_CLIENT_SECRET="%s"\n' "$id" "$secret" >> "$tmp"
cat "$tmp" > "$ENV_FILE"
rm -f "$tmp"
echo "Saved. You can close this window."
