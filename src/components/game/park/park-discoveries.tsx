"use client";

import { useDiscoveries } from "@/lib/game/use-discoveries";

/**
 * Discoveries side-panel. Lists hidden + found items in the park (and
 * eventually any other zone we pipe in). "Found" rows go full-color; hidden
 * rows are dimmed and show "???". Items tagged `companion` get a small
 * "SNIFF" chip so the player knows the pet is the way in.
 */
export function ParkDiscoveries() {
  const { foundCount, total, all } = useDiscoveries("park");

  return (
    <section className="hh-card p-4">
      <div className="flex items-center justify-between">
        <p className="hh-eyebrow text-garden-700">Discoveries today</p>
        <span className="hh-chip text-[10px]">
          {foundCount} found · {Math.max(0, total - foundCount)} hidden
        </span>
      </div>
      <ul className="mt-2 grid gap-1.5">
        {all.map((item, index) => {
          const found = item.status === "found";
          return (
            <li
              key={item.id}
              className={`flex items-center gap-2 rounded-md border border-cream-200 bg-white/65 px-2 py-1.5 transition-opacity ${
                found ? "opacity-100" : "opacity-60"
              } ${index === all.length - 1 ? "" : ""}`}
            >
              <div className={`grid size-8 place-items-center rounded-md text-base ${found ? "bg-honey-100" : "bg-cream-200"}`}>
                <span aria-hidden>{found ? item.emoji : "?"}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-black text-ink-900">{found ? item.name : "???"}</p>
                <p className="truncate text-[10px] font-bold text-ink-500">
                  {found ? item.hint : "Sniff around to find this one."}
                </p>
              </div>
              {item.tag === "companion" && (
                <span className="rounded-full bg-lavender-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-normal text-lavender-500">
                  Sniff
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
