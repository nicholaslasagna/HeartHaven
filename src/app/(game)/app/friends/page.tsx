import { FriendsClient } from "@/app/(game)/app/friends/friends-client";

export const metadata = {
  title: "Friends · HeartHaven",
  description: "Your private circle: friend code, invite inbox, played-with, gifts, blocks, and reports.",
};

export default function FriendsPage() {
  return <FriendsClient />;
}
