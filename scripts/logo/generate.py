"""
Regenerates public/branding/logo-{white,black}.png: "SPRITEBENCH" in
Silkscreen (Google Fonts, OFL -- see OFL.txt beside this script).

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
OUT = HERE.parent.parent / "public" / "branding"

TEXT = "SPRITEBENCH"
NATIVE_SIZE = 8
SCALE = 12
COLORS = {"white": (255, 255, 255, 255), "black": (0, 0, 0, 255)}


def render_mask() -> Image.Image:
    font = ImageFont.truetype(str(HERE / "Silkscreen-Regular.ttf"), NATIVE_SIZE)
    canvas = Image.new("L", (NATIVE_SIZE * len(TEXT) * 2, NATIVE_SIZE * 3), 0)
    draw = ImageDraw.Draw(canvas)
    draw.fontmode = "1"  # no anti-aliasing: one bit per pixel
    draw.text((NATIVE_SIZE, NATIVE_SIZE), TEXT, font=font, fill=255)
    return canvas.crop(canvas.getbbox())


def main() -> None:
    mask = render_mask()
    big = mask.resize((mask.width * SCALE, mask.height * SCALE), Image.NEAREST)

    for name, color in COLORS.items():
        image = Image.new("RGBA", big.size, (0, 0, 0, 0))
        image.paste(Image.new("RGBA", big.size, color), mask=big)
        path = OUT / f"logo-{name}.png"
        image.save(path, optimize=True)
        print(f"{path.relative_to(HERE.parent.parent)}  {image.width}x{image.height}")


if __name__ == "__main__":
    main()
