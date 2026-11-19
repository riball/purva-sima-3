# Deploying Sima to Azure

Sima runs on Azure Container Apps as **one container**: the FastAPI server, which also serves the
React web app from the same address (API under `/api`, health check at `/api/health`). After setup,
**every push to `main` deploys automatically** through GitHub Actions (`.github/workflows/azure.yml`).

You run everything below in **Azure Cloud Shell (Bash)**: portal.azure.com, then the `>_` icon at
the top. Cloud Shell already has `az`, `git`, `gh` and `jq`. You don't need Docker: GitHub builds the
image.

Every name comes from `deploy/azure-deploy.conf`. The app name is **`sima`**.

| What | Name |
|---|---|
| Resource group (only this project) | `sima` |
| Container registry (Basic) | `sima82aaf9d4` |
| Container app | `sima`, inside the shared environment `purva-bot-env` |
| Deploy identity for GitHub | `sima-github` (in `sima`) |
| Website | none separate: the web app is inside the container |

## Steps (in order)

### 1. Get the code

```bash
gh auth login
```

Choose GitHub.com, HTTPS, and "Login with a web browser". Then:

```bash
gh repo clone riball/purva-sima-3
```

```bash
cd purva-sima-3
```

If you run several projects in Cloud Shell, keep each one in its own folder, and always `cd` into the
right one first. The scripts only read this folder's `deploy/azure-deploy.conf` and `.env.azure`, so
settings left over from another project (an exported `APP_NAME`, another `.env.azure`) can't leak in.

### 2. Copy the settings from Render

```bash
bash deploy/render-env.sh
```

It asks for a Render API key (Render dashboard → Account settings → API keys). Typing is hidden. It
writes `.env.azure` with every name ending in `_sima`, and lists what it left out (PORT,
Render-only settings, empty values). Render "environment groups" and "secret files" are not copied.
If you use them, add those settings by hand.

If it says the service isn't found, it lists the services the key can see. Run it again with the
right name: `bash deploy/render-env.sh <name>`.

**Not on Render?** Create the file by hand instead (one `KEY_sima=value` per line, see the
table below), then run `chmod 600 .env.azure`.

Now check the file:

```bash
nano .env.azure
```

(Ctrl+O, Enter to save, Ctrl+X to quit.) It needs at least `DATABASE_URL_sima` (otherwise
everything users enter is kept only on the container's disk and lost on every deploy) and
`GROQ_API_KEY_sima`. **Never commit this file.** Git already ignores it.

### 3. Create the Azure resources

```bash
bash deploy/azure.sh
```

This takes a few minutes. Rerunning it is always safe: it only changes what differs. If Azure answers
**InternalServerError**, just run it again. Azure sometimes reports that error even when the step
worked, and the script checks before it retries.

To only see what it would do, run `DRY_RUN=1 bash deploy/azure.sh` (secret values are masked).

At first the app shows a placeholder page (nginx). The first GitHub deploy replaces it.

### 4. Let GitHub deploy

```bash
bash deploy/github-setup.sh
```

### 5. Publish the config file (this starts the first deploy)

Both scripts write non-secret values (registry name, app address, IDs) into
`deploy/azure-deploy.conf`. At the end they print one line like this. Run it:

```bash
git add deploy/azure-deploy.conf && git commit -m "Azure: deploy identity for GitHub Actions" && git push
```

If git asks for a password, run `gh auth setup-git` once, then repeat the line.

### 6. Watch the deploy

```bash
gh run watch
```

Or open the repository's **Actions** tab → "Deploy to Azure". It builds the image (about 5 minutes),
rolls it out, and waits until the new version answers on `/api/health`. The address is the
`BACKEND_URL` line in `deploy/azure-deploy.conf`. It looks like
`https://sima.<something>.centralindia.azurecontainerapps.io`.

Until steps 3–5 are done, the workflow finishes with a notice "Azure isn't set up yet" and does
nothing. That is expected.

## What is shared with other projects, and why nothing clashes

- **Shared:** the Container Apps environment `purva-bot-env` (resource group `purva-bot`). The free
  trial allows only one environment in the whole subscription. Every project's app runs in it.
  - This app's logs go to that environment's log workspace (in `purva-bot`).
  - **If that environment is deleted, this app is deleted with it.**
  - The scripts only read it. They never create, change or delete it, or anything else in `purva-bot`.
- **Shared:** one custom role, "Container Apps environment join (purva-bot-env)". It only allows
  reading the environment and placing apps in it, and it can only be assigned on that environment.
  Azure checks it every time an app in the environment is updated. The script reuses it if it exists.
- **Everything else is this project's own:** resource group, registry, app, identity and secrets.
  The deploy identity can change only group `sima`, push to its own registry, and join the
  environment. Nothing on `purva-bot`, nothing on the subscription.

Settings can't clash because each one carries the project name:

| In `.env.azure` | Secret in the Azure portal (app → Secrets) | Env var the code reads |
|---|---|---|
| `DATABASE_URL_sima` (Supabase **Session pooler** URI) | `database-url-sima` | `DATABASE_URL` |
| `GROQ_API_KEY_sima` | `groq-api-key-sima` | `GROQ_API_KEY` |
| `GROQ_MODEL_sima` (optional, default `openai/gpt-oss-120b`) | `groq-model-sima` | `GROQ_MODEL` |
| `LLM_PROVIDER_sima` (optional, default `groq`) | `llm-provider-sima` | `LLM_PROVIDER` |
| `CORS_ORIGINS_sima` (optional, not needed: web app and API share one address) | `cors-origins-sima` | `CORS_ORIGINS` |
| (none) | (none) | `PORT=8080`, always set by the script |

`azure.sh` refuses any line in `.env.azure` that doesn't end in `_sima`, which catches a file
copied from another project. It also refuses two names that would become the same secret.

## Switching users over to the new address

Render keeps running untouched until you decide to switch. Until then, both addresses work against
the same Supabase database (as long as both use the same `DATABASE_URL`).

When you switch:

1. Tell users the new address (`BACKEND_URL` in `deploy/azure-deploy.conf`). Bookmarks to the old
   address keep working while Render runs.
2. Sima has no sign-in, sends no emails and prints no QR codes, so there are no Supabase Auth URLs or
   links to update.
3. No CORS setting is needed: the web app and the API share one address.
4. **Don't let both run upload jobs at the same time for long.** Each server runs its own background
   jobs; that is fine, but once users have moved, switch Render off (or scale it down) in the Render
   dashboard.

## Changing a setting later

- **Quick:** Azure portal → container app `sima` → Security → Secrets → edit the value. Then go
  to Revisions and replicas → restart the active revision so the app reads the new value.
- **Or:** edit `.env.azure` in Cloud Shell and run `bash deploy/azure.sh` again. It updates only what
  changed, starts a new revision, and removes secrets you deleted from the file.
- **Size or replicas:** edit `CPU`, `MEMORY`, `MIN_REPLICAS` or `MAX_REPLICAS` in
  `deploy/azure-deploy.conf`, run `bash deploy/azure.sh`, then commit and push the file.

Code changes need nothing: push to `main` and GitHub deploys them. Deploys never change settings.

## Removing Sima from Azure

```bash
az group delete --name sima --subscription 82aaf9d4-d161-4dab-8ecf-dff34de35353
```

This removes the app, registry and identity. **Never delete `purva-bot-env`, the `purva-bot` group,
or the "Container Apps environment join (purva-bot-env)" role: other projects use them.**

## Things to know

- **Set `DATABASE_URL`.** Without it, projects, bills and job results are written to the container's
  disk and are lost whenever the app restarts or a new version deploys.
- **The shared material-category list** (`canonical_material_categories.json`) is always a file on
  the container's disk, even with a database. A new category registered while confirming an
  onboarding job is lost on the next deploy or restart (the built-in categories always come back).
- Uploads are calculated in background jobs inside the server. A deploy or restart in the middle of
  one leaves that job stuck at "running"; delete it from Recent Uploads and upload again.
- Size 0.5 vCPU / 1 GiB, always on (`MIN_REPLICAS=1`), one replica (`MAX_REPLICAS=1`), because of
  those in-process jobs. A real BOQ takes a few minutes to calculate at this size.
- The app has no sign-in: anyone with the address can see and change all data (same as on Render).
