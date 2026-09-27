# Production TODOs

Working list for taking SpriteBench to production as an alpha. Newest decisions
at the top of each section; tick things off rather than deleting them.

## Launch night

- [x] Stop asking Google for offline access (identity only: openid, email, profile).
- [x] Cap how many workers one user can hold at once (`WORKER_USER_CONCURRENCY`, default 2
      of `WORKER_CONCURRENCY` 4). Jobs are grouped by the user who pressed Generate;
      pg-boss skips a user at their cap, so big requests queue behind themselves.
- [ ] Apply migrations `0005_provider_key_defaults` and `0006_feedback_admin` in production
      (`npm run db:migrate:prod`) with the deploy. Generation breaks without 0005.
- [ ] Clear refresh tokens Google already issued:
      `update accounts set refresh_token = null, access_token = null where provider = 'google';`
- [ ] Google Cloud Console: move the OAuth consent screen from "Testing" to "In production"
      (Testing caps at 100 users and expires sign-ins weekly). Basic scopes need no review.
- [ ] Make yourself admin: `update users set is_admin = true where email = '…';`
- [ ] Confirm the production domain matches the Godot addon's default base URL
      (`https://spritebench.com` in `spritebench-godot/addons/spritebench/credentials.gd`).

## Costs and abuse (you pay storage and worker time; users pay generation)

- [ ] Per-user storage or image cap. Nothing limits how many images a user keeps.
- [ ] Clean up storage for soft-deleted projects (files stay in R2 forever today).
- [ ] Rate limits on write endpoints: sign-up/bootstrap, project create, token create,
      feedback, generate.
- [ ] Remove or re-wire the leftover per-project quota code (`pendingImages` in
      `src/db/repo/jobs.ts` is unused).
- [ ] Consider grouping jobs by billed provider key as well as user, since provider rate
      limits are per key (matters once projects are shared).

## Accounts and access

- [ ] Sharing by link. `project_invites` already exists in the schema (token column) but has
      no code. Owner makes a link with a role (viewer/editor) and a "can generate" flag (off by
      default: it spends the owner's key); `/join/<token>` adds a signed-in user as a member;
      Members list in Project settings to change roles, remove people, revoke links. Links
      revocable, ideally expiring or use-limited.
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
- [ ] Artist upload as the final copy: an artist uploads their finished image straight into
      the app against that asset (drag onto it, or "upload final" in the inspector), keeping
      the AI candidates it came from as history.
- [ ] Finals win downstream: Godot slots, downloads and the scene use the final when one
      exists, and the library shows final vs draft at a glance (badge, like the Godot/saved
      icons).
- [ ] Open questions: who can upload finals (editors? a new "artist" role?), whether a final
      can be re-processed (pixel art, palette) or is taken as-is, and whether a newer final
      replaces the old one or versions it.

## Product

- [ ] Redesign the marketing homepage.
- [ ] Update `logo-editable.svg` and any favicon or social image to the Silkscreen wordmark.
- [ ] Inspector labels for results ("set", "tileset", "items") to match the new automation
      names.
