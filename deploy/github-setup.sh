#!/usr/bin/env bash
# deploy/github-setup.sh: let GitHub Actions (main branch of this repo only)
# deploy to Azure without any stored password. Run after deploy/azure.sh.
#
#   bash deploy/github-setup.sh
#   DRY_RUN=1 bash deploy/github-setup.sh
#
# Safe to rerun. It sets up:
#   - identity <app>-github in group <app>, trusted for GitHub's OIDC tokens
#     from main of this repo (both subject forms GitHub may send)
#   - its roles, nothing more: Contributor on group <app>, AcrPush on this
#     project's registry, and the shared "environment join" role on the shared
#     environment only (created once for all projects, reused otherwise)
#   - AZURE_CLIENT_ID and AZURE_TENANT_ID in deploy/azure-deploy.conf
# Pushing the config file afterwards starts the first deploy.
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib.sh"

need az
need jq
need git
load_conf

ISSUER="https://token.actions.githubusercontent.com"
AUDIENCE="api://AzureADTokenExchange"
OWNER="${GH_REPO%%/*}"
REPO_NAME="${GH_REPO#*/}"

[ "$DRY_RUN" = 1 ] && say "DRY RUN: nothing will be changed"
say "Project $APP: deploy identity $DEPLOY_IDENTITY for $GH_REPO (main)"

acct="$(az account show --subscription "$SUB" -o json 2>/dev/null)" \
  || die "can't use subscription $SUB. Run 'az login' and check you have access."
TENANT="$(printf '%s' "$acct" | jq -r '.tenantId')"

# ---------------------------------------------------------------------------
# What azure.sh made (read only here)
# ---------------------------------------------------------------------------
say "Checking what deploy/azure.sh created"
ENV_JSON="$(az_ containerapp env show --name "$ENV_NAME" --resource-group "$ENV_RG" -o json 2>/dev/null)" \
  || die "can't read the shared environment $ENV_NAME in $ENV_RG"
ENV_ID="$(printf '%s' "$ENV_JSON" | jq -r '.id')"
info "shared environment: $ENV_ID"
if [ "$(az_ group exists --name "$RG" 2>/dev/null)" != true ]; then
  [ "$DRY_RUN" = 1 ] || die "resource group $RG doesn't exist yet: run bash deploy/azure.sh first"
  info "(dry run) group $RG doesn't exist yet"
fi
ACR_ID="$(az_ acr show --name "$ACR" --resource-group "$RG" -o json 2>/dev/null | jq -r '.id // empty' 2>/dev/null || true)"
if [ -z "$ACR_ID" ]; then
  [ "$DRY_RUN" = 1 ] || die "registry $ACR doesn't exist yet: run bash deploy/azure.sh first"
  ACR_ID="<id of registry $ACR>"
fi
conf_acr="$(conf_get ACR_NAME)"
[ -z "$conf_acr" ] || [ "$conf_acr" = "$ACR" ] || die "ACR_NAME in $CONF_REL is '$conf_acr' but this project's registry is '$ACR'"

# ---------------------------------------------------------------------------
# GitHub's OIDC subject (both forms)
# ---------------------------------------------------------------------------
say "GitHub repository IDs"
if command -v gh >/dev/null 2>&1 && ids="$(gh api "repos/$GH_REPO" --jq '"\(.owner.id) \(.id)"' 2>/dev/null)"; then
  [ "$ids" = "$GH_OWNER_ID $GH_REPO_ID" ] \
    || die "GitHub says the IDs of $GH_REPO are '$ids' but $CONF_REL has '$GH_OWNER_ID $GH_REPO_ID'. Fix GITHUB_OWNER_ID / GITHUB_REPO_ID."
  info "owner $GH_OWNER_ID, repository $GH_REPO_ID (checked with gh)"
  sub_cfg="$(gh api "repos/$GH_REPO/actions/oidc/customization/sub" 2>/dev/null || true)"
  if [ -n "$sub_cfg" ]; then
    use_default="$(printf '%s' "$sub_cfg" | jq -r '.use_default // empty')"
    prefix="$(printf '%s' "$sub_cfg" | jq -r '.sub_claim_prefix // empty')"
    info "GitHub sends subjects starting with: ${prefix:-repo:$GH_REPO}"
    [ "$use_default" = false ] && warn "this repo uses custom OIDC claim keys; the subjects below may not match. Check: gh api repos/$GH_REPO/actions/oidc/customization/sub"
  fi
else
  [ -n "$GH_OWNER_ID" ] && [ -n "$GH_REPO_ID" ] || die "GITHUB_OWNER_ID / GITHUB_REPO_ID missing in $CONF_REL and gh can't look them up (run gh auth login)"
  info "owner $GH_OWNER_ID, repository $GH_REPO_ID (from $CONF_REL; gh not available to re-check)"
fi
SUBJECT_NAME="repo:$GH_REPO:ref:refs/heads/main"
SUBJECT_ID="repo:$OWNER@$GH_OWNER_ID/$REPO_NAME@$GH_REPO_ID:ref:refs/heads/main"

# ---------------------------------------------------------------------------
# Identity and federated credentials
# ---------------------------------------------------------------------------
say "Identity $DEPLOY_IDENTITY"
ID_JSON=""
id_exists() { ID_JSON="$(az_ identity show --name "$DEPLOY_IDENTITY" --resource-group "$RG" -o json 2>/dev/null)" && [ -n "$ID_JSON" ]; }
id_create() { run az_ identity create --name "$DEPLOY_IDENTITY" --resource-group "$RG" --location "$LOC" -o none; }
ensure "identity $DEPLOY_IDENTITY" id_exists id_create
id_exists || true
CLIENT_ID="$(printf '%s' "${ID_JSON:-}" | jq -r '.clientId // empty' 2>/dev/null || true)"
PRINCIPAL="$(printf '%s' "${ID_JSON:-}" | jq -r '.principalId // empty' 2>/dev/null || true)"
[ -n "$PRINCIPAL" ] || PRINCIPAL="<principal id of $DEPLOY_IDENTITY>"

FED_JSON="[]"
fed_list() { FED_JSON="$(az_ identity federated-credential list --identity-name "$DEPLOY_IDENTITY" --resource-group "$RG" -o json 2>/dev/null || echo '[]')"; }
[ -n "$ID_JSON" ] && fed_list
for pair in "github-main|$SUBJECT_NAME" "github-main-ids|$SUBJECT_ID"; do
  cred="${pair%%|*}"; subject="${pair#*|}"
  fed_has() { fed_list; [ -n "$(printf '%s' "$FED_JSON" | jq -r --arg s "$subject" '.[] | select(.subject == $s) | .name')" ]; }
  fed_create() {
    run az_ identity federated-credential create --identity-name "$DEPLOY_IDENTITY" --name "$cred" --resource-group "$RG" \
      --issuer "$ISSUER" --subject "$subject" --audiences "$AUDIENCE" -o none
  }
  other="$(printf '%s' "$FED_JSON" | jq -r --arg n "$cred" --arg s "$subject" '.[] | select(.name == $n and .subject != $s) | .subject')"
  [ -z "$other" ] || die "federated credential '$cred' exists with another subject ($other). Delete it in the portal (identity $DEPLOY_IDENTITY > Federated credentials) and rerun."
  if [ -z "$ID_JSON" ]; then fed_create; else ensure "trust for $subject" fed_has fed_create; fi
done

# ---------------------------------------------------------------------------
# Shared role on the environment (same for every project; reuse, never change)
# ---------------------------------------------------------------------------
say "Shared role '$ENV_ROLE_NAME'"
ENV_ROLE_ID=""
role_find() {
  local j
  j="$(az_ role definition list --name "$ENV_ROLE_NAME" --custom-role-only true --scope "$ENV_ID" -o json 2>/dev/null || echo '[]')"
  [ "$(printf '%s' "$j" | jq 'length')" -gt 0 ] \
    || j="$(az_ role definition list --name "$ENV_ROLE_NAME" --custom-role-only true -o json 2>/dev/null || echo '[]')"
  ENV_ROLE_ID="$(printf '%s' "$j" | jq -r '.[0].id // empty')"
  ROLE_JSON="$(printf '%s' "$j" | jq -c '.[0] // {}')"
  [ -n "$ENV_ROLE_ID" ]
}
ROLE_FILE=""
role_create() {
  ROLE_FILE="$(mktemp "${TMPDIR:-/tmp}/envrole.XXXXXX")"
  cat > "$ROLE_FILE" <<JSON
{
  "Name": "$ENV_ROLE_NAME",
  "IsCustom": true,
  "Description": "Read the shared Container Apps environment and put apps in it (managedEnvironments/join). Nothing else.",
  "Actions": [
    "Microsoft.App/managedEnvironments/read",
    "Microsoft.App/managedEnvironments/join/action"
  ],
  "NotActions": [],
  "DataActions": [],
  "NotDataActions": [],
  "AssignableScopes": ["$ENV_ID"]
}
JSON
  run az_ role definition create --role-definition "@$ROLE_FILE" -o none
  local rc=$?
  rm -f "$ROLE_FILE"
  if [ "$rc" = 0 ] && [ "$DRY_RUN" = 0 ]; then
    # New role definitions take a moment to show up.
    local i
    for i in 1 2 3 4 5 6; do role_find && return 0; sleep 10; done
  fi
  return "$rc"
}
ensure "role definition" role_find role_create
role_find || true
if [ -n "$ENV_ROLE_ID" ]; then
  actions="$(printf '%s' "$ROLE_JSON" | jq -r '[.permissions[]?.actions[]?] | sort | join(" ")')"
  scopes="$(printf '%s' "$ROLE_JSON" | jq -r '.assignableScopes // [] | join(" ")')"
  [ "$actions" = "Microsoft.App/managedEnvironments/join/action Microsoft.App/managedEnvironments/read" ] \
    || warn "the shared role's actions are '$actions' (expected read + join/action). Not changing it: other projects use it."
  case " $(printf '%s' "$scopes" | tr 'A-Z' 'a-z') " in
    *" $(printf '%s' "$ENV_ID" | tr 'A-Z' 'a-z') "*) ;;
    *) die "the shared role can't be assigned on $ENV_ID (its scopes: $scopes). Ask whoever created it." ;;
  esac
  ROLE_REF="$ENV_ROLE_ID"
else
  ROLE_REF="$ENV_ROLE_NAME"
fi

# ---------------------------------------------------------------------------
# Role assignments for the deploy identity (nothing on the shared group or
# the subscription)
# ---------------------------------------------------------------------------
say "Roles for $DEPLOY_IDENTITY"
grant Contributor "$RG_ID" "$PRINCIPAL" "Contributor on group $RG"
grant AcrPush "$ACR_ID" "$PRINCIPAL" "AcrPush on registry $ACR"
grant "$ROLE_REF" "$ENV_ID" "$PRINCIPAL" "environment join on $ENV_NAME (only)"

# ---------------------------------------------------------------------------
# Record and publish
# ---------------------------------------------------------------------------
say "Results"
[ -n "$CLIENT_ID" ] && conf_set AZURE_CLIENT_ID "$CLIENT_ID"
conf_set AZURE_TENANT_ID "$TENANT"
[ -n "$(conf_get BACKEND_URL)" ] || [ "$DRY_RUN" = 1 ] || warn "BACKEND_URL is empty in $CONF_REL; run bash deploy/azure.sh again"
if [ "$DRY_RUN" = 1 ]; then
  say "Dry run finished: nothing was changed."
else
  say "Done. Pushing the config file starts the first deploy (GitHub Actions > Deploy to Azure)."
  print_publish_line "Azure: deploy identity for GitHub Actions"
fi
