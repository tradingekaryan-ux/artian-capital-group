import { describe, it, expect } from "vitest";
import {
  formatCompact,
  formatUsd,
  formatPercent,
  rawToUsdc,
  shortAddress,
  formatDate,
} from "@/lib/format";

describe("format", () => {
  it("formatCompact", () => {
    expect(formatCompact(1234)).toBe("1.23K");
    expect(formatCompact(0)).toBe("0");
  });

  it("formatUsd", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0.0000123)).toContain("$");
  });

  it("formatPercent", () => {
    expect(formatPercent(5.123)).toBe("+5.12%");
    expect(formatPercent(-2.5)).toBe("-2.50%");
  });

  it("rawToUsdc", () => {
    expect(rawToUsdc("1000000")).toBe(1);
    expect(rawToUsdc(1_500_000)).toBe(1.5);
  });

  it("shortAddress", () => {
    expect(shortAddress("So11111111111111111111111111111111111111112")).toBe("So11…1112");
    expect(shortAddress("abc")).toBe("abc");
  });

  it("formatDate", () => {
    expect(formatDate("2026-01-15T00:00:00.000Z")).toContain("2026");
    expect(formatDate("invalid")).toBe("invalid");
  });
});
