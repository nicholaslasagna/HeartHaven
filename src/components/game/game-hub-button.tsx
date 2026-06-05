"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type GameHubButtonProps = {
  returnToLobby: () => Promise<unknown>;
  label?: string;
};

export function GameHubButton({ returnToLobby, label = "Games hub" }: GameHubButtonProps) {
  return (
    <Button onClick={() => void returnToLobby()} variant="secondary">
      <ArrowLeft /> {label}
    </Button>
  );
}
