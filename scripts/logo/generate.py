"""
Regenerates public/branding/logo-{white,black}.png: "SPRITEBENCH" in
Silkscreen (Google Fonts, OFL -- see OFL.txt beside this script). Also the
favicons in app/ (favicon.ico, icon.svg, apple-icon.png): "SB" the same way,
mint on the app's dark ink.

Silkscreen is a pixel font whose capitals are 5 pixels tall at size 8, so the
text is drawn at that native size with anti-aliasing off and then scaled up by
a whole number with nearest-neighbour sampling. That keeps every pixel square
and sharp. Pages show the PNG at a multiple of 5px tall with
`image-rendering: pixelated`, which keeps it sharp there too.

    python3 scripts/logo/generate.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "public" / "branding"
APP = ROOT / "app"

TEXT = "SPRITEBENCH"
NATIVE_SIZE = 8
SCALE = 12
COLORS = {"white": (255, 255, 255, 255), "black": (0, 0, 0, 255)}


ICON_TEXT = "SB"
# --color-accent on --color-ink-800, from app/globals.css.
ICON_FG = (0x6E, 0xE7, 0xB7, 255)
ICON_BG = (0x12, 0x15, 0x1A, 255)
ICO_SIZES = (16, 32, 48)
APPLE_SIZE = 180


def render_mask(text: str = TEXT) -> Image.Image:
    font = ImageFont.truetype(str(HERE / "Silkscreen-Regular.ttf"), NATIVE_SIZE)
    canvas = Image.new("L", (NATIVE_SIZE * len(text) * 2, NATIVE_SIZE * 3), 0)
    draw = ImageDraw.Draw(canvas)
    draw.fontmode = "1"  # no anti-aliasing: one bit per pixel
    draw.text((NATIVE_SIZE, NATIVE_SIZE), text, font=font, fill=255)
    return canvas.crop(canvas.getbbox())


def icon_mask() -> Image.Image:
    """The letters one pixel apart rather than the font's two; at 16px every column counts."""
    letters = [render_mask(letter) for letter in ICON_TEXT]
    width = sum(letter.width for letter in letters) + len(letters) - 1
    mask = Image.new("L", (width, max(letter.height for letter in letters)), 0)
    x = 0
    for letter in letters:
        mask.paste(letter, (x, mask.height - letter.height))
        x += letter.width + 1
    return mask


def icon_png(mask: Image.Image, size: int) -> Image.Image:
    """The largest whole-number scale that leaves a margin, centred on a rounded tile."""
    # Tab icons want every pixel; a home-screen icon wants room to breathe.
    margin = size // 8 if size >= 64 else max(1, size // 16)
    scale = max(1, (size - 2 * margin) // mask.width)
    glyphs = mask.resize((mask.width * scale, mask.height * scale), Image.NEAREST)

    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    radius = max(2, size // 6)
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, size - 1, size - 1), radius, fill=ICON_BG)
    at = ((size - glyphs.width) // 2, (size - glyphs.height) // 2)
    tile.paste(Image.new("RGBA", glyphs.size, ICON_FG), at, mask=glyphs)
    return tile


def icon_svg(mask: Image.Image) -> str:
    """One square per pixel, so it stays sharp at any size."""
    side = mask.width + 3
    top = (side - mask.height) / 2
    fg = "#%02x%02x%02x" % ICON_FG[:3]
    bg = "#%02x%02x%02x" % ICON_BG[:3]
    cells = "".join(
        f'<rect x="{x + 1.5}" y="{y + top}" width="1" height="1"/>'
        for y in range(mask.height)
        for x in range(mask.width)
        if mask.getpixel((x, y))
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}" '
        f'shape-rendering="crispEdges">'
        f'<rect width="{side}" height="{side}" rx="{side / 6:.2f}" fill="{bg}"/>'
        f'<g fill="{fg}">{cells}</g></svg>\n'
    )


def write_icons() -> None:
    mask = icon_mask()

    sizes = [icon_png(mask, size) for size in ICO_SIZES]
    sizes[-1].save(APP / "favicon.ico", sizes=[(s, s) for s in ICO_SIZES], append_images=sizes[:-1])
    icon_png(mask, APPLE_SIZE).save(APP / "apple-icon.png", optimize=True)
    (APP / "icon.svg").write_text(icon_svg(mask))

    for name in ("favicon.ico", "apple-icon.png", "icon.svg"):
        print(f"app/{name}")


def main() -> None:
    mask = render_mask()
    big = mask.resize((mask.width * SCALE, mask.height * SCALE), Image.NEAREST)

    for name, color in COLORS.items():
        image = Image.new("RGBA", big.size, (0, 0, 0, 0))
        image.paste(Image.new("RGBA", big.size, color), mask=big)
        path = OUT / f"logo-{name}.png"
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)}  {image.width}x{image.height}")

    write_icons()


if __name__ == "__main__":
    main()
