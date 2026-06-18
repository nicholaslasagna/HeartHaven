# Keeper animation source contract

The runtime sheet may only be built from pose-specific source art. A standing
portrait must never be rotated, squashed, shifted, or resized to impersonate a
walk, seated, sleeping, or emote frame.

Each source file must be a `320x384` RGBA PNG with transparent corners. The
extra width allows real waves and side steps without shrinking those poses.
Place the character's floor contact at `(160, 352)` in every frame. Filenames are
zero-padded and follow this structure:

```text
<character-id>/
  idle/00.png ... 01.png
  walkSide/00.png ... 03.png
  walkDown/00.png ... 01.png
  walkUp/00.png ... 01.png
  sit/00.png ... 01.png
  sleep/00.png ... 01.png
  wave/00.png ... 01.png
```

Run the non-destructive audit while sources are incomplete:

```bash
python3 scripts/generate-keeper-animation-sheet.py
```

It produces a contact sheet and metadata, but does not publish a production
sheet. Once all frames are real poses, publish with:

```bash
python3 scripts/generate-keeper-animation-sheet.py --build
```

The build rejects missing frames, wrong dimensions, opaque corners, anchor
drift, and exact duplicate pixels. Generated art should use one keeper portrait
as the identity reference and a separate prompt for each animation group. Keep
hair, face, skin tone, outfit, palette, and accessories invariant while changing
the body pose itself.
