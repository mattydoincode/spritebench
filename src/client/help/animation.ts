/** Help → Animation. Same Markdown rules as overview.ts. */
export default `
## Animation

### Generate a sprite sheet

1. In Generate, choose the **Animation (Sprite Sheet)** automation.
2. List the actions you want, like idle with 4 frames and walk with 4, and set the sprite size.
3. Attach your character as a starting image to help keep every frame on-model.
4. Generate. The sheet comes back with a row per action, already sliced into named animations.

### Play and fix

Select the sheet and the inspector shows a player: pick an action, play it, change the speed, step through frames. Crop a single frame to fix it without touching the others.

### Slice any sheet

Got a sheet from somewhere else? Select it and press **slice** above the preview to cut it into frames on a grid.

### From a chain

The Chain results automation can also collect its steps into an animation.
`;
