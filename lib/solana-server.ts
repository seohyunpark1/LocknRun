// Server-only Solana logic: the challenge escrow. Never import this in client code.
import "server-only";
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

/** USDC transfer with a memo. The sponsor pays fees and creates the receiver's account, so runners never need SOL. */
async function transferUsdc(from: Keypair, toOwner: PublicKey, amountUsd: number, memo: string) {
  const payer = sponsor();
  const toAta = usdcAccount(toOwner);
  const raw = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, toAta, toOwner, mint),
    createTransferCheckedInstruction(usdcAccount(from.publicKey), mint, toAta, from.publicKey, raw, USDC_DECIMALS),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(memo, "utf8") })
  );
  tx.feePayer = payer.publicKey;
  const signers = from.publicKey.equals(payer.publicKey) ? [payer] : [payer, from];
  return sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
}

/** Runner joins: deposit is locked in escrow. (Sponsor = demo stand-in for a card / Apple Pay payment.) */
export function lockDeposit(challengeId: string, amount: number) {
  return transferUsdc(sponsor(), escrow().publicKey, amount, `LockRun|join|${challengeId}`);
}

/** A brand sponsors a challenge: the bonus is locked in escrow. (Sponsor wallet = demo stand-in for the brand's card.) */
export function lockSponsorBonus(challengeId: string, amount: number) {
  return transferUsdc(sponsor(), escrow().publicKey, amount, `LockRun|sponsor|${challengeId}`);
}

/** Nobody finished: the sponsor bonus goes back (to the brand's card, in production). */
export function refundSponsorBonus(challengeId: string, amount: number) {
  return transferUsdc(escrow(), sponsor().publicKey, amount, `LockRun|sponsor-refund|${challengeId}`);
}

/** Settlement: escrow pays a finisher (or refunds everyone if nobody finished). */
export function payFromEscrow(challengeId: string, to: string, amount: number) {
  return transferUsdc(escrow(), new PublicKey(to), amount, `LockRun|payout|${challengeId}`);
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

/** A runner's own USDC balance (their in-browser wallet), read from Solana. */
export async function usdcBalance(owner: string): Promise<number> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(new PublicKey(owner)));
    return Number(bal.value.uiAmount || 0);
  } catch {
    return 0; // no USDC account yet
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
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

export async function escrowBalance(): Promise<number | null> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(escrow().publicKey));
    return Number(bal.value.uiAmount || 0);
  } catch {
    return null;
  }
}
