#!/usr/bin/env python3
"""Validate and pack authored HeartHaven keeper animation frames.

This script deliberately does not synthesize poses from standing portraits.
Every runtime frame must exist as a pose-specific 320x384 RGBA source image.
Use --audit while art is incomplete; --build refuses to publish a sheet until
the full source set passes the quality gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "public/game-assets/source/keeper-animations"
SOURCE_MANIFEST = SOURCE_ROOT / "manifest.json"
TEMPORARY_SHEET = "/game-assets/generated/keepers/preset-animation-sheet-v2.png"
AUTHORED_SHEET = ROOT / "public/game-assets/generated/keepers/preset-animation-sheet-authored.png"
PUBLIC_METADATA = ROOT / "public/game-assets/generated/keepers/keeper-animation-manifest.json"
RUNTIME_METADATA = ROOT / "src/lib/game/keeper-animation-runtime.json"
CONTACT_SHEET = ROOT / "public/game-assets/generated/keepers/keeper-animation-contact-sheet.png"


@dataclass(frozen=True)
class FrameGroup:
    name: str
    count: int
    frame_duration_ms: int
    loop: bool


def read_manifest() -> dict[str, Any]:
    return json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))


def load_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def source_path(character_id: str, group_name: str, frame_index: int) -> Path:
    return SOURCE_ROOT / character_id / group_name / f"{frame_index:02d}.png"


def image_digest(image: Image.Image) -> str:
    return hashlib.sha256(image.tobytes()).hexdigest()


def validate_frame(
    path: Path,
    frame_width: int,
    frame_height: int,
    anchor_x: int,
    anchor_y: int,
) -> tuple[Image.Image | None, list[str]]:
    issues: list[str] = []
    if not path.exists():
        return None, ["missing"]

    with Image.open(path) as opened:
        if opened.size != (frame_width, frame_height):
            issues.append(f"wrong-size:{opened.width}x{opened.height}")
        if opened.mode != "RGBA":
            issues.append(f"wrong-mode:{opened.mode}")
        image = opened.convert("RGBA")

    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        issues.append("empty-alpha")
        return image, issues

    corner_alpha = max(
        alpha.getpixel((0, 0)),
        alpha.getpixel((frame_width - 1, 0)),
        alpha.getpixel((0, frame_height - 1)),
        alpha.getpixel((frame_width - 1, frame_height - 1)),
    )
    if corner_alpha > 4:
        issues.append("non-transparent-corner")

    visual_center_x = (bbox[0] + bbox[2]) / 2
    if abs(visual_center_x - anchor_x) > 44:
        issues.append(f"anchor-x-drift:{visual_center_x:.1f}")
    if abs(bbox[3] - anchor_y) > 18:
        issues.append(f"anchor-y-drift:{bbox[3]}")

    return image, issues


def group_offsets(groups: list[FrameGroup]) -> dict[str, int]:
    offsets: dict[str, int] = {}
    cursor = 0
    for group in groups:
        offsets[group.name] = cursor
        cursor += group.count
    return offsets


def make_contact_sheet(
    manifest: dict[str, Any],
    availability: dict[str, dict[str, list[Path]]],
) -> None:
    frame_width = int(manifest["frameSize"]["width"])
    frame_height = int(manifest["frameSize"]["height"])
    preview_groups = ["idle", "walkRight", "sit", "sleep", "wave"]
    preview_labels = ["IDLE", "WALK", "SIT", "SLEEP", "WAVE"]
    card_width = 170
    card_height = 236
    label_width = 190
    header_height = 112
    row_height = 260
    width = label_width + card_width * len(preview_groups) + 40
    height = header_height + row_height * len(manifest["characters"]) + 30
    sheet = Image.new("RGB", (width, height), "#fffaf0")
    draw = ImageDraw.Draw(sheet)
    title_font = load_font(28, bold=True)
    body_font = load_font(16)
    label_font = load_font(18, bold=True)
    small_font = load_font(13, bold=True)

    draw.text((24, 20), "KEEPER POSE ART QUALITY GATE", fill="#3a2a2a", font=title_font)
    draw.text(
        (24, 58),
        "Only authored pose sources appear here. Missing cells block the production sheet.",
        fill="#7b6262",
        font=body_font,
    )
    for column, label in enumerate(preview_labels):
        draw.text((label_width + column * card_width + 50, 84), label, fill="#5b3f3f", font=small_font)

    for row, character in enumerate(manifest["characters"]):
        character_id = character["id"]
        y = header_height + row * row_height
        draw.rounded_rectangle((16, y + 6, width - 16, y + row_height - 8), radius=18, fill="#fffdf8", outline="#ead9b8", width=2)
        draw.text((30, y + 32), character["label"], fill="#3a2a2a", font=label_font)
        draw.text((30, y + 62), character_id, fill="#8c7474", font=body_font)

        for column, group_name in enumerate(preview_groups):
            x = label_width + column * card_width
            box = (x + 8, y + 16, x + card_width - 8, y + card_height)
            paths = availability[character_id][group_name]
            if paths:
                with Image.open(paths[0]) as opened:
                    frame = opened.convert("RGBA")
                preview = frame.copy()
                preview.thumbnail((card_width - 28, card_height - 34), Image.Resampling.LANCZOS)
                px = x + (card_width - preview.width) // 2
                py = y + 18 + (card_height - 34 - preview.height)
                sheet.paste(preview.convert("RGB"), (px, py), preview.getchannel("A"))
                draw.rounded_rectangle(box, radius=14, outline="#b9d6a6", width=3)
                draw.text((x + 18, y + card_height - 26), "AUTHORED SOURCE", fill="#52743d", font=small_font)
            else:
                draw.rounded_rectangle(box, radius=14, fill="#f5e5e7", outline="#df9aa5", width=3)
                draw.line((box[0] + 16, box[1] + 16, box[2] - 16, box[3] - 38), fill="#df9aa5", width=4)
                draw.line((box[2] - 16, box[1] + 16, box[0] + 16, box[3] - 38), fill="#df9aa5", width=4)
                draw.text((x + 30, y + 104), "MISSING", fill="#9d3f50", font=label_font)
                draw.text((x + 22, y + 132), "POSE SOURCE", fill="#9d3f50", font=small_font)

    CONTACT_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET, optimize=True)


def audit(manifest: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Image.Image], bool]:
    frame_width = int(manifest["frameSize"]["width"])
    frame_height = int(manifest["frameSize"]["height"])
    anchor_x = int(manifest["anchor"]["x"])
    anchor_y = int(manifest["anchor"]["y"])
    groups = [
        FrameGroup(
            name=group["name"],
            count=int(group["frameCount"]),
            frame_duration_ms=int(group["frameDurationMs"]),
            loop=bool(group["loop"]),
        )
        for group in manifest["animations"]
    ]
    offsets = group_offsets(groups)
    frames_per_character = sum(group.count for group in groups)
    validated_images: dict[str, Image.Image] = {}
    readiness: dict[str, Any] = {}
    contact_availability: dict[str, dict[str, list[Path]]] = {}
    complete = True

    for row, character in enumerate(manifest["characters"]):
        character_id = character["id"]
        character_issues: list[dict[str, Any]] = []
        animation_metadata: dict[str, Any] = {}
        seen_digests: dict[str, str] = {}
        contact_availability[character_id] = {}

        for group in groups:
            available_paths: list[Path] = []
            available_count = 0
            for frame_index in range(group.count):
                path = source_path(character_id, group.name, frame_index)
                image, issues = validate_frame(path, frame_width, frame_height, anchor_x, anchor_y)
                if image is not None and not issues:
                    digest = image_digest(image)
                    previous = seen_digests.get(digest)
                    if previous is not None:
                        issues.append(f"duplicate-pixels:{previous}")
                    else:
                        seen_digests[digest] = f"{group.name}/{frame_index:02d}"
                        validated_images[f"{character_id}/{group.name}/{frame_index:02d}"] = image
                        available_paths.append(path)
                        available_count += 1
                if issues:
                    complete = False
                    character_issues.append({"frame": f"{group.name}/{frame_index:02d}", "issues": issues})

            contact_availability[character_id][group.name] = available_paths
            start = row * frames_per_character + offsets[group.name]
            animation_metadata[group.name] = {
                "start": start,
                "end": start + group.count - 1,
                "frameCount": group.count,
                "availableFrames": available_count,
                "frameDurationMs": group.frame_duration_ms,
                "loop": group.loop,
            }

        readiness[character_id] = {
            "row": row,
            "ready": not character_issues,
            "animations": animation_metadata,
            "issues": character_issues,
        }

    make_contact_sheet(manifest, contact_availability)
    metadata = {
        "schemaVersion": 1,
        "artStatus": "pose-authored" if complete else "temporary-transform",
        "productionReady": complete,
        "runtime": {
            "sheetPath": "/game-assets/generated/keepers/preset-animation-sheet-authored.png" if complete else TEMPORARY_SHEET,
            "frameColumns": frames_per_character if complete else 26,
            "frameWidth": frame_width if complete else 256,
            "frameHeight": frame_height,
        },
        "target": {
            "frameColumns": frames_per_character,
            "frameWidth": frame_width,
            "frameHeight": frame_height,
            "anchor": manifest["anchor"],
        },
        "characters": readiness,
    }
    PUBLIC_METADATA.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_METADATA.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    runtime_metadata = {
        "productionReady": metadata["productionReady"],
        "artStatus": metadata["artStatus"],
        **metadata["runtime"],
    }
    RUNTIME_METADATA.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_METADATA.write_text(json.dumps(runtime_metadata, indent=2) + "\n", encoding="utf-8")
    return metadata, validated_images, complete


def build_sheet(manifest: dict[str, Any], validated_images: dict[str, Image.Image]) -> None:
    frame_width = int(manifest["frameSize"]["width"])
    frame_height = int(manifest["frameSize"]["height"])
    groups = [FrameGroup(group["name"], int(group["frameCount"]), int(group["frameDurationMs"]), bool(group["loop"])) for group in manifest["animations"]]
    frames_per_character = sum(group.count for group in groups)
    sheet = Image.new(
        "RGBA",
        (frame_width * frames_per_character, frame_height * len(manifest["characters"])),
        (0, 0, 0, 0),
    )
    for row, character in enumerate(manifest["characters"]):
        column = 0
        for group in groups:
            for frame_index in range(group.count):
                key = f"{character['id']}/{group.name}/{frame_index:02d}"
                sheet.alpha_composite(validated_images[key], (column * frame_width, row * frame_height))
                column += 1
    AUTHORED_SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(AUTHORED_SHEET, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true", help="Publish the authored runtime sheet after a clean audit.")
    args = parser.parse_args()
    manifest = read_manifest()
    metadata, validated_images, complete = audit(manifest)
    issue_count = sum(len(character["issues"]) for character in metadata["characters"].values())
    print(f"Keeper animation audit: {'PASS' if complete else 'REJECTED'} ({issue_count} frame issues)")
    print(f"Contact sheet: {CONTACT_SHEET.relative_to(ROOT)}")
    print(f"Metadata: {PUBLIC_METADATA.relative_to(ROOT)}")
    if args.build:
        if not complete:
            raise SystemExit("Refusing to publish: pose-specific keeper source art is incomplete or invalid.")
        build_sheet(manifest, validated_images)
        print(f"Authored sheet: {AUTHORED_SHEET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
