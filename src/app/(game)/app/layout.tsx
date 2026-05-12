import { redirect } from "next/navigation";
import { GameShell } from "@/components/layout/game-shell";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (isSupabaseConfigured()) {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data?.claims?.sub) {
      redirect("/auth/sign-in?message=Sign in to enter your HeartHaven world.");
    }
  }

  return <GameShell>{children}</GameShell>;
}
