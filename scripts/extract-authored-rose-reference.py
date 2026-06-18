#!/usr/bin/env python3
"""Extract the existing hand-authored Rose poses into normalized source cells.

The input must already have alpha (use remove_chroma_key.py on anim-ref.png).
This preserves the distinct drawn poses; it does not create animation frames.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "public/game-assets/source/keeper-animations/rose-waves"
FRAME_SIZE = (320, 384)
ANCHOR = (160, 352)
CROPS = {
    "idle/00.png": (20, 10, 315, 438),
    "walkLeft/00.png": (305, 10, 625, 438),
    "walkRight/00.png": (610, 10, 940, 438),
    "sit/00.png": (925, 10, 1225, 438),
    "wave/00.png": (1200, 10, 1498, 438),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Chroma-removed RGBA reference sheet")
    args = parser.parse_args()
    source = Image.open(args.input).convert("RGBA")

    idle = source.crop(CROPS["idle/00.png"])
    idle_bbox = idle.getchannel("A").getbbox()
    if idle_bbox is None:
        raise SystemExit("The idle crop is empty; check the input alpha.")
    authored_scale = 338 / (idle_bbox[3] - idle_bbox[1])

    for relative_path, crop_box in CROPS.items():
        crop = source.crop(crop_box)
        bbox = crop.getchannel("A").getbbox()
        if bbox is None:
            raise SystemExit(f"Empty authored pose crop: {relative_path}")
        pose = crop.crop(bbox)
        pose = pose.resize(
            (max(1, round(pose.width * authored_scale)), max(1, round(pose.height * authored_scale))),
            Image.Resampling.LANCZOS,
        )
        if pose.width > FRAME_SIZE[0] - 8 or pose.height > FRAME_SIZE[1] - 8:
            raise SystemExit(f"Authored pose does not fit the source cell: {relative_path} ({pose.size})")
        frame = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
        x = ANCHOR[0] - pose.width // 2
        y = ANCHOR[1] - pose.height
        frame.alpha_composite(pose, (x, y))
        destination = OUTPUT_ROOT / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        frame.save(destination, optimize=True)
        print(destination.relative_to(ROOT))


if __name__ == "__main__":
    main()
