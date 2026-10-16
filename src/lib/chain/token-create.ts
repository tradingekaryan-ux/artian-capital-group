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
import { getTreasury } from "@/lib/chain/usdc";

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
 *  1. createMint            — payer treasury, authority sementara treasury
 *  2. createV1 (Metaplex)   — metadata on-chain, update authority = wallet user
 *  3. ATA user + mintTo     — supply penuh masuk ke wallet user
 *  4. setAuthority (opsional) — revoke mint/freeze (ditandatangani user)
 *
 * User tidak pernah membutuhkan SOL: semua fee & rent dibayar treasury.
 */
export async function createSplToken(params: CreateTokenParams): Promise<CreateTokenResult> {
  const connection = getConnection();
  const treasury = getTreasury();
  const signatures: string[] = [];

  // 1) Mint account (Token Program)
  const mintAddr = await createMint(
    connection,
    treasury,
    treasury.publicKey, // mint authority sementara (treasury) — dipindah/revoke setelah supply ter-mint
    treasury.publicKey, // freeze authority sementara
    params.decimals,
    params.mint,
  );
  const initSigs = await connection.getSignaturesForAddress(mintAddr, { limit: 2 });
  signatures.push(...initSigs.map((s) => s.signature).reverse());

  // 2) Metadata (Metaplex Token Metadata, via umi)
  const umi = createUmi(connection.rpcEndpoint, { commitment: "confirmed" });
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(treasury.secretKey)));
  const umiMint = createSignerFromKeypair(
    umi,
    umi.eddsa.createKeypairFromSecretKey(params.mint.secretKey),
  );
  const umiUser = createSignerFromKeypair(
    umi,
    umi.eddsa.createKeypairFromSecretKey(params.owner.secretKey),
  );
  const metaSig = await createV1(umi, {
    mint: umiMint,
    // authority = mint authority di-chain (treasury, hasil langkah 1);
    // di Token Metadata wajib cocok dengan mint, kalau tidak → error 0xa.
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umiUser.publicKey,
    name: params.name.slice(0, 32),
    symbol: params.symbol.slice(0, 10),
    uri: params.metadataUri,
    // Tanpa creators: resolver default menandai authority (treasury) sbg
    // creator verified — melanggar aturan "creator must sign" (error 0x36).
    creators: none(),
    sellerFeeBasisPoints: createAmount(0, "%", 2),
    tokenStandard: TokenStandard.Fungible,
    isMutable: !params.immutableMetadata,
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  signatures.push(String(metaSig.signature));

  // 3) ATA user + seluruh supply (mint authority masih treasury)
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,
    mintAddr,
    params.owner.publicKey,
  );
  const sigMintTo = await mintTo(
    connection,
    treasury,
    mintAddr,
    ata.address, // seluruh supply masuk ke ATA user
    treasury.publicKey, // authority sementara
    params.supplyRaw,
    [],
  );
  signatures.push(sigMintTo);

  // 3b) Pindahkan mint authority dari treasury → user (sebelum revoke)
  await setAuthority(
    connection,
    treasury,
    mintAddr,
    treasury.publicKey,
    AuthorityType.MintTokens,
    params.owner.publicKey,
    [],
  );
  await setAuthority(
    connection,
    treasury,
    mintAddr,
    treasury.publicKey,
    AuthorityType.FreezeAccount,
    params.owner.publicKey,
    [],
  );

  // 4) Revoke authorities sesuai pilihan user (ditandatangani user)
  if (params.revokeMintAuthority) {
    signatures.push(
      await setAuthority(
        connection,
        treasury,
        mintAddr,
        params.owner.publicKey,
        AuthorityType.MintTokens,
        null,
        [params.owner],
      ),
    );
  }
  if (params.revokeFreezeAuthority) {
    signatures.push(
      await setAuthority(
        connection,
        treasury,
        mintAddr,
        params.owner.publicKey,
        AuthorityType.FreezeAccount,
        null,
        [params.owner],
      ),
    );
  }

  void ata; // ATA dibuat untuk menerima supply
  return { mint: mintAddr.toBase58(), signatures };
}
