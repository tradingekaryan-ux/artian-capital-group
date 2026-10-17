import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE, SECRETS } from "@/lib/config";

/** Client browser (anon key, user session via cookies). */
export function supabaseBrowser(): SupabaseClient {
  return createBrowserClient(SUPABASE.url, SUPABASE.anonKey);
}

let _server: SupabaseClient | null = null;

/**
 * Client server-side dengan session user (untuk Server Components & route
 * handler). Memakai cookie request — bukan service role.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const { cookies } = await import("next/headers");
  const { createServerClient } = await import("@supabase/ssr");
  const store = await cookies();
  return createServerClient(SUPABASE.url, SUPABASE.anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Component — cookie tidak bisa ditulis, abaikan. */
        }
      },
    },
  });
}

/**
 * Client service-role — HANYA untuk server/worker (bypass RLS).
 * Jangan pernah di-import dari komponen client.
 */
export function supabaseAdmin(): SupabaseClient {
  if (!_server) {
    if (!SUPABASE.url || !SECRETS.serviceRoleKey) {
      throw new Error("SUPABASE_URL / SERVICE_ROLE_KEY belum dikonfigurasi");
    }
    _server = createClient(SUPABASE.url, SECRETS.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _server;
}

/** Ambil user aktif dari session; null jika belum login. */
export async function requireUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * User login + cek status suspend admin.
 * Return null bila belum login; `{ user, suspended }` jika login
 * (suspended=true → route mutasi wajib balas 403).
 */
export async function requireActiveUser(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof requireUser>>>;
  suspended: boolean;
} | null> {
  const user = await requireUser();
  if (!user) return null;
  try {
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("is_suspended")
      .eq("user_id", user.id)
      .maybeSingle();
    return { user, suspended: !!data?.is_suspended };
  } catch {
    // profiles belum ada (user baru) → anggap aktif; ensureProfile menyusul.
    return { user, suspended: false };
  }
}
