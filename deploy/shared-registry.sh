# shellcheck shell=bash
# deploy/shared-registry.sh: helpers for the ONE container registry that every
# project shares. Sourced by deploy/shared-registry-setup.sh,
# deploy/use-shared-registry.sh and (once a project has moved) deploy/azure.sh
# and deploy/github-setup.sh. Never run on its own.
#
# The registry is SHARED_ACR_NAME in group SHARED_ACR_RESOURCE_GROUP (both in
# deploy/azure-deploy.conf). Each project keeps its images in its own
# repository inside it, named after APP_NAME, and gets access to that
# repository only (Azure ABAC conditions on the repository name):
#   - the app's own identity:   "Container Registry Repository Reader"  (pull)
#   - the deploy identity:      "Container Registry Repository Writer"  (push)
#     plus "Reader" on the registry resource, so `az acr login` can find it
#     (in this mode Reader gives no access to any image).
# If the registry runs without ABAC (fallback), these become AcrPull/AcrPush on
# the whole registry, and the scripts say so.
#
# Rules: names come only from deploy/azure-deploy.conf (never from shell
# variables; only DRY_RUN comes from the shell). DRY_RUN=1 prints changing
# commands and runs only read-only ones. Nothing here ever changes the shared
# Container Apps environment's group, and per-project scripts may only add
# role assignments on the shared registry, never change or delete it.
# Works in bash 3.2 (macOS) and bash 5 (Azure Cloud Shell).

SR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SR_REPO_DIR="$(cd "$SR_DIR/.." && pwd)"
SR_CONF="$SR_DIR/azure-deploy.conf"
SR_CONF_REL="deploy/azure-deploy.conf"
case "${DRY_RUN:-0}" in 1|true|yes) DRY_RUN=1 ;; *) DRY_RUN=0 ;; esac
SR_ALLOW_SHARED_CHANGE=0   # only shared-registry-setup.sh sets this to 1
SR_READER_ROLE="Container Registry Repository Reader"
SR_WRITER_ROLE="Container Registry Repository Writer"

sr_say()  { printf '\n==> %s\n' "$*"; }
sr_info() { printf '    %s\n' "$*"; }
sr_warn() { printf 'WARNING: %s\n' "$*" >&2; }
sr_die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
sr_need() { command -v "$1" >/dev/null 2>&1 || sr_die "'$1' is not installed (Azure Cloud Shell has it)"; }
sr_lc()   { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# Error output of the last sr_run (shared with lib.sh's when both are loaded).
if [ -n "${ERR_FILE:-}" ]; then
  SR_ERR="$ERR_FILE"
else
  SR_ERR="$(mktemp "${TMPDIR:-/tmp}/sharedacr.XXXXXX")"
  trap 'rm -f "$SR_ERR"' EXIT
fi

# ---------------------------------------------------------------------------
# Config file
# ---------------------------------------------------------------------------

# sr_conf_get KEY: value of the last KEY= line (empty if none).
sr_conf_get() {
  [ -f "$SR_CONF" ] || sr_die "missing $SR_CONF_REL"
  awk -v k="$1" '
    { sub(/\r$/, "") }
    /^[ \t]*#/ { next }
    index($0, "=") == 0 { next }
    {
      key = substr($0, 1, index($0, "=") - 1); gsub(/^[ \t]+|[ \t]+$/, "", key)
      if (key == k) { v = substr($0, index($0, "=") + 1); gsub(/^[ \t]+|[ \t]+$/, "", v); val = v; found = 1 }
    }
    END { if (found) print val }' "$SR_CONF"
}

# sr_conf_set KEY VALUE: replace (or append) KEY=VALUE. Only plain names are
# written here (registry names), never anything secret. Not done in DRY_RUN.
sr_conf_set() {
  local key="$1" val="$2" tmp
  printf '%s' "$val" | grep -Eq '^[A-Za-z0-9._-]*$' || sr_die "refusing to write '$key' into $SR_CONF_REL: not a plain name"
  if [ "$DRY_RUN" = 1 ]; then sr_info "[dry-run] would write $key=$val into $SR_CONF_REL"; return 0; fi
  if [ "$(sr_conf_get "$key")" = "$val" ] && grep -q "^$key=" "$SR_CONF"; then return 0; fi
  tmp="$SR_CONF.tmp.$$"
  K="$key" V="$val" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
    { line = $0; sub(/\r$/, "", line) }
    line !~ /^[ \t]*#/ && index(line, "=") > 0 {
      key = substr(line, 1, index(line, "=") - 1); gsub(/^[ \t]+|[ \t]+$/, "", key)
      if (key == k) { print k "=" v; done = 1; next }
    }
    { print }
    END { if (!done) print k "=" v }' "$SR_CONF" > "$tmp" && mv "$tmp" "$SR_CONF"
  sr_info "wrote $key=$val into $SR_CONF_REL"
}

# sr_load: read the names this file needs.
sr_load() {
  SR_APP="$(sr_conf_get APP_NAME)"
  SR_SUB="$(sr_conf_get AZURE_SUBSCRIPTION_ID)"
  SR_LOC="$(sr_conf_get AZURE_LOCATION)"
  SR_ENV_RG="$(sr_conf_get ACA_ENV_RESOURCE_GROUP)"
  SR_ACR="$(sr_conf_get SHARED_ACR_NAME)"
  SR_ACR_RG="$(sr_conf_get SHARED_ACR_RESOURCE_GROUP)"
  SR_MODE="$(sr_conf_get SHARED_ACR_MODE)"
  SR_CUR_ACR="$(sr_conf_get ACR_NAME)"
  [ -n "$SR_ENV_RG" ] || SR_ENV_RG=purva-bot
  [ -n "$SR_MODE" ] || SR_MODE=abac

  printf '%s' "$SR_APP" | grep -Eq '^[a-z][a-z0-9-]{0,31}$' || sr_die "APP_NAME in $SR_CONF_REL is not a valid app name"
  printf '%s' "$SR_SUB" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' \
    || sr_die "AZURE_SUBSCRIPTION_ID in $SR_CONF_REL is not a subscription ID"
  if [ -n "$SR_ACR" ]; then
    printf '%s' "$SR_ACR" | grep -Eq '^[a-z0-9]{5,50}$' || sr_die "SHARED_ACR_NAME in $SR_CONF_REL: 5-50 lower-case letters and digits"
    printf '%s' "$SR_ACR_RG" | grep -Eq '^[A-Za-z0-9._-]{1,90}$' || sr_die "SHARED_ACR_RESOURCE_GROUP in $SR_CONF_REL is missing or invalid"
    [ "$(sr_lc "$SR_ACR_RG")" != "$(sr_lc "$SR_ENV_RG")" ] || sr_die "SHARED_ACR_RESOURCE_GROUP must not be the shared environment's group ($SR_ENV_RG)"
    [ "$(sr_lc "$SR_ACR_RG")" != "$(sr_lc "$SR_APP")" ] || sr_die "SHARED_ACR_RESOURCE_GROUP must not be a project's own group"
  fi
  case "$SR_MODE" in abac|rbac) ;; *) sr_die "SHARED_ACR_MODE in $SR_CONF_REL must be abac or rbac" ;; esac

  SR_RG="$SR_APP"                       # this project's own group
  SR_DEPLOY_ID="$SR_APP-github"         # this project's deploy identity
  SR_REPO="$SR_APP"                     # this project's repository in the registry
  SR_OLD_ACR="$(printf '%s' "$SR_APP" | tr -d '-')$(printf '%s' "$SR_SUB" | cut -c1-8)"   # its own old registry
  SR_ACR_SERVER="$SR_ACR.azurecr.io"
  SR_ACR_ID=""
  SR_ABAC=0
}

# sr_uses_shared: true when this project deploys from the shared registry
# (ACR_NAME is the shared one, or still empty for a brand-new project).
sr_uses_shared() {
  [ -n "${SR_ACR:-}" ] && { [ "$SR_CUR_ACR" = "$SR_ACR" ] || [ -z "$SR_CUR_ACR" ]; }
}

# ---------------------------------------------------------------------------
# Running az
# ---------------------------------------------------------------------------
sr_az() { az "$@" --subscription "$SR_SUB"; }

sr_print_cmd() {
  local out="" a
  for a in "$@"; do
    [ "$a" = sr_az ] && a=az
    out="$out $(printf '%q' "$a")"
  done
  [ "$1" = sr_az ] && out="$out --subscription $SR_SUB"
  printf '%s\n' "${out# }"
}

# sr_guard ARGS...: stop a changing command that would touch the shared
# environment's group or the whole subscription, or (unless this is the setup
# script) change the shared registry's group in any way other than adding a
# role assignment on the registry itself.
sr_guard() {
  local prev="" a lc env_rg acr_rg cmd="$*" touches_shared=0
  env_rg="$(sr_lc "$SR_ENV_RG")"; acr_rg="$(sr_lc "${SR_ACR_RG:-@@none@@}")"
  for a in "$@"; do
    lc="$(sr_lc "$a")"
    case "$prev" in
      -g|--resource-group|--name|-n)
        [ "$lc" = "$env_rg" ] && sr_die "refusing to change the shared environment's group '$SR_ENV_RG': $cmd"
        [ "$lc" = "$acr_rg" ] && touches_shared=1 ;;
      --scope)
        case "$lc" in
          "/subscriptions/$SR_SUB"|"/subscriptions/$SR_SUB/") sr_die "refusing to assign anything on the whole subscription" ;;
          */resourcegroups/"$env_rg"|*/resourcegroups/"$env_rg"/*) sr_die "refusing to change anything in the shared environment's group '$SR_ENV_RG'" ;;
          */resourcegroups/"$acr_rg"|*/resourcegroups/"$acr_rg"/*)
            touches_shared=1
            case "$cmd" in
              "sr_az role assignment create "*) [ "$lc" = "$(sr_lc "$SR_ACR_ID")" ] && touches_shared=0 ;;
            esac ;;
        esac ;;
    esac
    prev="$a"
  done
  if [ "$touches_shared" = 1 ] && [ "$SR_ALLOW_SHARED_CHANGE" != 1 ]; then
    sr_die "refusing: per-project scripts may only add role assignments on the shared registry: $cmd"
  fi
  return 0
}

# sr_run ARGS...: run a changing command (or print it in DRY_RUN).
sr_run() {
  sr_guard "$@"
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$(sr_print_cmd "$@")"; return 0; fi
  printf '+ %s\n' "$(sr_print_cmd "$@")"
  if "$@" 2>"$SR_ERR"; then return 0; fi
  sed 's/^/    az: /' "$SR_ERR" >&2
  return 1
}

# sr_not_allowed_hint: explain an AuthorizationFailed from the last sr_run.
sr_not_allowed_hint() {
  grep -q "AuthorizationFailed" "$SR_ERR" 2>/dev/null || return 1
  local action
  action="$(grep -oE "perform action '[^']+'" "$SR_ERR" | head -1 | cut -d"'" -f2)"
  case "$action" in
    Microsoft.Authorization/*)
      printf '%s' "your Azure account isn't allowed to grant access (${action}).
    That needs Owner, or User Access Administrator, on subscription $SR_SUB.
    If it was just added, it can take a few minutes to work. Otherwise ask the
    subscription's Owner (portal -> Subscriptions -> Access control (IAM) ->
    Add role assignment). Rerunning continues from here." ;;
    *)
      printf '%s' "your Azure account isn't allowed to do this (${action:-see the error above}).
    Ask the subscription's Owner for access, then rerun." ;;
  esac
}

# ---------------------------------------------------------------------------
# The shared registry
# ---------------------------------------------------------------------------

# sr_lookup: read the shared registry; sets SR_ACR_ID, SR_ACR_SERVER, SR_ABAC.
# Fails if it doesn't exist (read only).
sr_lookup() {
  local j mode
  j="$(sr_az acr show --name "$SR_ACR" --resource-group "$SR_ACR_RG" -o json 2>/dev/null)" || return 1
  [ -n "$j" ] || return 1
  SR_ACR_ID="$(printf '%s' "$j" | jq -r '.id // empty')"
  SR_ACR_SERVER="$(printf '%s' "$j" | jq -r '.loginServer // empty')"
  [ -n "$SR_ACR_SERVER" ] || SR_ACR_SERVER="$SR_ACR.azurecr.io"
  mode="$(printf '%s' "$j" | jq -r '.roleAssignmentMode // ""')"
  SR_ACR_MODE_RAW="$mode"
  case "$(sr_lc "$mode")" in *abac*) SR_ABAC=1 ;; *) SR_ABAC=0 ;; esac
  [ -n "$SR_ACR_ID" ]
}

# sr_condition ROLE: the ABAC condition limiting ROLE to this project's
# repository. Built from the role's own data actions, so every action the role
# allows is covered (an action left out would apply to EVERY repository).
sr_condition() {
  local role="$1" acts a lhs="" q
  acts="$(sr_az role definition list --name "$role" -o json 2>/dev/null \
    | jq -r '[.[0].permissions[]?.dataActions[]?] | unique | .[]' 2>/dev/null || true)"
  [ -n "$acts" ] || sr_die "can't read the data actions of the built-in role '$role' (az role definition list --name \"$role\")"
  for a in $acts; do
    case "$a" in
      *\**) sr_die "role '$role' has a wildcard data action ($a); refusing to build a repository condition for it" ;;
      Microsoft.ContainerRegistry/registries/repositories/*) ;;
      *) sr_die "role '$role' has a data action that isn't per repository ($a); refusing" ;;
    esac
    q="!(ActionMatches{'$a'})"
    if [ -z "$lhs" ]; then lhs="$q"; else lhs="$lhs AND $q"; fi
  done
  printf '((%s) OR (@Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase '"'"'%s'"'"'))' "$lhs" "$SR_REPO"
}

# sr_grant ROLE PRINCIPAL LABEL [CONDITION]: give ROLE on the shared registry
# unless already given (with a condition, one for this repository). Retries
# while a new identity or role is still appearing.
sr_grant() {
  local role="$1" pid="$2" label="$3" cond="${4:-}" n attempt hint
  case "$pid" in "<"*)
    if [ "$DRY_RUN" = 1 ]; then
      if [ -n "$cond" ]; then
        sr_run sr_az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
          --role "$role" --scope "$SR_ACR_ID" --condition "$cond" --condition-version 2.0 -o none
      else
        sr_run sr_az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
          --role "$role" --scope "$SR_ACR_ID" -o none
      fi
      return 0
    fi
    sr_die "$label: unknown identity ($pid)" ;;
  esac
  n="$(sr_az role assignment list --assignee-object-id "$pid" --role "$role" --scope "$SR_ACR_ID" -o json 2>/dev/null \
      | jq --arg r "'$SR_REPO'" --arg c "$cond" \
          'if $c == "" then length else [.[] | select((.condition // "") | ascii_downcase | contains($r | ascii_downcase))] | length end' 2>/dev/null || echo 0)"
  if [ "${n:-0}" -gt 0 ]; then sr_info "$label: already granted"; return 0; fi
  for attempt in 1 2 3 4 5 6; do
    if [ -n "$cond" ]; then
      sr_run sr_az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
        --role "$role" --scope "$SR_ACR_ID" --condition "$cond" --condition-version 2.0 \
        --description "$SR_APP: repository $SR_REPO only" -o none && { sr_info "$label: granted"; return 0; }
    else
      sr_run sr_az role assignment create --assignee-object-id "$pid" --assignee-principal-type ServicePrincipal \
        --role "$role" --scope "$SR_ACR_ID" -o none && { sr_info "$label: granted"; return 0; }
    fi
    [ "$DRY_RUN" = 1 ] && return 0
    if grep -q "RoleAssignmentExists" "$SR_ERR"; then sr_info "$label: already granted"; return 0; fi
    if [ "$attempt" = 1 ] && hint="$(sr_not_allowed_hint)"; then sr_warn "$label: $hint"; fi
    sr_warn "$label: not yet (attempt $attempt; a new identity or role takes a moment to appear), retrying in 20 s..."
    sleep 20
  done
  if hint="$(sr_not_allowed_hint)"; then sr_die "$label: could not grant $role: $hint"; fi
  sr_die "$label: could not grant $role. Wait a minute and rerun."
}

# sr_grant_pull PRINCIPAL: let an app's identity pull this project's images.
sr_grant_pull() {
  if [ "$SR_ABAC" = 1 ]; then
    sr_grant "$SR_READER_ROLE" "$1" "pull from repository $SR_REPO (app identity)" "$(sr_condition "$SR_READER_ROLE")"
  else
    sr_warn "shared registry $SR_ACR has no per-repository permissions: the app can pull every project's images"
    sr_grant AcrPull "$1" "AcrPull on $SR_ACR (app identity)"
  fi
}

# sr_grant_push PRINCIPAL: let the deploy identity push this project's images.
sr_grant_push() {
  if [ "$SR_ABAC" = 1 ]; then
    sr_grant "$SR_WRITER_ROLE" "$1" "push to repository $SR_REPO (deploy identity)" "$(sr_condition "$SR_WRITER_ROLE")"
    sr_grant Reader "$1" "see the registry resource, for az acr login (deploy identity; no image access)"
  else
    sr_warn "shared registry $SR_ACR has no per-repository permissions: the deploy identity can push to every project's repository"
    sr_grant AcrPush "$1" "AcrPush on $SR_ACR (deploy identity)"
  fi
}

# sr_connect_app APP_JSON: make the app pull from the shared registry with its
# own identity. Other registry entries (the old one) stay until cleanup.
sr_connect_app() {
  local app_json="$1" reg
  reg="$(printf '%s' "$app_json" | jq -r --arg s "$SR_ACR_SERVER" \
    '.properties.configuration.registries // [] | .[] | select(.server == $s) | .identity // ""' 2>/dev/null || true)"
  if [ "$(sr_lc "$reg")" = system ]; then
    sr_info "registry $SR_ACR_SERVER: already pulled with the app's identity"
    return 0
  fi
  sr_run sr_az containerapp registry set --name "$SR_APP" --resource-group "$SR_RG" \
    --server "$SR_ACR_SERVER" --identity system -o none \
    || sr_die "could not connect $SR_ACR_SERVER to the app (a new role can take a minute; rerun)"
}
