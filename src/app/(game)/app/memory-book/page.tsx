import { MemoryBookClient } from "@/app/(game)/app/memory-book/memory-book-client";

export const metadata = {
  title: "Announcements · HeartHaven",
  description: "Updates, gifts, and login bonuses from the HeartHaven team.",
};

export default function MemoryBookRoute() {
  return <MemoryBookClient />;
}
