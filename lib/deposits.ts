import 'server-only';
import { assertDevnet } from './solana-network';
import { buildSimulatedTransaction } from './wallet-simulation';
import { allSignaturesValid } from './transaction-signatures';
import { depositSimulationMessage } from './simulation-error';
import { createHash } from 'node:crypto';
import { PublicKey, VersionedTransaction, TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { connection, escrowAddress, sponsorAddress } from './solana-server';
import { ESCROW_PROGRAM_ID, MODE_FRACTION, MODE_POOL, TIMEOUT_SECS, createRoomIx, fundSponsorIx, joinRoomIx, roomPda, vaultPda } from './escrow-ix';
import { MEMO_PROGRAM_ID, USDC_DECIMALS, USDC_MINT, Challenge, MAX_SPONSORS, SPONSOR_BONUSES } from './config';
import { getChallenge, mutate, kvGet, kvSet, acquireLock, releaseLock } from './store';

type Intent = { kind?: "join" | "sponsor"; amount?: number; url?: string; logo?: string; tagline?: string; challengeId: string; address: string; name: string; transaction: string; message: string; blockhash: string; lastValidBlockHeight: number; signature?: string; confirmed?: boolean };
export function requireDurableStorage() {
  if (process.env.VERCEL && !(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) && !(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)) throw new Error('Configure Redis before accepting wallet deposits.');
}
export async function prepareDeposit(c: Challenge, address: string, name: string, funding?: { amount: number; url?: string; logo?: string; tagline?: string }) {
  requireDurableStorage();
  if (!funding && c.participants.some(p => p.address === address)) throw new Error('This wallet already joined.');
  if (funding && (!SPONSOR_BONUSES.includes(funding.amount) || (c.sponsors || []).length >= MAX_SPONSORS)) throw new Error('Sponsor amount or capacity is invalid.');
  if (funding && c.sponsors?.some(s => s.address === address)) throw new Error('This wallet already sponsors this challenge.');
  const amount = funding?.amount ?? c.deposit;
  const kind = funding ? 'sponsor' : 'join';
  if (!['draft', 'active'].includes(c.status) || Date.now() >= c.endsAt) throw new Error('Challenge is closed.');
  await assertDevnet(connection);
  const owner = new PublicKey(address);
  const onchain = c.escrow === 'program';
  const recipient = onchain ? vaultPda(roomPda(c.id)).toBase58() : escrowAddress();
  if (!recipient) throw new Error('Escrow is not configured.');
  if (recipient === address) throw new Error('The escrow wallet cannot join.');
  const mint = new PublicKey(USDC_MINT), to = new PublicKey(recipient);
  const lifetime = await connection.getLatestBlockhash('confirmed');
  const micro = BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
  const userToken = getAssociatedTokenAddressSync(mint, owner);
  const creating = onchain && !funding && c.status === 'draft' && c.participants.length === 0;
  const core = onchain
    ? funding
      ? [fundSponsorIx({ funder: owner, challengeId: c.id, funderToken: userToken, amount: micro })]
      : [
          ...(creating ? [createRoomIx({ creator: owner, mint, challengeId: c.id, stake: micro, mode: c.rewardMode === 'fraction' ? MODE_FRACTION : MODE_POOL, endsAt: Math.ceil(c.endsAt / 1000), timeoutSecs: TIMEOUT_SECS, verifier: new PublicKey(sponsorAddress()), feeRecipient: new PublicKey(sponsorAddress()) })] : []),
          joinRoomIx({ user: owner, challengeId: c.id, mint, userToken }),
        ]
    : [
        createAssociatedTokenAccountIdempotentInstruction(owner, getAssociatedTokenAddressSync(mint, to, true), to, mint),
        createTransferCheckedInstruction(userToken, mint, getAssociatedTokenAddressSync(mint, to, true), owner, micro, USDC_DECIMALS),
        new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM_ID), keys: [], data: Buffer.from(`LockRun|${kind}|${c.id}|${address}`) })
      ];
  const { tx, simulation } = await buildSimulatedTransaction(owner, core, lifetime.blockhash);
  if (simulation.value.err) {
    console.error('deposit_simulation_failed', { challengeId: c.id, address, mint: USDC_MINT, amount, sourceTokenAccount: getAssociatedTokenAddressSync(mint, owner).toBase58(), error: simulation.value.err, logs: simulation.value.logs || [] });
    throw new Error(depositSimulationMessage(simulation.value.err, simulation.value.logs || []));
  }
  const fee = await connection.getFeeForMessage(tx.message, 'confirmed');
  if (fee.value === null) throw new Error('Fee estimate unavailable. Please retry.');
  const transaction = Buffer.from(tx.serialize()).toString('base64');
  const message = Buffer.from(tx.message.serialize()).toString('base64');
  const id = createHash('sha256').update(message).digest('hex');
  const intent: Intent = { kind, amount, url: funding?.url, logo: funding?.logo, tagline: funding?.tagline, challengeId: c.id, address, name, transaction, message, ...lifetime };
  await kvSet(`deposit:${id}`, intent);
  return { intentId: id, transaction, summary: { kind, amount, recipient, mint: USDC_MINT, feeSol: fee.value / 1e9, feePayer: address, network: 'Solana Devnet', simulation: 'passed', transactionVersion: 0, preparedAt: Date.now(), minContextSlot: simulation.context?.slot, ...(onchain ? { escrow: { program: ESCROW_PROGRAM_ID.toBase58(), challengeId: c.id, action: funding ? 'sponsor' : creating ? 'create' : 'join', mode: c.rewardMode === 'fraction' ? MODE_FRACTION : MODE_POOL } } : {}) } };
}
export function validateSignedDeposit(serialized: string, expectedMessage: string, address: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(serialized, 'base64'));
  if (Buffer.from(tx.message.serialize()).toString('base64') !== expectedMessage || tx.message.staticAccountKeys[0]?.toBase58() !== address || tx.message.header.numRequiredSignatures !== 1 || !allSignaturesValid(tx)) throw new Error('Signed transaction does not match the approved deposit.');
  return tx;
}
export async function confirmDeposit(id: string, signed: string, address: string) {
  requireDurableStorage();
  if (!/^[a-f0-9]{64}$/.test(id) || signed.length > 4096) throw new Error('Invalid deposit.');
  const intent = await kvGet<Intent>(`deposit:${id}`);
  if (!intent || intent.address !== address) throw new Error('Deposit not found for this wallet.');
  const tx = validateSignedDeposit(signed, intent.message, address);
  await assertDevnet(connection);
  const key = `c:${intent.challengeId}`;
  const lock = await acquireLock(key, 120);
  if (!lock) throw new Error('Challenge busy. Retry confirmation.');
  try {
    const c = await getChallenge(intent.challengeId);
    if (!c) throw new Error('Challenge not found.');
    const existingSponsor = intent.kind === "sponsor" ? c.sponsors?.find(s => s.address === address) : undefined;
    if (existingSponsor) {
      if (existingSponsor.sig === intent.signature) return c;
      throw new Error("Wallet already funded a sponsor bonus.");
    }
    const existing = intent.kind === "sponsor" ? undefined : c.participants.find(p => p.address === address);
    if (existing) {
      if (existing.joinSig === intent.signature) return c;
      throw new Error('Wallet already joined with another deposit.');
    }
    // A signed transaction is stored before broadcasting; retries reuse exactly the same signature.
    if (!intent.signature) {
      if (!['draft', 'active'].includes(c.status) || Date.now() >= c.endsAt) throw new Error('Challenge is closed.');
      if (intent.kind === 'sponsor' && (c.sponsors || []).length >= MAX_SPONSORS) throw new Error('Sponsor capacity reached.');
      const bs58 = (await import('bs58')).default;
      intent.signature = bs58.encode(tx.signatures[0]);
      await kvSet(`deposit:${id}`, intent);
    }
    await mutate(c.id, x => { x.pendingDeposits = Array.from(new Set([...(x.pendingDeposits || []), id])); });
    const status = await connection.getSignatureStatuses([intent.signature], { searchTransactionHistory: true });
    const found = status.value[0];
    if (found?.err) {
      await mutate(c.id, x => { x.pendingDeposits = x.pendingDeposits?.filter(v => v !== id); });
      throw new Error('Deposit failed on Solana.');
    }
    if (!found || !['confirmed', 'finalized'].includes(found.confirmationStatus || '')) {
      await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
      const confirmation = await connection.confirmTransaction({ signature: intent.signature, blockhash: intent.blockhash, lastValidBlockHeight: intent.lastValidBlockHeight }, 'confirmed');
      if (confirmation.value.err) throw new Error('Deposit failed on Solana.');
    }
    if (intent.kind === "sponsor" && intent.logo) await kvSet(`sponsorlogo:${c.id}:${(c.sponsors || []).length}`, intent.logo);
    const updated = await mutate(c.id, x => {
      x.pendingDeposits = x.pendingDeposits?.filter(v => v !== id);
      if (intent.kind === "sponsor") {
        x.sponsors = [...(x.sponsors || []), { address, name: intent.name, amount: intent.amount!, url: intent.url, logo: !!intent.logo, tagline: intent.tagline, at: Date.now(), sig: intent.signature! }];
      } else {
        x.participants.push({ name: intent.name, address, joinedAt: Date.now(), joinSig: intent.signature!, runs: [] });
      }
      if (x.status === 'draft') x.status = 'active';
    });
    await kvSet(`deposit:${id}`, { ...intent, confirmed: true });
    return updated;
  } finally { await releaseLock(key, lock); }
}

/** Rebuild after the human review dialog, so the wallet receives a fresh, exactly simulated message. */
export async function refreshDeposit(id: string, address: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid deposit.');
  const intent = await kvGet<Intent>(`deposit:${id}`);
  if (!intent || intent.address !== address || intent.signature) throw new Error('Only an unsigned deposit can be refreshed by its wallet.');
  const c = await getChallenge(intent.challengeId);
  if (!c) throw new Error('Challenge not found.');
  return prepareDeposit(c, address, intent.name, intent.kind === 'sponsor' ? { amount: intent.amount!, url: intent.url, logo: intent.logo, tagline: intent.tagline } : undefined);
}
