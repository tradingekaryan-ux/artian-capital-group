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
import { clusterFor, type WalletKind } from "@/lib/config";

/**
 * Modul Liquidity Pool — Raydium CPMM (Standard AMM).
 *
 * API mengikuti @raydium-io/raydium-sdk-v2@0.2.74-alpha (Raydium.load,
 * raydium.cpmm.createPool/addLiquidity/withdrawLiquidity).
 *
 * CATATAN FASE 4 (spike): verifikasi end-to-end di devnet sebelum mainnet —
 * khususnya feePayer = wallet user (gas dari saldo SOL user) & pemilihan
 * feeConfig. Alternatif yang dibandingkan: Meteora DAMM v2 & Orca Whirlpools.
 */

const COMPUTE_BUDGET = { units: 600_000, microLamports: 100_000 } as const;

/** Raydium hanya mengenali "mainnet" | "devnet" (cluster utama live bisa devnet saat pengembangan). */
function raydiumCluster(kind: WalletKind): "mainnet" | "devnet" {
  return clusterFor(kind) === "mainnet-beta" ? "mainnet" : "devnet";
}

async function initRaydium(owner: Keypair, kind: WalletKind = "mainnet") {
  return Raydium.load({
    connection: getConnection(kind),
    owner,
    cluster: raydiumCluster(kind),
    blockhashCommitment: "confirmed",
    disableFeatureCheck: true,
  });
}

function cpmmProgramId(kind: WalletKind = "mainnet"): PublicKey {
  return raydiumCluster(kind) === "mainnet"
    ? CREATE_CPMM_POOL_PROGRAM
    : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM;
}

function cpmmFeeAccount(kind: WalletKind = "mainnet"): PublicKey {
  return raydiumCluster(kind) === "mainnet"
    ? CREATE_CPMM_POOL_FEE_ACC
    : DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC;
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

export async function createCpmmPool(
  p: CreatePoolParams,
  kind: WalletKind = "mainnet",
): Promise<CreatePoolResult> {
  const raydium = await initRaydium(p.owner, kind);

  // fee tier dari API (tradeFeeRate dalam satuan 1e6 → 2500 = 0.25%)
  const configs = await raydium.api.getCpmmConfigs();
  const target = (p.feeBps ?? 25) * 100;
  const feeConfig = configs.reduce((best, c) =>
    Math.abs(c.tradeFeeRate - target) < Math.abs(best.tradeFeeRate - target) ? c : best,
  configs[0]);

  const mintA = await raydium.token.getTokenInfo(p.baseMint);
  const mintB = await raydium.token.getTokenInfo(p.quoteMint);

  // Builder Raydium bermasalah dgn feePayer asing (akun user ter-mark readonly
  // → PrivilegeEscalation). Pakai feePayer default = owner — gas pembuatan pool
  // (protokol CPMM 0.15 SOL + rent) dibayar dari saldo SOL milik user sendiri.
  const userSol = await rpcRead((c) => c.getBalance(p.owner.publicKey), kind);
  if (userSol < 260_000_000) {
    throw new Error(
      "Saldo SOL tidak cukup untuk biaya pembuatan pool (butuh ±0,26 SOL). Isi SOL dulu, lalu coba lagi.",
    );
  }

  const built = await raydium.cpmm.createPool({
    programId: cpmmProgramId(kind),
    poolFeeAccount: cpmmFeeAccount(kind),
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
export async function getPoolContext(
  owner: Keypair,
  poolId: string,
  kind: WalletKind = "mainnet",
): Promise<PoolContext> {
  const raydium = await initRaydium(owner, kind);
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

export async function fetchPoolInfo(
  poolId: string,
  kind: WalletKind = "mainnet",
): Promise<PoolInfoLite | null> {
  try {
    const raydium = await initRaydium(getTreasury(kind), kind);
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    const raw = poolInfo as unknown as {
      mintA: { address: string };
      mintB: { address: string };
      feeRate?: number;
    };
    // SDK getPoolInfoFromRpc TIDAK mengisi amount — baca reserve aktual dari vault.
    const vault = (poolKeys as { vault: Record<string, unknown> }).vault;
    const vaultA = String(vault.A ?? vault.vaultA ?? "");
    const vaultB = String(vault.B ?? vault.vaultB ?? "");
    if (!vaultA || !vaultB) return null;
    const [a, b] = await Promise.all([
      rpcRead((c) => c.getTokenAccountBalance(new PublicKey(vaultA)), kind),
      rpcRead((c) => c.getTokenAccountBalance(new PublicKey(vaultB)), kind),
    ]);
    return {
      poolId,
      baseMint: raw.mintA.address,
      quoteMint: raw.mintB.address,
      baseReserve: a.value.amount,
      quoteReserve: b.value.amount,
      lpSupply: "0",
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
  kind?: WalletKind;
}): Promise<{ txSignature?: string; lpAmount?: string }> {
  const kind = params.kind ?? "mainnet";
  const raydium = await initRaydium(params.owner, kind);
  const { poolInfo, poolKeys } = await getPoolContext(params.owner, params.poolId, kind);
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
  kind?: WalletKind;
}): Promise<{ txSignature?: string }> {
  const kind = params.kind ?? "mainnet";
  const raydium = await initRaydium(params.owner, kind);
  const { poolInfo, poolKeys } = await getPoolContext(params.owner, params.poolId, kind);
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
