# shellcheck shell=bash
# Shared helpers for deploy/*.sh. Sourced, never run on its own.
#
# Rules every script follows:
# - Project names and settings come ONLY from deploy/azure-deploy.conf (and
#   .env.azure for secrets). Shell variables such as APP_NAME or LOCATION left
#   over from another project are ignored. Only DRY_RUN and API keys/tokens
#   may come from the shell.
# - DRY_RUN=1 prints every changing command (secret values masked) and runs
#   only read-only ones.
# - Nothing that changes Azure may target the shared environment's resource
#   group, except the one shared role assignment on the environment itself.
# - Works in bash 3.2 (macOS) and bash 5 (Azure Cloud Shell).

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
CONF_FILE="$DEPLOY_DIR/azure-deploy.conf"
CONF_REL="deploy/azure-deploy.conf"

# Only DRY_RUN comes from the shell. Anything else is reset here.
case "${DRY_RUN:-0}" in 1|true|yes) DRY_RUN=1 ;; *) DRY_RUN=0 ;; esac
unset AZURE_DEFAULTS_GROUP AZURE_DEFAULTS_LOCATION 2>/dev/null || true

PLACEHOLDER_IMAGE="docker.io/nginxinc/nginx-unprivileged:alpine"
ENV_ROLE_NAME="Container Apps environment join (purva-bot-env)"

say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed (Azure Cloud Shell has it)"; }

# ---------------------------------------------------------------------------
# Config file
# ---------------------------------------------------------------------------

# conf_get KEY: value of the last KEY= line in the config file (empty if none).
conf_get() {
  [ -f "$CONF_FILE" ] || die "missing $CONF_REL"
  awk -v k="$1" '
    { sub(/\r$/, "") }
    /^[ \t]*#/ { next }
    index($0, "=") == 0 { next }
    {
      key = substr($0, 1, index($0, "=") - 1); gsub(/^[ \t]+|[ \t]+$/, "", key)
      if (key == k) { v = substr($0, index($0, "=") + 1); gsub(/^[ \t]+|[ \t]+$/, "", v); val = v; found = 1 }
    }
    END { if (found) print val }' "$CONF_FILE"
}

# looks_secret VALUE: true if VALUE looks like a credential.
looks_secret() {
  local v="$1" payload role
  case "$v" in
    *sb_secret_*|*sk_live_*|*sk_test_*|*rk_live_*|*whsec_*|*ghp_*|*gho_*|*ghu_*|*ghs_*|*github_pat_*|\
    *xoxb-*|*xoxp-*|*AKIA*|*-----BEGIN*|*PRIVATE\ KEY*|*gsk_*|sk-*|*AIza*|*glpat-*|*npm_*)
      return 0 ;;
    *://*:*@*) return 0 ;;   # connection string with a password
  esac
  # A JWT: only a Supabase "anon" key is public.
  case "$v" in
    eyJ*.*.*)
      payload="$(printf '%s' "$v" | cut -d. -f2 | tr '_-' '/+')"
      while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
      role="$(printf '%s' "$payload" | { base64 -d 2>/dev/null || base64 -D 2>/dev/null; } | sed -n 's/.*"role"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
      [ "$role" = "anon" ] && return 1
      return 0 ;;
  esac
  return 1
}

# conf_set KEY VALUE: replace (or append) KEY=VALUE in the config file.
# Refuses anything that looks secret. Not done in DRY_RUN.
conf_set() {
  local key="$1" val="$2" tmp
  case "$val" in *$'\n'*|*$'\r'*) die "refusing to write a multi-line value for $key into $CONF_REL" ;; esac
  if looks_secret "$val"; then
    die "refusing to write $key into $CONF_REL: the value looks like a secret (secrets belong in .env.azure)"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    info "[dry-run] would write $key=$val into $CONF_REL"
    return 0
  fi
  [ "$(conf_get "$key")" = "$val" ] && grep -q "^$key=" "$CONF_FILE" && return 0
  tmp="$CONF_FILE.tmp.$$"
  K="$key" V="$val" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    { line = $0; sub(/\r$/, "", line) }
    line !~ /^[ \t]*#/ && index(line, "=") > 0 {
      key = substr(line, 1, index(line, "=") - 1); gsub(/^[ \t]+|[ \t]+$/, "", key)
      if (key == k) { print k "=" v; done = 1; next }
    }
    { print }
    END { if (!done) print k "=" v }' "$CONF_FILE" > "$tmp" && mv "$tmp" "$CONF_FILE"
  info "wrote $key=$val into $CONF_REL"
}

# load_conf: read the project settings from the config file into variables.
load_conf() {
  APP="$(conf_get APP_NAME)"
  GH_REPO="$(conf_get GITHUB_REPO)"
  GH_OWNER_ID="$(conf_get GITHUB_OWNER_ID)"
  GH_REPO_ID="$(conf_get GITHUB_REPO_ID)"
  SUB="$(conf_get AZURE_SUBSCRIPTION_ID)"
  LOC="$(conf_get AZURE_LOCATION)"
  ENV_NAME="$(conf_get ACA_ENV_NAME)"
  ENV_RG="$(conf_get ACA_ENV_RESOURCE_GROUP)"
  HEALTH_PATH="$(conf_get HEALTH_PATH)"
  CPU="$(conf_get CPU)"
  MEMORY="$(conf_get MEMORY)"
  MIN_REPLICAS="$(conf_get MIN_REPLICAS)"
  MAX_REPLICAS="$(conf_get MAX_REPLICAS)"

  printf '%s' "$APP" | grep -Eq '^[a-z][a-z0-9-]{0,31}$' && case "$APP" in *-|*--*) false ;; *) true ;; esac \
    || die "APP_NAME '$APP' in $CONF_REL: use lower-case letters, digits and single dashes, start with a letter, end with a letter or digit, max 32 characters"
  printf '%s' "$SUB" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    || die "AZURE_SUBSCRIPTION_ID in $CONF_REL is not a subscription ID"
  printf '%s' "$GH_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die "GITHUB_REPO in $CONF_REL must be owner/name"
  [ -n "$LOC" ] && [ -n "$ENV_NAME" ] && [ -n "$ENV_RG" ] || die "AZURE_LOCATION, ACA_ENV_NAME and ACA_ENV_RESOURCE_GROUP must be set in $CONF_REL"
  [ -n "$CPU" ] && [ -n "$MEMORY" ] && [ -n "$MIN_REPLICAS" ] && [ -n "$MAX_REPLICAS" ] || die "CPU, MEMORY, MIN_REPLICAS and MAX_REPLICAS must be set in $CONF_REL"
  case "$HEALTH_PATH" in /*) ;; *) die "HEALTH_PATH in $CONF_REL must start with /" ;; esac
  [ "$APP" != "$ENV_RG" ] || die "APP_NAME must not be the shared environment's resource group"

  RG="$APP"                                   # this project's resource group
  PROJECT="$(printf '%s' "$APP" | tr '-' '_')" # suffix for setting names: KEY_<project>
  ACR="$(printf '%s' "$APP" | tr -d '-')$(printf '%s' "$SUB" | cut -c1-8)"
  ACR_SERVER="$ACR.azurecr.io"
  DEPLOY_IDENTITY="$APP-github"
  RG_ID="/subscriptions/$SUB/resourceGroups/$RG"
}

# ---------------------------------------------------------------------------
# Running az
# ---------------------------------------------------------------------------

# az_ ...: az pinned to this project's subscription (never the shell's default).
az_() { az "$@" --subscription "$SUB"; }

# print_cmd ARGS...: show a command, quoted, with --secrets values masked.
print_cmd() {
  local out="" a in_secrets=0 shown
  for a in "$@"; do
    if [ "$in_secrets" = 1 ]; then
      case "$a" in
        -*) in_secrets=0 ;;
        *=*) out="$out ${a%%=*}=***"; continue ;;
      esac
    fi
    case "$a" in --secrets|-s) in_secrets=1 ;; esac
    [ "$a" = az_ ] && a=az
    shown="$(printf '%q' "$a")"
    out="$out $shown"
  done
  case "$1" in az_) out="$out --subscription $SUB" ;; esac
  printf '%s\n' "${out# }"
}

# guard ARGS...: stop if a changing command would touch the shared environment's
# resource group (or the subscription itself), except the shared role on the
# environment.
guard() {
  local prev="" a lc_env_rg lc_a cmd="$*"
  lc_env_rg="$(printf '%s' "$ENV_RG" | tr 'A-Z' 'a-z')"
  for a in "$@"; do
    lc_a="$(printf '%s' "$a" | tr 'A-Z' 'a-z')"
    case "$prev" in
      -g|--resource-group|--name|-n)
        [ "$lc_a" = "$lc_env_rg" ] && die "refusing to run a changing command on the shared group '$ENV_RG': $cmd" ;;
      --scope)
        if [ "$lc_a" = "$(printf '%s' "${ENV_ID:-}" | tr 'A-Z' 'a-z')" ] && [ -n "${ENV_ID:-}" ]; then
          case "$cmd" in "az_ role assignment create "*"$ENV_ROLE_NAME"*|"az_ role assignment create "*"${ENV_ROLE_ID:-@@none@@}"*) ;;
            *) die "refusing: only the shared join role may be assigned on the shared environment" ;; esac
        else
          case "$lc_a" in
            "/subscriptions/$SUB"|"/subscriptions/$SUB/") die "refusing to assign anything on the whole subscription" ;;
            */resourcegroups/"$lc_env_rg"|*/resourcegroups/"$lc_env_rg"/*) die "refusing to change anything in the shared group '$ENV_RG'" ;;
          esac
        fi ;;
    esac
    prev="$a"
  done
}

# run ARGS...: run a changing command, or print it in DRY_RUN.
# Errors go to $ERR_FILE so callers can inspect them.
ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/azdeploy.XXXXXX")"
trap 'rm -f "$ERR_FILE"' EXIT
run() {
  guard "$@"
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] %s\n' "$(print_cmd "$@")"
    return 0
  fi
  printf '+ %s\n' "$(print_cmd "$@")"
  if "$@" 2>"$ERR_FILE"; then return 0; fi
  sed 's/^/    az: /' "$ERR_FILE" >&2
  return 1
}

# ensure LABEL EXISTS_FN CREATE_FN: create a resource unless it exists. Azure
# sometimes answers InternalServerError even though the create worked, so
# after a failure check again before retrying or giving up.
ensure() {
  local label="$1" exists_fn="$2" create_fn="$3" attempt
  if "$exists_fn"; then info "$label: already exists"; return 0; fi
  if [ "$DRY_RUN" = 1 ]; then "$create_fn"; return 0; fi
  for attempt in 1 2 3; do
    if "$create_fn"; then info "$label: created"; return 0; fi
    warn "$label: create failed (attempt $attempt); checking whether it exists anyway..."
    sleep 15
    if "$exists_fn"; then info "$label: exists after all (Azure reported an error but created it)"; return 0; fi
  done
  die "$label: could not create it. If the error was InternalServerError, wait a minute and rerun this script."
}

# grant ROLE SCOPE PRINCIPAL_ID LABEL: give a role unless already given. A new
# identity takes a moment to appear, so retry a few times.
grant() {
  local role="$1" scope="$2" pid="$3" label="$4" attempt n
  if [ "$DRY_RUN" = 1 ] && case "$pid" in "<"*) true ;; *) false ;; esac; then
    run az_ role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope" -o none
    return 0
  fi
  n="$(az_ role assignment list --assignee-object-id "$pid" --role "$role" --scope "$scope" -o json 2>/dev/null | jq 'length' 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt 0 ]; then info "$label: already granted"; return 0; fi
  if [ "$DRY_RUN" = 1 ]; then
    run az_ role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal --role "$role" --scope "$scope" -o none
    return 0
  fi
  for attempt in 1 2 3 4 5 6; do
    if run az_ role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
         --role "$role" --scope "$scope" -o none; then
      info "$label: granted"; return 0
    fi
    if grep -q "RoleAssignmentExists" "$ERR_FILE"; then info "$label: already granted"; return 0; fi
    warn "$label: not yet (attempt $attempt; a new identity or role takes a moment to appear), retrying in 20 s..."
    sleep 20
  done
  die "$label: could not grant $role. Wait a minute and rerun this script."
}

# print_publish_line MESSAGE: the one line that publishes the config file.
print_publish_line() {
  if [ "$DRY_RUN" = 1 ]; then return 0; fi
  if [ -z "$(git -C "$REPO_DIR" status --porcelain -- "$CONF_REL" 2>/dev/null)" ]; then
    info "$CONF_REL is unchanged; nothing to commit."
    return 0
  fi
  say "Publish the new values (run this from $(basename "$REPO_DIR")):"
  printf '\n    git add %s && git commit -m "%s" && git push\n\n' "$CONF_REL" "$1"
  info "If git asks for a password, run 'gh auth setup-git' once and try again."
}
