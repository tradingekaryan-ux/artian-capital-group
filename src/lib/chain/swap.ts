import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getConnection } from "@/lib/solana/connection";
import { JUPITER, type WalletKind } from "@/lib/config";

/**
 * Swap in-app via Jupiter Aggregator (REST).
 * Model gas: treasury mengirim "gas drop" SOL kecil ke wallet user sebelum swap,
 * lalu transaksi Jupiter ditandatangani user (fee payer = user).
 * Dust SOL yang tersisa tercakup oleh fee swap platform (0.30%).
 */

export interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  [k: string]: unknown;
}

function headers(): Record<string, string> {
  return JUPITER.apiKey ? { "x-api-key": JUPITER.apiKey } : {};
}

export async function getQuote(params: {
  inputMint: string;
  outputMint: string;
  amountRaw: bigint;
  slippageBps?: number;
}): Promise<QuoteResponse> {
  const url = new URL(`${JUPITER.apiBase}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amountRaw.toString());
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 50));
  url.searchParams.set("swapMode", "ExactIn");
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter quote gagal: ${res.status} ${await res.text()}`);
  return (await res.json()) as QuoteResponse;
}

export async function executeSwapToUsdc(params: {
  owner: Keypair; // wallet user
  inputMint: string;
  amountRaw: bigint;
  slippageBps?: number;
}): Promise<{ outAmount: string; txSignature: string }> {
  const quote = await getQuote({
    inputMint: params.inputMint,
    outputMint: (await import("@/lib/config")).USDC_MINT,
    amountRaw: params.amountRaw,
    slippageBps: params.slippageBps,
  });

  const res = await fetch(`${JUPITER.apiBase}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: params.owner.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap gagal: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { swapTransaction: string };

  const tx = VersionedTransaction.deserialize(Buffer.from(data.swapTransaction, "base64"));
  tx.sign([params.owner]);
  const connection = getConnection();
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return { outAmount: quote.outAmount, txSignature: sig };
}

/** Gas drop: treasury kirim sedikit SOL ke user untuk fee swap. */
export async function gasDrop(
  userOwner: string,
  lamports = 2_000_000,
  kind: WalletKind = "mainnet",
): Promise<void> {
  const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import(
    "@solana/web3.js"
  );
  const { PublicKey } = await import("@solana/web3.js");
  const { getTreasury } = await import("@/lib/chain/usdc");
  const treasury = getTreasury(kind);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: new PublicKey(userOwner),
      lamports,
    }),
  );
  const conn = getConnection(kind);
  await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
}
