"use client";

import { useEffect, useRef, useState } from "react";
import type { RoomPlacement } from "@/lib/game/types";

type RoomCanvasProps = {
  placements: RoomPlacement[];
};

export function RoomCanvas({ placements }: RoomCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Loading room renderer");

  useEffect(() => {
    let destroyed = false;
    let game: { destroy: (removeCanvas: boolean, noReturn?: boolean) => void } | null = null;

    async function boot() {
      const Phaser = await import("phaser");

      if (!mountRef.current || destroyed) return;

      class RoomScene extends Phaser.Scene {
        private avatar?: Phaser.GameObjects.Arc;
        private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

        constructor() {
          super("HeartHavenRoom");
        }

        create() {
          this.cameras.main.setBackgroundColor("#FBEEDC");

          const floor = this.add.graphics();
          floor.fillStyle(0xf5e9d0, 1);
          floor.fillRoundedRect(54, 88, 692, 384, 14);
          floor.lineStyle(3, 0x8b5e3c, 0.28);
          floor.strokeRoundedRect(54, 88, 692, 384, 14);

          // TODO: Load and save these placements through Supabase placed_items.
          placements
            .slice()
            .sort((a, b) => a.zIndex - b.zIndex)
            .forEach((placement) => {
              drawPlacedItem(this, placement, (label) => {
                if (!destroyed) setStatus(`Selected ${label}`);
              });
            });

          this.add.text(28, 24, "Personal Room", {
            color: "#3A2A2A",
            fontFamily: "Nunito, sans-serif",
            fontSize: "18px",
            fontStyle: "700",
          });

          this.avatar = this.add.circle(400, 330, 18, 0xd87e8c).setStrokeStyle(3, 0x8b5e3c);
          this.add.circle(392, 324, 3, 0x3a2a2a);
          this.add.circle(408, 324, 3, 0x3a2a2a);
          this.add.circle(442, 336, 15, 0xfffcf3).setStrokeStyle(2, 0xe6d2be);
          this.add.circle(438, 332, 2.5, 0x3a2a2a);
          this.add.circle(447, 332, 2.5, 0x3a2a2a);

          this.cursors = this.input.keyboard?.createCursorKeys();
          // TODO: Broadcast avatar movement over Supabase Realtime room presence.
        }

        update() {
          if (!this.avatar || !this.cursors) return;

          const speed = 2.4;
          if (this.cursors.left.isDown) this.avatar.x -= speed;
          if (this.cursors.right.isDown) this.avatar.x += speed;
          if (this.cursors.up.isDown) this.avatar.y -= speed;
          if (this.cursors.down.isDown) this.avatar.y += speed;

          this.avatar.x = Phaser.Math.Clamp(this.avatar.x, 84, 716);
          this.avatar.y = Phaser.Math.Clamp(this.avatar.y, 128, 434);
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: mountRef.current,
        width: 800,
        height: 500,
        backgroundColor: "#FBEEDC",
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: RoomScene,
      });

      setStatus("Use arrow keys to move. Click furniture to inspect it.");
    }

    boot().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Unable to load Phaser");
    });

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, [placements]);

  return (
    <div className="overflow-hidden rounded-lg border border-cream-300 bg-cream-100 shadow-sm">
      <div ref={mountRef} className="min-h-[280px] w-full [&_canvas]:!h-auto [&_canvas]:!w-full" />
      <div className="border-t border-cream-300 bg-white/70 px-4 py-2 text-xs font-extrabold text-ink-700">
        {status}
      </div>
    </div>
  );
}

function drawPlacedItem(scene: Phaser.Scene, placement: RoomPlacement, onSelect: (label: string) => void) {
  const label = placement.catalogItemId
    .split("-")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  if (placement.catalogItemId.includes("rug")) {
    scene.add.ellipse(placement.x, placement.y, 176, 76, 0xf6cfd2).setStrokeStyle(3, 0xd87e8c, 0.45);
    addClickTarget(scene, placement.x, placement.y, 176, 76, label, onSelect);
    return;
  }

  if (placement.catalogItemId.includes("window")) {
    scene.add.rectangle(placement.x, placement.y, 108, 96, 0xc7e0eb).setStrokeStyle(4, 0x8b5e3c, 0.7);
    scene.add.line(placement.x, placement.y, -54, 0, 54, 0, 0x8b5e3c, 0.6);
    scene.add.line(placement.x, placement.y, 0, -48, 0, 48, 0x8b5e3c, 0.6);
    addClickTarget(scene, placement.x, placement.y, 108, 96, label, onSelect);
    return;
  }

  if (placement.catalogItemId.includes("lantern")) {
    scene.add.rectangle(placement.x, placement.y, 36, 56, 0xfaebc2).setStrokeStyle(3, 0x8b5e3c, 0.8);
    scene.add.circle(placement.x, placement.y + 4, 11, 0xd9a53e, 0.75);
    addClickTarget(scene, placement.x, placement.y, 48, 68, label, onSelect);
    return;
  }

  if (placement.catalogItemId.includes("chair")) {
    scene.add.rectangle(placement.x, placement.y, 80, 76, 0xddceec).setStrokeStyle(3, 0x8e70bd, 0.5);
    scene.add.rectangle(placement.x, placement.y + 36, 92, 18, 0xc0a8dc);
    addClickTarget(scene, placement.x, placement.y, 98, 92, label, onSelect);
    return;
  }

  scene.add.text(placement.x, placement.y, label, {
    color: "#5B3F3F",
    fontFamily: "Nunito, sans-serif",
    fontSize: "12px",
  });
  addClickTarget(scene, placement.x, placement.y, 120, 52, label, onSelect);
}

function addClickTarget(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  onSelect: (label: string) => void,
) {
  scene.add
    .zone(x, y, width, height)
    .setInteractive({ useHandCursor: true })
    .on("pointerdown", () => onSelect(label));
}
