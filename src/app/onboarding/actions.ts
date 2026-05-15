"use server";

import { redirect } from "next/navigation";
import { starterCatalog, starterPlacements } from "@/lib/catalog";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function cleanText(value: FormDataEntryValue | null, fallback: string) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : fallback;
}

function cleanUsername(value: FormDataEntryValue | null, fallback: string) {
  return String(value ?? fallback)
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || fallback;
}

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 42) || "main";
}

async function requireUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in?message=Sign in before creating your keeper profile.");
  }

  return { supabase, user };
}

export async function createProfileAction(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/onboarding/adopt-pet");
  }

  const { supabase, user } = await requireUser();
  const emailName = user.email?.split("@")[0] ?? "Keeper";
  const username = cleanUsername(formData.get("username"), emailName);
  const displayName = cleanText(formData.get("displayName"), username);
  const havenName = cleanText(formData.get("havenName"), `${displayName}'s Haven`);
  const bio = cleanText(formData.get("bio"), "A cozy keeper building a little world.");
  const worldSlug = toSlug(havenName);

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username,
      display_name: displayName,
      bio,
    },
    { onConflict: "id" },
  );

  if (profileError) {
    redirect(`/onboarding/profile?message=${encodeURIComponent(profileError.message)}`);
  }

  await supabase.from("wallets").upsert({ profile_id: user.id, coins: 500, hearts: 5 }, { onConflict: "profile_id" });

  const { data: world, error: worldError } = await supabase
    .from("worlds")
    .upsert(
      {
        owner_id: user.id,
        name: havenName,
        slug: worldSlug,
        visibility: "friends",
      },
      { onConflict: "owner_id,slug" },
    )
    .select("id")
    .single();

  if (worldError || !world) {
    redirect(`/onboarding/profile?message=${encodeURIComponent(worldError?.message ?? "Could not create starter world.")}`);
  }

  const { data: existingRoom } = await supabase
    .from("rooms")
    .select("id")
    .eq("owner_id", user.id)
    .eq("room_type", "personal")
    .limit(1)
    .maybeSingle();

  let roomId = existingRoom?.id as string | undefined;

  if (!roomId) {
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .insert({
        owner_id: user.id,
        world_id: world.id,
        room_type: "personal",
        name: "Moonlit Loft",
        width: 960,
        height: 600,
      })
      .select("id")
      .single();

    if (roomError || !room) {
      redirect(`/onboarding/profile?message=${encodeURIComponent(roomError?.message ?? "Could not create starter room.")}`);
    }

    roomId = room.id;
  }

  const { data: existingGarden } = await supabase
    .from("gardens")
    .select("id")
    .eq("owner_id", user.id)
    .eq("garden_type", "personal")
    .limit(1)
    .maybeSingle();

  if (!existingGarden) {
    await supabase.from("gardens").insert({
      owner_id: user.id,
      name: "Moonberry Garden",
      garden_type: "personal",
    });
  }

  await supabase.from("inventory_items").upsert(
    starterCatalog
      .filter((item) => item.rarity === "starter" || item.id === "chair-lavender-cushion")
      .map((item) => ({
        owner_id: user.id,
        catalog_item_id: item.id,
        quantity: 1,
      })),
    { onConflict: "owner_id,catalog_item_id" },
  );

  if (roomId) {
    const { count } = await supabase
      .from("placed_items")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("room_id", roomId);

    if (!count) {
      await supabase.from("placed_items").insert(
        starterPlacements.map((placement) => ({
          owner_id: user.id,
          room_id: roomId,
          catalog_item_id: placement.catalogItemId,
          x: placement.x,
          y: placement.y,
          rotation: placement.rotation,
          scale: placement.scale,
          z_index: placement.zIndex,
        })),
      );
    }
  }

  redirect("/onboarding/adopt-pet");
}

export async function adoptPetAction(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/app");
  }

  const { supabase, user } = await requireUser();
  const species = cleanText(formData.get("species"), "cloud-fox");
  const name = cleanText(formData.get("petName"), "Casper");

  const { data: existingPet } = await supabase
    .from("pets")
    .select("id")
    .eq("owner_id", user.id)
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (existingPet) {
    await supabase
      .from("pets")
      .update({
        species,
        name,
        tone: "cream",
        happiness: 88,
        hunger: 15,
      })
      .eq("id", existingPet.id);
  } else {
    await supabase.from("pets").insert({
      owner_id: user.id,
      species,
      name,
      tone: "cream",
      happiness: 88,
      hunger: 15,
      active: true,
    });
  }

  redirect("/app");
}
