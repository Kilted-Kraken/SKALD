# SKALD Metadata Worker

Cloudflare Worker scaffold for centralized SKALD metadata and art enrichment.

## Purpose

This Worker keeps provider credentials off the client for a broadly distributed,
non-commercial SKALD launcher.

Current provider targets:

- IGDB for canonical game metadata
- SteamGridDB for icon/logo art

The launcher stores the final metadata and downloaded images locally after the
first enrichment, so the Worker is an enrichment service rather than a hard
runtime dependency for ordinary browsing.

## Endpoints

- `GET /health`
- `POST /metadata/game`
- `POST /metadata/search`
- `POST /art/search`

## Expected launcher flow

1. SKALD scans/imports a game locally.
2. `library-enrich-game` in the Electron main process calls this Worker first.
3. The Worker returns normalized metadata and remote art URLs.
4. SKALD downloads those images into its permanent local art cache.
5. SKALD saves the normalized metadata and local image paths into its library DB.

## Secrets

Set these with Wrangler secrets before production deployment:

- `IGDB_CLIENT_ID`
- `IGDB_CLIENT_SECRET`
- `STEAMGRIDDB_API_KEY`

Optional:

- `SKALD_API_KEY`

If `SKALD_API_KEY` is set, the launcher should send:

`Authorization: Bearer <token>`

## Local dev

```bash
npm install
npm run dev
```

## Deploy Checklist

1. Install dependencies for the Worker:

```bash
cd services/metadata-worker
npm install
```

2. Log into Cloudflare with Wrangler:

```bash
npx wrangler login
```

3. Set production secrets:

```bash
npx wrangler secret put IGDB_CLIENT_ID
npx wrangler secret put IGDB_CLIENT_SECRET
npx wrangler secret put STEAMGRIDDB_API_KEY
```

Optional:

```bash
npx wrangler secret put SKALD_API_KEY
```

4. Deploy the Worker:

```bash
npm run deploy
```

5. Copy the deployed Worker base URL.

Expected example shape:

```text
https://skald-metadata-worker.<your-subdomain>.workers.dev
```

6. In SKALD Blades, open:

```text
System -> Emulators
```

Then set:

- `Use Cloud Metadata Service` = `On`
- `Metadata Service URL` = your deployed Worker URL
- `Metadata Service API Key` = the same `SKALD_API_KEY` value, if you configured one

7. Select:

```text
Save Metadata Service Settings
```

8. Select:

```text
Test Metadata Service
```

Healthy result should report:

- metadata service reachable
- `IGDB ready`
- `SteamGridDB ready` if that secret was provided

9. After that, test SKALD in:

- `Games -> My Games`
- `Marketplace -> Archive.org`
- `Marketplace -> Retro Game Sets`

Those flows should begin pulling preview/enrichment metadata from the Worker first.

## Production note

This is now a first usable scaffold with:

- IGDB access-token reuse inside the Worker
- lightweight response caching for repeated metadata/art lookups
- normalized response shape that matches the current Electron launcher contract

Good next upgrades:

- KV/D1 cache for longer-lived normalized results
- request throttling
- stronger platform matching
- optional screenshots/background selection policy
