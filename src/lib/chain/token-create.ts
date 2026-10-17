import { Keypair } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  keypairIdentity,
  createSignerFromKeypair,
  createAmount,
  none,
} from "@metaplex-foundation/umi";
import { createV1, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { getConnection } from "@/lib/solana/connection";
import type { WalletKind } from "@/lib/config";

export interface CreateTokenParams {
  mint: Keypair; // keypair mint baru — secret hanya dipakai saat init & metadata
  owner: Keypair; // wallet user (sudah didecrypt di server)
  decimals: number;
  supplyRaw: bigint; // supply dalam base unit
  metadataUri: string;
  name: string;
  symbol: string;
  revokeMintAuthority: boolean;
  revokeFreezeAuthority: boolean;
  immutableMetadata: boolean;
}

export interface CreateTokenResult {
  mint: string;
  signatures: string[];
}

/**
 * Buat token SPL lengkap dengan Metaplex metadata, dalam satu alur:
 *  1. createMint            — payer & authority = wallet user
 *  2. createV1 (Metaplex)   — metadata on-chain, payer & update authority = user
 *  3. ATA user + mintTo     — supply penuh masuk ke wallet user
 *  4. setAuthority (opsional) — revoke mint/freeze oleh user
 *
 * Model gas: SELURUH fee & rent dibayar dari saldo SOL milik user
 * (wallet user = fee-payer) — platform tidak mendanai treasury.
 * Preflight `requiredSolFor("create_token")` dijalankan sebelum order dibayar.
 */
export async function createSplToken(
  params: CreateTokenParams,
  kind: WalletKind = "mainnet",
): Promise<CreateTokenResult> {
  const connection = getConnection(kind);
  const owner = params.owner;
  const signatures: string[] = [];

  // 1) Mint account (Token Program) — payer & authority = user
  const mintAddr = await createMint(
    connection,
    owner,
    owner.publicKey, // mint authority = user sejak awal (tanpa transfer)
    owner.publicKey, // freeze authority = user
    params.decimals,
    params.mint,
  );
  const initSigs = await connection.getSignaturesForAddress(mintAddr, { limit: 2 });
  signatures.push(...initSigs.map((s) => s.signature).reverse());

  // 2) Metadata (Metaplex Token Metadata, via umi) — identity = user (payer)
  const umi = createUmi(connection.rpcEndpoint, { commitment: "confirmed" });
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(owner.secretKey)));
  const umiMint = createSignerFromKeypair(
    umi,
    umi.eddsa.createKeypairFromSecretKey(params.mint.secretKey),
  );
  const metaSig = await createV1(umi, {
    mint: umiMint,
    // authority = mint authority di-chain (= user, hasil langkah 1);
    // di Token Metadata wajib cocok dengan mint, kalau tidak → error 0xa.
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity.publicKey,
    name: params.name.slice(0, 32),
    symbol: params.symbol.slice(0, 10),
    uri: params.metadataUri,
    // Tanpa creators: resolver default menandai authority sbg creator
    // verified — melanggar aturan "creator must sign" (error 0x36).
    creators: none(),
    sellerFeeBasisPoints: createAmount(0, "%", 2),
    tokenStandard: TokenStandard.Fungible,
    isMutable: !params.immutableMetadata,
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  signatures.push(String(metaSig.signature));

  // 3) ATA user + seluruh supply (authority = user)
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    owner,
    mintAddr,
    owner.publicKey,
  );
  const sigMintTo = await mintTo(
    connection,
    owner,
    mintAddr,
    ata.address, // seluruh supply masuk ke ATA user
    owner.publicKey, // authority = user
    params.supplyRaw,
    [],
  );
  signatures.push(sigMintTo);

  // 4) Revoke authorities sesuai pilihan user (user = authority saat ini)
  if (params.revokeMintAuthority) {
    signatures.push(
      await setAuthority(
        connection,
        owner,
        mintAddr,
        owner.publicKey,
        AuthorityType.MintTokens,
        null,
        [],
      ),
    );
  }
  if (params.revokeFreezeAuthority) {
    signatures.push(
      await setAuthority(
        connection,
        owner,
        mintAddr,
        owner.publicKey,
        AuthorityType.FreezeAccount,
        null,
        [],
      ),
    );
  }

  void ata; // ATA dibuat untuk menerima supply
  return { mint: mintAddr.toBase58(), signatures };
}
