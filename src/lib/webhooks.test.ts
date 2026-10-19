import { describe, expect, it } from "vitest";
import { SITE, CLUSTER } from "@/lib/config";
import { buildWebhookEnvelope } from "@/lib/webhooks";

const base = SITE.url.replace(/\/+$/, "");
const PUBKEY = "5cG1oj5wRoqyzuRoHhMMwFkg325rfQL3ic1X13Fg361";
const SIG = "3yS7Qm9WzXe2KdP4Rf8UvNc6JhL5GtAbDeMqYwZxCvBnHp";
const USER_ID = "b02d2677-25e2-4e90-b45d-b224d7f3536a";
const MINT = "7xKXtg2CW39F7VtL4BdGhGqZQz9pVv1sQmYh3EuPdRnA";

/** URL harus polos di teks — Discord TIDAK membuat kartu utk link yg dibungkus. */
function isRawUrl(url: string, text: string): boolean {
  return text.includes(url) && !text.includes(`(${url})`) && !text.includes(`<${url}>`);
}

describe("buildWebhookEnvelope — tanpa embed, teks biasa utk Discord", () => {
  const post = "https://x.com/artian/status/1234567890";
  const caption = "Giveaway mingguan! Retweet post ini, join Discord, dan menangkan 10 USDC.";
  const env = buildWebhookEnvelope({
    slot: "events",
    kind: "event_created",
    text: `New event posted: ${caption}`,
    data: { id: "evt-1", url: post, caption },
    ts: "2026-10-18T12:00:00.000Z",
  });

  it("embeds selalu kosong — tampilan memakai teks biasa", () => {
    expect(env.embeds).toEqual([]);
  });

  it("content = teks baris-per-baris: judul, caption, URL polos (dideteksi Discord)", () => {
    expect(env.content).toBe(`New event posted\n${caption}\n${post}`);
    expect(isRawUrl(post, env.content)).toBe(true);
    expect(env.content).not.toContain("["); // tanpa markdown link
  });

  it("text identik dgn content utk receiver generik; url top-level = URL post", () => {
    expect(env.text).toBe(env.content);
    expect(env.url).toBe(post);
    expect(env.data.url).toBe(post);
    expect(env.event).toBe("event_created");
    expect(env.ts).toBe("2026-10-18T12:00:00.000Z");
  });

  it("username + avatar pengirim tetap ada (tampil di atas pesan)", () => {
    expect(env.username).toBe("Artian · Event Tracker");
    expect(env.avatar_url).toBe(`${base}/icon.png`);
  });
});

describe("buildWebhookEnvelope — wallet & user (teks saja, tanpa URL)", () => {
  it("wallet mainnet: judul + alamat lengkap", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: `New mainnet wallet: ${PUBKEY}`,
      data: { kind: "mainnet", label: "Bot trading", publicKey: PUBKEY, userId: USER_ID },
    });
    expect(env.content).toBe(`New wallet — mainnet\n${PUBKEY}`);
    expect(env.embeds).toEqual([]);
    expect(env.url).toBe(`${base}/admin/users`); // utk receiver generik saja
  });

  it("wallet demo → devnet; label & UUID tidak ikut tampil", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: "New demo wallet",
      data: { kind: "demo", label: "Demo (Devnet)", publicKey: PUBKEY, userId: USER_ID },
    });
    expect(env.content).toBe(`New wallet — devnet\n${PUBKEY}`);
    expect(env.content).not.toContain(USER_ID);
    expect(env.content).not.toContain("Label");
  });

  it("user: `New user — @username`; fallback email lalu 'user'", () => {
    expect(
      buildWebhookEnvelope({
        slot: "user",
        kind: "user_registered",
        text: "x",
        data: { email: "budi@mail.com", username: "budi", userId: USER_ID },
      }).content,
    ).toBe("New user — @budi");
    expect(
      buildWebhookEnvelope({ slot: "user", kind: "user_registered", text: "x", data: { email: "anon@mail.com" } })
        .content,
    ).toBe("New user — anon@mail.com");
    expect(buildWebhookEnvelope({ slot: "user", kind: "user_registered", text: "x", data: {} }).content).toBe(
      "New user — user",
    );
  });
});

describe("buildWebhookEnvelope — algo & token (teks + URL polos utk kartu)", () => {
  it("algo: judul + URL halaman algo (polos)", () => {
    const env = buildWebhookEnvelope({
      slot: "algo",
      kind: "algo_created",
      text: "New algo: Scalper X",
      data: { algoId: "algo-9", name: "Scalper X", priceUsdc: 5, billing: "monthly", userId: USER_ID },
    });
    expect(env.content).toBe(`New algo — Scalper X\n${base}/algos/algo-9`);
    expect(isRawUrl(`${base}/algos/algo-9`, env.content)).toBe(true);
    expect(env.url).toBe(`${base}/algos/algo-9`);
    expect(env.content).not.toContain("5 USDC"); // tanpa detail berlebih
  });

  it("token: judul nama+simbol+tipe, URL halaman token & mint di explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "token",
      kind: "token_created",
      text: "New token: Raycoin (RAY) — mainnet",
      data: { mint: MINT, name: "Raycoin", symbol: "RAY", kind: "mainnet", tx: SIG, userId: USER_ID },
    });
    expect(env.content).toBe(
      `New token — Raycoin (RAY) · mainnet\n` +
        `${base}/token/${MINT}\n` +
        `https://explorer.solana.com/address/${MINT}?cluster=${CLUSTER}`,
    );
    expect(isRawUrl(`${base}/token/${MINT}`, env.content)).toBe(true);
    expect(env.url).toBe(`${base}/token/${MINT}`);
    expect(env.embeds).toEqual([]);
  });

  it("token demo → tipe devnet + cluster devnet di link explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "token",
      kind: "token_created",
      text: "x",
      data: { mint: MINT, name: "Latihan", symbol: "TRY", kind: "demo" },
    });
    expect(env.content).toContain("New token — Latihan (TRY) · devnet");
    expect(env.content).toContain("cluster=devnet");
  });

  it("token tanpa mint → tanpa baris URL; url top-level fallback dashboard", () => {
    const env = buildWebhookEnvelope({ slot: "token", kind: "token_created", text: "x", data: {} });
    expect(env.content).toBe("New token — token baru · mainnet");
    expect(env.url).toBe(`${base}/dashboard/tokens`);
  });
});

describe("buildWebhookEnvelope — tx: New Transaction + URL explorer", () => {
  // Payload disalin persis dari pemanggil aslinya: orders.ts, runner.ts (WD),
  // subscribe route, treasury route, admin wallet route.
  it("order_paid: judul jenis transaksi + signature + URL cek ke jaringan Solana", () => {
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
    expect(env.content).toBe(
      `New Transaction — Order paid\ntx ${SIG.slice(0, 8)}…${SIG.slice(-6)}\n` +
        `https://explorer.solana.com/tx/${SIG}?cluster=${CLUSTER}`,
    );
    expect(isRawUrl(`https://explorer.solana.com/tx/${SIG}?cluster=${CLUSTER}`, env.content)).toBe(true);
    expect(env.url).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=${CLUSTER}`);
    // tanpa detail berlebih (amount/service/id tidak ikut)
    expect(env.content).not.toContain("2000000");
    expect(env.content).not.toContain("create_token");
    expect(env.embeds).toEqual([]);
  });

  it("withdrawal demo → cluster devnet di link explorer", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "x",
      data: { subkind: "withdrawal", id: 88, amountRaw: "1500000", destination: PUBKEY, tx: SIG, kind: "demo" },
    });
    expect(env.content.split("\n")[0]).toBe("New Transaction — Withdrawal confirmed");
    expect(env.content).toContain("cluster=devnet");
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
      const env = buildWebhookEnvelope({ slot: "tx", kind: "transaction", text: "x", data: { subkind, tx: SIG } });
      expect(env.content.split("\n")[0]).toBe(`New Transaction — ${label}`);
    }
  });

  it("tanpa signature → hanya baris judul; url top-level fallback /admin", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "x",
      data: { subkind: "treasury_deposit", amount: "10.00", asset: "usdc" },
    });
    expect(env.content).toBe("New Transaction — Treasury deposit");
    expect(env.url).toBe(`${base}/admin`);
  });
});

describe("buildWebhookEnvelope — batas & fallback", () => {
  it("content & text tidak pernah melebihi 2000 char (Discord)", () => {
    const long = "word ".repeat(700); // ~3500 char
    const env = buildWebhookEnvelope({
      slot: "events",
      kind: "event_created",
      text: `New event posted: ${long}`,
      data: { url: "https://example.com/post", caption: long },
    });
    expect(env.content.length).toBeLessThanOrEqual(1900);
    expect(env.content.startsWith("New event posted")).toBe(true);
    expect(env.content.endsWith("https://example.com/post")).toBe(true); // URL tetap utuh
    expect(env.text).toBe(env.content);
    expect(env.data.caption).toBe(long); // data tidak ikut dipotong
  });

  it("data kosong → format tetap terbangun (default URL halaman situs)", () => {
    const env = buildWebhookEnvelope({ slot: "events", kind: "event_created", text: "Pesan lama pemanggil", data: {} });
    expect(env.content).toBe(`New event posted\n${base}/events`);
    expect(env.url).toBe(`${base}/events`);

    const bare = buildWebhookEnvelope({ slot: "tx", kind: "transaction", text: "Fallback utk n8n", data: {} });
    expect(bare.content).toBe("New Transaction — Transaction");
  });

  it("receiver generik: data mentah utuh + username per slot", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "x",
      data: { subkind: "order_paid", tx: SIG, userId: USER_ID, nested: { a: 1 } },
    });
    expect(env.username).toBe("Artian · Transactions");
    expect(env.data.userId).toBe(USER_ID);
    expect(env.data.nested).toEqual({ a: 1 });
  });
});
