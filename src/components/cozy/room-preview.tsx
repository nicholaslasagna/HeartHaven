import Link from "next/link";
import { ArrowRight, LockKeyhole, UsersRound } from "lucide-react";
import { CozyButton } from "@/components/cozy/cozy-button";
import { CozyCard } from "@/components/cozy/cozy-card";
import { Badge } from "@/components/ui/badge";
import { roomBlueprints } from "@/lib/catalog";

export function RoomPreview() {
  const [starterRoom, ...unlockableRooms] = roomBlueprints;

  return (
    <CozyCard className="overflow-hidden">
      <div className="relative h-48 bg-cream-100">
        <div className="absolute inset-x-8 bottom-4 h-24 rounded-lg border-2 border-cream-300 bg-cream-200" />
        <div className="absolute left-12 top-8 h-20 w-24 rounded-md border-4 border-ink-500/50 bg-sky-200" />
        <div className="absolute bottom-8 left-1/2 h-16 w-36 -translate-x-1/2 rounded-[50%] border-2 border-blush-300 bg-blush-200" />
        <div className="absolute bottom-10 right-16 h-14 w-9 rounded-md border-4 border-ink-500/55 bg-honey-100" />
        <div className="absolute bottom-10 left-20 h-16 w-20 rounded-md border-2 border-lavender-500/40 bg-lavender-200" />
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
