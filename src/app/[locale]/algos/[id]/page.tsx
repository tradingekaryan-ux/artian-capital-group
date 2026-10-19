import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { supabaseAdmin, requireUser } from "@/lib/db/client";
import { getLatestSub, isSubActive, ALGO_FEED_PAGE, type AlgoRow } from "@/lib/algos";
import { SITE } from "@/lib/config";
import { AlgoView } from "@/components/algos/algo-view";

/** og-meta → link algo yang dibagikan (mis. di Discord) menghasilkan kartu preview jelas. */
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/algos/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    const { data } = await supabaseAdmin()
      .from("algos")
      .select("name, description, price_usdc, billing, is_active")
      .eq("id", id)
      .maybeSingle();
    if (!data?.is_active) return {};
    const description = `${data.description || `Signal algo ${data.name} on Solana.`} Subscribe for ${data.price_usdc} USDC ${data.billing}.`;
    return {
      title: data.name,
      description,
      openGraph: {
        title: data.name,
        description,
        url: `${SITE.url}/algos/${id}`,
        siteName: SITE.name,
        type: "website",
        images: [{ url: "/icon.png", width: 512, height: 512, type: "image/png" }],
      },
    };
  } catch {
    return {};
  }
}

export default async function AlgoDetailPage({
  params,
}: PageProps<"/[locale]/algos/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const db = supabaseAdmin();
  const { data: algoRaw } = await db.from("algos").select("*").eq("id", id).maybeSingle();
  if (!algoRaw) notFound();
  const algo = algoRaw as AlgoRow;

  const user = await requireUser();
  const isOwner = !!user && user.id === algo.user_id;
  if (!algo.is_active && !isOwner) notFound();

  const { data: msgs } = await db
    .from("algo_messages")
    .select("id, text, payload, created_at")
    .eq("algo_id", id)
    .order("id", { ascending: false })
    .limit(ALGO_FEED_PAGE);
  const messages = ((msgs ?? []) as {
    id: number;
    text: string;
    payload: unknown;
    created_at: string;
  }[]).slice().reverse();

  const [{ data: creator }, { count: subCount }, { count: messageCount }] = await Promise.all([
    db.from("profiles").select("username, display_name").eq("user_id", algo.user_id).maybeSingle(),
    db
      .from("algo_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("algo_id", id)
      .eq("status", "active"),
    db.from("algo_messages").select("id", { count: "exact", head: true }).eq("algo_id", id),
  ]);

  const sub = user ? await getLatestSub(id, user.id) : null;

  return (
    <AlgoView
      algo={algo}
      creator={{ username: creator?.username ?? null, display_name: creator?.display_name ?? null }}
      initialMessages={messages}
      mySub={
        sub
          ? { status: sub.status, billing: sub.billing, expires_at: sub.expires_at, active: isSubActive(sub) }
          : null
      }
      isAuthed={!!user}
      viewerIsOwner={isOwner}
      subCount={subCount ?? 0}
      messageCount={messageCount ?? 0}
    />
  );
}
