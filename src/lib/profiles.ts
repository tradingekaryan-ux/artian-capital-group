import { supabaseAdmin } from "@/lib/db/client";

/**
 * Pastikan row profiles ada (dipanggil saat login/dashboard & worker).
 * Username divalidasi sesuai constraint DB: ^[a-z0-9_]{3,24}$.
 */
export async function ensureProfile(
  userId: string,
  opts: { username?: string; email?: string } = {},
): Promise<{ username: string }> {
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("profiles")
    .select("user_id, username")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { username: existing.username ?? "user" };

  const username = sanitizeUsername(opts.username) ?? fallbackUsername(opts.email, userId);

  const { data, error } = await db
    .from("profiles")
    .upsert({ user_id: userId, username }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("username")
    .maybeSingle();
  if (error) {
    // username kemungkinan bentrok (unique) — coba suffix acak
    const alt = `${username.slice(0, 18)}_${userId.slice(0, 4)}`;
    const { data: retried } = await db
      .from("profiles")
      .upsert({ user_id: userId, username: alt }, { onConflict: "user_id", ignoreDuplicates: true })
      .select("username")
      .maybeSingle();
    if (retried) return { username: retried.username };
    const { data: reread } = await db
      .from("profiles")
      .select("username")
      .eq("user_id", userId)
      .maybeSingle();
    if (reread) return { username: reread.username };
    throw error;
  }
  return { username: data?.username ?? username };
}

export function sanitizeUsername(raw?: string): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned.length < 3) return null;
  return cleaned.slice(0, 24);
}

function fallbackUsername(email?: string, userId?: string): string {
  const base = email?.split("@")[0];
  const slug = sanitizeUsername(base) ?? "creator";
  const suffix = (userId ?? Math.random().toString(36).slice(2, 6)).slice(0, 4);
  return `${slug.slice(0, 19)}_${suffix}`.slice(0, 24);
}
