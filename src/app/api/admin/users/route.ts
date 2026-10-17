import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { supabaseAdmin } from "@/lib/db/client";
import { enqueue } from "@/lib/jobs/queue";
import { rateLimit } from "@/lib/security/ratelimit";

const patchSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]).optional(),
  isSuspended: z.boolean().optional(),
  displayName: z.string().max(60).optional(),
  reindex: z.boolean().optional(),
});

/** Daftar user auth + profil + dompet + saldo cache + jumlah token/pesanan. */
export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const db = supabaseAdmin();

    // ── detail satu user ──
    if (id) {
      const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      const authUser = (list?.users ?? []).find((u) => u.id === id);
      if (!authUser) return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });

      const [{ data: profile }, { data: wallet }, { data: bal }, { data: tokens }, { data: orders }, { data: withdrawals }] =
        await Promise.all([
          db.from("profiles").select("*").eq("user_id", id).maybeSingle(),
          db.from("wallets").select("public_key").eq("user_id", id).maybeSingle(),
          db.from("balances_cache").select("usdc_raw, sol_lamports, refreshed_at").eq("user_id", id).maybeSingle(),
          db
            .from("tokens")
            .select("mint, name, symbol, supply, status, created_at")
            .eq("user_id", id)
            .order("created_at", { ascending: false })
            .limit(50),
          db
            .from("orders")
            .select("id, service, amount_raw, status, payment_signature, created_at")
            .eq("user_id", id)
            .order("created_at", { ascending: false })
            .limit(20),
          db
            .from("withdrawals")
            .select("id, amount_raw, fee_raw, status, tx_signature, fee_tx, created_at")
            .eq("user_id", id)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      return NextResponse.json({
        user: {
          id: authUser.id,
          email: authUser.email ?? null,
          createdAt: authUser.created_at,
          username: profile?.username ?? null,
          displayName: profile?.display_name ?? null,
          role: profile?.role ?? "user",
          isSuspended: !!profile?.is_suspended,
          wallet: wallet?.public_key ?? null,
          usdcRaw: bal?.usdc_raw ?? "0",
          solLamports: bal?.sol_lamports ?? "0",
          balanceRefreshedAt: bal?.refreshed_at ?? null,
        },
        tokens: tokens ?? [],
        orders: orders ?? [],
        withdrawals: withdrawals ?? [],
      });
    }

    // ── daftar (paginasi + pencarian) ──
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 60);
    const perPage = 20;
    const { data: list } = await db.auth.admin.listUsers({ page, perPage });
    const users = list?.users ?? [];
    const total = list?.users?.length ? undefined : 0;

    const ids = users.map((u) => u.id);
    const [profiles, wallets, bals, tokenRows, orderRows] = await Promise.all([
      ids.length
        ? db.from("profiles").select("user_id, username, display_name, role, is_suspended").in("user_id", ids)
        : Promise.resolve({ data: [] as unknown[] }),
      ids.length ? db.from("wallets").select("user_id, public_key").in("user_id", ids) : Promise.resolve({ data: [] as unknown[] }),
      ids.length
        ? db.from("balances_cache").select("user_id, usdc_raw, sol_lamports").in("user_id", ids)
        : Promise.resolve({ data: [] as unknown[] }),
      ids.length ? db.from("tokens").select("user_id").in("user_id", ids) : Promise.resolve({ data: [] as unknown[] }),
      ids.length ? db.from("orders").select("user_id, amount_raw, payment_signature").in("user_id", ids) : Promise.resolve({ data: [] as unknown[] }),
    ]);

    const pMap = new Map(
      ((profiles.data ?? []) as Array<{ user_id: string; username: string | null; display_name: string | null; role: string; is_suspended: boolean }>).map(
        (p) => [p.user_id, p],
      ),
    );
    const wMap = new Map(
      ((wallets.data ?? []) as Array<{ user_id: string; public_key: string }>).map((w) => [w.user_id, w]),
    );
    const bMap = new Map(
      ((bals.data ?? []) as Array<{ user_id: string; usdc_raw: string; sol_lamports: number }>).map((b) => [b.user_id, b]),
    );
    const tCount = new Map<string, number>();
    for (const r of (tokenRows.data ?? []) as Array<{ user_id: string }>) {
      tCount.set(r.user_id, (tCount.get(r.user_id) ?? 0) + 1);
    }
    const oAgg = new Map<string, { count: number; paidRaw: bigint }>();
    for (const r of (orderRows.data ?? []) as Array<{ user_id: string; amount_raw: string; payment_signature: string | null }>) {
      const a = oAgg.get(r.user_id) ?? { count: 0, paidRaw: 0n };
      a.count += 1;
      if (r.payment_signature) a.paidRaw += BigInt(r.amount_raw ?? "0");
      oAgg.set(r.user_id, a);
    }

    let rows = users.map((u) => {
      const p = pMap.get(u.id) as Record<string, unknown> | undefined;
      const w = wMap.get(u.id) as Record<string, unknown> | undefined;
      const b = bMap.get(u.id) as Record<string, unknown> | undefined;
      const o = oAgg.get(u.id);
      return {
        id: u.id,
        email: u.email ?? null,
        createdAt: u.created_at,
        username: (p?.username as string) ?? null,
        displayName: (p?.display_name as string) ?? null,
        role: (p?.role as string) ?? "user",
        isSuspended: !!p?.is_suspended,
        wallet: (w?.public_key as string) ?? null,
        usdcRaw: (b?.usdc_raw as string) ?? "0",
        solLamports: (b?.sol_lamports as number) ?? 0,
        tokensCount: tCount.get(u.id) ?? 0,
        ordersCount: o?.count ?? 0,
        paidRaw: (o?.paidRaw ?? 0n).toString(),
      };
    });

    if (q) {
      rows = rows.filter(
        (r) =>
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.username ?? "").toLowerCase().includes(q) ||
          (r.wallet ?? "").toLowerCase().includes(q),
      );
    }

    return NextResponse.json({ users: rows, page, hasMore: users.length === perPage, ...(total === 0 ? { total: 0 } : {}) });
  } catch (e) {
    console.error("[admin] users gagal:", e);
    return NextResponse.json({ error: "Gagal memuat pengguna" }, { status: 500 });
  }
}

/** Update hak akses akun: role, suspend, nama, reindex wallet. */
export async function PATCH(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!rateLimit(`admin-patch:${admin.id}`, 60, 60_000)) {
    return NextResponse.json({ error: "Terlalu banyak permintaan." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Validasi gagal" }, { status: 400 });
  }
  const { userId, role, isSuspended, displayName, reindex } = parsed.data;

  // Admin tidak boleh menonaktifkan / menurunkan dirinya sendiri.
  if (userId === admin.id && (role === "user" || isSuspended === true)) {
    return NextResponse.json({ error: "Tidak bisa mengubah akses akun sendiri." }, { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const patch: Record<string, unknown> = {};
    if (role !== undefined) patch.role = role;
    if (isSuspended !== undefined) patch.is_suspended = isSuspended;
    if (displayName !== undefined) patch.display_name = displayName;

    let updated = null;
    if (Object.keys(patch).length) {
      const { data, error } = await db
        .from("profiles")
        .update(patch)
        .eq("user_id", userId)
        .select("user_id, username, display_name, role, is_suspended")
        .maybeSingle();
      if (error) throw error;
      // profiles bisa belum ada untuk user baru — buat lalu update.
      if (!data) {
        const { data: created } = await db
          .from("profiles")
          .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
          .select()
          .maybeSingle();
        if (created) {
          const { data: retried } = await db
            .from("profiles")
            .update(patch)
            .eq("user_id", userId)
            .select("user_id, username, display_name, role, is_suspended")
            .maybeSingle();
          updated = retried ?? null;
        }
      } else {
        updated = data;
      }
    }

    let jobQueued = false;
    if (reindex) {
      await enqueue("index_wallet", { userId });
      jobQueued = true;
    }

    return NextResponse.json({ ok: true, updated, jobQueued });
  } catch (e) {
    console.error("[admin] update user gagal:", e);
    return NextResponse.json({ error: "Gagal mengubah pengguna" }, { status: 500 });
  }
}
