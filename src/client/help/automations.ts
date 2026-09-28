/** Help → Automations. Same Markdown rules as overview.ts. */
export default `
## Automations

By default a job makes one image from your prompt. An automation, chosen in the Generate panel, changes what a job does.

- **Chain results**: the same prompt for several steps, each output feeding the next. Good for evolving a design. Use {step} and {total_steps} in the prompt, and optionally collect the steps into an animation.
- **Chunk and process**: split a starting image into a grid of cells and redo each cell with your prompt. Good for adding detail to, or restyling, something big like a map.
- **Each image**: the same prompt on every image you've attached, one job each.
- **Animation (Sprite Sheet)**: rows of frames, sliced into animations. See the Animation tab.
- **Variations (Sprite Sheet)**: many separate images on one sheet, set by columns and rows. Good for a set of items in one style.

### Prompt variables

Write a slot like {color} in a prompt and give it a list of values (red, blue, green) to get one job per value. Two variables multiply.

### Snippets

Save text you reuse as a snippet and drop it into any prompt with @name. Snippets are shared across the project.
`;
