"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCachedPublicUsername, resolvePublicUsername } from "@/lib/game/public-identity";

export function KeeperAccountButton() {
  const [username, setUsername] = useState(getCachedPublicUsername());

  useEffect(() => {
    let cancelled = false;
    void resolvePublicUsername().then((next) => {
      if (!cancelled) setUsername(next);
    });
    const sync = (event: Event) => {
      const next = (event as CustomEvent<{ username?: string }>).detail?.username;
      setUsername(next ?? getCachedPublicUsername());
    };
    window.addEventListener("hearthaven:public-username-changed", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("hearthaven:public-username-changed", sync);
    };
  }, []);

  return (
    <Button asChild variant="warm" size="sm">
      <Link href="/app/account">
        <UserRound /> @{username}
      </Link>
    </Button>
  );
}
