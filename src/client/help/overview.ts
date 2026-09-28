/**
 * Help → Overview. Plain Markdown in a string: ## and ### headings, "- "
 * bullets, "1. " steps, **bold**, [links](https://...). Blank lines split
 * paragraphs.
 */
export default `
## How SpriteBench works

SpriteBench is for making game art: generate drafts with AI, clean them up, and bring in an artist once something is worth finishing.

### Projects

Everything lives in a project: its library of images, the scene, your prompts and snippets, and its settings. Make one per game, or per experiment, from the Projects page.

### Your key

Generation runs on your own OpenAI or Gemini key, added under **Settings → Account & keys**. You pay the provider directly. I recommend starting with Gemini.

### Generating

1. Write a prompt in the **Generate** panel on the left.
2. Pick a model and a size, and how many to make.
3. Press **Generate**. Jobs run in the background and land in the **Library** as they finish.

Click any image to open it in the **Inspector** on the right: crop it, cut out its background, turn it into pixel art. Every change is non-destructive; the original is always kept.

### The scene

Drag images from the library onto the scene in the middle to see how they look together.

### Looping in artists

- Share the project from **Settings → Project**: as a viewer, an editor, or an editor who can also generate. Share links last a week.
- Your artist sees every draft and can upload finished pieces straight into the library, with the upload button or by dropping files on a folder.
- In **Game Assets**, every slot keeps an AI **prototype** and an artist's **final** side by side.

### Feedback

This is alpha software, so things will break. The feedback box under the inspector comes straight to me.
`;
