#!/usr/bin/env bash
# deploy/render-env.sh: copy the app's settings from Render into .env.azure.
#
#   bash deploy/render-env.sh               # service name from deploy/azure-deploy.conf
#   bash deploy/render-env.sh <service>     # another Render service name
#
# Asks for a Render API key (Render dashboard > Account settings > API keys);
# it is read without echo and only sent to api.render.com. RENDER_API_KEY in
# the shell is used instead if set.
#
# Writes .env.azure (mode 600, never committed) with every name suffixed
# _<project> (GROQ_API_KEY -> GROQ_API_KEY_sima), backs up an
# existing file to .env.azure.bak, and never prints a value.
# Leaves out PORT, Render-only settings, one-time admin passwords and empty
# or multi-line values, and lists what it left out.
# Render "environment groups" and "secret files" are not included: add those
# by hand.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

need curl
need jq
APP="$(conf_get APP_NAME)"
[ -n "$APP" ] || die "APP_NAME is missing in $CONF_REL"
PROJECT="$(printf '%s' "$APP" | tr '-' '_')"
SERVICE="${1:-$(conf_get RENDER_SERVICE_NAME)}"
[ -n "$SERVICE" ] || die "give the Render service name: bash deploy/render-env.sh <service>"
API="https://api.render.com/v1"
OUT="$REPO_DIR/.env.azure"

if [ -z "${RENDER_API_KEY:-}" ]; then
  printf 'Render API key (input hidden): ' >&2
  read -rs RENDER_API_KEY
  printf '\n' >&2
fi
[ -n "$RENDER_API_KEY" ] || die "no API key given"

BODY="$(mktemp "${TMPDIR:-/tmp}/render.XXXXXX")"
trap 'rm -f "$BODY" "$ERR_FILE" "${TMP_OUT:-}"' EXIT

# render_get PATH_AND_QUERY: GET from the Render API into $BODY. The key goes
# to curl on stdin, so it never appears in the process list.
render_get() {
  local code
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$RENDER_API_KEY" \
    | curl -sS -K - -H 'Accept: application/json' -o "$BODY" -w '%{http_code}' --max-time 30 "$API$1" 2>"$ERR_FILE")" \
    || die "could not reach $API ($(cat "$ERR_FILE"))"
  if ! jq -e 'type == "array"' "$BODY" >/dev/null 2>&1; then
    if jq -e '.message' "$BODY" >/dev/null 2>&1; then
      die "Render answered $code: $(jq -r '.message' "$BODY")"
    fi
    die "Render answered $code with something that isn't a list: $(head -c 300 "$BODY" | tr '\n' ' ')"
  fi
}

urlenc() { jq -rn --arg v "$1" '$v | @uri'; }

say "Finding Render service '$SERVICE'"
render_get "/services?name=$(urlenc "$SERVICE")&limit=20"
ids="$(jq -r --arg n "$SERVICE" '[.[] | .service // . | select(.name == $n) | .id] | unique | .[]' "$BODY")"
count="$(printf '%s' "$ids" | grep -c . || true)"
if [ "$count" != 1 ]; then
  if [ "$count" = 0 ]; then warn "no Render service is named '$SERVICE'."; else warn "$count services are named '$SERVICE'."; fi
  render_get "/services?limit=100"
  say "Services this API key can see (name, type, address):"
  jq -r '.[] | .service // . | "    \(.name)  \(.type // "?")  \(.serviceDetails.url // "")  id=\(.id)"' "$BODY"
  die "run again with the right name: bash deploy/render-env.sh <name>"
fi
SERVICE_ID="$ids"
info "found $SERVICE_ID"

say "Reading its environment variables"
ALL="[]"
cursor=""
pages=0
while :; do
  q="/services/$SERVICE_ID/env-vars?limit=100"
  [ -n "$cursor" ] && q="$q&cursor=$(urlenc "$cursor")"
  render_get "$q"
  n="$(jq 'length' "$BODY")"
  [ "$n" -gt 0 ] || break
  ALL="$(jq -c --argjson all "$ALL" '$all + [.[] | .envVar // . | {key, value}]' "$BODY")"
  cursor="$(jq -r '.[-1].cursor // empty' "$BODY")"
  pages=$((pages + 1))
  [ -n "$cursor" ] || break
  [ "$pages" -lt 100 ] || die "more than 100 pages of settings; something is wrong"
done
info "$(printf '%s' "$ALL" | jq 'length') variables on Render"

# Which ones to leave out, and why (printed; values never are).
reason_for() {
  local k="$1" v="$2"
  case "$k" in
    PORT) echo "PORT is always 8080 on Azure"; return ;;
    RENDER|RENDER_*|IS_PULL_REQUEST) echo "Render-only"; return ;;
    PYTHON_VERSION|NODE_VERSION|POETRY_VERSION|BUN_VERSION|GO_VERSION|RUBY_VERSION|ELIXIR_VERSION|PIP_*|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE)
      echo "Render build/runtime setting (the image sets its own)"; return ;;
    WEB_CONCURRENCY|UVICORN_*|GUNICORN_*|FRONTEND_DIST)
      echo "server setting for Render (the Azure image runs one uvicorn process and sets its own paths)"; return ;;
    VITE_*)
      echo "web build setting (the Azure image builds the web app with VITE_API_BASE=/api)"; return ;;
    *ADMIN*PASSWORD*|*INITIAL*PASSWORD*|*BOOTSTRAP*|*SEED*PASSWORD*|*DEFAULT*PASSWORD*)
      echo "one-time admin password"; return ;;
  esac
  [ -n "$v" ] || { echo "empty"; return; }
  case "$v" in *$'\n'*|*$'\r'*) echo "multi-line value (add it in the Azure portal)"; return ;; esac
  printf '%s' "$k" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || { echo "not a valid name"; return; }
  echo ""
}

say "Writing .env.azure (names end in _$PROJECT)"
TMP_OUT="$(mktemp "$REPO_DIR/.env.azure.tmp.XXXXXX")"
chmod 600 "$TMP_OUT"
{
  echo "# Settings for Azure app $APP, imported from Render service $SERVICE on $(date -u +%Y-%m-%d)."
  echo "# NEVER commit this file. Every name ends in _$PROJECT; deploy/azure.sh stores"
  echo "# KEY_$PROJECT as the app secret <key>-$APP and gives the app the env var KEY."
  echo "# Edit, then rerun: bash deploy/azure.sh"
} > "$TMP_OUT"
written=0
LEFT_OUT=""
n="$(printf '%s' "$ALL" | jq 'length')"
i=0
while [ "$i" -lt "$n" ]; do
  k="$(printf '%s' "$ALL" | jq -r --argjson i "$i" '.[$i].key // ""')"
  v="$(printf '%s' "$ALL" | jq -r --argjson i "$i" '.[$i].value // ""'; printf x)"; v="${v%x}"; v="${v%$'\n'}"
  i=$((i + 1))
  r="$(reason_for "$k" "$v")"
  if [ -n "$r" ]; then LEFT_OUT="$LEFT_OUT    $k: $r"$'\n'; continue; fi
  printf '%s_%s=%s\n' "$k" "$PROJECT" "$v" >> "$TMP_OUT"
  info "$k -> ${k}_$PROJECT"
  written=$((written + 1))
done

if [ -f "$OUT" ]; then
  cp -p "$OUT" "$OUT.bak"
  chmod 600 "$OUT.bak"
  info "previous file kept as .env.azure.bak"
fi
mv "$TMP_OUT" "$OUT"
chmod 600 "$OUT"
TMP_OUT=""

say "Wrote $written settings to .env.azure (mode 600)"
if [ -n "$LEFT_OUT" ]; then
  say "Left out:"
  printf '%s' "$LEFT_OUT"
fi
info "Render environment groups and secret files are not included; add any you use by hand."
info "Next: check it with 'nano .env.azure', then run: bash deploy/azure.sh"
