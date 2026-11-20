// Server-only Solana logic: the challenge escrow. Never import this in client code.
import "server-only";
import { assertDevnet } from "./solana-network";
import { buildSimulatedTransaction } from "./wallet-simulation";
import { allSignaturesValid, hasValidSignature } from "./transaction-signatures";
import { kvGet, kvSet } from "./store";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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
  await assertDevnet(connection);
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
 * challenge, distance, time and a SHA-256 fingerprint of the photo check-in.
 * Anyone can later check that the proof shown in the app matches what was recorded on-chain.
 */
export async function stampProof(memo: string) {
  await assertDevnet(connection);
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
  await assertDevnet(connection);
  const fromKey = new PublicKey(from), payer = { publicKey: fromKey }; // one signer: the runner pays the fee
  const toKey = new PublicKey(to);
  const toAta = usdcAccount(toKey);
  const raw = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const { tx, simulation } = await buildSimulatedTransaction(fromKey, [
    createAssociatedTokenAccountIdempotentInstruction(fromKey, toAta, toKey, mint),
    createTransferCheckedInstruction(usdcAccount(fromKey), mint, toAta, fromKey, raw, USDC_DECIMALS),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from("LockRun|cashout", "utf8") })
  ], lifetime.blockhash);
  if (simulation.value.err) throw new Error("Withdrawal simulation failed.");
  return Buffer.from(tx.serialize()).toString('base64');
}

/** Shop: the store wallet (the sponsor/treasury wallet in this demo) that receives payments. */
export function storeAddress() {
  return sponsor().publicKey.toBase58();
}

/** Shop payment, step 1: the runner is the only signer and fee payer; nothing is pre-signed. */
export async function prepareStorePayment(from: string, amountUsd: number, orderId: string) {
  await assertDevnet(connection);
  const fromKey = new PublicKey(from), storeKey = new PublicKey(storeAddress());
  const storeAta = usdcAccount(storeKey);
  const raw = BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const { tx, simulation } = await buildSimulatedTransaction(fromKey, [
    createAssociatedTokenAccountIdempotentInstruction(fromKey, storeAta, storeKey, mint),
    createTransferCheckedInstruction(usdcAccount(fromKey), mint, storeAta, fromKey, raw, USDC_DECIMALS),
    new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`LockRun|shop|${orderId}`, "utf8") })
  ], lifetime.blockhash);
  if (simulation.value.err) throw new Error("Payment simulation failed. Check that your wallet has Devnet SOL for fees and enough Devnet USDC.");
  return { tx: Buffer.from(tx.serialize()).toString("base64"), message: Buffer.from(tx.message.serialize()).toString("base64"), feePayer: from };
}

/** Shop payment, step 2: only the exact transaction prepared for this order, signed by that runner, is accepted. */
export async function submitStorePayment(base64Tx: string, expectedMessage: string, address: string) {
  await assertDevnet(connection);
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  if (Buffer.from(tx.message.serialize()).toString("base64") !== expectedMessage || tx.message.header.numRequiredSignatures !== 1 || !hasValidSignature(tx, address))
    throw new Error("That payment doesn't match your order.");
  const signature = bs58.encode(tx.signatures[0]);
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error("Payment failed on Solana.");
  if (status && ["confirmed", "finalized"].includes(status.confirmationStatus || "")) return signature;
  await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  const result = await connection.confirmTransaction(signature, "confirmed");
  if (result.value.err) throw new Error("Payment failed on Solana.");
  return signature;
}

/** Cash out, step 2: submit the transaction once the runner's browser has signed it. */
export async function submitWithdraw(base64Tx: string) {
  await assertDevnet(connection);
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, 'base64'));
  if (tx.message.header.numRequiredSignatures !== 1) throw new Error('Unexpected withdrawal signers.');
  const allowed = new Set([TOKEN_PROGRAM_ID.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), MEMO_PROGRAM_ID, ComputeBudgetProgram.programId.toBase58()]);
  if (!TransactionMessage.decompile(tx.message).instructions.every(ix => allowed.has(ix.programId.toBase58()))) throw new Error('Unexpected withdrawal instruction.');
  if (!allSignaturesValid(tx)) throw new Error('Missing withdrawal signature.');
  const signature = bs58.encode(tx.signatures[0]);
  const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  if (status?.err) throw new Error('Withdrawal failed on Solana.');
  if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus || '')) return signature;
  await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
  const result = await connection.confirmTransaction(signature, 'confirmed');
  if (result.value.err) throw new Error('Withdrawal failed on Solana.');
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
