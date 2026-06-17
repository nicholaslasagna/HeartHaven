#!/usr/bin/env python3
"""Generate HeartHaven keeper animation sheet from finished preset portraits.

The source portraits are already the approved character art. This script keeps
identity stable by transforming those portraits into animation frames instead
of asking a model to redraw each pose inconsistently.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Callable, Iterable, NamedTuple

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "public/game-assets/generated/keepers/presets-v2"
OUT_PATH = ROOT / "public/game-assets/generated/keepers/preset-animation-sheet.png"

FRAME_W = 256
FRAME_H = 384


KEEPERS = [
    "rose-waves",
    "moonlit-overalls",
    "sage-braids",
    "honey-curls",
    "blush-blonde",
    "starlight-cape",
    "garden-bangs",
    "clover-curls",
]


class FrameSpec(NamedTuple):
    name: str
    scale_x: float = 1.0
    scale_y: float = 1.0
    rotate: float = 0.0
    x: float = 0.0
    y: float = 0.0
    overlay: str | None = None


FRAMES: list[FrameSpec] = [
    FrameSpec("idle-a", y=0),
    FrameSpec("idle-blink", scale_y=0.992, y=1, overlay="blink"),
    FrameSpec("idle-breathe", scale_x=1.012, scale_y=0.992, y=-2),
    FrameSpec("idle-look", rotate=-1.0, x=-1, y=0, overlay="sparkle"),
    FrameSpec("walk-left-step", scale_x=1.016, scale_y=0.972, rotate=-3.1, x=-7, y=-5, overlay="step-left"),
    FrameSpec("walk-left-mid", scale_x=0.99, scale_y=1.018, rotate=-1.1, x=-3, y=-8),
    FrameSpec("walk-right-step", scale_x=1.016, scale_y=0.972, rotate=3.1, x=7, y=-5, overlay="step-right"),
    FrameSpec("walk-right-mid", scale_x=0.99, scale_y=1.018, rotate=1.1, x=3, y=-8),
    FrameSpec("sit-a", scale_x=1.04, scale_y=0.87, y=34, overlay="sit-shadow"),
    FrameSpec("sit-b", scale_x=1.03, scale_y=0.855, rotate=-0.8, y=38, overlay="sit-heart"),
    FrameSpec("sleep-a", scale_x=1.04, scale_y=0.8, rotate=-10, x=-4, y=58, overlay="sleep"),
    FrameSpec("sleep-b", scale_x=1.05, scale_y=0.79, rotate=-8, x=-2, y=60, overlay="sleep-breathe"),
    FrameSpec("wave-a", rotate=-2.0, x=-2, y=-2, overlay="wave-a"),
    FrameSpec("wave-b", rotate=2.5, x=4, y=-5, overlay="wave-b"),
    FrameSpec("wave-c", rotate=-1.5, x=-1, y=-2, overlay="wave-c"),
    FrameSpec("heart-a", scale_x=1.03, scale_y=0.975, y=-2, overlay="heart-a"),
    FrameSpec("heart-b", scale_x=1.06, scale_y=0.95, y=-7, overlay="heart-b"),
    FrameSpec("yoyo-a", rotate=-1.0, x=-2, y=-1, overlay="yoyo-a"),
    FrameSpec("yoyo-b", rotate=1.0, x=2, y=-3, overlay="yoyo-b"),
    FrameSpec("yoyo-c", rotate=-0.8, x=-1, y=1, overlay="yoyo-c"),
    FrameSpec("dance-a", scale_x=1.02, scale_y=0.98, rotate=-5.0, x=-8, y=-7, overlay="dance-a"),
    FrameSpec("dance-b", scale_x=0.99, scale_y=1.018, rotate=0.0, x=0, y=-11, overlay="dance-b"),
    FrameSpec("dance-c", scale_x=1.02, scale_y=0.98, rotate=5.0, x=8, y=-7, overlay="dance-c"),
    FrameSpec("swing-a", rotate=-6.5, x=-13, y=2, overlay="swing-a"),
    FrameSpec("swing-b", rotate=0.0, x=0, y=-7, overlay="swing-b"),
    FrameSpec("swing-c", rotate=6.5, x=13, y=2, overlay="swing-c"),
]


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return (0, 0, FRAME_W, FRAME_H)
    return bbox


def transformed_sprite(source: Image.Image, spec: FrameSpec, personality: float) -> Image.Image:
    canvas = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    bbox = alpha_bbox(source)
    crop = source.crop(bbox)

    width = max(1, int(crop.width * spec.scale_x))
    height = max(1, int(crop.height * spec.scale_y))
    crop = crop.resize((width, height), Image.Resampling.LANCZOS)

    rotation = spec.rotate * personality
    if abs(rotation) > 0.01:
        crop = crop.rotate(rotation, resample=Image.Resampling.BICUBIC, expand=True)

    original_center_x = (bbox[0] + bbox[2]) / 2
    original_bottom = bbox[3]
    x = int(round(original_center_x - crop.width / 2 + spec.x * personality))
    y = int(round(original_bottom - crop.height + spec.y))
    canvas.alpha_composite(crop, (x, y))
    return canvas


def heart_points(cx: float, cy: float, size: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for index in range(40):
        t = math.tau * index / 40
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        points.append((cx + x * size, cy + y * size))
    return points


def draw_soft_ellipse(draw: ImageDraw.ImageDraw, xy: tuple[float, float, float, float], fill: tuple[int, int, int, int]) -> None:
    draw.ellipse(xy, fill=fill)


def draw_heart(draw: ImageDraw.ImageDraw, cx: float, cy: float, size: float, fill: tuple[int, int, int, int]) -> None:
    draw.polygon(heart_points(cx, cy, size), fill=fill)


def overlay_effect(frame: Image.Image, spec: FrameSpec, row: int) -> Image.Image:
    effect = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(effect)
    accent_cycle = [
        (216, 126, 140, 235),
        (142, 112, 189, 235),
        (110, 150, 81, 235),
        (217, 165, 62, 235),
        (94, 148, 176, 235),
    ]
    accent = accent_cycle[row % len(accent_cycle)]

    if spec.overlay in {"step-left", "step-right"}:
        side = -1 if spec.overlay == "step-left" else 1
        draw.arc((104 + side * 20, 330, 158 + side * 20, 356), 190, 330, fill=(142, 112, 189, 92), width=3)
        draw.arc((98 - side * 14, 336, 142 - side * 14, 360), 205, 335, fill=(217, 165, 62, 82), width=3)

    if spec.overlay == "blink":
        # A tiny glossy lid shimmer reads as a blink without trying to paint
        # over each keeper's unique eyes.
        draw.arc((92, 142, 116, 152), 200, 340, fill=(58, 42, 42, 135), width=2)
        draw.arc((140, 142, 164, 152), 200, 340, fill=(58, 42, 42, 135), width=2)

    if spec.overlay == "sparkle":
        for x, y, s in [(186, 116, 10), (200, 144, 6), (70, 122, 7)]:
            draw.line((x - s, y, x + s, y), fill=(255, 244, 214, 210), width=2)
            draw.line((x, y - s, x, y + s), fill=(255, 244, 214, 210), width=2)

    if spec.overlay == "sit-shadow":
        draw_soft_ellipse(draw, (76, 318, 180, 350), (58, 42, 42, 34))

    if spec.overlay == "sit-heart":
        draw_heart(draw, 187, 176, 0.44, (216, 126, 140, 210))

    if spec.overlay in {"sleep", "sleep-breathe"}:
        draw_soft_ellipse(draw, (70, 318, 188, 352), (58, 42, 42, 30))
        z_alpha = 220 if spec.overlay == "sleep" else 150
        draw.text((174, 118), "Z", fill=(142, 112, 189, z_alpha))
        draw.text((194, 96), "z", fill=(142, 112, 189, max(110, z_alpha - 45)))
        draw.text((210, 82), "z", fill=(142, 112, 189, max(80, z_alpha - 80)))

    if spec.overlay in {"wave-a", "wave-b", "wave-c"}:
        offset = {"wave-a": 0, "wave-b": -8, "wave-c": 6}[spec.overlay]
        for index in range(3):
            draw.arc((178 + index * 7, 104 + offset + index * 7, 216 + index * 8, 142 + offset + index * 8), -40, 48, fill=accent, width=3)

    if spec.overlay in {"heart-a", "heart-b"}:
        scale = 0.62 if spec.overlay == "heart-a" else 0.84
        draw_heart(draw, 194, 126, scale, (216, 126, 140, 232))
        draw_heart(draw, 64, 160, 0.34, (142, 112, 189, 180))
        if spec.overlay == "heart-b":
            draw_heart(draw, 128, 92, 0.28, (217, 165, 62, 190))

    if spec.overlay in {"yoyo-a", "yoyo-b", "yoyo-c"}:
        positions = {
            "yoyo-a": (183, 154, 183, 206),
            "yoyo-b": (188, 148, 188, 238),
            "yoyo-c": (180, 152, 180, 184),
        }
        x1, y1, x2, y2 = positions[spec.overlay]
        draw.line((x1, y1, x2, y2), fill=(142, 112, 189, 142), width=2)
        draw.ellipse((x2 - 11, y2 - 10, x2 + 11, y2 + 12), fill=(244, 182, 196, 235), outline=(255, 244, 214, 230), width=3)
        draw.ellipse((x2 + 3, y2 - 6, x2 + 7, y2 - 2), fill=(255, 255, 255, 210))

    if spec.overlay in {"dance-a", "dance-b", "dance-c"}:
        notes = [(188, 112, "♪"), (72, 124, "✦"), (202, 154, "♡")]
        for x, y, glyph in notes:
            draw.text((x, y), glyph, fill=accent)

    if spec.overlay in {"swing-a", "swing-b", "swing-c"}:
        lean = {"swing-a": -14, "swing-b": 0, "swing-c": 14}[spec.overlay]
        draw.line((86 + lean, 54, 106, 308), fill=(142, 112, 189, 118), width=4)
        draw.line((170 + lean, 54, 150, 308), fill=(142, 112, 189, 118), width=4)
        draw.rounded_rectangle((84, 306, 172, 324), radius=9, fill=(217, 165, 62, 150), outline=(255, 244, 214, 170), width=2)

    if effect.getchannel("A").getbbox():
        # Keep effects soft and integrated with the painterly assets.
        glow = effect.filter(ImageFilter.GaussianBlur(1.4))
        frame = Image.alpha_composite(glow, frame)
        frame = Image.alpha_composite(frame, effect)
    return frame


def make_frame(source: Image.Image, spec: FrameSpec, row: int) -> Image.Image:
    personality = 0.88 + (row % 4) * 0.075
    frame = transformed_sprite(source, spec, personality)
    return overlay_effect(frame, spec, row)


def main() -> None:
    missing = [name for name in KEEPERS if not (SOURCE_DIR / f"{name}.png").exists()]
    if missing:
        raise SystemExit(f"Missing keeper source portraits: {', '.join(missing)}")

    sheet = Image.new("RGBA", (FRAME_W * len(FRAMES), FRAME_H * len(KEEPERS)), (0, 0, 0, 0))
    for row, keeper in enumerate(KEEPERS):
        source = Image.open(SOURCE_DIR / f"{keeper}.png").convert("RGBA")
        if source.size != (FRAME_W, FRAME_H):
            source = source.resize((FRAME_W, FRAME_H), Image.Resampling.LANCZOS)
        for col, spec in enumerate(FRAMES):
            frame = make_frame(source, spec, row)
            sheet.alpha_composite(frame, (col * FRAME_W, row * FRAME_H))

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH, optimize=True)
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} ({len(KEEPERS)} rows x {len(FRAMES)} columns)")


if __name__ == "__main__":
    main()
