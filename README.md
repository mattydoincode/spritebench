# AI Art Studio

A pipeline for generating, processing, and exporting game art — prompt an image
model, cut the background, quantize to a palette, downsample to a sprite, and
compose the results on a canvas to check how they read together.

Extracted from a Godot project; the app no longer depends on one.

## Running it

```bash
npm install
cp .env.example .env.local   # add your OpenAI key
npm run dev                  # http://localhost:4300
```

## Data

All user data lives under a single directory, `./data` by default. Point
`ART_STUDIO_DATA_DIR` somewhere else to move it.

```
data/
  sources/                 raw generated PNGs
  templates/               shape templates used as edit masks
  palettes/                .hex .txt .gpl .pal .png palettes
  jobs/                    one JSON file per generation job
  library/
    index.json             the asset index
    studio.json            saved settings
    compositions/          saved canvas layouts
  exports/props/           approved PNGs plus JSON sidecars
```

## Layout

- `src/core/` — pure image pipeline. No Node or DOM dependencies; runs
  unchanged in the browser worker and on the server.
- `src/server/` — filesystem persistence, the job queue, provider calls.
- `src/client/` — zustand store and React components.
- `app/api/` — route handlers.

## Where this is going

See [plans.md](./plans.md).
