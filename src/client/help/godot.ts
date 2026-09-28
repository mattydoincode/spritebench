/** Help → Godot. Same Markdown rules as overview.ts. */
export default `
## Godot plugin (beta)

An experimental Godot 4.6 editor addon that pulls art from a SpriteBench project into your game. It's alpha, so expect rough edges and back up your project before trying it.

### Setup

1. Get the addon from [github.com/mattydoincode/spritebench-godot](https://github.com/mattydoincode/spritebench-godot), copy **addons/spritebench** into your project, and enable it under Project Settings → Plugins.
2. In SpriteBench, go to **Settings → Account & keys** and create a personal access token. Paste it into the SpriteBench dock in Godot.
3. Paste your **Project ID** into the dock as well. It's the long id in this project's address (spritebench.com/projects/...), and the Game Assets tab shows it until your first sync.
4. Tick **SpriteBench slot** on a Sprite2D or AnimatedSprite2D, or add a SpriteBenchSet resource, then press Sync. Sync also runs when you save a scene.

### Assigning art

Your slots show up in the **Game Assets** tab. Drag art from the library onto a slot, and the next sync pulls the processed PNG into res://spritebench/. Assets, lists and tables can be created in SpriteBench too.

### Prototype and final

Each slot can hold an AI prototype and an artist's final. In Godot, Project Settings → SpriteBench → **Art** picks what the game uses: finals where they exist (the default), or only prototypes.

Godot never uploads pixels. If you edit a pulled PNG in Godot, it sticks until you assign again in SpriteBench.
`;
