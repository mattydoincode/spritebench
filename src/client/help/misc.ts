/** Help → Miscellaneous. Same Markdown rules as overview.ts. */
export default `
## Miscellaneous

Useful things that don't fit anywhere else.

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
