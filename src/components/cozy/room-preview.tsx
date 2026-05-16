import Link from "next/link";
import Image from "next/image";
import { ArrowRight, LockKeyhole, UsersRound } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { roomBlueprints } from "@/lib/catalog";

export function RoomPreview() {
  const [starterRoom, ...unlockableRooms] = roomBlueprints;

  return (
    <CozyCard className="overflow-hidden">
      <div className="relative h-56 overflow-hidden bg-cream-100">
        <Image
          alt="Painted cozy room preview"
          className="h-full w-full object-cover"
          height={600}
          priority
          src="/game-assets/generated/cozy-room-bg.png"
          width={960}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/38 via-transparent to-white/12" />
        <div className="absolute bottom-4 left-4 rounded-full border border-white/60 bg-white/78 px-3 py-1 text-xs font-black text-ink-800 shadow-sm backdrop-blur">
          Drag-and-drop decor
        </div>
      </div>
      <div className="p-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge variant="garden">
            <UsersRound className="size-3.5" /> {starterRoom.capacity} players
          </Badge>
          <Badge variant="outline">2.5D decoratable</Badge>
        </div>
        <h2 className="font-display text-3xl text-ink-900">{starterRoom.name}</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-ink-700">
          {starterRoom.description}
        </p>
        <CozyButton asChild className="mt-4">
          <Link href={starterRoom.href}>
            Open room <ArrowRight />
          </Link>
        </CozyButton>
        <div className="mt-5 grid gap-2">
          {unlockableRooms.slice(0, 3).map((room) => (
            <Link
              className="flex items-center justify-between rounded-lg border border-cream-300 bg-cream-50/80 px-3 py-2 text-sm font-black text-ink-800 transition hover:border-blush-300 hover:bg-blush-100/40"
              href={room.href}
              key={room.id}
            >
              <span className="inline-flex items-center gap-2">
                <LockKeyhole className="size-4 text-honey-700" /> {room.name}
              </span>
              <span className="text-xs text-ink-500">{room.priceCoins}c / {room.priceHearts}h</span>
            </Link>
          ))}
        </div>
      </div>
    </CozyCard>
  );
}
