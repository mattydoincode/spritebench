# TODOs

Everyday post-launch work. Launch and production items live in `PROD_TODOS.md`;
loose product thoughts in `ideas.md`. Tick things off rather than deleting them.

## Templates

- [ ] Flat template shapes: a rectangle and a circle in the template builder, alongside the
      isometric diamond, prism, sphere, intersection and building. For top-down and side-view
      games, a silhouette to fill (items, icons, tiles, portraits). The builder already handles
      size, fill and export (`src/core/isoTemplate.ts`, `TemplateBuilderModal.tsx`), so this is
      mostly two new shapes that skip the iso projection. Not a sizing fix: Gemini takes its
      output shape from the request's aspect ratio, not the input image.
