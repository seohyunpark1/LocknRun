// Server-only Solana logic: the challenge escrow. Never import this in client code.
import "server-only";
import { kvGet, kvSet } from "./store";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { MEMO_PROGRAM_ID, RPC_URL, USDC_DECIMALS, USDC_MINT } from "./config";

export const connection = new Connection(RPC_URL, "confirmed");
const mint = new PublicKey(USDC_MINT);

function keypairFromEnv(name: "SPONSOR_SECRET_KEY" | "ESCROW_SECRET_KEY"): Keypair {
  const secret = process.env[name];
  if (!secret) throw new Error(`${name} is missing. Run \`npm run setup\` and add it to .env.local.`);
  return Keypair.fromSecretKey(bs58.decode(secret.trim()));
}
const sponsor = () => keypairFromEnv("SPONSOR_SECRET_KEY");
const escrow = () => keypairFromEnv("ESCROW_SECRET_KEY");

export function escrowAddress(): string | null {
  try {
    return escrow().publicKey.toBase58();
  } catch {
    return null;
  }
}

const usdcAccount = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);

/** Returns rewards to the immutable participant address recorded at deposit. */
export async function payFromEscrow(challengeId: string, to: string, amount: number) {
  const key = `payout:${challengeId}:${to}`;
  type Payment = { signature: string; raw: string; blockhash: string; lastValidBlockHeight: number; amount: number };
  let payment = await kvGet<Payment>(key);
  if (payment && payment.amount !== amount) throw new Error("Recorded payout amount differs; reconciliation required.");
  if (!payment) {
    const payer = sponsor(), source = escrow(), owner = new PublicKey(to);
    const lifetime = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ ...lifetime, feePayer: payer.publicKey }).add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, usdcAccount(owner), owner, mint),
      createTransferCheckedInstruction(usdcAccount(source.publicKey), mint, usdcAccount(owner), source.publicKey, BigInt(Math.round(amount * 10 ** USDC_DECIMALS)), USDC_DECIMALS),
      new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`LockRun|payout|${challengeId}`) })
    );
    tx.sign(...(source.publicKey.equals(payer.publicKey) ? [payer] : [payer, source]));
    payment = { ...lifetime, amount, signature: bs58.encode(tx.signature!), raw: tx.serialize().toString('base64') };
    await kvSet(key, payment);
  }
  const status = (await connection.getSignatureStatuses([payment.signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error('Payout failed; reconciliation required before a new transfer.');
  if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '')) return payment.signature;
  await connection.sendRawTransaction(Buffer.from(payment.raw, 'base64'), { skipPreflight: false });
  const result = await connection.confirmTransaction({ signature: payment.signature, blockhash: payment.blockhash, lastValidBlockHeight: payment.lastValidBlockHeight }, 'confirmed');
  if (result.value.err) throw new Error('Payout failed on Solana.');
  return payment.signature;
}

/**
 * Stamps a run's proof on Solana: a memo-only transaction (paid by the sponsor) containing the
 * challenge, distance, time and a SHA-256 fingerprint of the photo or the Strava activity id.
 * Anyone can later check that the proof shown in the app matches what was recorded on-chain.
 */
export async function stampProof(memo: string) {
  const payer = sponsor();
  const tx = new Transaction().add(
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(memo.slice(0, 500), "utf8") })
  );
  tx.feePayer = payer.publicKey;
  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
}

export async function escrowBalance(): Promise<number | null> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(escrow().publicKey));
    return Number(bal.value.uiAmount || 0);
  } catch {
    return null;
  }
}
