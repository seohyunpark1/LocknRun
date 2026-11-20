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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
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
export async function payFromEscrow(challengeId: string, to: string, amount: number, kind: "payout" | "sponsor-refund" = "payout") {
  const key = `${kind}:${challengeId}:${to}`;
  type Payment = { signature: string; raw: string; blockhash: string; lastValidBlockHeight: number; amount: number };
  let payment = await kvGet<Payment>(key);
  if (payment && payment.amount !== amount) throw new Error("Recorded payout amount differs; reconciliation required.");
  if (!payment) {
    const payer = sponsor(), source = escrow(), owner = new PublicKey(to);
    const lifetime = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({ ...lifetime, feePayer: payer.publicKey }).add(
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, usdcAccount(owner), owner, mint),
      createTransferCheckedInstruction(usdcAccount(source.publicKey), mint, usdcAccount(owner), source.publicKey, BigInt(Math.round(amount * 10 ** USDC_DECIMALS)), USDC_DECIMALS),
      new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`LockRun|${kind}|${challengeId}`) })
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

/** Legacy demo bonuses came from the configured sponsor; new bonuses record their actual funding wallet. */
export function sponsorAddress() { return sponsor().publicKey.toBase58(); }

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

/** A runner's own USDC balance (their in-browser wallet), read from Solana. */
export async function usdcBalance(owner: string): Promise<number> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(new PublicKey(owner)));
    return Number(bal.value.uiAmount || 0);
  } catch (e) {
    if (e instanceof Error && /could not find account/i.test(e.message)) return 0;
    throw e;
  }
}

/**
 * Cash out, step 1: the server builds a USDC transfer from the runner's wallet to any Solana address,
 * with the sponsor as fee payer (so runners never need SOL), and signs it as fee payer only.
 * The runner's browser adds its own signature; nobody else can move the runner's money.
 */
export async function prepareWithdraw(from: string, to: string, amountUsd: number) {
  const payer = sponsor();
  const fromKey = new PublicKey(from);
  const toKey = new PublicKey(to);
  const toAta = usdcAccount(toKey);
  const raw = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, toAta, toKey, mint),
    createTransferCheckedInstruction(usdcAccount(fromKey), mint, toAta, fromKey, raw, USDC_DECIMALS),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from("LockRun|cashout", "utf8") })
  );
  tx.feePayer = payer.publicKey;
  const simulation = await connection.simulateTransaction(tx);
  if (simulation.value.err) throw new Error("Withdrawal simulation failed.");
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.partialSign(payer);
  return tx.serialize({ requireAllSignatures: false }).toString("base64");
}

/** Cash out, step 2: submit the transaction once the runner's browser has signed it. */
export async function submitWithdraw(base64Tx: string) {
  const tx = Transaction.from(Buffer.from(base64Tx, "base64"));
  const payer = sponsor().publicKey;
  // Only accept transactions this server built: sponsor pays fees, and only token / account / memo instructions.
  const allowed = new Set([TOKEN_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), MEMO_PROGRAM_ID]);
  if (!tx.feePayer?.equals(payer) || !tx.instructions.every((ix) => allowed.has(ix.programId.toBase58())) || !tx.verifySignatures())
    throw new Error("That transaction wasn't prepared by Lock&Run.");
  const signature = bs58.encode(tx.signature!);
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error("Withdrawal failed on Solana.");
  if (status && ["confirmed", "finalized"].includes(status.confirmationStatus || "")) return signature;
  await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const result = await connection.confirmTransaction(signature, "confirmed");
  if (result.value.err) throw new Error("Withdrawal failed on Solana.");
  return signature;
}

export async function escrowBalance(): Promise<number | null> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(escrow().publicKey));
    return Number(bal.value.uiAmount || 0);
  } catch {
    return null;
  }
}
