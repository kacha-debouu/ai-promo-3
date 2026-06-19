# Deploy — Cloudflare Pages (Git-connected, password-protected)

The gallery is served by **Cloudflare Pages built straight from this GitHub
repo**. No files are uploaded by hand — every `git push` to `main` triggers a
build (~1 min). The whole site sits behind a shared password enforced by
[`functions/_middleware.js`](functions/_middleware.js) (HTTP Basic Auth,
fail-closed until the secret is set).

- **Login:** `widelab`
- **Password:** set as the `SITE_PASSWORD` Cloudflare secret (never committed).

## How it's wired

- **Pages project:** source = GitHub `kacha-debouu/ai-promo-3`, production branch
  `main`. Static site — no build command, output dir = repo root.
- **Auth:** `functions/_middleware.js` runs on every request and checks Basic Auth
  against `SITE_PASSWORD` (secret) with username `SITE_USER` (defaults to `widelab`).
- **Secret:** `SITE_PASSWORD` is set on both Production and Preview, so preview
  deployments are gated too.

## Changing the password

Dashboard: project → **Settings → Variables and Secrets** → edit `SITE_PASSWORD`,
then redeploy. Or via CLI:

```bash
npx wrangler pages secret put SITE_PASSWORD --project-name <project>
# then trigger a redeploy (any push to main, or an empty commit)
```

## Re-creating from scratch

```bash
. ~/.widelab/deploy.env   # shared Widelab Cloudflare creds

# 1. create the Git-connected project
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"ai-promo-3","production_branch":"main","source":{"type":"github","config":{"owner":"kacha-debouu","repo_name":"ai-promo-3","production_branch":"main","deployments_enabled":true}},"build_config":{"build_command":"","destination_dir":""}}'

# 2. set the password secret (prod + preview)
curl -s -X PATCH "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/ai-promo-3" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"deployment_configs":{"production":{"env_vars":{"SITE_PASSWORD":{"type":"secret_text","value":"YOUR_PASSWORD"}}},"preview":{"env_vars":{"SITE_PASSWORD":{"type":"secret_text","value":"YOUR_PASSWORD"}}}}}'

# 3. trigger a deploy
git commit --allow-empty -m "Trigger deploy" && git push origin main
```
