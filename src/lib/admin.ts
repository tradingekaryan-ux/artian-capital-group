import { requireUser, supabaseAdmin } from "@/lib/db/client";

/** Cek user adalah admin (role di profiles). Return null bila bukan. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user) return null;
  try {
    const { data } = await supabaseAdmin()
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    return data?.role === "admin" ? user : null;
  } catch {
    return null;
  }
}
