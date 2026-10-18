import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/config";
import { buildWebhookEnvelope } from "@/lib/webhooks";

const base = SITE.url.replace(/\/+$/, "");
const PUBKEY = "5cG1oj5wRoqyzuRoHhMMwFkg325rfQL3ic1X13Fg361";
const USER_ID = "b02d2677-25e2-4e90-b45d-b224d7f3536a";

describe("buildWebhookEnvelope — Discord tanpa kalimat dobel", () => {
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

  it("URL top-level + data.url tetap utuh", () => {
    expect(env.url).toBe(post);
    expect(env.data.url).toBe(post);
    expect(env.ts).toBe("2026-10-18T12:00:00.000Z");
  });

  it("embed: judul bisa diklik, caption jadi deskripsi (dipotong 280)", () => {
    expect(env.embeds).toHaveLength(1);
    expect(env.embeds[0].title).toBe("New event posted");
    expect(env.embeds[0].url).toBe(post);
    expect(env.embeds[0].description).toBe(caption); // < 280 → utuh
    // tanpa field sampah (link sudah jadi judul, caption sudah jadi deskripsi)
    expect(env.embeds[0].fields).toBeUndefined();
  });

  it("styling: color, timestamp, username, avatar — tanpa footer", () => {
    expect(env.embeds[0].color).toBe(0x7c3aed);
    expect(env.embeds[0].timestamp).toBe("2026-10-18T12:00:00.000Z");
    expect(env.username).toBe("Artian · Event Tracker");
    expect(env.avatar_url).toBe(`${base}/icon.png`);
    expect(env.embeds[0]).not.toHaveProperty("footer");
  });
});

describe("buildWebhookEnvelope — field disaring (hanya yang penting)", () => {
  it("wallet: hanya Public key (diringkas); label default dibuang, label kustom tampil", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: `New demo wallet created: ${PUBKEY}`,
      data: { kind: "demo", label: "Demo (Devnet)", publicKey: PUBKEY, userId: USER_ID },
    });
    expect(env.embeds[0].title).toBe("Demo wallet created");
    expect(env.embeds[0].description).toBeUndefined(); // tidak mengulang teks
    const fields = env.embeds[0].fields ?? [];
    expect(fields.map((f) => f.name)).toEqual(["Public key"]); // Label "Demo (Devnet)" = turunan kind
    expect(fields[0].value).toBe("5cG1oj5w…3Fg361"); // base58 dipotong
    expect(JSON.stringify(fields)).not.toContain(USER_ID); // UUID dibuang

    const named = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: "New wallet",
      data: { kind: "mainnet", label: "Bot trading", publicKey: PUBKEY },
    });
    expect(named.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Public key=5cG1oj5w…3Fg361",
      "Label=Bot trading",
    ]);
  });

  it("user: hanya Email + Username, tanpa User Id", () => {
    const env = buildWebhookEnvelope({
      slot: "user",
      kind: "user_registered",
      text: "New user: a@b.c",
      data: { email: "budi@mail.com", username: "budi", userId: USER_ID },
    });
    expect(env.embeds[0].title).toBe("New user registered");
    expect(env.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Email=budi@mail.com",
      "Username=budi",
    ]);
  });

  it("algo: judul memuat nama, field Price + Billing", () => {
    const env = buildWebhookEnvelope({
      slot: "algo",
      kind: "algo_created",
      text: "New algo: Scalper X",
      data: { algoId: "algo-9", name: "Scalper X", priceUsdc: 5, billing: "monthly" },
    });
    expect(env.embeds[0].title).toBe("New algo: Scalper X");
    expect(env.url).toBe(`${base}/algos/algo-9`);
    expect(env.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Price=5 USDC",
      "Billing=monthly",
    ]);
  });

  // Payload di bawah ini disalin persis dari pemanggil aslinya:
  // orders.ts, runner.ts (WD), subscribe, treasury route, admin wallet route.
  const SIG = "3yS7Qm9WzXe2KdP4Rf8UvNc6JhL5GtAbDeMqYwZxCvBnHp"; // base58 valid

  it("tx order_paid (amountRaw+service+tx): nominal terkonversi, subkind & kind dibuang", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Order paid: create_token 2.00 USDC (mainnet) — tx 3yS7Qm9WzXe…",
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
    expect(env.embeds[0].title).toBe("Order paid");
    expect(env.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Service=create_token",
      "Amount=2.00 USDC", // 2000000 / 1e6
      `Tx=${SIG.slice(0, 8)}…${SIG.slice(-6)}`,
    ]);
    expect(env.url).toBe(`${base}/admin`);
  });

  it("tx withdrawal: destination diringkas, orderId/tipe wallet dibuang", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Withdrawal confirmed: 1.50 USDC → 9CDQv…",
      data: {
        subkind: "withdrawal",
        id: 88,
        amountRaw: "1500000",
        destination: PUBKEY,
        tx: SIG,
        userId: USER_ID,
        kind: "mainnet",
      },
    });
    expect(env.embeds[0].title).toBe("Withdrawal confirmed");
    expect(env.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Amount=1.50 USDC",
      `Destination=${PUBKEY.slice(0, 8)}…${PUBKEY.slice(-6)}`,
      `Tx=${SIG.slice(0, 8)}…${SIG.slice(-6)}`,
    ]);
  });

  it("tx algo_subscribe (priceRaw): judul + nama algo + harga, halaman publik algo", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: 'Algo subscription paid: "Scalper X" 5.00 USDC (monthly)',
      data: {
        subkind: "algo_subscribe",
        algoId: "algo-9",
        algoName: "Scalper X",
        subscriberId: USER_ID,
        billing: "monthly",
        priceRaw: "5000000",
        commissionRaw: "1000000",
        tx: SIG,
      },
    });
    expect(env.url).toBe(`${base}/algos/algo-9`);
    expect(env.embeds[0].title).toBe("Algo subscription paid");
    expect(env.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Algo=Scalper X",
      "Price=5.00 USDC",
      `Tx=${SIG.slice(0, 8)}…${SIG.slice(-6)}`,
    ]);
  });

  it("tx treasury_* (amount+asset) → /admin/revenue; admin_wallet_* → /admin/users", () => {
    const dep = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Treasury deposit: 10.00 USDC",
      data: { subkind: "treasury_deposit", asset: "usdc", amount: "10.00", tx: SIG, actor: USER_ID },
    });
    expect(dep.url).toBe(`${base}/admin/revenue`);
    expect(dep.embeds[0].title).toBe("Treasury deposit");
    expect(dep.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      "Amount=10.00 USDC",
      `Tx=${SIG.slice(0, 8)}…${SIG.slice(-6)}`,
    ]);

    const topup = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "Admin topup: 5.00 USDC → user wallet",
      data: {
        subkind: "admin_wallet_topup",
        userId: USER_ID,
        walletId: "w-1",
        asset: "usdc",
        amount: "5.00",
        tx: SIG,
        actor: USER_ID,
      },
    });
    expect(topup.url).toBe(`${base}/admin/users`);
    expect(topup.embeds[0].title).toBe("User wallet top-up");
    expect(topup.embeds[0].fields?.map((f) => `${f.name}=${f.value}`)).toEqual([
      `User=${USER_ID.slice(0, 8)}`,
      "Amount=5.00 USDC",
      `Tx=${SIG.slice(0, 8)}…${SIG.slice(-6)}`,
    ]);
  });
});

describe("buildWebhookEnvelope — batas & URL utama", () => {
  it("text tidak pernah melebihi 2000 char (Discord), URL tetap utuh", () => {
    const post = "https://example.com/very/long/post/url/with/path?query=1";
    const long = "word ".repeat(700); // ~3500 char
    const env = buildWebhookEnvelope({
      slot: "events",
      kind: "event_created",
      text: `New event posted: ${long}`,
      data: { url: post, caption: long },
    });
    expect(env.content).toBe("");
    expect(env.text.length).toBeLessThanOrEqual(2000);
    expect(env.text.endsWith(post)).toBe(true);
    expect(env.data.url).toBe(post); // data tidak ikut dipotong
    expect((env.embeds[0].description ?? "").length).toBeLessThanOrEqual(281); // caption dipotong 280 + …
  });

  it("URL utama events tanpa data.url → fallback halaman /events", () => {
    expect(buildWebhookEnvelope({ slot: "events", kind: "event_created", text: "x", data: {} }).url).toBe(
      `${base}/events`,
    );
  });

  it("wallet & user → /admin/users; nilai object tidak pernah jadi field", () => {
    const env = buildWebhookEnvelope({
      slot: "wallet",
      kind: "wallet_created",
      text: "New wallet",
      data: { kind: "mainnet", nested: { a: 1 }, list: [1, 2] },
    });
    expect(env.url).toBe(`${base}/admin/users`);
    expect(env.embeds[0].title).toBe("Mainnet wallet created");
    // tanpa label & tanpa key di luar allowlist → tidak ada field sama sekali
    expect(env.embeds[0].fields).toBeUndefined();
  });

  it("field selalu ≤3 dan nilai ≤1024 char", () => {
    const env = buildWebhookEnvelope({
      slot: "tx",
      kind: "transaction",
      text: "t",
      data: {
        subkind: "admin_wallet_topup",
        userId: "x".repeat(200),
        amount: "1",
        asset: "usdc",
        tx: "y".repeat(2000),
      },
    });
    const fields = env.embeds[0].fields ?? [];
    expect(fields.length).toBeLessThanOrEqual(3);
    expect(fields.every((f) => f.value.length <= 1024)).toBe(true);
  });
});
