// End-to-end check of the app's escrow code (instruction builders, browser inspector, decoders, settlement crank)
// against the real program on a local validator: `anchor test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bs58 from 'bs58';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY, VersionedTransaction } from '@solana/web3.js';
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';

const RPC = process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899';
const raw = new Connection(RPC, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL('./test-authority.json', import.meta.url), 'utf8')))), sponsor = Keypair.generate(), escrow = Keypair.generate();
process.env.NEXT_PUBLIC_SOLANA_RPC = RPC;
process.env.SPONSOR_SECRET_KEY = bs58.encode(sponsor.secretKey);
process.env.ESCROW_SECRET_KEY = bs58.encode(escrow.secretKey);
process.env.LOCKRUN_DATA_FILE = join(mkdtempSync(join(tmpdir(), 'lockrun-onchain-')), 'challenges.json');

const airdrop = async (k: Keypair, sol = 5) => raw.confirmTransaction(await raw.requestAirdrop(k.publicKey, sol * LAMPORTS_PER_SOL), 'confirmed');
const chainTime = async () => Number((await raw.getAccountInfo(SYSVAR_CLOCK_PUBKEY))!.data.readBigInt64LE(32));
const bal = async (mint: PublicKey, owner: PublicKey) => Number((await getAccount(raw, (await getOrCreateAssociatedTokenAccount(raw, payer, mint, owner, true)).address)).amount);

test('create, join and sponsor through the app builders, then settle through the crank', async t => {
  await airdrop(payer, 10); await airdrop(sponsor, 10);
  const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // preloaded by Anchor.toml with a test mint authority
  const { connection } = await import('../lib/solana-server');
  t.mock.method(connection, 'getGenesisHash', async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  const { prepareDeposit, confirmDeposit } = await import('../lib/deposits');
  const { insertChallenge, getChallenge, mutate } = await import('../lib/store');
  const { inspectEscrowTransaction } = await import('../lib/wallet-transaction');
  const { settleOnchain } = await import('../lib/escrow-settle');
  const { computePayouts } = await import('../lib/settle');
  const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const { MODE_POOL } = await import('../lib/escrow-ix');

  const [a, b, brand] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  for (const k of [a, b, brand]) { await airdrop(k, 2); await mintTo(raw, payer, mint, (await getOrCreateAssociatedTokenAccount(raw, payer, mint, k.publicKey)).address, payer, 100_000_000); }
  const endsAt = (await chainTime()) * 1000 + 25_000;
  const c0 = { id: 'abcdef0123', title: 'T', goalKm: 3, runsRequired: 1, deposit: 10, createdAt: Date.now(), endsAt, creatorName: 'A', escrow: 'program' as const, rewardMode: 'pool' as const, status: 'draft' as const, participants: [] };
  await insertChallenge(c0);

  const deposit = async (kp: Keypair, action: 'create' | 'join' | 'sponsor', amount = 10) => {
    const c = (await getChallenge(c0.id))!;
    const prepared = await prepareDeposit(c, kp.publicKey.toBase58(), 'N', action === 'sponsor' ? { amount } : undefined);
    assert.equal(prepared.summary.escrow?.action, action);
    const bytes = Buffer.from(prepared.transaction, 'base64');
    const want = { kind: action, user: kp.publicKey, challengeId: c0.id, mint, userToken: getAssociatedTokenAddressSync(mint, kp.publicKey), amount: BigInt(amount * 1e6), mode: MODE_POOL };
    inspectEscrowTransaction(bytes, want); // what the browser checks before asking the wallet to sign
    // A join carries no amount (the room fixes the stake); create and sponsor do, and must match what was reviewed.
    if (action !== 'join') assert.throws(() => inspectEscrowTransaction(bytes, { ...want, amount: BigInt((amount + 1) * 1e6) }), /Wrong|match/);
    assert.throws(() => inspectEscrowTransaction(bytes, { ...want, challengeId: 'ffffffffff' }), /Wrong|match|accounts/);
    const tx = VersionedTransaction.deserialize(bytes); tx.sign([kp]);
    return confirmDeposit(prepared.intentId, Buffer.from(tx.serialize()).toString('base64'), kp.publicKey.toBase58());
  };
  await deposit(a, 'create');
  await deposit(b, 'join');
  await deposit(brand, 'sponsor', 10);
  const before = (await getChallenge(c0.id))!;
  assert.equal(before.status, 'active'); assert.equal(before.participants.length, 2); assert.equal(before.sponsors?.length, 1);
  await mutate(c0.id, x => { x.participants[0].runs.push({ id: 'r1', km: 3, sec: 900, at: Date.now(), counts: true, status: 'approved' }); });

  while ((await chainTime()) * 1000 < endsAt) await new Promise(r => setTimeout(r, 500));
  const c = (await getChallenge(c0.id))!;
  const expected = computePayouts(c).payouts.map(p => p.amount);
  assert.deepEqual(expected, [29.5, 0]); // 2x10 + 10 bonus - 5% of the 10 forfeited
  const paid: string[] = [];
  await settleOnchain(c, { shouldClaim: w => (computePayouts(c).payouts.find(p => p.address === w)?.amount || 0) > 0, onPaid: async w => { paid.push(w); }, onSponsorReturned: async () => { throw new Error('not expected'); } });
  assert.deepEqual(paid, [a.publicKey.toBase58()]);
  assert.equal(await bal(mint, a.publicKey), 100_000_000 - 10_000_000 + 29_500_000, 'the program paid exactly what the app showed');
  assert.equal(await bal(mint, b.publicKey), 90_000_000, 'the non-finisher forfeited');
  assert.equal(await bal(mint, sponsor.publicKey), 500_000, 'platform fee reached the fee recipient');
  const { vaultPda, roomPda } = await import('../lib/escrow-ix');
  assert.equal(Number((await getAccount(raw, vaultPda(roomPda(c0.id)))).amount), 0, 'vault is empty');
  // Settling again never pays a claimed participant twice (the non-finisher's zero claim is merely recorded).
  const again: string[] = [];
  await settleOnchain((await getChallenge(c0.id))!, { shouldClaim: () => true, onPaid: async w => { again.push(w); }, onSponsorReturned: async () => {} });
  assert.ok(!again.includes(a.publicKey.toBase58()));
  assert.equal(await bal(mint, a.publicKey), 100_000_000 - 10_000_000 + 29_500_000);
});
