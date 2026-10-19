import { describe, expect, it } from "vitest";
import { normalizeWalletLabel, WALLET_LABEL_MAX } from "@/lib/wallet-label";

describe("normalizeWalletLabel", () => {
  it("trim spasi & buang karakter kontrol", () => {
    expect(normalizeWalletLabel("  Ops  ")).toBe("Ops");
    expect(normalizeWalletLabel("Bot\u0000 trading\n")).toBe("Bot trading");
  });

  it("hasil kosong (kosong/spasi/kontrol saja) → null", () => {
    expect(normalizeWalletLabel("")).toBeNull();
    expect(normalizeWalletLabel("   ")).toBeNull();
    expect(normalizeWalletLabel("\u0000\u001f")).toBeNull();
    expect(normalizeWalletLabel(undefined)).toBeNull();
    expect(normalizeWalletLabel(null)).toBeNull();
    expect(normalizeWalletLabel(42 as unknown as string)).toBeNull(); // tipe salah
  });

  it("dipotong ke maksimum 40 char", () => {
    const long = "x".repeat(80);
    expect(normalizeWalletLabel(long)?.length).toBe(WALLET_LABEL_MAX);
    expect(normalizeWalletLabel("y".repeat(WALLET_LABEL_MAX))).toBe("y".repeat(WALLET_LABEL_MAX));
  });

  it("label valid dipertahankan apa adanya", () => {
    expect(normalizeWalletLabel("Trading harian #2")).toBe("Trading harian #2");
  });
});
