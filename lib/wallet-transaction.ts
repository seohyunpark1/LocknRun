import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';

export const WALLET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export function buildWalletTransaction(payer: PublicKey, instructions: TransactionInstruction[], blockhash: string) {
  // The installed SDK can read v1 but cannot serialize it. v0 is Phantom's documented compatible format.
  return new VersionedTransaction(new TransactionMessage({ payerKey: payer, instructions, recentBlockhash: blockhash }).compileToV0Message());
}
/** Explicit compute-unit and loaded-account-data limits, so wallets can predict the transaction's cost and footprint. */
export function budgetInstructions(units: number, loadedAccountsBytes: number) {
  const data = Buffer.alloc(5); data.writeUInt8(4, 0); data.writeUInt32LE(loadedAccountsBytes, 1); // SetLoadedAccountsDataSizeLimit
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data })];
}
function isBudgetInstruction(ix: TransactionInstruction, kind: number) { return ix.programId.equals(ComputeBudgetProgram.programId) && ix.keys.length === 0 && ix.data.length === 5 && ix.data[0] === kind; }
export function equalBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((v, i) => v === b[i]); }

function sameInstruction(actual: TransactionInstruction, expected: TransactionInstruction) {
  // Compilation upgrades shared account flags across instructions, so compare keys/order/data here;
  // signer and writable permissions are separately checked across the complete message below.
  return actual.programId.equals(expected.programId) && equalBytes(actual.data, expected.data) && actual.keys.length === expected.keys.length && actual.keys.every((k, i) => k.pubkey.equals(expected.keys[i].pubkey));
}
/** Independently check the bytes handed to the wallet, rather than trusting a display label. */
export function inspectWalletTransfer(bytes: Uint8Array, expected: { from: string; to: string; amount: number; feePayer: string; sponsored?: boolean }) {
  const tx = VersionedTransaction.deserialize(bytes);
  if (tx.version !== 0 || tx.message.addressTableLookups.length) throw new Error('Unsupported wallet transaction format.');
  const from = new PublicKey(expected.from), to = new PublicKey(expected.to), payer = new PublicKey(expected.feePayer), mint = new PublicKey(WALLET_USDC_MINT);
  const required = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
  const wanted = payer.equals(from) ? [from] : [payer, from];
  if (!tx.message.staticAccountKeys[0].equals(payer) || required.length !== wanted.length || !wanted.every(k => required.some(r => r.equals(k)))) throw new Error('Unexpected transaction signers or fee payer.');
  if (tx.signatures.some(sig => sig.some(v => v !== 0))) throw new Error('Wallet approval must happen before other signatures are added.');
  const source = getAssociatedTokenAddressSync(mint, from), destination = getAssociatedTokenAddressSync(mint, to, true);
  const setup = createAssociatedTokenAccountIdempotentInstruction(payer, destination, to, mint);
  const transfer = createTransferCheckedInstruction(source, mint, destination, from, BigInt(Math.round(expected.amount * 1e6)), 6);
  let instructions = TransactionMessage.decompile(tx.message).instructions;
  if (instructions.length >= 2 && isBudgetInstruction(instructions[0], 2) && isBudgetInstruction(instructions[1], 4)) instructions = instructions.slice(2);
  if (instructions.length !== 3 || !sameInstruction(instructions[0], setup) || !sameInstruction(instructions[1], transfer) || instructions[2].programId.toBase58() !== 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' || instructions[2].keys.length) throw new Error('Transaction does not match the reviewed USDC transfer.');
  const writable = new Set([payer, from, source, destination].map(k => k.toBase58()));
  tx.message.staticAccountKeys.forEach((k, i) => { if (tx.message.isAccountWritable(i) && !writable.has(k.toBase58())) throw new Error('Unexpected writable account.'); });
  return tx;
}
