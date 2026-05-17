import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";

/** Cookie used to memoize the ban check so we don't run the RPC on every
 *  signed-in request. The cookie carries the result + an expiry epoch ms;
 *  the middleware re-checks once it expires. */
const BAN_CHECK_COOKIE = "hh_ban_check_v1";
const BAN_CHECK_TTL_MS = 60_000; // 60 seconds — long enough to amortize, short enough that a fresh ban kicks the user inside a minute.

/** Routes the ban check protects. Auth pages, the suspended page itself,
 *  and static-style routes are intentionally excluded. */
function shouldCheckBan(pathname: string): boolean {
  if (pathname.startsWith("/app")) return true;
  if (pathname.startsWith("/onboarding")) return true;
  return false;
}

type BanCheckCache = { banned: boolean; banId?: string; exp: number };

function readBanCheckCookie(request: NextRequest): BanCheckCache | null {
  const raw = request.cookies.get(BAN_CHECK_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BanCheckCache>;
    if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
    return { banned: Boolean(parsed.banned), banId: parsed.banId, exp: parsed.exp };
  } catch {
    return null;
  }
}

function writeBanCheckCookie(response: NextResponse, payload: BanCheckCache) {
  response.cookies.set(BAN_CHECK_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.ceil(BAN_CHECK_TTL_MS / 1000),
  });
}

function clearBanCheckCookie(response: NextResponse) {
  response.cookies.set(BAN_CHECK_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseConfig();

  const supabase = createServerClient(url!, anonKey!, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const claims = await supabase.auth.getClaims();
  const userId = claims.data?.claims?.sub;
  const pathname = request.nextUrl.pathname;

  // Ban gate. Only runs for protected paths AND when we actually have a
  // signed-in keeper. The result is cached in an httpOnly cookie for 60s
  // so we don't pay the RPC round-trip on every navigation. A fresh ban
  // therefore reaches the user within a minute.
  if (userId && shouldCheckBan(pathname)) {
    const cached = readBanCheckCookie(request);
    let banned = false;
    let banId: string | undefined;

    if (cached) {
      banned = cached.banned;
      banId = cached.banId;
    } else {
      try {
        const { data, error } = await supabase.rpc("is_current_user_banned");
        if (!error && Array.isArray(data) && data.length > 0) {
          const row = data[0] as { banned?: boolean; ban_id?: string };
          banned = Boolean(row.banned);
          banId = typeof row.ban_id === "string" ? row.ban_id : undefined;
        }
        writeBanCheckCookie(supabaseResponse, {
          banned,
          banId,
          exp: Date.now() + BAN_CHECK_TTL_MS,
        });
      } catch {
        // Fail open on transient RPC errors — better to let the keeper
        // through and re-check on the next nav than to hard-block on a
        // network blip. The ban table is still authoritative for
        // anything that actually mutates server-side.
      }
    }

    if (banned) {
      // Sign them out so the cookie session can't be reused, clear the
      // cached "you're fine" flag, then redirect to the suspended page
      // where the ban id lets the page fetch a (PII-free) summary.
      await supabase.auth.signOut();
      const target = request.nextUrl.clone();
      target.pathname = "/account-suspended";
      target.search = banId ? `?ref=${encodeURIComponent(banId)}` : "";
      const redirect = NextResponse.redirect(target);
      clearBanCheckCookie(redirect);
      return redirect;
    }
  } else if (!userId) {
    // No active session — drop any stale ban-check cookie so the next
    // signed-in request makes a fresh decision.
    clearBanCheckCookie(supabaseResponse);
  }

  return supabaseResponse;
}
