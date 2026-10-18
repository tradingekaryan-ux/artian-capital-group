import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/config";
import { buildWebhookEnvelope } from "@/lib/webhooks";

const base = SITE.url.replace(/\/+$/, "");

describe("buildWebhookEnvelope — events", () => {
  const post = "https://x.com/artian/status/1234567890";
  const caption =
    "Giveaway mingguan! Retweet post ini, join Discord, dan menangkan 10 USDC — syarat & ketentuan berlaku, ditutup Jumat 18:00 WITA.";
  const env = buildWebhookEnvelope({
    slot: "events",
    kind: "event_created",
    text: `New event posted: ${caption.slice(0, 140)}`,
    data: { id: "evt-1", url: post, caption },
    ts: "2026-10-18T12:00:00.000Z",
  });

  it("URL post ikut di text/content (opsi gabungan)", () => {
    expect(env.content).toContain(post);
    expect(env.content).toBe(env.text);
    expect(env.content.startsWith("New event posted:")).toBe(true);
  });

  it("URL top-level + data.url tetap utuh", () => {
    expect(env.url).toBe(post);
    expect(env.data.url).toBe(post);
    expect(env.event).toBe("event_created");
    expect(env.slot).toBe("events");
    expect(env.ts).toBe("2026-10-18T12:00:00.000Z");
  });

  it("caption penuh (tanpa potongan 140) jadi deskripsi embed", () => {
    expect(env.embeds).toHaveLength(1);
    expect(env.embeds[0].description).toBe(caption);
    expect(env.embeds[0].title).toBe("New event posted");
    expect(env.embeds[0].url).toBe(post);
  });

  it("styling Discord: color, footer, timestamp, username, avatar, field Post", () => {
    expect(env.embeds[0].color).toBe(0x7c3aed);
    expect(env.embeds[0].footer?.text).toBe("Artian Capital Group · Event Tracker");
    expect(env.embeds[0].timestamp).toBe("2026-10-18T12:00:00.000Z");
    expect(env.username).toBe("Artian · Event Tracker");
    expect(env.avatar_url).toBe(`${base}/icon.png`);
    expect(env.embeds[0].fields?.[0]).toEqual({ name: "Post", value: post, inline: false });
    // caption tidak diulang sebagai field (sudah jadi deskripsi)
    expect(env.embeds[0].fields?.some((f) => f.name === "Caption")).toBe(false);
  });
});

describe("buildWebhookEnvelope — URL utama per slot", () => {
  it("tx order_paid → panel admin", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Order paid: create_token 2.00 USDC (mainnet) — tx 5AbCdEfGhIjKlMn…",
      data: { subkind: "order_paid", orderId: 42 },
    });
    expect(env.url).toBe(`${base}/admin`);
    expect(env.content.endsWith(env.url)).toBe(true);
    expect(env.embeds[0].title).toBe("Order paid");
  });

  it("tx algo_subscribe → halaman publik algo", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: 'Algo subscription paid: "Scalper X" 5.00 USDC (monthly)',
      data: { subkind: "algo_subscribe", algoId: "algo-9" },
    });
    expect(env.url).toBe(`${base}/algos/algo-9`);
    expect(env.embeds[0].title).toBe("Algo subscription paid");
  });

  it("tx treasury_* → tab revenue; admin_wallet_* → daftar user", () => {
    expect(
      buildWebhookEnvelope({
        slot: "tx",
        kind: "transaction",
        text: "Treasury deposit: 10 USDC",
        data: { subkind: "treasury_deposit" },
      }).url,
    ).toBe(`${base}/admin/revenue`);
    expect(
      buildWebhookEnvelope({
        slot: "tx",
        kind: "transaction",
        text: "Admin topup: 5 USDC → user wallet",
        data: { subkind: "admin_wallet_topup" },
      }).url,
    ).toBe(`${base}/admin/users`);
  });

  it("wallet & user → daftar user admin; tanpa data → tetap ber-link", () => {
    expect(
      buildWebhookEnvelope({ slot: "wallet", kind: "wallet_created", text: "New wallet: AbC…", data: { kind: "demo" } })
        .url,
    ).toBe(`${base}/admin/users`);
    expect(
      buildWebhookEnvelope({ slot: "user", kind: "user_registered", text: "New user: a@b.c", data: {} }).url,
    ).toBe(`${base}/admin/users`);
  });

  it("events tanpa data.url → fallback halaman /events", () => {
    expect(buildWebhookEnvelope({ slot: "events", kind: "event_created", text: "x", data: {} }).url).toBe(
      `${base}/events`,
    );
  });
});

describe("buildWebhookEnvelope — batas & field embed", () => {
  it("content tidak pernah melebihi 2000 char (Discord), URL tetap utuh", () => {
    const post = "https://example.com/very/long/post/url/with/path?query=1";
    const long = "word ".repeat(700); // ~3500 char
    const env = buildWebhookEnvelope({
      slot: "events",
      kind: "event_created",
      text: `New event posted: ${long}`,
      data: { url: post, caption: long },
    });
    expect(env.content.length).toBeLessThanOrEqual(2000);
    expect(env.content.endsWith(post)).toBe(true);
    expect(env.data.url).toBe(post); // data tidak ikut dipotong
    expect(env.text).toBe(env.content);
  });

  it("hanya nilai primitif yang jadi field; object dilewati, key di-humanize", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Order paid: 2 USDC",
      data: { subkind: "order_paid", orderId: 7, nested: { a: 1 }, list: [1, 2] },
    });
    const names = (env.embeds[0].fields ?? []).map((f) => f.name);
    expect(names).toContain("Subkind");
    expect(names).toContain("Order Id");
    expect(names).not.toContain("Nested");
    expect(names).not.toContain("List");
  });

  it("field embed maksimal 10 entri dan nilai dipotong 1024 char", () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 14; i++) data[`key${i}`] = "x".repeat(1200);
    const env = buildWebhookEnvelope({ slot: "tx", kind: "transaction", text: "t", data });
    const fields = env.embeds[0].fields ?? [];
    expect(fields).toHaveLength(10);
    expect(fields.every((f) => f.value.length <= 1024)).toBe(true);
  });
});
