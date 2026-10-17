import { describe, it, expect } from "vitest";
import {
  usdcToRaw,
  swapFeeRaw,
  rawToUsdc,
  pricingValueSchema,
  uiToRaw,
  U64_MAX,
  requiredSolFor,
  SOL_REQUIREMENT,
} from "./pricing";

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

describe("uiToRaw (konversi presisi-eksak)", () => {
  it("mengonversi benar tanpa kehilangan presisi Number", () => {
    expect(uiToRaw("1", 9)).toBe(1_000_000_000n);
    expect(uiToRaw("0.5", 6)).toBe(500_000n);
    expect(uiToRaw("1000000000", 9)).toBe(1_000_000_000_000_000_000n);
    // kasus yang SALAH bila pakai Number: 9007199254740993 (2^53+1)
    expect(uiToRaw("9007199254740993", 0)).toBe(9007199254740993n);
  });

  it("menolak format tidak valid", () => {
    expect(() => uiToRaw("abc", 9)).toThrow();
    expect(() => uiToRaw("-5", 9)).toThrow();
    expect(() => uiToRaw("1.2.3", 9)).toThrow();
    expect(() => uiToRaw("", 9)).toThrow();
  });

  it("menolak melebihi desimal / u64", () => {
    expect(() => uiToRaw("0.1234567", 6)).toThrow();
    expect(() => uiToRaw("20000000000", 9)).toThrow(); // 2e10 * 1e9 > u64
    expect(uiToRaw(String(U64_MAX), 0)).toBe(U64_MAX);
  });
});

describe("requiredSolFor (preflight gas user)", () => {
  it("setiap layanan punya kebutuhan SOL > 0", () => {
    const services = Object.keys(SOL_REQUIREMENT);
    expect(services.length).toBeGreaterThanOrEqual(5);
    for (const s of services) {
      expect(requiredSolFor(s as keyof typeof SOL_REQUIREMENT)).toBeGreaterThan(0);
    }
  });

  it("biaya pembuatan pool jauh lebih besar dari layanan lain (CPMM fee 0.15 SOL)", () => {
    expect(SOL_REQUIREMENT.create_pool).toBeGreaterThan(SOL_REQUIREMENT.create_token);
    expect(SOL_REQUIREMENT.create_pool).toBeGreaterThan(0.3);
  });

  it("service tak dikenal fallback ke kebutuhan kecil", () => {
    expect(requiredSolFor("bogus" as never)).toBe(0.01);
  });
});
