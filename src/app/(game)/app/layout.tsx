import { GameShell } from "@/components/layout/game-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <GameShell>{children}</GameShell>;
}
