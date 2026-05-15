import {
  Award,
  Calendar,
  Coins,
  Flame,
  Gamepad2,
  HandHeart,
  Heart,
  Home,
  Leaf,
  ListChecks,
  Medal,
  Moon,
  PawPrint,
  PiggyBank,
  Sparkles,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react";

/**
 * Resolves the string `icon` names stored on daily tasks + achievement defs
 * into real lucide components. Kept in one place so the data modules can stay
 * plain data (no React imports) and the UI just looks the icon up.
 */
const ICONS: Record<string, LucideIcon> = {
  Award,
  Calendar,
  Coins,
  Flame,
  Gamepad2,
  HandHeart,
  Heart,
  Home,
  Leaf,
  ListChecks,
  Medal,
  Moon,
  PawPrint,
  PiggyBank,
  Sparkles,
  Star,
  Trophy,
};

export function GameIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Star;
  return <Icon className={className} />;
}
