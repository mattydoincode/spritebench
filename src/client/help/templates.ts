/** Help → Templates. Same Markdown rules as overview.ts. */
export default `
## Templates

Templates are images that go along with your prompt to steer what comes back. They live in the **template** section of the Generate panel, in two parts.

### Starting images and references

Drop PNGs here, or drag images in from your library. Depending on the automation they're a starting image for the model to edit, or references for it to follow. **Fit** decides how each one maps onto the request size (contain, cover or stretch), and anything you upload is kept under **Saved templates** for next time.

### Layout plates

A plate sits under the prompt and shows the model where to draw:

- **iso**: a true isometric diamond. The model draws inside the tile's footprint.
- **2:1**: a dimetric diamond, the classic pixel-art tile that steps 2 across and 1 down.
- **pixel constraint** and **frames**: grids for pixel art and sprite sheets. The Animation tab explains both, and they work on single images too.
- **Custom**: upload or paste your own sketch and use it as a stencil. Tick **Remove the white background on paste** to drop paper white, and reuse old ones from **Saved sketches**.

### Editable region

With a custom stencil, **Where to draw** decides which part the model may change: where the template is transparent, only the dark strokes, only the light areas, inside the shape you drew, or everything around it while the shape stays put. **Grow editable region** widens it by a few pixels so edges blend. Masks are exact on OpenAI and approximate on Gemini; see Miscellaneous → Models.

### The template builder

Press **build**, above your starting images, to make a guide shape instead of drawing one: a diamond, prism, sphere, road intersection or building. Set its width, depth and height, the light direction, and whether it's seen at an iso angle or front-on. Intersections also take road and sidewalk widths and colours. The result becomes a template you can attach like any other, and a quick way to get consistent blocks, props and tiles.
`;
