/** Help → Advanced. Same Markdown rules as overview.ts. */
export default `
## Advanced

### Project defaults

**Settings → Defaults** sets how new images in the project are processed: whether the background is kept or cut out (flood fill from the edges, a chroma key colour, or brightness), plus the isometric angle and light direction.

### Pixel art and palettes

In the inspector, shrink an image to a target size as real pixel art, snap it to a palette (upload .hex, .gpl, .pal or .png), and dither. All of it re-runs from the original.

### Templates

Templates are images you attach to a prompt to guide its shape and layout. The template builder makes isometric shapes (diamond, prism, sphere, intersection, building) with your chosen light. An editable region limits where the model is allowed to draw.

### Isometric

Isometric templates, clipping a result to the iso diamond, and isometric repeaters on the scene all follow the project's iso settings.

### Repeaters and terrain

On the scene, a **repeater** tiles art from a set you choose: a grid, an isometric diamond map, 2:1 dimetric, or a scatter of things like grass. A **terrain** takes heightmaps on its cells, and the Terrain tab shows the assembled 3D mesh.
`;
