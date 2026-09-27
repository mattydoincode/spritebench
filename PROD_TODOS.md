# Production TODOs

Working list for taking SpriteBench to production as an alpha. Newest decisions
at the top of each section; tick things off rather than deleting them.

## Launch night

- [x] Stop asking Google for offline access (identity only: openid, email, profile).
- [x] Cap how many workers one user can hold at once (`WORKER_USER_CONCURRENCY`, default 2
      of `WORKER_CONCURRENCY` 4). Jobs are grouped by the user who pressed Generate;
      pg-boss skips a user at their cap, so big requests queue behind themselves.
- [ ] Apply migrations `0005` through `0011` in production (provider key defaults, feedback/admin,
      share links, engine sync time, asset origin, final lane, web game assets)
      (`npm run db:migrate:prod`) with the deploy. Generation breaks without 0005.
- [ ] Clear refresh tokens Google already issued:
      `update accounts set refresh_token = null, access_token = null where provider = 'google';`
- [ ] Google Cloud Console: move the OAuth consent screen from "Testing" to "In production"
      (Testing caps at 100 users and expires sign-ins weekly). Basic scopes need no review.
- [ ] Make yourself admin: `update users set is_admin = true where email = '…';`
- [ ] R2 bucket is private: in the bucket's Settings, "Public Development URL" (r2.dev) is
      disabled and "Custom Domains" is empty; and `R2_PUBLIC_BASE` is unset in production.
      With either on, image links become permanent public URLs instead of 1-hour signed ones.
- [ ] R2 bucket has no lifecycle rule deleting objects (Settings → Object lifecycle rules),
      now that the app keeps originals forever.
- [ ] Confirm the production domain matches the Godot addon's default base URL
      (`https://spritebench.com` in `spritebench-godot/addons/spritebench/credentials.gd`).

## Costs and abuse (you pay storage and worker time; users pay generation)

- [x] Removed the nightly roll-off of originals (was: delete after 30 days). Originals now stay
      until something deliberately deletes them. R2 is ~$0.015/GB-month and originals average
      ~4 MB: ~$3.50/mo after a year at 10 users, ~$36 at 100, ~$360 at 1,000 (at ~500
      images/user/month). If trimming is ever needed, build it fresh: rejected or untouched drafts
      only, never favourites/finals, or store originals as lossless WebP. The unused
      `assets.expires_at` column can go in a later migration.
- [x] Per-user usage on /admin: projects, jobs, failed jobs, images, stored bytes, last
      generation, joined; plus total stored and its rough R2 cost.

- [ ] Per-user storage or image cap. Nothing limits how many images a user keeps (the /admin
      usage table is the basis for one).
- [ ] Clean up storage for soft-deleted projects (files stay in R2 forever today).
- [ ] Rate limits on write endpoints: sign-up/bootstrap, project create, token create,
      feedback, generate.
- [ ] Remove or re-wire the leftover per-project quota code (`pendingImages` in
      `src/db/repo/jobs.ts` is unused).
- [ ] Consider grouping jobs by billed provider key as well as user, since provider rate
      limits are per key (matters once projects are shared).

## Accounts and access

- [x] Sharing by link: Settings → Project (the default tab) shows the name (owner renames it),
      stats, people with access (owner changes access or removes; others can leave) and share
      links (viewer / editor / editor + generate, a week each, revocable). `/join/<token>` signs
      people in and adds them. Also on the dashboard's ⋯ menu as "Share…".
- [ ] Sign-up gate (allowlist or invite codes) if open sign-up becomes a problem.
- [ ] Account deletion and data export. Until then, say in the privacy page how to request
      deletion, and know the SQL to do it.
- [ ] Personal access tokens never expire; consider an expiry or "last used" cleanup.
- [ ] `/api/projects/[id]/approve` (server-side copies) is unused by the UI now; decide
      whether the flow comes back or the route goes.

## Godot addon

- [ ] Interim: make `spritebench-godot` public, cut a GitHub Release with
      `addons/spritebench/` zipped (a GitHub Action on version tags), and link
      "Download the Godot addon" next to access tokens in Account settings.
- [ ] Official Godot Asset Library: submit repo URL + version tag; needs a square icon
      (none yet), category, supported Godot version, README. Moderator review takes days.
      The newer Godot Asset Store (beta) is an alternative.
- [ ] Commit `.uid` files in the addon repo (its `.gitignore` excludes them; Godot 4.4+
      expects them committed, especially for distributed addons).

## Human in the loop (artist finals)

The goal: AI output is the draft, a human artist signs off on the final. The last step
of the pipeline should be a person, not a generation.

- [ ] Favorites / picks: mark the good ones inside a batch (and hide the rejects), so a
      batch of 12 candidates becomes "these 2 are worth finishing".
- [ ] Asset groups: tie candidates, picks and the finished art for one thing (a sprite, a
      building face) together, so it is clear which images are drafts of the same asset.
- [x] Uploads: library upload button or drop files on a folder; stored as-is, person icon.
- [x] Prototype / Final lanes on every game-asset slot, a toggle in Game Assets for which you
      edit, and the Godot plugin's Art setting for which the game pulls.
- [ ] Artist upload as the final copy: an artist uploads their finished image straight into
      the app against that asset (drag onto it, or "upload final" in the inspector), keeping
      the AI candidates it came from as history.
- [ ] Finals win downstream: Godot slots, downloads and the scene use the final when one
      exists, and the library shows final vs draft at a glance (badge, like the Godot/saved
      icons).
- [ ] Open questions: who can upload finals (editors? a new "artist" role?), whether a final
      can be re-processed (pixel art, palette) or is taken as-is, and whether a newer final
      replaces the old one or versions it.

## Game Assets (new, needs a real end-to-end test in Godot)

- [ ] Test with the plugin: Art = final/prototype switching, web-made asset/list landing in
      `assets.tres`, web table becoming `tables/<name>.tres` with rows and art.
- [ ] A removed web table's `.tres` is left in Godot; decide whether the plugin deletes it.
- [ ] Web-made "asset" is a still image only; add animations (sprite frames) if needed.
- [ ] Release the plugin (see Godot addon) so people get the Art setting and web assets.

## Product

- [ ] Redesign the marketing homepage.
- [ ] Update `logo-editable.svg` and any favicon or social image to the Silkscreen wordmark.
- [ ] Inspector labels for results ("set", "tileset", "items") to match the new automation
      names.
