# Art Studio — Professionalization Plan

A working TODO list for turning `tools/art-studio` from a single-user local tool
into a self-hostable, multi-tenant SaaS for game artists.

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done, `[-]` dropped.

---

## Where the code stands today

**Size:** ~8,300 lines of TS/TSX. No tests, no linter, no CI, no runtime deps
beyond Next 15 / React 19 / zustand / pngjs.

**The good news.** The layering is already close to right, and one decision in
particular pays off enormously here: `src/core/` is pure, isomorphic,
dependency-free image code (`pipeline`, `cutout`, `palette`, `resample`, `mask`,
`oklab`, `edits`, `orientation`, `size`). It already runs unchanged in three
places — the browser worker, the server approve path, and the server template
path. That means the highest-risk, hardest-to-get-right part of the product is
*already* unit-testable with zero refactoring. Most projects at this stage don't
have that.

`src/server/` is a thin filesystem layer, `src/client/` is a zustand store plus
components, `app/api/` is 14 small route handlers. The seams are in sensible
places.

**The constraints that block SaaS**, in rough order of how much they cost to fix:

| Area | Current state | Why it blocks |
| --- | --- | --- |
| Repo coupling | `server/paths.ts` walks up looking for `project.godot` and throws if absent; writes `.gdignore` markers | The app literally cannot boot outside this Godot repo |
| Persistence | One `art/library/index.json` array for all assets; whole file read-modify-written per edit | No concurrency, no per-user scoping, no queries |
| Mutual exclusion | `library.ts` `serialize()` is a module-level promise chain | Only holds within one Node process; Next can and will run several |
| Job queue | `server/queue.ts` in-memory `Map` + module globals, JSON files on disk | Jobs die on restart (marked "interrupted"); no retries, no idempotency, single-instance only |
| Credentials | `server/env.ts` reads one `.env` at repo root, returns one process-global key | No per-user keys, and no way to attribute or cap spend |
| Providers | `server/openai.ts` hardcodes OpenAI URLs, `b64_json`, `usage.input_tokens`; model capabilities are scattered across `BACKGROUND_CAPABLE_MODELS`, `core/size.ts`, and `MODELS` in `shared/model.ts` | Adding a second provider means touching all of it |
| Auth | None, anywhere | Every route is world-open |
| Validation | Routes do `await request.json() as GenerateBody` — a cast, not a parse | Malformed or hostile input reaches the filesystem and the paid API |
| Client state | `client/store.ts` is 933 lines mixing server cache, document state, UI state, and debounce timers held in module globals | Undo/redo has nothing clean to attach to |

**Two real bugs found during review** (independent of any SaaS work):

- `server/template.ts` writes every template job's base and mask to the *fixed*
  paths `_edit_base.png` and `_edit_mask.png`. With `concurrency: 4`, two
  template jobs running at once will overwrite each other's inputs, and you'll
  get a generation against the wrong base image. Randomize these per job.
- `client/store.ts` `persistComposition` debounces a full-document PUT with no
  version check. Two browser tabs on the same composition silently clobber each
  other, last write wins.

---

## Phase 0 — Extract and build a floor

Do this first. Everything downstream is easier once there's a test runner and CI.

- [ ] **P0-1** Move to its own repo. `git subtree split` or
      `git filter-repo --subdirectory-filter tools/art-studio` to keep history.
      Pick a product name; `art-studio` is fine but generic.
- [ ] **P0-2** Decide licensing up front. Open-core (self-host free, hosted paid)
      vs closed. This decision constrains the whole architecture, so make it now.
      See Open Questions.
- [ ] **P0-3** Add Vitest. `core/` needs no DOM; `server/` needs a temp-dir
      fixture; store logic needs `happy-dom` at most. No Playwright, no browser.
- [ ] **P0-4** Add ESLint (`next/core-web-vitals` + `@typescript-eslint`) and
      Prettier. Enforce `no-explicit-any` and ban the `as SomeBody` cast pattern
      in route handlers.
- [ ] **P0-5** GitHub Actions: typecheck, lint, test on PR. Required to merge.
- [ ] **P0-6** Golden-image tests for `core/pipeline.ts`. Check in a handful of
      small source PNGs and their expected outputs; assert on a hash of the RGBA
      buffer. This is the single highest-value test suite in the project — it
      pins the behavior users actually care about, runs in milliseconds, and
      catches the class of bug that's otherwise invisible until someone
      eyeballs a sprite.
- [ ] **P0-7** Unit tests for the pure helpers with real edge cases:
      `size.ts` snapping, `oklab.ts` round-trips, `palette.ts` parsing of each
      supported format (`.hex/.txt/.gpl/.pal/.png`), `cutout.ts` flood fill on
      fully-transparent and fully-opaque inputs, `settings.ts` `withDefaults`
      against every historical shape you've persisted.
- [ ] **P0-8** Fix the `_edit_base.png` / `_edit_mask.png` race (see above).
- [ ] **P0-9** `CONTRIBUTING.md` + `README.md` with a real local setup path.

## Phase 1 — Cut the Godot cord

- [ ] **P1-1** Replace `repoRoot()` with explicit configuration:
      `ART_STUDIO_DATA_DIR` env var, defaulting to `~/.art-studio`. Delete the
      `project.godot` walk and the `.gdignore` writing.
- [ ] **P1-2** Introduce a `Storage` interface (`put`, `get`, `delete`, `list`,
      `signedUrl`) with a `LocalFsStorage` driver. All of `server/` goes through
      it — no direct `fs` calls outside the driver.
- [ ] **P1-3** Make export a pluggable **export target** rather than a hardcoded
      `art/approved/props` write. Targets: plain PNG download, ZIP of a folder,
      Godot (PNG + `.import` + the JSON sidecar `api/approve` already writes),
      Aseprite, Unity. Godot becomes one target among several.
- [ ] **P1-4** Generalize `api/import` — it currently scans the Godot art folders
      for legacy sidecars. Becomes "import a ZIP / drop a folder".
- [ ] **P1-5** Optional, later: a small Godot editor plugin that pulls approved
      assets from the hosted API. Turns the coupling into a feature.

## Phase 2 — Real data layer

- [ ] **P2-1** Postgres. Self-hosted, no managed-service dependency. Drizzle or
      Prisma — pick one and don't relitigate.
- [ ] **P2-2** Schema: `users`, `orgs`, `memberships`, `projects`, `assets`,
      `compositions`, `jobs`, `templates`, `palettes`, `api_keys`,
      `usage_events`, `audit_log`. Every user-owned row carries `org_id`.
- [ ] **P2-3** Add a `schemaVersion` to every persisted JSON blob
      (`ProcessingSettings`, `Composition`, `AssetRecord`). `withDefaults()` is
      already doing informal migration by accretion; make it explicit and
      versioned before the shapes multiply further.
- [ ] **P2-4** Migration runner in CI and on deploy.
- [ ] **P2-5** Soft-delete (`deleted_at`) on assets, compositions, and templates.
      Required for both undo and "I deleted my library" support tickets.
- [ ] **P2-6** Optimistic concurrency: `version` column, `If-Match` on writes,
      409 on conflict. Fixes the two-tab clobber.
- [ ] **P2-7** Split `StudioSettings`, which currently conflates three things:
      per-user preferences (prompt prefix/suffix, slug), per-composition state
      (`activeCompositionId`), and server config (`concurrency`). In a
      multi-user world one user's generate call would otherwise rewrite
      everyone's defaults — `api/generate` does exactly that today.
- [ ] **P2-8** Backups: nightly `pg_dump`, tested restore, documented RPO/RTO.

## Phase 3 — Multi-provider generation

- [ ] **P3-1** Define an `ImageProvider` interface: `generate(prompt, params)`,
      `edit(prompt, params, base, mask)`, `capabilities()`, `models()`.
- [ ] **P3-2** Move model capabilities into data. Today they're spread across
      `MODELS` in `shared/model.ts`, `BACKGROUND_CAPABLE_MODELS` in
      `server/openai.ts`, and the snapping tables in `core/size.ts`. One
      registry: supported sizes, transparent-background support, mask/edit
      support, cost per image, max `n`.
- [ ] **P3-3** Refactor `server/openai.ts` behind the interface. It's already
      close; the work is separating OpenAI's wire format from the internal one.
- [ ] **P3-4** OpenRouter provider. Note it doesn't cover every image model, and
      its edit/mask support is thinner than OpenAI's — the UI needs to gray out
      capabilities per provider rather than assume the OpenAI feature set.
- [ ] **P3-5** Consider Replicate and fal.ai too. Both matter for pixel-art and
      SDXL/Flux LoRA workflows, which is likely what game artists actually want.
- [ ] **P3-6** Provider contract tests against recorded HTTP fixtures. No live
      API calls in CI — every test run would cost money.
- [ ] **P3-7** Normalize errors across providers (rate limit, content policy,
      auth, transient) so retry logic and UI messaging aren't per-provider.
- [ ] **P3-8** Normalize usage/cost reporting. `parseUsage` currently assumes
      OpenAI's `input_tokens`/`output_tokens` shape.

## Phase 4 — Multi-tenancy, auth, BYOK

- [ ] **P4-1** Auth.js (NextAuth) with the Postgres adapter — self-hostable,
      unlike Clerk/WorkOS. Email magic link + GitHub and Google OAuth.
- [ ] **P4-2** Orgs and projects. Even solo users get a personal org; retrofitting
      teams later is far more painful than carrying the column from day one.
- [ ] **P4-3** Every route resolves the session, derives `org_id`, and scopes
      every query. Enforce at the data layer, not per handler — a route that
      forgets is a cross-tenant leak.
- [ ] **P4-4** Route-level authorization tests. Cheap, and they're the thing that
      keeps you out of the news.
- [ ] **P4-5** BYOK: users store provider keys, encrypted at rest with
      AES-256-GCM under a KMS-held or env-held master key. Never returned to the
      client — only a masked suffix and a validity indicator, replacing today's
      `hasApiKey` boolean.
- [ ] **P4-6** Validate a key on save with a cheap provider call; store the
      result and surface it in the UI.
- [ ] **P4-7** Decide managed-key policy: BYOK-only is dramatically simpler
      (no billing, no fraud, no abuse liability for spend). Managed keys with
      credits is a better product but roughly triples Phase 9. See Open
      Questions.

## Phase 5 — Durable job queue

- [ ] **P5-1** Replace the in-memory queue with `pg-boss` (Postgres-backed, no
      Redis) or BullMQ if you're willing to run Redis. `pg-boss` fits the
      "self-hosted, minimal dependencies" goal better.
- [ ] **P5-2** Run workers as a separate process from the web app. Image
      generation should never occupy a request handler.
- [ ] **P5-3** Idempotency keys on job creation and on the provider call. A
      generation that succeeds and then crashes before the record is written is
      real money burned with nothing to show — the current `runJob` has exactly
      that window between `generateImages` returning and `upsertAsset`.
- [ ] **P5-4** Retries with exponential backoff, but only for errors classified
      as transient. Never auto-retry a content-policy rejection.
- [ ] **P5-5** Per-org concurrency limits and a global cap. `concurrency` is a
      single global today.
- [ ] **P5-6** Replace the 750ms `/api/jobs` poll (`app/page.tsx`) with SSE or
      WebSocket. Every connected client currently pulls the entire job list,
      full prompts included, more than once a second.
- [ ] **P5-7** Dead-letter queue plus an admin view of failed jobs.
- [ ] **P5-8** Graceful shutdown that drains in-flight jobs rather than marking
      them "interrupted by a server restart".

## Phase 6 — Object storage

- [ ] **P6-1** `S3Storage` driver behind the Phase 1 `Storage` interface.
      S3-compatible so MinIO / R2 / Backblaze all work — important for
      self-hosters.
- [ ] **P6-2** Content-addressed keys (`sha256` of bytes) with a reference count.
      Reruns of the same prompt produce a lot of near-duplicates, and dedupe is
      nearly free at this layer.
- [ ] **P6-3** Signed, short-lived URLs for reads. Never proxy image bytes
      through the app the way `api/assets/[id]/source` does today.
- [ ] **P6-4** Generate and store thumbnails on ingest. The library grid
      currently downloads full-resolution PNGs for every tile.
- [ ] **P6-5** Bucket versioning plus a lifecycle rule to cold storage. Generated
      art is expensive to recreate and cheap to keep.
- [ ] **P6-6** Storage quota per plan, enforced on write.
- [ ] **P6-7** Consider `sharp` for server-side encode/decode. `pngjs` is pure JS
      and will be a bottleneck once thumbnailing runs on every ingest — but keep
      `core/` pure so it still runs in the browser worker.

## Phase 7 — Undo/redo

- [ ] **P7-1** Split `client/store.ts` into three stores. Right now it's one
      933-line object mixing server cache, document state, and UI state, and the
      debounce timers live in module globals outside the store entirely:
      - **Server cache** (assets, jobs, palettes, templates) → move to TanStack
        Query. Not undoable.
      - **Document** (the `Composition`: items, groups, camera, palette) →
        undoable.
      - **UI** (selection, busy, error, layout, snap/grid toggles) → not
        undoable.
- [ ] **P7-2** Undo the *document*, using immer `produceWithPatches` to record
      forward and inverse patches. Zundo is the off-the-shelf option but stores
      whole snapshots; patches are cheaper and give you a natural wire format for
      collaboration later.
- [ ] **P7-3** Coalesce continuous gestures. A drag must be one undo step, not
      one per mousemove. Same for slider scrubbing in the inspector.
- [ ] **P7-4** Decide whether per-asset `ProcessingSettings` edits share the
      document undo stack. They're a different scope — the user is editing an
      asset, not the canvas — and mixing them makes Ctrl+Z unpredictable. I'd
      recommend a separate stack scoped to the inspector, but this is a genuine
      product call.
- [ ] **P7-5** Destructive server operations (delete asset, delete template,
      clear stage) need undo too. Soft-delete from P2-5 plus an "undo" toast is
      the cheap version.
- [ ] **P7-6** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, correctly suppressed while a text
      field has focus.
- [ ] **P7-7** Unit-test the undo stack directly. Pure reducer logic, no browser
      needed — apply a scripted sequence of operations, undo all, assert the
      document is byte-identical to the start.

## Phase 8 — Security

- [ ] **P8-1** Zod (or Valibot) schemas at every route boundary. Today all 14
      handlers cast rather than parse: `(await request.json()) as GenerateBody`.
- [ ] **P8-2** Rate limiting, tightest on the endpoints that cost money
      (`/api/generate`, `/api/rerun`) and on auth.
- [ ] **P8-3** Cap generation fan-out. `batches` is clamped to 20 but
      `generation.imageCount` is unbounded from the client, and 20 × n is the
      real multiplier.
- [ ] **P8-4** Audit every filesystem path derived from user input. `path.basename`
      guards the template and palette routes today, and `sanitizeName` strips
      non-alphanumerics, so I didn't find a live traversal — but `api/approve`
      builds a path with a `".."` segment (`path.join(paths.approved, "..", ...)`)
      and that pattern is one careless edit away from a hole. Once storage is
      S3-backed and keys are org-prefixed, most of this class disappears.
- [ ] **P8-5** CSRF protection on state-changing routes (`SameSite=Lax` cookies
      plus a token).
- [ ] **P8-6** Security headers: CSP, HSTS, `X-Content-Type-Options`,
      `Referrer-Policy`.
- [ ] **P8-7** Never log API keys, prompts, or PII. Prompts are user content and
      may be commercially sensitive.
- [ ] **P8-8** SSRF guard on any user-supplied URL (image import by URL, webhooks
      if you add them). Block private ranges and link-local addresses.
- [ ] **P8-9** Dependabot plus secret scanning.
- [ ] **P8-10** Validate uploads by magic bytes, not extension; cap size; cap
      decoded dimensions to stop decompression bombs.
- [ ] **P8-11** Verify the tenant on signed-URL issuance — the most common
      IDOR in apps shaped like this one.

## Phase 9 — Metering, quotas, billing

Only fully required if you offer managed keys (see P4-7). Metering is worth
having regardless.

- [ ] **P9-1** `usage_events` table: every provider call with org, user, model,
      tokens, images, computed cost.
- [ ] **P9-2** Cost estimate shown *before* the user clicks generate.
- [ ] **P9-3** Hard spend caps per org, per day and per month, enforced before
      dispatch. This protects BYOK users from a runaway loop draining their key —
      which is a support nightmare and a trust-destroying event.
- [ ] **P9-4** Usage dashboard: spend by day, by model, by project.
- [ ] **P9-5** If managed keys: Stripe, plans, credit packs, webhook handling,
      dunning, invoices, tax (Stripe Tax).
- [ ] **P9-6** Free tier definition and its enforcement points.

## Phase 10 — Admin

- [ ] **P10-1** Separate admin surface with its own authz role, not a flag on the
      main UI.
- [ ] **P10-2** User and org browser: plan, usage, storage, last active.
- [ ] **P10-3** Job inspector across all orgs, with requeue and cancel.
- [ ] **P10-4** Grant credits / adjust quota / extend trial.
- [ ] **P10-5** Feature flags with per-org overrides.
- [ ] **P10-6** Moderation queue for flagged generations (see P12-4).
- [ ] **P10-7** Support impersonation — time-boxed, consented, and audit-logged.
- [ ] **P10-8** `audit_log` for every admin action. Non-negotiable if
      impersonation exists.
- [ ] **P10-9** Provider health dashboard: latency, error rate, spend by model.

## Phase 11 — Observability and ops

- [ ] **P11-1** Structured JSON logging with a request ID threaded through to the
      worker.
- [ ] **P11-2** Error tracking. Self-hosted Sentry or GlitchTip keeps the
      "everything local except S3" property.
- [ ] **P11-3** `/api/health` and `/api/ready` covering DB, storage, and queue.
- [ ] **P11-4** Metrics: queue depth, job duration, provider error rate, p95
      request latency.
- [ ] **P11-5** Alerts on queue backlog, provider failure spikes, and error rate.
- [ ] **P11-6** Docker Compose for self-hosters: app, worker, Postgres, MinIO.
- [ ] **P11-7** Surface a support-quotable error ID in every user-facing error.

---

## What you didn't list

These are the gaps I'd expect to bite you, roughly ordered by how much they'd
hurt to discover late.

- [ ] **P12-1 Job durability as a money problem.** Covered in P5-3, but worth
      stating separately because it's the difference between a bug and a refund.
      Every crash between "provider returned an image" and "row committed" is
      cash spent for nothing, and at scale it's constant.
- [ ] **P12-2 Terms of service, privacy policy, DPA.** You'll be processing user
      prompts and storing generated images. Also settle *who owns the output* and
      pass through the provider terms — game artists ship this work
      commercially and will absolutely ask.
- [ ] **P12-3 Data portability and deletion.** Bulk export of a library (images +
      metadata) and real account deletion. Partly a legal requirement, mostly a
      trust signal that makes people willing to commit their library to you.
- [ ] **P12-4 Content moderation and abuse.** You're operating an image
      generator. You need a policy, logging sufficient to respond to a takedown,
      and a story for CSAM and NSFW. `moderation: "auto" | "low"` is passed to
      OpenAI today and that is the entirety of the current defense. Under BYOK
      the provider carries some of this, but you're still hosting the output.
- [ ] **P12-5 Onboarding.** A blank canvas with no assets and no API key is a
      bounce. Wanted: a sample project with pre-generated assets, a guided first
      generation, and a working demo that needs no key.
- [ ] **P12-6 Transactional email.** Magic links, "your batch is done", failure
      notices, receipts. SMTP config for self-hosters.
- [ ] **P12-7 Keyboard shortcuts and accessibility.** A canvas tool lives or dies
      on shortcuts, and there are effectively none today. Also focus management,
      contrast, and screen-reader labels on the icon-only controls in `ui.tsx`.
- [ ] **P12-8 Multi-device and multi-tab.** See the clobber bug above. Solved by
      P2-6 plus a "this composition changed elsewhere" prompt.
- [ ] **P12-9 Asset versioning.** Distinct from undo: users want the history of a
      single asset's processing settings, and to roll one back. Cheap to add once
      there's a real database, expensive to retrofit onto a JSON array.
- [ ] **P12-10 Templates and presets as a shareable object.** Processing settings
      are the accumulated craft knowledge of the tool. Named, shareable presets
      are a genuine retention feature and possibly a community one.
- [ ] **P12-11 Product analytics.** Privacy-respecting (PostHog self-hosted or
      Plausible). You cannot prioritize without knowing which pipeline stages
      people actually use.
- [ ] **P12-12 In-app feedback.** One button, attaches the error ID and app
      version.
- [ ] **P12-13 Pricing and packaging.** Decide early — it determines whether you
      need Phase 9 at all, and whether managed keys exist. See Open Questions.
- [ ] **P12-14 Deploy story.** Preview environments per PR, staged rollout, and
      migrations that run safely with both old and new code live.
- [ ] **P12-15 Performance budget.** `api/approve` runs the full pipeline
      synchronously inside a request handler, single-threaded. Fine for one user,
      not for fifty. Move it to the worker pool.
- [ ] **P12-16 A public changelog and roadmap.** Cheap, and it's how a solo-built
      tool signals it's alive.
- [ ] **P12-17 Self-host vs hosted parity.** If you open-source, decide now what
      lives only in the hosted tier. Retrofitting that boundary onto a shipped
      codebase is miserable.

---

## Suggested order

Phases 0 and 1 unblock everything and are worth doing even if you never ship a
SaaS — you get a tested, standalone tool. Then 2 → 4 → 5 → 6 as the platform
spine. Phase 3 (providers) and Phase 7 (undo/redo) are independent of the spine
and can be done any time; both are user-visible wins, so they're good morale
work to interleave. Phases 8–11 harden. Phase 12 items get scheduled once you
know whether this is a product or a nice tool you happen to host.

A reasonable first milestone: **P0-1, P0-3, P0-6, P0-8, P1-1, P1-2.** That
yields a standalone repo with a test suite pinning the image pipeline, no Godot
dependency, and a storage abstraction ready for S3 — with no auth, no database,
and no billing, so it stays a tool you can still use tomorrow.

---

## Open questions

1. **BYOK-only, or managed keys with credits?** BYOK-only removes billing,
   fraud, spend liability, and most of Phase 9. Managed keys convert far better
   but roughly triple the scope. Strong recommendation: launch BYOK-only.
2. **Open-source, open-core, or closed?** Affects licensing, the self-host/hosted
   feature boundary, and whether Docker Compose is a supported product surface.
3. **Solo tool or teams?** Carrying `org_id` from day one is nearly free;
   retrofitting it is not. I've assumed orgs throughout.
4. **Godot-first or engine-agnostic?** The pipeline (top-down, palette-quantized,
   transparent-cutout sprites) is opinionated in a way that's a real
   differentiator. "Pixel-art sprite pipeline for indie game devs" is a sharper
   pitch than "AI image tool", and it suggests leaning *into* engine integrations
   rather than away from them.
5. **Does undo cover asset processing settings, or only the canvas?** (P7-4.)
6. **Is the playground/composition feature core, or a scratchpad?** It's a large
   share of the client code — `Playground.tsx` alone is 1,338 lines, the single
   biggest file in the app — and it drives most of the undo/redo cost. Worth
   knowing whether it's the product or a tool inside it.
