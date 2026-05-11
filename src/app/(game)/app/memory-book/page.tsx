import { MemoryBookClient } from "@/app/(game)/app/memory-book/memory-book-client";
import { memoryPages } from "@/lib/mock-data";

export default function MemoryBookRoute() {
  return <MemoryBookClient pages={memoryPages} />;
}
