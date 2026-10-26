# Architecture and service boundary

## Frontend

Next.js exports three static routes. Browser-only effects import PlayCanvas lazily; the renderer is not initialized during static generation. React owns panels and user actions. `BenchmarkRunner` owns timing, phases and raw samples without importing React. `RendererAdapter` defines the portable TypeScript boundary; Rust owns batched statistics and mathematics, never DOM/WebGPU operations.

The UI keeps the live viewport mounted across category changes. The context is disposed on scene/API/render-scale changes or navigation away. Static CSS tokens drive both themes; Tailwind v4 is configured through PostCSS. Charts use SVG and native controls rather than an animation-heavy charting package.

Local session records include raw frame samples and remain in localStorage, at most 20 sessions. Export provides a full JSON record. Local custom filenames are retained in reports, local storage and JSON exports. Community submission payloads anonymize them to `Local scene`. Input URLs and local-file contents never enter the submission payload.

## Worker + D1

The [Cloudflare static asset routing model](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/) serves the static Next.js export and runs the Worker first for `/api/*`. No Next server, paid adapter service or remote storage is needed for local development.

`GET /api/results` returns `{ results, total, configurations, renderers, scope }`. Records are the latest 200 matches by server receipt timestamp. Supported filters: `renderer`, `api`, `browser`, `gpu` (substring), `scene`, `source`, `format`, `days` (7/30/90). All queries constrain methodology v1, all values are bound parameters, and schema indexes support methodology/time and scene filters. Counts cover all matching rows; charts cover the returned 200.

`POST /api/results` accepts a compact strict JSON schema. No raw frames, arbitrary extra fields, files or account identifiers are accepted. A 32 KiB streaming cap applies even when Content-Length is absent. Reference hash/count/bytes, repeat counts, timing consistency, percentile ordering and numeric bounds are checked. Responses: 201 new record, 200 duplicate ID, 400 invalid record/filter, 403 foreign Origin, 413 oversized body, 415 unsupported content type, 429 rate limit, 503 unconfigured/unavailable service. Insert is idempotent by client UUID.

A D1 atomic UPSERT limits submissions to 10 per UTC hour per hashed IP key. The hash includes a secret salt and the hour. Raw IP addresses are not stored in D1. Rate keys expire at the next hour and are pruned on subsequent submissions. Production requires `RATE_LIMIT_SALT`; localhost uses a nonsecret local-only value. CORS permits same-origin requests and the explicit local frontend on port 3005 when the Worker itself is local. CORS is not bot protection.

The service does not claim attestation. It needs deployment-level rate limiting/Turnstile and a data retention policy before a public launch. Read queries are public, aggregate counts can grow expensive at large scale, and this first slice has no user accounts, deletion workflow, signed receipts, or moderation. Wrangler request logs may contain technical request metadata; application records do not contain raw IPs. Production observability is disabled in the checked-in configuration.

## Deployment preparation

No deployment was performed. With approval and Cloudflare credentials:

1. Create a D1 database and replace the placeholder ID in `wrangler.jsonc`.
2. Set a random `RATE_LIMIT_SALT` using `wrangler secret put RATE_LIMIT_SALT` (never commit its value).
3. Apply the migration with `wrangler d1 migrations apply gaussmark --remote`.
4. Build with `npm ci` and `npm run build`. Keep `NEXT_PUBLIC_API_URL` unset for same-origin serving.
5. Review current Cloudflare quotas, abuse controls and privacy/retention policy before running `wrangler deploy`.

Static assets plus a small Worker/D1 database are intended to fit a small free-tier deployment; this is configuration preparation, not a quota guarantee or provisioning instruction executed by this build.

## Shared navigation and A/B retention

`src/renderers/controls.ts` owns orbit/fly input and canonical benchmark camera transforms for both adapters. `src/renderers/websplatter.ts` owns a dedicated WebGPU device and a cancellable PLY parsing worker, using pinned, locally bundled MIT sources in `vendor/websplatter`. Build adaptations and renderer defaults are documented there.

`gaussmark.comparison.v1` stores two explicitly selected full results independently of `gaussmark.sessions.v1`. Saving A or B replaces only that slot and raises a local event to refresh the comparison. Local PLY/SOG uploads get a SHA-256 content identity, retained locally for matching and omitted from community submissions. Actual files are not persisted; original filenames are retained in local results. Reusing A copies protocol, object rotation and exact target dimensions; switching renderer retains the in-memory Blob URL.
