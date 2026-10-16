import { describe, it, expect } from "vitest";
import { usdcToRaw, swapFeeRaw, rawToUsdc } from "./pricing";

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
