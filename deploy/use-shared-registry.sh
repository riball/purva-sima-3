#!/usr/bin/env bash
# deploy/use-shared-registry.sh: move this project to the shared container
# registry (SHARED_ACR_NAME in deploy/azure-deploy.conf). Safe to rerun.
#
#   DRY_RUN=1 bash deploy/use-shared-registry.sh   # only print what it would do
#   bash deploy/use-shared-registry.sh
#
# Run deploy/shared-registry-setup.sh once (from any project) before this.
# What it does, for this project only:
#   1. lets the app's own identity pull from repository <app> in the shared
#      registry, and adds that registry to the app (the old one stays connected,
#      so the running version keeps working)
#   2. lets the deploy identity <app>-github push to repository <app> only
#   3. writes ACR_NAME=<shared registry> into deploy/azure-deploy.conf and
#      prints the git command that publishes it. That push makes GitHub Actions
#      build and deploy the app from the shared registry.
# Run it again after that deploy has succeeded: it then prints the commands
# that remove the old registry (it never deletes anything itself).
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/shared-registry.sh"

sr_need az
sr_need jq
sr_need git
sr_load
[ -n "$SR_ACR" ] || sr_die "SHARED_ACR_NAME is empty in $SR_CONF_REL"

[ "$DRY_RUN" = 1 ] && sr_say "DRY RUN: nothing will be changed"
sr_say "Project $SR_APP -> shared registry $SR_ACR (repository $SR_REPO)"
acct="$(az account show --subscription "$SR_SUB" -o json 2>/dev/null)" \
  || sr_die "can't use subscription $SR_SUB. Run 'az login' (Cloud Shell is already signed in) and check you have access."
sr_info "signed in as $(printf '%s' "$acct" | jq -r '.user.name // "?"') to '$(printf '%s' "$acct" | jq -r '.name // "?"')'"

sr_lookup || sr_die "shared registry $SR_ACR not found in group $SR_ACR_RG.
    Run 'bash deploy/shared-registry-setup.sh' once first (from any project)."
if [ "$SR_ABAC" = 1 ]; then
  sr_info "registry $SR_ACR_SERVER: per-repository permissions on"
else
  sr_warn "registry $SR_ACR has NO per-repository permissions (mode '${SR_ACR_MODE_RAW:-default}'): this project will be able to reach every project's images"
fi

# ---------------------------------------------------------------------------
sr_say "1. App $SR_APP: pull access"
APP_JSON="$(sr_az containerapp show --name "$SR_APP" --resource-group "$SR_RG" -o json 2>/dev/null)" \
  || sr_die "container app $SR_APP not found in group $SR_RG"
PRINCIPAL="$(printf '%s' "$APP_JSON" | jq -r '.identity.principalId // empty')"
case "$(printf '%s' "$APP_JSON" | jq -r '.identity.type // ""')" in
  *SystemAssigned*) sr_info "app identity: on" ;;
  *)
    sr_run sr_az containerapp identity assign --name "$SR_APP" --resource-group "$SR_RG" --system-assigned -o none \
      || sr_die "could not turn on the app's identity (rerun)"
    if [ "$DRY_RUN" = 0 ]; then
      APP_JSON="$(sr_az containerapp show --name "$SR_APP" --resource-group "$SR_RG" -o json)"
      PRINCIPAL="$(printf '%s' "$APP_JSON" | jq -r '.identity.principalId // empty')"
    fi ;;
esac
[ -n "$PRINCIPAL" ] || PRINCIPAL="<principal id of $SR_APP's identity>"
sr_grant_pull "$PRINCIPAL"
sr_connect_app "$APP_JSON"

# ---------------------------------------------------------------------------
sr_say "2. Deploy identity $SR_DEPLOY_ID: push access"
DEPLOY_PID="$(sr_az identity show --name "$SR_DEPLOY_ID" --resource-group "$SR_RG" -o json 2>/dev/null | jq -r '.principalId // empty' || true)"
[ -n "$DEPLOY_PID" ] || sr_die "deploy identity $SR_DEPLOY_ID not found in group $SR_RG (this project's GitHub deploys were never set up?)"
sr_grant_push "$DEPLOY_PID"

# ---------------------------------------------------------------------------
sr_say "3. Results"
sr_conf_set ACR_NAME "$SR_ACR"
IMAGE="$(printf '%s' "$APP_JSON" | jq -r '.properties.template.containers[0].image // ""')"
sr_info "the app runs: $IMAGE"

case "$IMAGE" in
  "$SR_ACR_SERVER"/*)
    sr_say "This app already runs an image from the shared registry."
    old_servers="$(printf '%s' "$APP_JSON" | jq -r --arg s "$SR_ACR_SERVER" \
      '.properties.configuration.registries // [] | .[] | .server | select(. != $s)' 2>/dev/null || true)"
    old_exists=0
    sr_az acr show --name "$SR_OLD_ACR" --resource-group "$SR_RG" -o none 2>/dev/null && old_exists=1
    if [ -z "$old_servers" ] && [ "$old_exists" = 0 ]; then
      sr_info "Nothing old is left: the move is complete."
    else
      sr_info "Once it has run well for 2-3 days, remove the old registry. These delete its images (no undo):"
      printf '\n'
      for s in $old_servers; do
        printf '    az containerapp registry remove --name %s --resource-group %s --server %s --subscription %s\n' "$SR_APP" "$SR_RG" "$s" "$SR_SUB"
      done
      [ "$old_exists" = 0 ] || printf '    az acr delete --name %s --resource-group %s --subscription %s --yes\n' "$SR_OLD_ACR" "$SR_RG" "$SR_SUB"
      printf '\n'
      sr_info "Run them in that order: the app first stops using the old registry, then it is deleted."
    fi ;;
  *)
    if [ "$DRY_RUN" = 1 ]; then
      sr_say "Dry run finished: nothing was changed."
    elif [ -z "$(git -C "$SR_REPO_DIR" status --porcelain -- "$SR_CONF_REL" 2>/dev/null)" ]; then
      sr_say "Done. $SR_CONF_REL already says ACR_NAME=$SR_ACR; the next deploy uses the shared registry."
      sr_info "Deploy now without a code change: GitHub -> Actions -> Deploy to Azure -> Run workflow."
    else
      sr_say "Done. Publish the change (run this from $(basename "$SR_REPO_DIR"), on the branch that deploys):"
      printf '\n    git add %s && git commit -m "Azure: deploy from the shared registry %s" && git push\n\n' "$SR_CONF_REL" "$SR_ACR"
      sr_info "If git asks for a password, run 'gh auth setup-git' once and try again."
      sr_info "That push builds and deploys the app from the shared registry (watch: gh run watch)."
      sr_info "When the deploy has succeeded, run this script again: it prints how to remove the old registry."
    fi ;;
esac
