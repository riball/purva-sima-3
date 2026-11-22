# Shared container registry

All projects in this Azure subscription keep their app images in **one** container
registry instead of one each. A Basic registry costs about US$5 a month just for
existing, so one shared registry instead of eight saves about US$35 a month.

| What | Name |
|---|---|
| Registry (Basic) | `purvashared82aaf9d4` → `purvashared82aaf9d4.azurecr.io` |
| Its resource group | `purva-shared` (holds only the registry) |
| This project's images | repository `<APP_NAME>` inside it, e.g. `purvashared82aaf9d4.azurecr.io/<APP_NAME>:<commit>-<attempt>` |

The names are in `deploy/azure-deploy.conf` (`SHARED_ACR_NAME`, `SHARED_ACR_RESOURCE_GROUP`).
`ACR_NAME` in that file says which registry this project uses right now: its own old
one (`<app without dashes>82aaf9d4`) or the shared one.

## Who can do what

The registry uses **per-repository permissions** (Azure ABAC). Each project can reach
only its own repository:

| Identity | Role on the shared registry | Limited to |
|---|---|---|
| the container app's own identity | Container Registry Repository Reader (pull) | repository `<APP_NAME>` |
| the deploy identity `<APP_NAME>-github` | Container Registry Repository Writer (push) | repository `<APP_NAME>` |
| the deploy identity `<APP_NAME>-github` | Reader (lets `az acr login` find the registry; gives no image access in this mode) | the registry resource |

In this mode the old roles AcrPull and AcrPush do nothing. Nobody gets delete rights.

## What changes and what doesn't

- **Users of the app:** nothing. Same address and settings. The switch is one ordinary
  deploy (a new revision), so like every deploy it restarts the app: anything the app
  keeps only on the container's disk or in memory is lost at that moment (see "Things to
  know" in deploy/AZURE.md). Pick a quiet time.
- **Developers:** nothing. Pushing to the deploy branch still builds and deploys.
- **The one risk:** every project now depends on this registry. If it's broken or
  deleted, running apps keep running, but no app can deploy, restart, scale out or wake
  from sleep until it's fixed. **Never delete `purvashared82aaf9d4` or the
  `purva-shared` group.**
- **Storage:** Basic includes 10 GB for all projects together. Old image versions pile
  up; delete old ones now and then (portal → registry → Repositories → `<APP_NAME>`).
- **Removing this project later:** `az group delete -n <APP_NAME>` no longer removes its
  images. Also delete its repository:
  `az acr repository delete --name purvashared82aaf9d4 --repository <APP_NAME> --yes`
  (needs Owner, or a Repository Contributor role).

## Moving this project (Azure Cloud Shell)

Needs the same Azure role as the original setup: **Owner** (or Contributor plus User
Access Administrator) on the subscription, because it grants roles. Keep the Cloud Shell
tab open until done.

1. Get the latest files, in this project's folder (the folder has the GitHub repo's
   name). Use the branch that deploys (`DEPLOY_BRANCH` in `deploy/azure-deploy.conf`
   if it has that line, otherwise `main`):

   ```bash
   git checkout main && git pull
   ```

2. **Once for all projects** (skip if someone already did it; running it again changes
   nothing):

   ```bash
   DRY_RUN=1 bash deploy/shared-registry-setup.sh
   ```

   ```bash
   bash deploy/shared-registry-setup.sh
   ```

3. Move this project:

   ```bash
   DRY_RUN=1 bash deploy/use-shared-registry.sh
   ```

   ```bash
   bash deploy/use-shared-registry.sh
   ```

   It gives the app and the deploy identity access to repository `<APP_NAME>`, connects
   the registry to the app (the old one stays connected, so nothing breaks), writes
   `ACR_NAME=purvashared82aaf9d4` into `deploy/azure-deploy.conf` and prints one
   `git add … && git commit … && git push` line. Run that line: the push builds the
   image again and deploys it from the shared registry.

   New roles can take a few minutes to work. If the deploy fails with "unauthorized" or
   401, wait five minutes and rerun it (GitHub → Actions → the failed run → Re-run
   jobs). The app keeps running the old version meanwhile.

4. Watch the deploy (`gh run watch`), then open the app. For an app that sleeps
   (`MIN_REPLICAS=0`), wait until it has slept and woken up once, to be sure it can pull
   from the new registry.

5. **After 2–3 days** of it working, run the script again:

   ```bash
   bash deploy/use-shared-registry.sh
   ```

   It prints two commands that disconnect and then delete the old registry. They
   delete its images (no undo), so run them only after step 4 worked. Order matters:
   an app whose old registry is deleted while it still runs an image from it can't
   restart or wake up.

## If per-repository permissions don't work

If the setup script says Azure refused per-repository permissions, or apps can't pull
even after waiting, the fallback is a registry without them: every project's deploy
identity can then push to every repository. Tell whoever maintains these scripts before
switching; it needs `SHARED_ACR_MODE=rbac` in the config file and a new registry.
