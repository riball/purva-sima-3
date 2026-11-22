#!/usr/bin/env bash
# deploy/shared-registry-setup.sh: create the ONE container registry that every
# project shares. Run it once, from any project's folder; running it again (or
# from another project) changes nothing.
#
#   DRY_RUN=1 bash deploy/shared-registry-setup.sh   # only print what it would do
#   bash deploy/shared-registry-setup.sh
#
# Creates, if missing (names from deploy/azure-deploy.conf):
#   - resource group SHARED_ACR_RESOURCE_GROUP (holds only the shared registry)
#   - registry SHARED_ACR_NAME: Basic, admin user off, per-repository
#     permissions (ABAC) so each project can reach only its own repository
# It gives nobody access: each project does that for itself with
# deploy/use-shared-registry.sh. See deploy/SHARED-REGISTRY.md.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/shared-registry.sh"

sr_need az
sr_need jq
sr_load
[ -n "$SR_ACR" ] || sr_die "SHARED_ACR_NAME is empty in $SR_CONF_REL"
[ -n "$SR_LOC" ] || sr_die "AZURE_LOCATION is empty in $SR_CONF_REL"
SR_ALLOW_SHARED_CHANGE=1

[ "$DRY_RUN" = 1 ] && sr_say "DRY RUN: nothing will be changed"
sr_say "Shared registry $SR_ACR in group $SR_ACR_RG ($SR_LOC), subscription $SR_SUB"
acct="$(az account show --subscription "$SR_SUB" -o json 2>/dev/null)" \
  || sr_die "can't use subscription $SR_SUB. Run 'az login' (Cloud Shell is already signed in) and check you have access."
sr_info "signed in as $(printf '%s' "$acct" | jq -r '.user.name // "?"') to '$(printf '%s' "$acct" | jq -r '.name // "?"')'"

state="$(sr_az provider show --namespace Microsoft.ContainerRegistry -o json 2>/dev/null | jq -r '.registrationState // ""')"
if [ "$state" = Registered ]; then
  sr_info "provider Microsoft.ContainerRegistry: registered"
else
  sr_run sr_az provider register --namespace Microsoft.ContainerRegistry --wait -o none || sr_die "could not register Microsoft.ContainerRegistry"
fi

# ---------------------------------------------------------------------------
sr_say "Resource group $SR_ACR_RG"
if [ "$(sr_az group exists --name "$SR_ACR_RG" 2>/dev/null)" = true ]; then
  sr_info "already exists"
else
  sr_run sr_az group create --name "$SR_ACR_RG" --location "$SR_LOC" --tags purpose=shared-container-registry -o none \
    || [ "$(sr_az group exists --name "$SR_ACR_RG" 2>/dev/null)" = true ] \
    || sr_die "could not create group $SR_ACR_RG (if the error was InternalServerError, rerun)"
fi

# ---------------------------------------------------------------------------
sr_say "Registry $SR_ACR"
if sr_lookup; then
  sr_info "already exists ($SR_ACR_SERVER, role assignment mode '${SR_ACR_MODE_RAW:-default}')"
else
  avail="$(sr_az acr check-name --name "$SR_ACR" -o json 2>/dev/null | jq -r 'if .nameAvailable == false then "false" else "true" end' 2>/dev/null || true)"
  [ "$avail" != false ] || sr_die "registry name $SR_ACR is taken (another subscription or group). Pick another SHARED_ACR_NAME in EVERY project's $SR_CONF_REL."
  created=0
  for attempt in 1 2 3; do
    if [ "$SR_MODE" = abac ]; then
      sr_run sr_az acr create --name "$SR_ACR" --resource-group "$SR_ACR_RG" --location "$SR_LOC" --sku Basic \
        --admin-enabled false --role-assignment-mode rbac-abac -o none && { created=1; break; }
    else
      sr_run sr_az acr create --name "$SR_ACR" --resource-group "$SR_ACR_RG" --location "$SR_LOC" --sku Basic \
        --admin-enabled false -o none && { created=1; break; }
    fi
    if [ "$SR_MODE" = abac ] && grep -qiE 'role-assignment-mode|roleAssignmentMode|abac' "$SR_ERR"; then
      sr_die "Azure refused per-repository permissions for this registry (see the error above).
    Fallback (every project can then reach every repository): add the line
    SHARED_ACR_MODE=rbac to $SR_CONF_REL in this folder and rerun this script.
    Or run 'az upgrade' first if the error says the option is unknown."
    fi
    if hint="$(sr_not_allowed_hint)"; then sr_die "registry: $hint"; fi
    sr_warn "registry: create failed (attempt $attempt); checking whether it exists anyway..."
    sleep 15
    if sr_lookup; then created=1; break; fi
  done
  [ "$created" = 1 ] || sr_die "could not create the registry. If the error was InternalServerError, wait a minute and rerun."
  [ "$DRY_RUN" = 1 ] || sr_lookup || sr_die "registry $SR_ACR doesn't show up yet; rerun in a minute"
fi

if [ "$DRY_RUN" = 0 ]; then
  if [ "$SR_MODE" = abac ] && [ "$SR_ABAC" != 1 ]; then
    sr_warn "registry $SR_ACR exists WITHOUT per-repository permissions (mode '${SR_ACR_MODE_RAW:-default}').
    Not switching it here: switching logs out every client already using it.
    If no project uses it yet, switch it with:
      az acr update --name $SR_ACR --resource-group $SR_ACR_RG --role-assignment-mode rbac-abac --subscription $SR_SUB"
  fi
  admin="$(sr_az acr show --name "$SR_ACR" --resource-group "$SR_ACR_RG" -o json 2>/dev/null | jq -r '.adminUserEnabled // false')"
  [ "$admin" != true ] || sr_warn "the admin user is enabled on $SR_ACR; nothing needs it (az acr update -n $SR_ACR --admin-enabled false --subscription $SR_SUB)"
fi

if [ "$DRY_RUN" = 1 ]; then
  sr_say "Dry run finished: nothing was changed."
else
  sr_say "Done: $SR_ACR_SERVER ($( [ "$SR_ABAC" = 1 ] && echo 'per-repository permissions' || echo 'NO per-repository permissions'))."
  sr_info "Next, in each project's folder: bash deploy/use-shared-registry.sh (see deploy/SHARED-REGISTRY.md)."
fi
