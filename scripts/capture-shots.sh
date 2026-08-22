#!/bin/bash
# Guided screenshot capture for setup.html.
#
# Walks the twelve shots one at a time: it tells you what to put on screen,
# you drag a box around it, and the file lands in docs/img/ under the exact
# name setup.html is looking for. Nothing is captured until you press Enter,
# so what ends up in the repo is only ever what you chose to frame.
#
# Already-captured shots are skipped, so you can stop and come back.
# Pass --redo to recapture everything.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$DIR/docs/img"
REDO="${1:-}"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This uses macOS's screencapture. On Windows use Win+Shift+S and save"
  echo "each file into docs/img/ by hand — see docs/img/CAPTURE-LIST.md."
  exit 1
fi

if [[ ! -t 0 ]] && [[ ! -r /dev/tty ]]; then
  echo "No terminal attached. This script captures your screen, so it only runs"
  echo "somewhere you can see and frame each shot. Open a terminal and run:"
  echo "  npm run shots"
  exit 1
fi

mkdir -p "$OUT"

bold=$'\033[1m'; dim=$'\033[2m'; amber=$'\033[33m'; green=$'\033[32m'; off=$'\033[0m'

# name|where to go|what to frame|warning|url to open (all optional after the first two)
SHOTS=(
"vscode-claude|VS Code, with the Claude Code extension panel open on a project|The whole window: file tree on the left, Claude on the right||"
"docker-running|Docker Desktop, Containers tab, with this project's containers running|The container list showing green/running||"
"cf-nameservers|Cloudflare dashboard -> your domain -> the nameserver setup screen|The two nameservers Cloudflare gives you|Cover your account email if it is on screen|https://dash.cloudflare.com/"
"cf-api-token|Cloudflare -> My Profile -> API Tokens -> Create Custom Token|The permissions rows: Cloudflare Tunnel Edit, DNS Edit, Zone Read|Frame the PERMISSIONS screen, never the screen that shows the token itself|https://dash.cloudflare.com/profile/api-tokens"
"meta-create-app|developers.facebook.com -> Create App -> the use-case picker|The picker with Instagram selected|Use a throwaway app so no real app ID is shown|https://developers.facebook.com/apps/creation/"
"meta-oauth-redirect|Your Meta app -> Instagram -> API setup -> OAuth redirect URIs|The redirect URI field with the callback URL in it|Crop out the app ID and any secret|https://developers.facebook.com/apps/"
"meta-webhook-config|Your Meta app -> Instagram -> Customize -> Configure webhooks|The field list showing comments Subscribed|Crop out the verify token|https://developers.facebook.com/apps/"
"meta-tester-invite|Your Meta app -> App roles -> Roles -> Instagram testers|The tester list with an invite showing||https://developers.facebook.com/apps/"
"ig-tester-invite|YOUR PHONE: Instagram -> Edit profile -> Apps and websites -> Tester invites|The Accept button. AirDrop it to the Mac first, then frame it here||"
"meta-publish|Your Meta app -> the left-hand menu, with Publish visible|The menu, so people can see where Publish lives||https://developers.facebook.com/apps/"
"app-connect-instagram|Your BeyondChat -> Settings -> Connect Instagram -> Instagram's approval screen|The permission list Instagram asks you to approve||"
"dm-received|The payoff: the comment on your post, and the DM that arrived|Both together if you can. This is the best shot on the page|Blur the commenter's handle unless it is your own account|"
)

total=${#SHOTS[@]}
done_count=0
skipped=()

echo
echo "${bold}Capturing ${total} screenshots for setup.html${off}"
echo "${dim}macOS will ask for Screen Recording permission the first time. If it"
echo "does, grant it and run this again — without it every capture saves blank."
echo "Enter = capture (drag a box, or press Space then click a window)"
echo "s = skip · q = quit. Progress is saved as you go.${off}"
echo

i=0
for row in "${SHOTS[@]}"; do
  i=$((i+1))
  IFS='|' read -r name where what warn url <<< "$row"
  target="$OUT/$name.png"

  if [[ -f "$target" && "$REDO" != "--redo" ]]; then
    echo "${green}✓${off} [$i/$total] $name ${dim}(already captured)${off}"
    done_count=$((done_count+1))
    continue
  fi

  echo
  echo "${bold}[$i/$total] $name.png${off}"
  echo "  ${bold}Go to:${off} $where"
  echo "  ${bold}Frame:${off} $what"
  [[ -n "$warn" ]] && echo "  ${amber}⚠ $warn${off}"
  # Open the page for you. Half the work in this list is finding the screen,
  # not framing it — Meta in particular buries these four levels deep.
  if [[ -n "${url:-}" ]]; then
    echo "  ${dim}Opening $url${off}"
    open "$url" 2>/dev/null || true
  fi
  printf "  Ready? "
  # Read from the terminal when there is one, so this still works if the
  # script is piped. Unset on EOF would abort the run under `set -u`.
  # A failed read means no human is answering. Quit rather than capture:
  # an unframed screenshot of whatever happens to be on screen is exactly
  # what must never reach the repo.
  key=""
  if [[ -r /dev/tty ]]; then
    read -r key </dev/tty || { echo; echo "  No input — stopping."; break; }
  else
    read -r key || { echo; echo "  No input — stopping."; break; }
  fi

  case "$key" in
    q|Q) echo "  Stopped. Run again to pick up where you left off."; break ;;
    s|S) echo "  ${dim}Skipped.${off}"; skipped+=("$name"); continue ;;
  esac

  # -i interactive selection, -o no window shadow (shadows look broken on white)
  screencapture -i -o "$target"

  if [[ -f "$target" ]]; then
    size=$(stat -f%z "$target")
    echo "  ${green}✓ saved${off} ${dim}($((size/1024)) KB)${off}"
    done_count=$((done_count+1))
  else
    echo "  ${dim}Cancelled — nothing saved.${off}"
    skipped+=("$name")
  fi
done

echo
echo "${bold}$done_count of $total captured.${off}"
if (( ${#skipped[@]} )); then
  echo "${dim}Still missing: ${skipped[*]}${off}"
  echo "${dim}setup.html hides any shot that is missing, so it looks fine either way.${off}"
fi
echo
echo "Open the page to check them: ${bold}open $DIR/setup.html${off}"
echo
