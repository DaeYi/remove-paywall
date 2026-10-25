# remove-paywall

A personal "paste a URL, read the article" tool, along the lines of [unwall.app](https://unwall.app/).
Static frontend on **GitHub Pages** + a small **Cloudflare Worker** that does the server-side
fetch and text extraction. Private to you via an access token.

## How it works

```
Phone / Desktop  →  GitHub Pages (site/)  →  Cloudflare Worker (worker/)  →  the article
                      static reader UI        fetch + extract + fallback
```

The Worker fetches the article server-side with crawler-style headers, extracts the readable text
with Mozilla Readability (falling back to JSON-LD / embedded JSON), and returns clean HTML. When a
site can't be extracted, it returns archive links (Wayback + archive.today) instead.

## What it can and can't do

- **Extracts well:** soft / client-side and many metered paywalls, where the full text is in the
  page HTML or its JSON. Also ad/overlay-free reader view for any readable article.
- **Falls back to archives:** hard server-side paywalls (NYT, WSJ, FT, Bloomberg, Economist…) and
  pages that load their body with JavaScript — a no-browser fetch can't get those, so the app
  offers an archived copy instead of pretending.

It deliberately does **not** rotate residential IPs or impersonate TLS fingerprints to defeat
publisher bot-detection. That's an arms race, not a reader. Keep it personal and private.

## Repo layout

```
site/     static frontend (deployed to GitHub Pages)
worker/   Cloudflare Worker backend (fetch + extract + archive fallback)
worker/rules.json   per-site rules (header profile, cookies, archive-first) — the maintenance surface
.github/workflows/pages.yml   publishes site/ to Pages
```

## Deploy

### 1. Worker (backend)

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
# set your private access token (any long random string, e.g. `openssl rand -hex 24`):
npx wrangler secret put UNWALL_TOKEN
```

Note the deployed URL, e.g. `https://remove-paywall.<your-subdomain>.workers.dev`.

Optional hardening — once you know your Pages origin, lock the Worker to it. In `worker/wrangler.toml`:

```toml
[vars]
ALLOWED_ORIGINS = "https://<you>.github.io"
```

then `npx wrangler deploy` again.

### 2. Frontend (GitHub Pages)

1. Push this repo to GitHub (`main`).
2. Repo **Settings → Pages → Source → GitHub Actions**. The included workflow publishes `site/`.
   (A public Pages site from a private repo is allowed on GitHub Free.)
3. Your site appears at `https://<you>.github.io/remove-paywall/`.

### 3. Connect them

Open the site, press **⚙ Settings**, and paste your Worker URL and token. They're stored in your
browser's `localStorage` (the frontend holds no secrets). Done — paste an article URL and read.

## Use it from your phone

- Open the Pages URL and **Add to Home Screen** — it installs as an app (PWA).
- **Android:** the app registers as a share target, so you can **Share → Remove Paywall** from any
  browser/app.
- **iOS:** use the bookmarklet shown in Settings, or an iOS Shortcut that opens
  `https://<you>.github.io/remove-paywall/?url=<the page URL>`.

## Adding / tuning sites

Edit `worker/rules.json` and redeploy the Worker. Each site is matched by hostname suffix
(longest match wins):

```jsonc
"sites": {
  "wired.com":     { "profile": "googlebot" },
  "example.com":   { "profile": "mobile", "cookie": "consent=1", "removeSelectors": ["#paywall"] },
  "bloomberg.com": { "archiveFirst": true }   // skip extraction, go straight to archives
}
```

Profiles (`googlebot`, `bingbot`, `facebook`, `mobile`, `browser`) are defined at the top of the
same file. `default` applies to any site without its own rule.

## Local development

```bash
cd worker
echo "UNWALL_TOKEN=dev-local-token-123" > .dev.vars
npx wrangler dev                 # Worker at http://127.0.0.1:8787

# in another shell, serve the frontend:
cd ../site && python3 -m http.server 5500
# then open: http://127.0.0.1:5500/index.html?worker=http://127.0.0.1:8787&token=dev-local-token-123
```

The `?worker=` and `?token=` query params are a one-time setup convenience — the app saves them to
`localStorage` and strips them from the address bar.
