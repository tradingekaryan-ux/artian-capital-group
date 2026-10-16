import { describe, it, expect } from "vitest";
import { usdcToRaw, swapFeeRaw, rawToUsdc, pricingValueSchema } from "./pricing";

describe("pricing (pure)", () => {
  it("usdcToRaw mengonversi 6 desimal", () => {
    expect(usdcToRaw(2)).toBe(2_000_000n);
    expect(usdcToRaw(0.5)).toBe(500_000n);
  });

  it("rawToUsdc inverse dari usdcToRaw", () => {
    expect(rawToUsdc(usdcToRaw(12.345678))).toBeCloseTo(12.345678, 6);
  });

  it("swapFeeRaw = persen dari input", () => {
    // 0.3% dari 100 USDC = 0.3 USDC
    expect(swapFeeRaw(100_000_000n, 0.3, 0.05)).toBe(300_000n);
  });

  it("swapFeeRaw menghormati minimum", () => {
    // 0.3% dari 1 USDC = 0.003 → min 0.05 yang berlaku
    expect(swapFeeRaw(1_000_000n, 0.3, 0.05)).toBe(50_000n);
  });
});

describe("pricingValueSchema (validasi PATCH admin)", () => {
  it("menerima value yang valid", () => {
    expect(pricingValueSchema.safeParse({ flat_usdc: 0.5 }).success).toBe(true);
    expect(pricingValueSchema.safeParse({ percent: 0.3, min_usdc: 0.05 }).success).toBe(true);
    expect(pricingValueSchema.safeParse({ amount_usdc: 3, label: "Membuat token" }).success).toBe(true);
  });

  it("menolak object kosong", () => {
    expect(pricingValueSchema.safeParse({}).success).toBe(false);
  });

  it("menolak tipe salah / nilai di luar batas", () => {
    expect(pricingValueSchema.safeParse({ flat_usdc: "abc" }).success).toBe(false);
    expect(pricingValueSchema.safeParse({ percent: -1 }).success).toBe(false);
    expect(pricingValueSchema.safeParse({ percent: 101 }).success).toBe(false);
  });

  it("menolak field tak dikenal", () => {
    // JSON.parse membuat __proto__ jadi own-property biasa (bukan prototype setter)
    expect(pricingValueSchema.safeParse(JSON.parse('{"__proto__":1,"flat_usdc":1}')).success).toBe(false);
    expect(pricingValueSchema.safeParse({ evil: 1, flat_usdc: 1 }).success).toBe(false);
  });
});
