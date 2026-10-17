import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, requireActiveUser, supabaseAdmin } from "@/lib/db/client";
import { rateLimit } from "@/lib/security/ratelimit";

const createSchema = z.object({
  mint: z.string().min(32).max(64),
  body: z.string().min(1).max(1000),
});

export async function POST(req: Request) {
  const auth = await requireActiveUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.suspended) {
    return NextResponse.json({ error: "Akun ditangguhkan. Hubungi admin." }, { status: 403 });
  }
  const user = auth.user;

  if (!(await rateLimit(`comment:${user.id}`, 3, 60_000))) {
    return NextResponse.json({ error: "Terlalu cepat, tunggu sebentar." }, { status: 429 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validasi gagal" }, { status: 400 });
  }

  // pastikan mint ada di tabel tokens
  const db = supabaseAdmin();
  const { data: token } = await db
    .from("tokens")
    .select("mint")
    .eq("mint", parsed.data.mint)
    .maybeSingle();
  if (!token) return NextResponse.json({ error: "Token tidak ditemukan" }, { status: 404 });

  const { data, error } = await db
    .from("comments")
    .insert({ user_id: user.id, mint: parsed.data.mint, body: parsed.data.body })
    .select("id, mint, body, status, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Gagal mengirim komentar" }, { status: 500 });

  return NextResponse.json({ comment: data });
}

export async function DELETE(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

  const db = supabaseAdmin();
  const { data } = await db
    .from("comments")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Tidak ditemukan / bukan milikmu" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
