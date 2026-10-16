import { supabaseAdmin } from "@/lib/db/client";

export interface AuditEntry {
  actor?: string | null;
  action: string;
  target?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

/** Tulis audit log tanpa gagalkan operasi utama. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await supabaseAdmin().from("audit_logs").insert({
      actor: entry.actor ?? null,
      action: entry.action,
      target: entry.target ?? null,
      payload: entry.payload ?? {},
      ip: entry.ip ?? null,
    });
  } catch (e) {
    console.error("[audit] gagal menulis log", e);
  }
}
