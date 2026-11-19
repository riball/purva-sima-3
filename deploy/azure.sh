#!/usr/bin/env bash
# deploy/azure.sh: create or update this project's Azure resources and settings.
#
#   bash deploy/azure.sh             # do it
#   DRY_RUN=1 bash deploy/azure.sh   # only print what it would change
#
# Safe to rerun: it checks what exists first and only changes what differs.
# Run it again after editing .env.azure to update the app's settings.
#
# What it does (names come from deploy/azure-deploy.conf, never from the shell):
#   - resource group <app> and container registry <app without dashes><8 hex>
#   - container app <app> in the SHARED environment (looked up, never changed)
#   - every KEY_<project>=value line in .env.azure becomes the app secret
#     <key>-<app> and the env var KEY=secretref:<key>-<app>, plus PORT=8080
#   - the app pulls images from the registry with its own identity (AcrPull)
#   - writes ACR_NAME and BACKEND_URL into deploy/azure-deploy.conf
# It never changes the image: GitHub Actions deploys images.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

need az
need jq
need git
load_conf

ENV_FILE="$REPO_DIR/.env.azure"
[ "$DRY_RUN" = 1 ] && say "DRY RUN: nothing will be changed"
say "Project $APP (settings suffix _$PROJECT), subscription $SUB, region $LOC"

# ---------------------------------------------------------------------------
# 1. Read .env.azure
# ---------------------------------------------------------------------------
say "Reading .env.azure"
[ -f "$ENV_FILE" ] || die ".env.azure not found in $(basename "$REPO_DIR"). Create it with: bash deploy/render-env.sh (see deploy/AZURE.md)"
if git -C "$REPO_DIR" ls-files --error-unmatch .env.azure >/dev/null 2>&1; then
  die "git tracks .env.azure. It holds secrets: run 'git rm --cached .env.azure' and commit that first."
fi
perm="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE" 2>/dev/null || echo "?")"
[ "$perm" = 600 ] || warn ".env.azure has mode $perm; it should be 600 (chmod 600 .env.azure)"

NAMES=(); VALUES=()
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"            # leading spaces
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  case "$line" in export[[:space:]]*) line="${line#export}"; line="${line#"${line%%[![:space:]]*}"}" ;; esac
  case "$line" in *=*) ;; *) die ".env.azure line $lineno is not KEY=value" ;; esac
  name="${line%%=*}"; name="${name%"${name##*[![:space:]]}"}"
  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"; val="${val%"${val##*[![:space:]]}"}"
  if [ "${#val}" -ge 2 ]; then
    first="${val:0:1}"; last="${val:${#val}-1:1}"
    if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
      val="${val:1:${#val}-2}"
    fi
  fi
  printf '%s' "$name" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || die ".env.azure line $lineno: '$name' is not a valid setting name"
  case "$name" in
    *_"$PROJECT") ;;
    *) die ".env.azure line $lineno: '$name' does not end in _$PROJECT. Every setting here must be named KEY_$PROJECT (is this file from another project?)" ;;
  esac
  key="${name%_"$PROJECT"}"
  [ -n "$key" ] || die ".env.azure line $lineno: '$name' has no key before _$PROJECT"
  found=-1
  i=0
  while [ "$i" -lt "${#NAMES[@]}" ]; do
    [ "${NAMES[$i]}" = "$key" ] && found=$i
    i=$((i + 1))
  done
  if [ "$found" -ge 0 ]; then VALUES[$found]="$val"; else NAMES+=("$key"); VALUES+=("$val"); fi   # last duplicate wins
done < "$ENV_FILE"

SECRET_ARGS=(); ENV_ARGS=(); SECRET_NAMES=(); SKIPPED=()
i=0
while [ "$i" -lt "${#NAMES[@]}" ]; do
  key="${NAMES[$i]}"; val="${VALUES[$i]}"; i=$((i + 1))
  if [ "$key" = PORT ]; then SKIPPED+=("PORT (always 8080)"); continue; fi
  if [ -z "$val" ]; then SKIPPED+=("$key (empty)"); continue; fi
  secret="$(printf '%s' "$key" | tr 'A-Z_' 'a-z-')-$APP"
  printf '%s' "$secret" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' \
    || die "secret name '$secret' (from ${key}_$PROJECT) may only use a-z, 0-9 and '-', and must start and end with a letter or digit"
  # Azure's limit is 253 (a DNS subdomain name). "az containerapp secret set
  # --help" mentions 20 characters for keys, but neither az nor Azure enforces
  # it (another app in the shared environment runs with a 25-character secret).
  [ "${#secret}" -le 253 ] || die "secret name '$secret' is longer than 253 characters; shorten ${key}_$PROJECT"
  for s in ${SECRET_NAMES[@]+"${SECRET_NAMES[@]}"}; do
    [ "$s" = "$secret" ] && die "two settings map to the same secret name '$secret'; rename one of them"
  done
  SECRET_NAMES+=("$secret")
  SECRET_ARGS+=("$secret=$val")
  ENV_ARGS+=("$key=secretref:$secret")
done
ENV_ARGS+=("PORT=8080")

info "${#SECRET_NAMES[@]} settings:"
i=0
while [ "$i" -lt "${#SECRET_NAMES[@]}" ]; do
  info "  ${ENV_ARGS[$i]%%=*} <- secret ${SECRET_NAMES[$i]}"
  i=$((i + 1))
done
for s in ${SKIPPED[@]+"${SKIPPED[@]}"}; do info "  left out: $s"; done
[ "${#SECRET_NAMES[@]}" -gt 0 ] || warn ".env.azure has no settings; the app will not start properly without them"

# ---------------------------------------------------------------------------
# 2. Azure CLI, subscription, providers
# ---------------------------------------------------------------------------
say "Azure CLI and subscription"
acct="$(az account show --subscription "$SUB" -o json 2>/dev/null)" \
  || die "can't use subscription $SUB. Run 'az login' (Cloud Shell is already signed in) and check you have access."
info "signed in as $(printf '%s' "$acct" | jq -r '.user.name // "?"') to '$(printf '%s' "$acct" | jq -r '.name // "?"')'"
if [ "$DRY_RUN" = 1 ]; then
  printf '[dry-run] %s\n' "az extension add --name containerapp --upgrade --yes --only-show-errors"
else
  az extension add --name containerapp --upgrade --yes --only-show-errors \
    || warn "could not add/upgrade the containerapp extension; continuing with what is installed"
fi

for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry; do
  state="$(az_ provider show --namespace "$ns" -o json 2>/dev/null | jq -r '.registrationState // ""')"
  if [ "$state" = Registered ]; then
    info "provider $ns: registered"
  else
    run az_ provider register --namespace "$ns" --wait -o none || die "could not register $ns"
  fi
done

# ---------------------------------------------------------------------------
# 3. Resource group and registry (this project only)
# ---------------------------------------------------------------------------
say "Resource group $RG"
rg_exists() { [ "$(az_ group exists --name "$RG" 2>/dev/null)" = true ]; }
rg_create() { run az_ group create --name "$RG" --location "$LOC" --tags "project=$APP" -o none; }
ensure "resource group $RG" rg_exists rg_create

say "Container registry $ACR"
ACR_JSON=""
acr_exists() { ACR_JSON="$(az_ acr show --name "$ACR" --resource-group "$RG" -o json 2>/dev/null)" && [ -n "$ACR_JSON" ]; }
acr_create() { run az_ acr create --name "$ACR" --resource-group "$RG" --location "$LOC" --sku Basic --admin-enabled false -o none; }
if ! acr_exists; then
  avail="$(az_ acr check-name --name "$ACR" -o json 2>/dev/null | jq -r '.nameAvailable // empty')"
  if [ "$avail" = false ]; then
    die "registry name $ACR is taken (by another subscription or another group). Check: az acr list --subscription $SUB -o table"
  fi
fi
ensure "registry $ACR" acr_exists acr_create
acr_exists || true
ACR_ID="$(printf '%s' "$ACR_JSON" | jq -r '.id // empty' 2>/dev/null || true)"
[ -n "$ACR_ID" ] || ACR_ID="<id of new registry $ACR>"
ACR_SERVER="$(printf '%s' "$ACR_JSON" | jq -r '.loginServer // empty' 2>/dev/null || true)"
[ -n "$ACR_SERVER" ] || ACR_SERVER="$ACR.azurecr.io"
[ "$(printf '%s' "$ACR_JSON" | jq -r '.adminUserEnabled // false' 2>/dev/null)" = true ] \
  && warn "registry $ACR has the admin user enabled; it isn't needed (az acr update -n $ACR --admin-enabled false)"

# ---------------------------------------------------------------------------
# 4. Shared environment (read only) and app name check
# ---------------------------------------------------------------------------
say "Shared Container Apps environment $ENV_NAME (group $ENV_RG, read only)"
ENV_JSON="$(az_ containerapp env show --name "$ENV_NAME" --resource-group "$ENV_RG" -o json 2>/dev/null)" \
  || die "can't read the shared environment $ENV_NAME in $ENV_RG. It must already exist; this script never creates it."
ENV_ID="$(printf '%s' "$ENV_JSON" | jq -r '.id')"
ENV_LOC="$(printf '%s' "$ENV_JSON" | jq -r '.location // ""')"
ENV_WS="$(printf '%s' "$ENV_JSON" | jq -r '.properties.appLogsConfiguration.logAnalyticsConfiguration.customerId // ""')"
info "id: $ENV_ID ($ENV_LOC)"

apps="$(az_ containerapp list --environment "$ENV_ID" -o json 2>/dev/null)" || die "can't list the apps in $ENV_NAME"
taken_by="$(printf '%s' "$apps" | jq -r --arg n "$APP" --arg rg "$RG" \
  '[.[] | select((.name | ascii_downcase) == $n and ((.resourceGroup // "") | ascii_downcase) != ($rg | ascii_downcase)) | .resourceGroup] | join(", ")')"
[ -z "$taken_by" ] || die "an app named '$APP' already runs in $ENV_NAME (resource group: $taken_by). Pick another APP_NAME in $CONF_REL."
info "apps already in the environment: $(printf '%s' "$apps" | jq -r '[.[].name] | join(", ")')"

# ---------------------------------------------------------------------------
# 5. Container app: create, or update settings
# ---------------------------------------------------------------------------
say "Container app $APP"
APP_JSON=""
app_exists() { APP_JSON="$(az_ containerapp show --name "$APP" --resource-group "$RG" -o json 2>/dev/null)" && [ -n "$APP_JSON" ]; }
app_create() {
  local args=(az_ containerapp create --name "$APP" --resource-group "$RG" --environment "$ENV_ID"
    --image "$PLACEHOLDER_IMAGE" --ingress external --target-port 8080
    --cpu "$CPU" --memory "$MEMORY" --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS")
  [ "${#SECRET_ARGS[@]}" -gt 0 ] && args+=(--secrets "${SECRET_ARGS[@]}")
  args+=(--env-vars "${ENV_ARGS[@]}" -o none)
  run "${args[@]}"
}

created=0
if app_exists; then
  app_env="$(printf '%s' "$APP_JSON" | jq -r '.properties.managedEnvironmentId // .properties.environmentId // ""')"
  if [ "$(printf '%s' "$app_env" | tr 'A-Z' 'a-z')" != "$(printf '%s' "$ENV_ID" | tr 'A-Z' 'a-z')" ]; then
    die "app $APP exists in $RG but in another environment ($app_env). Delete it or pick another APP_NAME."
  fi
  info "exists"
else
  ensure "container app $APP" app_exists app_create
  created=1
  app_exists || true
fi

if [ -n "$APP_JSON" ] && { [ "$created" = 0 ] || [ "$DRY_RUN" = 0 ]; }; then
  # Compare what is there with what .env.azure and the config file ask for.
  want_env="$(printf '%s\n' "${ENV_ARGS[@]}" | LC_ALL=C sort)"
  have_env="$(printf '%s' "$APP_JSON" | jq -r '.properties.template.containers[0].env // [] | .[] |
      "\(.name)=\(if .secretRef then "secretref:" + .secretRef else (.value // "") end)"' | LC_ALL=C sort)"
  want_scale="$CPU $MEMORY $MIN_REPLICAS $MAX_REPLICAS"
  have_scale="$(printf '%s' "$APP_JSON" | jq -r '.properties.template as $t |
      "\($t.containers[0].resources.cpu) \($t.containers[0].resources.memory) \($t.scale.minReplicas // 0) \($t.scale.maxReplicas // 10)"')"
  have_secrets="$(az_ containerapp secret list --name "$APP" --resource-group "$RG" --show-values -o json 2>/dev/null \
      | jq -r '.[] | "\(.name)=\(.value // "")"')" || have_secrets=""

  CHANGED_SECRETS=()
  for pair in ${SECRET_ARGS[@]+"${SECRET_ARGS[@]}"}; do
    if ! printf '%s\n' "$have_secrets" | grep -Fxq -- "$pair"; then CHANGED_SECRETS+=("$pair"); fi
  done
  STALE=()
  for s in $(printf '%s\n' "$have_secrets" | sed -n 's/^\([a-z0-9.-]*\)=.*/\1/p'); do
    case "$s" in *-"$APP") ;; *) continue ;; esac
    keep=0
    for w in ${SECRET_NAMES[@]+"${SECRET_NAMES[@]}"}; do [ "$w" = "$s" ] && keep=1; done
    [ "$keep" = 1 ] || STALE+=("$s")
  done

  if [ "${#CHANGED_SECRETS[@]}" -eq 0 ] && [ "$want_env" = "$have_env" ] && [ "$want_scale" = "$(printf '%s' "$have_scale" | sed 's/^\([0-9.]*\)\.0 /\1 /')" ] && [ "${#STALE[@]}" -eq 0 ]; then
    info "settings, size and replicas already match; nothing to update"
  else
    if [ "${#CHANGED_SECRETS[@]}" -gt 0 ]; then
      info "${#CHANGED_SECRETS[@]} secret(s) new or changed: $(printf '%s\n' "${CHANGED_SECRETS[@]}" | sed 's/=.*//' | tr '\n' ' ')"
      run az_ containerapp secret set --name "$APP" --resource-group "$RG" --secrets "${CHANGED_SECRETS[@]}" -o none \
        || die "could not set the secrets (rerun this script; if it keeps failing, see the error above)"
    fi
    # A new revision (new suffix) makes the app read the new secret values.
    # No --image: the image stays whatever GitHub deployed.
    run az_ containerapp update --name "$APP" --resource-group "$RG" \
      --cpu "$CPU" --memory "$MEMORY" --min-replicas "$MIN_REPLICAS" --max-replicas "$MAX_REPLICAS" \
      --replace-env-vars "${ENV_ARGS[@]}" \
      --revision-suffix "cfg$(date -u +%y%m%d%H%M%S)" -o none \
      || die "could not update the app (rerun this script; it only changes what still differs)"
    if [ "${#STALE[@]}" -gt 0 ]; then
      info "removing secrets no longer in .env.azure: ${STALE[*]}"
      run az_ containerapp secret remove --name "$APP" --resource-group "$RG" --secret-names "${STALE[@]}" -o none \
        || warn "could not remove old secrets ${STALE[*]}; harmless, rerun later to retry"
    fi
    app_exists || true
  fi
fi

# ---------------------------------------------------------------------------
# 6. Let the app pull from the registry with its own identity
# ---------------------------------------------------------------------------
say "App identity and registry access"
# appq JQ_ARGS...: read a value from the app's JSON (empty while it doesn't exist).
appq() { [ -n "${APP_JSON:-}" ] || return 0; printf '%s' "$APP_JSON" | jq -r "$@" 2>/dev/null || true; }
PRINCIPAL="$(appq '.identity.principalId // empty')"
id_type="$(appq '.identity.type // ""')"
case "$id_type" in
  *SystemAssigned*) info "system-assigned identity: on" ;;
  *)
    run az_ containerapp identity assign --name "$APP" --resource-group "$RG" --system-assigned -o none \
      || die "could not turn on the app's identity (rerun this script)"
    app_exists || true
    PRINCIPAL="$(appq '.identity.principalId // empty')" ;;
esac
[ -n "$PRINCIPAL" ] || PRINCIPAL="<principal id of $APP's identity>"
grant AcrPull "$ACR_ID" "$PRINCIPAL" "AcrPull for the app on $ACR"

reg_identity="$(appq --arg s "$ACR_SERVER" \
  '.properties.configuration.registries // [] | .[] | select(.server == $s) | .identity // ""' 2>/dev/null || true)"
if [ "$(printf '%s' "$reg_identity" | tr 'A-Z' 'a-z')" = system ]; then
  info "registry $ACR_SERVER: pulled with the app's identity"
else
  run az_ containerapp registry set --name "$APP" --resource-group "$RG" --server "$ACR_SERVER" --identity system -o none \
    || die "could not connect the registry (the AcrPull grant can take a minute; rerun this script)"
  app_exists || true
fi

# ---------------------------------------------------------------------------
# 7. Record results and report
# ---------------------------------------------------------------------------
say "Results"
FQDN="$(appq '.properties.configuration.ingress.fqdn // empty')"
IMAGE="$(appq '.properties.template.containers[0].image // empty')"
conf_set ACR_NAME "$ACR"
if [ -n "$FQDN" ]; then conf_set BACKEND_URL "https://$FQDN"; fi

info "address: ${FQDN:+https://$FQDN}${FQDN:-(known after the app is created)}"
info "image:   ${IMAGE:-$PLACEHOLDER_IMAGE}"
if [ -z "$IMAGE" ] || [ "$IMAGE" = "$PLACEHOLDER_IMAGE" ]; then
  info "still on the placeholder image: the first GitHub deploy replaces it"
elif [ -n "$FQDN" ] && [ "$DRY_RUN" = 0 ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "https://$FQDN$HEALTH_PATH" || true)"
  if [ "$code" = 200 ]; then info "health https://$FQDN$HEALTH_PATH: OK (200)"
  else warn "health https://$FQDN$HEALTH_PATH answered $code (a new revision can take a minute to start)"; fi
fi

ws="$(az_ monitor log-analytics workspace list --resource-group "$RG" -o json 2>/dev/null || echo '[]')"
unused="$(printf '%s' "$ws" | jq -r --arg c "$ENV_WS" '.[] | select(.customerId != $c) | .name' 2>/dev/null || true)"
if [ -n "$unused" ]; then
  say "Unused log workspaces in $RG (they cost money; this app logs to the shared environment's workspace)"
  for w in $unused; do
    info "$w   delete with: az monitor log-analytics workspace delete --resource-group $RG --workspace-name $w --subscription $SUB --yes"
  done
fi

if [ "$DRY_RUN" = 1 ]; then
  say "Dry run finished: nothing was changed."
else
  say "Done. Next: bash deploy/github-setup.sh (only needed once)"
  print_publish_line "Azure: record registry and app address"
fi
