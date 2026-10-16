import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  Raydium,
  TxVersion,
  Percent,
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID,
} from "@raydium-io/raydium-sdk-v2";
import type {
  ApiV3PoolInfoStandardItemCpmm,
  CpmmKeys,
} from "@raydium-io/raydium-sdk-v2";
import { getConnection, rpcRead } from "@/lib/solana/connection";
import { getTreasury } from "@/lib/chain/usdc";
import { IS_MAINNET } from "@/lib/config";

/**
 * Modul Liquidity Pool — Raydium CPMM (Standard AMM).
 *
 * API mengikuti @raydium-io/raydium-sdk-v2@0.2.74-alpha (Raydium.load,
 * raydium.cpmm.createPool/addLiquidity/withdrawLiquidity).
 *
 * CATATAN FASE 4 (spike): verifikasi end-to-end di devnet sebelum mainnet —
 * khususnya feePayer treasury & pemilihan feeConfig. Alternatif yang
 * dibandingkan: Meteora DAMM v2 & Orca Whirlpools.
 */

const COMPUTE_BUDGET = { units: 600_000, microLamports: 100_000 } as const;

async function initRaydium(owner: Keypair) {
  return Raydium.load({
    connection: getConnection(),
    owner,
    cluster: IS_MAINNET ? "mainnet" : "devnet",
    blockhashCommitment: "confirmed",
    disableFeatureCheck: true,
  });
}

function cpmmProgramId(): PublicKey {
  return IS_MAINNET ? CREATE_CPMM_POOL_PROGRAM : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
}

function cpmmFeeAccount(): PublicKey {
  return IS_MAINNET ? CREATE_CPMM_POOL_FEE_ACC : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;
}

export interface CreatePoolParams {
  owner: Keypair; // wallet user (LP token → wallet ini)
  baseMint: PublicKey; // token buatan user
  quoteMint: PublicKey; // USDC / SOL
  baseAmountRaw: bigint;
  quoteAmountRaw: bigint;
  feeBps?: number; // default 25 = 0.25%
}

export interface CreatePoolResult {
  poolId: string;
  lpMint: string;
  txSignature?: string;
}

export async function createCpmmPool(p: CreatePoolParams): Promise<CreatePoolResult> {
  const raydium = await initRaydium(p.owner);

  // fee tier dari API (tradeFeeRate dalam satuan 1e6 → 2500 = 0.25%)
  const configs = await raydium.api.getCpmmConfigs();
  const target = (p.feeBps ?? 25) * 100;
  const feeConfig = configs.reduce((best, c) =>
    Math.abs(c.tradeFeeRate - target) < Math.abs(best.tradeFeeRate - target) ? c : best,
  configs[0]);

  const mintA = await raydium.token.getTokenInfo(p.baseMint);
  const mintB = await raydium.token.getTokenInfo(p.quoteMint);

  // Builder Raydium bermasalah dgn feePayer asing (akun user ter-mark readonly
  // → PrivilegeEscalation). Pakai feePayer default = owner; user dibekali
  // sedikit SOL oleh treasury (boros ≤0.001 SOL per pool).
  const userSol = await rpcRead((c) => c.getBalance(p.owner.publicKey));
  // CPMM creation fee protocol 0.15 SOL + rent akun (boros — hanya devnet/mainnet).
  if (userSol < 260_000_000) {
    const { gasDrop } = await import("@/lib/chain/swap");
    await gasDrop(p.owner.publicKey.toBase58(), 250_000_000);
  }

  const built = await raydium.cpmm.createPool({
    programId: cpmmProgramId(),
    poolFeeAccount: cpmmFeeAccount(),
    mintA,
    mintB,
    mintAAmount: new BN(p.baseAmountRaw.toString()),
    mintBAmount: new BN(p.quoteAmountRaw.toString()),
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: {},
    txVersion: TxVersion.V0,
    computeBudgetConfig: { ...COMPUTE_BUDGET },
  });

  let res;
  try {
    res = await built.execute({ sendAndConfirm: true });
  } catch (e) {
    // Raydium SDK bisa melempar nilai non-Error (reject(undefined) saat confirm
    // timeout) — simpan detail apa adanya.
    const detail =
      e instanceof Error
        ? e.stack || e.message
        : (e !== null && typeof e === "object"
            ? JSON.stringify(e, Object.getOwnPropertyNames(e))
            : String(e)) || String(e);
    throw new Error(`Raydium createPool gagal: ${detail}`);
  }
  const { extInfo } = built;
  return {
    poolId: extInfo.address.poolId.toBase58(),
    lpMint: extInfo.address.lpMint.toBase58(),
    txSignature: res.txId,
  };
}

export interface PoolContext {
  poolInfo: ApiV3PoolInfoStandardItemCpmm;
  poolKeys: CpmmKeys;
}

/**
 * Ambil konteks pool dari RPC (API publik tidak mendukung pool devnet).
 */
export async function getPoolContext(owner: Keypair, poolId: string): Promise<PoolContext> {
  const raydium = await initRaydium(owner);
  const ctx = await raydium.cpmm.getPoolInfoFromRpc(poolId);
  return { poolInfo: ctx.poolInfo, poolKeys: ctx.poolKeys };
}

export interface PoolInfoLite {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  baseReserve: string;
  quoteReserve: string;
  lpSupply: string;
  feeRate: number;
  raw: unknown;
}

export async function fetchPoolInfo(poolId: string): Promise<PoolInfoLite | null> {
  try {
    const raydium = await initRaydium(getTreasury());
    const { poolInfo } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    const raw = poolInfo as unknown as {
      mintA: { address: string; amount?: string };
      mintB: { address: string; amount?: string };
      lpSupply?: string;
      feeRate?: number;
    };
    return {
      poolId,
      baseMint: raw.mintA.address,
      quoteMint: raw.mintB.address,
      baseReserve: String(raw.mintA.amount ?? "0"),
      quoteReserve: String(raw.mintB.amount ?? "0"),
      lpSupply: String(raw.lpSupply ?? "0"),
      feeRate: Number(raw.feeRate ?? 0.25),
      raw: poolInfo,
    };
  } catch {
    return null;
  }
}

export async function addLiquidity(params: {
  owner: Keypair;
  poolId: string;
  inputAmountRaw: bigint; // salah satu sisi (baseIn menentukan sisi mana)
  baseIn: boolean;
  slippagePercent?: number;
}): Promise<{ txSignature?: string; lpAmount?: string }> {
  const raydium = await initRaydium(params.owner);
  const { poolInfo, poolKeys } = await getPoolContext(params.owner, params.poolId);
  const { execute, extInfo } = await raydium.cpmm.addLiquidity({
    poolInfo,
    poolKeys,
    inputAmount: new BN(params.inputAmountRaw.toString()),
    baseIn: params.baseIn,
    slippage: new Percent(params.slippagePercent ?? 1, 100),
    txVersion: TxVersion.V0,
    computeBudgetConfig: { ...COMPUTE_BUDGET },
  });
  const res = await execute({ sendAndConfirm: true });
  const lp = (extInfo as { lpAmount?: { toString(): string } } | undefined)?.lpAmount;
  return {
    txSignature: res.txId,
    lpAmount: lp?.toString(),
  };
}

export async function removeLiquidity(params: {
  owner: Keypair;
  poolId: string;
  lpAmountRaw: bigint;
  slippagePercent?: number;
}): Promise<{ txSignature?: string }> {
  const raydium = await initRaydium(params.owner);
  const { poolInfo, poolKeys } = await getPoolContext(params.owner, params.poolId);
  const { execute } = await raydium.cpmm.withdrawLiquidity({
    poolInfo,
    poolKeys,
    lpAmount: new BN(params.lpAmountRaw.toString()),
    slippage: new Percent(params.slippagePercent ?? 1, 100),
    txVersion: TxVersion.V0,
    computeBudgetConfig: { ...COMPUTE_BUDGET },
  });
  const res = await execute({ sendAndConfirm: true });
  return { txSignature: res.txId };
}
