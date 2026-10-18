import { describe, expect, it } from "vitest";
import { SITE, CLUSTER } from "@/lib/config";
import { buildWebhookEnvelope } from "@/lib/webhooks";

const base = SITE.url.replace(/\/+$/, "");
const PUBKEY = "5cG1oj5wRoqyzuRoHhMMwFkg325rfQL3ic1X13Fg361";
const SIG = "3yS7Qm9WzXe2KdP4Rf8UvNc6JhL5GtAbDeMqYwZxCvBnHp";
const USER_ID = "b02d2677-25e2-4e90-b45d-b224d7f3536a";
const MINT = "7xKXtg2CW39F7VtL4BdGhGqZQz9pVv1sQmYh3EuPdRnA";

describe("buildWebhookEnvelope — events: website card + caption saja", () => {
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

  it("content kosong — Discord cukup render embeds", () => {
    expect(env.content).toBe("");
  });

  it("text utk receiver generik tetap lengkap (ringkasan + URL)", () => {
    expect(env.text.startsWith("New event posted:")).toBe(true);
    expect(env.text).toContain(post);
    expect(env.event).toBe("event_created");
    expect(env.slot).toBe("events");
  });

  it("embed = kartu website: provider (domain), judul link, caption jadi deskripsi", () => {
    expect(env.embeds).toHaveLength(1);
    expect(env.embeds[0].provider).toEqual({ name: "x.com" });
    expect(env.embeds[0].title).toBe("New event posted");
    expect(env.embeds[0].url).toBe(post);
    expect(env.embeds[0].description).toBe(caption); // < 280 → utuh
  });

  it("tanpa field, tanpa timestamp, tanpa footer (jangan terlalu detail)", () => {
    expect(env.embeds[0]).not.toHaveProperty("fields");
    expect(env.embeds[0]).not.toHaveProperty("timestamp");
    expect(env.embeds[0]).not.toHaveProperty("footer");
  });

  it("styling: color per slot + username/avatar pengirim", () => {
    expect(env.embeds[0].color).toBe(0x7c3aed);
    expect(env.username).toBe("Artian · Event Tracker");
    expect(env.avatar_url).toBe(`${base}/icon.png`);
  });
});

describe("buildWebhookEnvelope — wallet & user: teks singkat + tipe jaringan", () => {
  it("wallet mainnet: `New wallet — mainnet` + alamat lengkap (tanpa field)", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: `New mainnet wallet: ${PUBKEY}`,
      data: { kind: "mainnet", label: "Bot trading", publicKey: PUBKEY, userId: USER_ID },
    });
    expect(env.embeds[0].title).toBe("New wallet — mainnet");
    expect(env.embeds[0].description).toBe(PUBKEY); // alamat utuh, bisa disalin
    expect(env.embeds[0]).not.toHaveProperty("fields");
    expect(env.embeds[0]).not.toHaveProperty("timestamp");
    expect(env.url).toBe(`${base}/admin/users`);
  });

  it("wallet demo → tampil sebagai devnet; label/UUID tidak ikut tampil", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: "New demo wallet",
      data: { kind: "demo", label: "Demo (Devnet)", publicKey: PUBKEY, userId: USER_ID },
    });
    expect(env.embeds[0].title).toBe("New wallet — devnet");
    expect(JSON.stringify(env.embeds)).not.toContain(USER_ID);
    expect(JSON.stringify(env.embeds)).not.toContain("Devnet)"); // label default dibuang
  });

  it("user: `New user — @username`; fallback email lalu 'user'", () => {
    const named = buildWebhookEnvelope({
      slot: "user",
      kind: "user_registered",
      text: "New user: budi@mail.com (@budi)",
      data: { email: "budi@mail.com", username: "budi", userId: USER_ID },
    });
    expect(named.embeds[0].title).toBe("New user — @budi");
    expect(named.embeds[0]).not.toHaveProperty("description");

    const noName = buildWebhookEnvelope({
      slot: "user",
      kind: "user_registered",
      text: "New user: anon@mail.com",
      data: { email: "anon@mail.com", username: null, userId: USER_ID },
    });
    expect(noName.embeds[0].title).toBe("New user — anon@mail.com");

    const bare = buildWebhookEnvelope({ slot: "user", kind: "user_registered", text: "x", data: {} });
    expect(bare.embeds[0].title).toBe("New user — user");
  });
});

describe("buildWebhookEnvelope — algo & token: website card + tautan", () => {
  it("algo: judul link ke halaman algo + provider domain (kartu website)", () => {
    const env = buildWebhookEnvelope({
      slot: "algo",
      kind: "algo_created",
      text: "New algo: Scalper X",
      data: { algoId: "algo-9", name: "Scalper X", priceUsdc: 5, billing: "monthly", userId: USER_ID },
    });
    expect(env.url).toBe(`${base}/algos/algo-9`);
    expect(env.embeds[0].title).toBe("New algo — Scalper X");
    expect(env.embeds[0].url).toBe(`${base}/algos/algo-9`);
    expect(env.embeds[0].provider).toEqual({ name: new URL(base).hostname });
    expect(env.embeds[0]).not.toHaveProperty("fields"); // harga/billing tidak perlu
  });

  it("token: judul nama+simbol+tipe, 2 tautan (halaman token & explorer mint)", () => {
    const env = buildWebhookEnvelope({
      slot: "token",
      kind: "token_created",
      text: `New token: Raycoin (RAY) — mainnet`,
      data: { mint: MINT, name: "Raycoin", symbol: "RAY", kind: "mainnet", tx: SIG, userId: USER_ID },
    });
    expect(env.slot).toBe("token");
    expect(env.url).toBe(`${base}/token/${MINT}`);
    expect(env.embeds[0].title).toBe("New token — Raycoin (RAY) · mainnet");
    expect(env.embeds[0].url).toBe(`${base}/token/${MINT}`);
    expect(env.embeds[0].provider).toEqual({ name: new URL(base).hostname });
    expect(env.embeds[0].description).toBe(
      `[Token page](${base}/token/${MINT})\n` +
        `[Mint · Solana Explorer](https://explorer.solana.com/address/${MINT}?cluster=${CLUSTER})`,
    );
  });

  it("token demo → tipe devnet + cluster devnet di link explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "token",
      kind: "token_created",
      text: "New token: Latihan (TRY) — demo",
      data: { mint: MINT, name: "Latihan", symbol: "TRY", kind: "demo" },
    });
    expect(env.embeds[0].title).toBe("New token — Latihan (TRY) · devnet");
    expect(env.embeds[0].description).toContain("cluster=devnet");
  });

  it("token tanpa mint → fallback halaman dashboard tokens", () => {
    const env = buildWebhookEnvelope({ slot: "token", kind: "token_created", text: "x", data: {} });
    expect(env.url).toBe(`${base}/dashboard/tokens`);
  });
});

describe("buildWebhookEnvelope — tx: New Transaction + tautan explorer", () => {
  // Payload disalin persis dari pemanggil aslinya: orders.ts, runner.ts (WD),
  // subscribe route, treasury route, admin wallet route.
  it("order_paid: judul jenis transaksi + signature + link explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Order paid: create_token 2.00 USDC (mainnet)",
      data: {
        subkind: "order_paid",
        orderId: 42,
        service: "create_token",
        amountRaw: "2000000",
        tx: SIG,
        userId: USER_ID,
        kind: "mainnet",
      },
    });
    expect(env.embeds[0].title).toBe("New Transaction — Order paid");
    expect(env.embeds[0].url).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=${CLUSTER}`);
    expect(env.embeds[0].description).toBe(
      `tx \`${SIG.slice(0, 8)}…${SIG.slice(-6)}\`\n` +
        `[View on Solana Explorer](https://explorer.solana.com/tx/${SIG}?cluster=${CLUSTER})`,
    );
    // tanpa detail berlebih (amount/service/id tidak ikut — cukup jenis + tx)
    expect(JSON.stringify(env.embeds)).not.toContain("2000000");
    expect(JSON.stringify(env.embeds)).not.toContain("create_token");
    expect(env.embeds[0]).not.toHaveProperty("timestamp");
  });

  it("withdrawal demo → cluster devnet di link explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Withdrawal confirmed",
      data: { subkind: "withdrawal", id: 88, amountRaw: "1500000", destination: PUBKEY, tx: SIG, kind: "demo" },
    });
    expect(env.embeds[0].title).toBe("New Transaction — Withdrawal confirmed");
    expect(env.embeds[0].url).toContain("cluster=devnet");
  });

  it("semua sub-jenis dikenal; subkind asing → 'Transaction'", () => {
    for (const [subkind, label] of [
      ["order_paid", "Order paid"],
      ["withdrawal", "Withdrawal confirmed"],
      ["algo_subscribe", "Algo subscription paid"],
      ["treasury_deposit", "Treasury deposit"],
      ["treasury_withdraw", "Treasury withdraw"],
      ["admin_wallet_topup", "User wallet top-up"],
      ["admin_wallet_withdraw", "User wallet withdraw"],
      ["yang_belum_ada", "Transaction"],
    ] as const) {
      const env = buildWebhookEnvelope({
        slot: "tx",
        kind: "transaction",
        text: "t",
        data: { subkind, tx: SIG },
      });
      expect(env.embeds[0].title).toBe(`New Transaction — ${label}`);
    }
  });

  it("tanpa signature → tanpa link explorer, URL fallback /admin", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "t",
      data: { subkind: "treasury_deposit", amount: "10.00", asset: "usdc" },
    });
    expect(env.url).toBe(`${base}/admin`);
    expect(env.embeds[0].url).toBeUndefined();
    expect(env.embeds[0].description).toBeUndefined();
  });
});

describe("buildWebhookEnvelope — batas & receiver generik", () => {
  it("text tidak pernah melebihi 2000 char (Discord), URL tetap utuh", () => {
    const post = "https://example.com/very/long/post/url/with/path?query=1";
    const long = "word ".repeat(700); // ~3500 char
    const env = buildWebhookEnvelope({
      slot: "events",
      kind: "event_created",
      text: `New event posted: ${long}`,
      data: { url: post, caption: long },
    });
    expect(env.text.length).toBeLessThanOrEqual(2000);
    expect(env.text.endsWith(post)).toBe(true);
    expect(env.data.url).toBe(post); // data tidak ikut dipotong
    expect((env.embeds[0].description ?? "").length).toBeLessThanOrEqual(280); // caption dipotong
  });

  it("events tanpa data.url → fallback halaman /events (provider = domain situs)", () => {
    const env = buildWebhookEnvelope({ slot: "events", kind: "event_created", text: "x", data: {} });
    expect(env.url).toBe(`${base}/events`);
    expect(env.embeds[0].provider).toEqual({ name: new URL(base).hostname });
  });

  it("semua slot: username & warna terisi, data mentah utuh utk n8n/Zapier", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "t",
      data: { subkind: "order_paid", tx: SIG, userId: USER_ID, nested: { a: 1 } },
    });
    expect(env.username).toBe("Artian · Transactions");
    expect(env.embeds[0].color).toBe(0x22c55e);
    expect(env.data.userId).toBe(USER_ID);
    expect(env.data.nested).toEqual({ a: 1 });
  });
});
