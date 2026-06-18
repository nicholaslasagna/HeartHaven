#!/usr/bin/env python3
"""Extract real keeper poses from chroma-removed 4x4 source sheets."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "art/keeper-animations"
FRAME_SIZE = (320, 384)
ANCHOR = (160, 352)
TARGET_IDLE_HEIGHT = 320
CELL_MAP = {
    "idle": [(0, 0), (0, 1)],
    "sit": [(0, 2), (0, 3)],
    "walkSide": [(1, 0), (1, 1), (1, 2), (1, 3)],
    "walkDown": [(2, 0), (2, 1)],
    "walkUp": [(2, 2), (2, 3)],
    "sleep": [(3, 0), (3, 1)],
    "wave": [(3, 2), (3, 3)],
}


def crop_cell(sheet: Image.Image, row: int, column: int) -> Image.Image:
    width, height = sheet.size
    box = (
        round(column * width / 4),
        round(row * height / 4),
        round((column + 1) * width / 4),
        round((row + 1) * height / 4),
    )
    return sheet.crop(box)


def largest_component_bbox(alpha: Image.Image) -> tuple[int, int, int, int] | None:
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    largest: tuple[int, int, int, int, int] | None = None

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if visited[start_index] or pixels[start_x, start_y] <= 32:
                continue
            visited[start_index] = 1
            stack = [(start_x, start_y)]
            area = 0
            min_x = max_x = start_x
            min_y = max_y = start_y
            while stack:
                x, y = stack.pop()
                area += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                    for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                        index = neighbor_y * width + neighbor_x
                        if visited[index] or pixels[neighbor_x, neighbor_y] <= 32:
                            continue
                        visited[index] = 1
                        stack.append((neighbor_x, neighbor_y))
            candidate = (area, min_x, min_y, max_x + 1, max_y + 1)
            if largest is None or candidate[0] > largest[0]:
                largest = candidate

    return None if largest is None else largest[1:]


def pose_crop(cell: Image.Image) -> Image.Image:
    bbox = largest_component_bbox(cell.getchannel("A"))
    if bbox is None:
        raise ValueError("empty pose cell")
    return cell.crop(bbox)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("alpha_dir", type=Path, help="Directory of chroma-removed <keeper-id>.png sheets")
    args = parser.parse_args()

    for sheet_path in sorted(args.alpha_dir.glob("*.png")):
        character_id = sheet_path.stem
        sheet = Image.open(sheet_path).convert("RGBA")
        idle = pose_crop(crop_cell(sheet, 0, 0))
        scale = TARGET_IDLE_HEIGHT / idle.height
        destination_root = SOURCE_ROOT / character_id

        for group_name, cells in CELL_MAP.items():
            group_dir = destination_root / group_name
            if group_dir.exists():
                shutil.rmtree(group_dir)
            group_dir.mkdir(parents=True, exist_ok=True)
            for index, (row, column) in enumerate(cells):
                pose = pose_crop(crop_cell(sheet, row, column))
                pose = pose.resize(
                    (max(1, round(pose.width * scale)), max(1, round(pose.height * scale))),
                    Image.Resampling.LANCZOS,
                )
                if pose.width > FRAME_SIZE[0] - 4 or pose.height > FRAME_SIZE[1] - 4:
                    fit = min((FRAME_SIZE[0] - 4) / pose.width, (FRAME_SIZE[1] - 4) / pose.height)
                    pose = pose.resize(
                        (max(1, round(pose.width * fit)), max(1, round(pose.height * fit))),
                        Image.Resampling.LANCZOS,
                    )
                frame = Image.new("RGBA", FRAME_SIZE, (0, 0, 0, 0))
                frame.alpha_composite(pose, (ANCHOR[0] - pose.width // 2, ANCHOR[1] - pose.height))
                frame.save(group_dir / f"{index:02d}.png", optimize=True)

        print(f"Extracted authored poses for {character_id}")


if __name__ == "__main__":
    main()
