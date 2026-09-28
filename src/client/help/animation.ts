/** Help → Animation. Same Markdown rules as overview.ts. */
export default `
## Animation

### Generate a sprite sheet

1. In Generate, choose the **Animation (Sprite Sheet)** automation.
2. List the actions you want, like idle with 4 frames and walk with 4, and set the sprite size.
3. Attach your character as a starting image to help keep every frame on-model.
4. Generate. The sheet comes back with a row per action, already sliced into named animations.

### Frames and pixel constraint

The **template** section of the Generate panel can lay a plate under the sheet, which helps the model keep frames tidy:

- **None**: the sheet's size comes from your sprite size and frame counts, and the model lays the frames out itself.
- **frames**: an empty box for every frame, with dark gutters between them, one row per action. The model draws each frame inside its box, so the sheet slices cleanly.
- **pixel constraint**: every frame's box becomes a grey checkerboard where each square is one real pixel of your sprite, at the size set in the **pixel art** section (say 32×32). The model draws on that grid, and pixel art shrinks each frame to exactly that size. In this mode the pixel art size replaces the sprite size setting.

Frames is the safe default for a clean sheet. Pixel constraint is for when you want true pixel art at a fixed size.

### Play and fix

Select the sheet and the inspector shows a player: pick an action, play it, change the speed, step through frames. Crop a single frame to fix it without touching the others.

### Slice any sheet

Got a sheet from somewhere else? Select it and press **slice** above the preview to cut it into frames on a grid.

### From a chain

The Chain results automation can also collect its steps into an animation.
`;
