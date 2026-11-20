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

export async function escrowBalance(): Promise<number | null> {
  try {
    const bal = await connection.getTokenAccountBalance(usdcAccount(escrow().publicKey));
    return Number(bal.value.uiAmount || 0);
  } catch {
    return null;
  }
}
