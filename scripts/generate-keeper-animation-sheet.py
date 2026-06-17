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
OUT_PATH = ROOT / "public/game-assets/generated/keepers/preset-animation-sheet-v2.png"
LEGACY_OUT_PATH = ROOT / "public/game-assets/generated/keepers/preset-animation-sheet.png"
INDIVIDUAL_OUT_DIR = ROOT / "public/game-assets/generated/keepers/animation-sheets-v2"

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
    FrameSpec("idle-blink", scale_y=0.986, y=2, overlay="blink"),
    FrameSpec("idle-breathe", scale_x=1.018, scale_y=0.986, y=-3),
    FrameSpec("idle-look", rotate=-1.8, x=-2, y=0, overlay="sparkle"),
    FrameSpec("walk-left-step", scale_x=1.055, scale_y=0.93, rotate=-8.8, x=-17, y=-8, overlay="step-left"),
    FrameSpec("walk-left-mid", scale_x=0.965, scale_y=1.035, rotate=-2.8, x=-8, y=-13, overlay="step-mid-left"),
    FrameSpec("walk-right-step", scale_x=1.055, scale_y=0.93, rotate=8.8, x=17, y=-8, overlay="step-right"),
    FrameSpec("walk-right-mid", scale_x=0.965, scale_y=1.035, rotate=2.8, x=8, y=-13, overlay="step-mid-right"),
    FrameSpec("sit-a", scale_x=1.08, scale_y=0.72, y=74, overlay="sit-shadow"),
    FrameSpec("sit-b", scale_x=1.065, scale_y=0.705, rotate=-2.0, y=80, overlay="sit-heart"),
    FrameSpec("sleep-a", scale_x=0.9, scale_y=0.68, rotate=-68, x=-8, y=76, overlay="sleep"),
    FrameSpec("sleep-b", scale_x=0.92, scale_y=0.66, rotate=-64, x=-2, y=82, overlay="sleep-breathe"),
    FrameSpec("wave-a", rotate=-4.0, x=-4, y=-3, overlay="wave-a"),
    FrameSpec("wave-b", rotate=5.2, x=8, y=-9, overlay="wave-b"),
    FrameSpec("wave-c", rotate=-3.0, x=-3, y=-3, overlay="wave-c"),
    FrameSpec("heart-a", scale_x=1.045, scale_y=0.955, y=-3, overlay="heart-a"),
    FrameSpec("heart-b", scale_x=1.085, scale_y=0.925, y=-10, overlay="heart-b"),
    FrameSpec("yoyo-a", rotate=-2.8, x=-5, y=-2, overlay="yoyo-a"),
    FrameSpec("yoyo-b", rotate=2.8, x=5, y=-7, overlay="yoyo-b"),
    FrameSpec("yoyo-c", rotate=-2.2, x=-3, y=3, overlay="yoyo-c"),
    FrameSpec("dance-a", scale_x=1.045, scale_y=0.952, rotate=-9.5, x=-16, y=-10, overlay="dance-a"),
    FrameSpec("dance-b", scale_x=0.97, scale_y=1.04, rotate=0.0, x=0, y=-17, overlay="dance-b"),
    FrameSpec("dance-c", scale_x=1.045, scale_y=0.952, rotate=9.5, x=16, y=-10, overlay="dance-c"),
    FrameSpec("swing-a", rotate=-13.5, x=-25, y=8, overlay="swing-a"),
    FrameSpec("swing-b", rotate=0.0, x=0, y=-12, overlay="swing-b"),
    FrameSpec("swing-c", rotate=13.5, x=25, y=8, overlay="swing-c"),
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
    if spec.name.startswith("sleep-"):
        x = int(round(FRAME_W / 2 - crop.width / 2 + spec.x * personality))
        y = int(round(286 - crop.height / 2 + spec.y * 0.1))
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

    if spec.overlay in {"step-left", "step-right", "step-mid-left", "step-mid-right"}:
        side = -1 if "left" in spec.overlay else 1
        intensity = 122 if "mid" not in spec.overlay else 82
        draw.arc((98 + side * 24, 322, 166 + side * 24, 364), 190, 330, fill=(142, 112, 189, intensity), width=4)
        draw.arc((82 - side * 16, 334, 150 - side * 16, 366), 205, 335, fill=(217, 165, 62, max(70, intensity - 28)), width=4)
        draw.ellipse((98 + side * 34, 346, 150 + side * 34, 358), fill=(58, 42, 42, 26))

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
        draw_soft_ellipse(draw, (58, 322, 198, 356), (58, 42, 42, 42))
        draw.rounded_rectangle((76, 285, 180, 326), radius=18, fill=(255, 244, 214, 72))

    if spec.overlay == "sit-heart":
        draw_soft_ellipse(draw, (58, 322, 198, 356), (58, 42, 42, 38))
        draw_heart(draw, 190, 174, 0.5, (216, 126, 140, 220))

    if spec.overlay in {"sleep", "sleep-breathe"}:
        draw_soft_ellipse(draw, (48, 318, 208, 354), (58, 42, 42, 34))
        z_alpha = 220 if spec.overlay == "sleep" else 150
        draw.text((174, 100), "Z", fill=(142, 112, 189, z_alpha))
        draw.text((197, 78), "z", fill=(142, 112, 189, max(110, z_alpha - 45)))
        draw.text((214, 62), "z", fill=(142, 112, 189, max(80, z_alpha - 80)))

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
        lean = {"swing-a": -28, "swing-b": 0, "swing-c": 28}[spec.overlay]
        draw.line((76 + lean, 34, 104, 310), fill=(142, 112, 189, 145), width=5)
        draw.line((180 + lean, 34, 152, 310), fill=(142, 112, 189, 145), width=5)
        draw.rounded_rectangle((74, 304, 182, 326), radius=10, fill=(217, 165, 62, 182), outline=(255, 244, 214, 205), width=3)
        draw.arc((54 + lean * 0.45, 252, 202 + lean * 0.45, 350), 24, 156, fill=(255, 244, 214, 85), width=3)

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
    INDIVIDUAL_OUT_DIR.mkdir(parents=True, exist_ok=True)
    for row, keeper in enumerate(KEEPERS):
        source = Image.open(SOURCE_DIR / f"{keeper}.png").convert("RGBA")
        if source.size != (FRAME_W, FRAME_H):
            source = source.resize((FRAME_W, FRAME_H), Image.Resampling.LANCZOS)
        row_sheet = Image.new("RGBA", (FRAME_W * len(FRAMES), FRAME_H), (0, 0, 0, 0))
        for col, spec in enumerate(FRAMES):
            frame = make_frame(source, spec, row)
            sheet.alpha_composite(frame, (col * FRAME_W, row * FRAME_H))
            row_sheet.alpha_composite(frame, (col * FRAME_W, 0))
        row_sheet.save(INDIVIDUAL_OUT_DIR / f"{keeper}.png", optimize=True)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_PATH, optimize=True)
    sheet.save(LEGACY_OUT_PATH, optimize=True)
    print(f"Wrote {OUT_PATH.relative_to(ROOT)} ({len(KEEPERS)} rows x {len(FRAMES)} columns)")


if __name__ == "__main__":
    main()
