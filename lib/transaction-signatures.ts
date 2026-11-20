import 'server-only';
import { createPublicKey, verify } from 'node:crypto';
import type { VersionedTransaction } from '@solana/web3.js';
export function hasValidSignature(tx: VersionedTransaction, address: string) {
  const index = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).findIndex(k => k.toBase58() === address);
  if (index < 0) return false;
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[index].toBuffer()]), format: 'der', type: 'spki' });
  return verify(null, tx.message.serialize(), key, tx.signatures[index]);
}
export function allSignaturesValid(tx: VersionedTransaction) {
  return tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures).every(k => hasValidSignature(tx, k.toBase58()));
}
