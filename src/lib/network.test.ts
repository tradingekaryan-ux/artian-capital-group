import { describe, it, expect } from "vitest";
import {
  usdcMintFor,
  clusterFor,
  explorerClusterParam,
  USDC_MINT_DEMO,
  DEMO_CLUSTER,
} from "@/lib/config";

describe("wallet kind helpers", () => {
  it("usdcMintFor: demo selalu USDC devnet (Circle faucet)", () => {
    expect(usdcMintFor("demo")).toBe(USDC_MINT_DEMO);
    expect(usdcMintFor("demo")).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });

  it("usdcMintFor: mainnet mengembalikan mint non-kosong (default cluster app)", () => {
    // Bisa sama dengan mint devnet jika app lokal NEXT_PUBLIC_SOLANA_CLUSTER=devnet.
    expect(usdcMintFor("mainnet").length).toBeGreaterThan(32);
  });

  it("clusterFor: demo selalu devnet", () => {
    expect(clusterFor("demo")).toBe("devnet");
    expect(clusterFor("demo")).toBe(DEMO_CLUSTER);
  });

  it("explorerClusterParam: cocok untuk parameter ?cluster=", () => {
    expect(explorerClusterParam("demo")).toBe("devnet");
    expect(["mainnet-beta", "devnet"]).toContain(explorerClusterParam("mainnet"));
  });
});
