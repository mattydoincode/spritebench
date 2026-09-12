# Ideas

Loose product thoughts. Not a plan, not committed. Ask the agent about
"ideas" or "the backlog" and it should open this file.

---

## Recursive map detail

Generate a large piece (a whole map), slice it into smaller pixelated chunks,
then fire each chunk as an `images/edits` origin for a batch in the same style.
Repeat: city → districts → streets, each round inheriting the parent so the
set still fits together.

Could also blend or inpaint the seams, or run an algorithm over the edges so
the tiles click without a visible cut. Same trick might work for any large
sheet you want to explode into a consistent kit.

Related to what we already have: template-as-edit origin, item grids, iso
repeater, prompt variables for the batch.

---

## In-app pixel editor (Aseprite-shaped)

Draw templates here, or edit pixels directly, instead of bouncing through
Aseprite. The pitch is end-to-end: generate, cut, tweak, tile, share — without
a pile of local files that only live on one machine.

Aseprite feels like the past for this workflow: installed, not shareable,
clunky next to a project that already has the document in the cloud. Basic
Aseprite (pencil, selection, layers, onion-skin for sequences) might be enough;
the rest of Aseprite is what we do not want to become.

---

## Style library

A library of styles you can pull onto a project — not just a prefix/suffix, a
whole look: prompt bits, palette, processing, maybe a reference sheet or the
iso diamond. Something you can browse and apply, and eventually share, so a
city kit and a character kit can stay in the same world without copying
settings by hand.

The thought trailed off here. Expand when it is clearer whether this is
presets, published packs, or both.

---

## LLM as a job multiplier

Use a text model to fan things out instead of typing every variant by hand:
more takes on an asset, a batch that spawns another batch, or filling in
`{name}` variables from a short brief ("ten shop signs", "every weather on
this tile").

The cartesian expander already runs once the lists exist. The missing piece
is proposing those lists — and maybe chaining a finished sheet back into the
next prompt — so one click turns a seed into a kit.
