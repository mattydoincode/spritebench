/** Help → Miscellaneous. Same Markdown rules as overview.ts. */
export default `
## Miscellaneous

### Models

OpenAI and Gemini don't support the same things, and SpriteBench works around the gaps where it can:

- **Masks**: OpenAI takes a real mask, so the area outside your editable region is protected exactly. Gemini has no mask channel, so SpriteBench sends it a guide image instead (white where it should draw) with instructions to leave the rest alone. It usually listens, but it can redraw parts you meant to keep. For precise edits, use OpenAI.
- **Transparent backgrounds**: only the newer OpenAI models (GPT Image 2 and up) can return a transparent background directly. Otherwise, cut the background out in the inspector.
- **Sizes**: newer OpenAI models take almost any size. Older OpenAI models and Gemini have fixed options; a custom size is snapped to the nearest one Gemini offers (its aspect ratios at 1K, 2K or 4K), and the Generate panel says what will be sent.
- **Quality and moderation**: OpenAI only. Gemini ignores both.
- **Images per request**: OpenAI can return up to 10 at once. Gemini returns 1, so a batch becomes several jobs that run side by side.

I recommend starting with Gemini, and reaching for OpenAI when you need exact masked edits or a transparent background.

### Project defaults

**Settings → Defaults** decides how new images in this project are processed. Keep the background (the default), or cut it out by flood filling from the edges, keying out a colour, or clearing pixels above or below a brightness. The isometric angle and light direction here are shared by the project's iso templates and repeaters, so a whole tileset agrees.

### Pixel art and palettes

In the inspector's **pixel art** section, shrink an image to a real pixel size like 32×32, snap it to a palette (upload a .hex, .gpl, .pal or .png file), and dither the gradients. It's all non-destructive, so you can try a new palette on forty sprites and back out.

### Organizing the library

Every Generate click lands as a batch. Drag images or whole batches into folders, tag them, and search by name, prompt or tag. Uploaded images keep their file names; everything else can be renamed.

### Going back to an earlier image

Any image can load its own prompt, model, templates and settings back into the Generate panel, so you can pick up where a good one left off and make more like it.

### Downloads

Select one image or many and download the originals, the processed PNGs, or both, zipped up when there's more than one. Animations can come out as a packed sheet plus JSON, or one PNG per frame plus JSON, ready for an engine. Filenames follow the project and each image's name.

### The scene

Drag images onto the scene to see how art reads together. A **repeater** tiles art from a set you choose, on a square grid, an isometric diamond map, 2:1 dimetric, or as a random scatter for things like grass and rubble. A **terrain** takes heightmaps on its cells, and its tab shows the assembled 3D mesh, so you can check hills and cliffs before building a level.
`;
