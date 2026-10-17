import { supabaseAdmin } from "@/lib/db/client";

export type JobType =
  | "create_token"
  | "create_pool"
  | "add_liquidity"
  | "remove_liquidity"
  | "withdraw"
  | "swap"
  | "burn"
  | "index_wallet"
  | "price_snapshot"
  | "treasury_rebalance"
  | "refund";

export interface JobRow {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
}

export async function enqueue(type: JobType, payload: Record<string, unknown>): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .insert({ type, payload })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

/** Klaim satu batch job pending (atomik per baris via update … in). */
export async function claimPendingJobs(limit = 5): Promise<JobRow[]> {
  const db = supabaseAdmin();
  const { data: candidates } = await db
    .from("jobs")
    .select("id, type, payload, attempts")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(limit);
  if (!candidates?.length) return [];

  const claimed: JobRow[] = [];
  for (const c of candidates) {
    const { data } = await db
      .from("jobs")
      .update({
        status: "running",
        attempts: c.attempts + 1,
        run_at: new Date().toISOString(),
      })
      .eq("id", c.id)
      .eq("status", "pending")
      .select("id, type, payload, attempts")
      .maybeSingle();
    if (data) claimed.push(data as JobRow);
  }
  return claimed;
}

export async function completeJob(id: number): Promise<void> {
  await supabaseAdmin().from("jobs").update({ status: "done", last_error: null }).eq("id", id);
}

const MAX_ATTEMPTS = 3;
/** Refund diberi jendela panjang: gas refund dari saldo SOL user — bila habis,
 * user perlu waktu mengisi SOL lagi sebelum refund bisa dieksekusi. */
const REFUND_MAX_ATTEMPTS = 60;

/** @returns true bila job permanen gagal (tidak akan di-retry lagi). */
export async function failJob(job: JobRow, error: string): Promise<boolean> {
  const db = supabaseAdmin();
  const maxAttempts = job.type === "refund" ? REFUND_MAX_ATTEMPTS : MAX_ATTEMPTS;
  if (job.attempts < maxAttempts) {
    // retry: backoff 30s × attempts (refund: 60s × attempts)
    const backoffMs = (job.type === "refund" ? 60_000 : 30_000) * job.attempts;
    await db
      .from("jobs")
      .update({
        status: "pending",
        last_error: error,
        run_at: new Date(Date.now() + backoffMs).toISOString(),
      })
      .eq("id", job.id);
    return false;
  }
  await db.from("jobs").update({ status: "failed", last_error: error }).eq("id", job.id);
  return true;
}
