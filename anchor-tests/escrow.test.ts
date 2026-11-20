// Integration tests for the lockrun_escrow program, run against a local validator: `anchor test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnchorProvider, BN, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { randomBytes } from 'node:crypto';

const idl = JSON.parse(readFileSync(new URL('./lockrun_escrow.idl.json', import.meta.url), 'utf8')) as Idl;
const connection = new Connection(process.env.ANCHOR_PROVIDER_URL || 'http://127.0.0.1:8899', 'confirmed');
const payer = Keypair.generate();
const verifier = Keypair.generate();
const feeRecipient = Keypair.generate();
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: 'confirmed' });
const program = new Program(idl, provider);
const D = 10_000_000; // 10 USDC
const USDC = (n: number) => Math.round(n * 1e6);

async function airdrop(kp: Keypair, sol = 5) {
  const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
}
async function chainTime() {
  const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  return Number(info!.data.readBigInt64LE(32));
}
async function waitUntil(ts: number) {
  while ((await chainTime()) < ts) await new Promise(r => setTimeout(r, 500));
}
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const roomPda = (id: Buffer) => pda([Buffer.from('room'), id]);
const vaultPda = (room: PublicKey) => pda([Buffer.from('vault'), room.toBuffer()]);
const partPda = (room: PublicKey, w: PublicKey) => pda([Buffer.from('p'), room.toBuffer(), w.toBuffer()]);
const sponsorPda = (room: PublicKey, w: PublicKey) => pda([Buffer.from('s'), room.toBuffer(), w.toBuffer()]);

let mint: PublicKey;
const atas = new Map<string, PublicKey>();
async function ata(owner: PublicKey) {
  const key = owner.toBase58();
  if (!atas.has(key)) atas.set(key, (await getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, true)).address);
  return atas.get(key)!;
}
async function balance(owner: PublicKey) { return Number((await getAccount(connection, await ata(owner))).amount); }
async function runner(usdc = 100) {
  const kp = Keypair.generate();
  await airdrop(kp, 2);
  await mintTo(connection, payer, mint, await ata(kp.publicKey), payer, USDC(usdc));
  return kp;
}

type Mode = 0 | 1;
async function newRoom(mode: Mode, endsInSec = 14, timeoutSec = 30) {
  const id = randomBytes(16);
  const room = roomPda(id);
  const now = await chainTime();
  const endsAt = now + endsInSec;
  await program.methods.createRoom([...id] as number[], new BN(D), mode, new BN(endsAt), new BN(timeoutSec), verifier.publicKey, feeRecipient.publicKey)
    .accounts({ creator: payer.publicKey, mint, room, vault: vaultPda(room), tokenProgram: TOKEN_PROGRAM, systemProgram: PublicKey.default, rent: new PublicKey('SysvarRent111111111111111111111111111111111') } as never)
    .rpc();
  return { id, room, vault: vaultPda(room), endsAt, timeoutAt: endsAt + timeoutSec };
}
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
async function join(r: { room: PublicKey; vault: PublicKey }, kp: Keypair) {
  await program.methods.joinRoom().accounts({ user: kp.publicKey, room: r.room, vault: r.vault, userToken: await ata(kp.publicKey), participant: partPda(r.room, kp.publicKey), tokenProgram: TOKEN_PROGRAM, systemProgram: PublicKey.default } as never).signers([kp]).rpc();
}
async function sponsor(r: { room: PublicKey; vault: PublicKey }, kp: Keypair, amount: number) {
  await program.methods.fundSponsor(new BN(amount)).accounts({ funder: kp.publicKey, room: r.room, vault: r.vault, funderToken: await ata(kp.publicKey), sponsor: sponsorPda(r.room, kp.publicKey), tokenProgram: TOKEN_PROGRAM, systemProgram: PublicKey.default } as never).signers([kp]).rpc();
}
async function record(r: { room: PublicKey }, kp: Keypair, bps: number, signer = verifier) {
  await program.methods.recordResult(bps).accounts({ verifier: signer.publicKey, room: r.room, participant: partPda(r.room, kp.publicKey) } as never).signers([signer]).rpc();
}
async function finalize(r: { room: PublicKey }, signer = verifier) {
  await program.methods.finalize().accounts({ verifier: signer.publicKey, room: r.room } as never).signers([signer]).rpc();
}
async function claim(r: { room: PublicKey; vault: PublicKey }, kp: Keypair, destination?: PublicKey) {
  await program.methods.claim().accounts({ room: r.room, vault: r.vault, participant: partPda(r.room, kp.publicKey), destination: destination ?? await ata(kp.publicKey), tokenProgram: TOKEN_PROGRAM } as never).rpc();
}
const failsWith = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(String(e) + JSON.stringify((e as { logs?: string[] }).logs ?? '')));

test('setup', async () => {
  await airdrop(payer, 10); await airdrop(verifier, 5);
  mint = await createMint(connection, payer, payer.publicKey, null, 6);
  await ata(feeRecipient.publicKey);
});

test('all or nothing: finishers share the pool, 5% fee on forfeited stakes goes to the fee recipient, vault ends empty', async () => {
  const [a, b, c, brand] = [await runner(), await runner(), await runner(), await runner(100)];
  const r = await newRoom(0);
  for (const kp of [a, b, c]) await join(r, kp);
  await sponsor(r, brand, USDC(10));
  assert.equal(Number((await getAccount(connection, r.vault)).amount), 3 * D + USDC(10));
  await waitUntil(r.endsAt);
  // Results must be recorded in join order, by the verifier only.
  await failsWith(record(r, b, 10000), /OutOfOrder|join order/);
  await failsWith(record(r, a, 10000, payer), /NotVerifier|ConstraintRaw|verifier/);
  await record(r, a, 10000); await record(r, b, 10000); await record(r, c, 3000);
  const before = [await balance(a.publicKey), await balance(b.publicKey), await balance(c.publicKey)];
  await finalize(r);
  for (const kp of [a, b, c]) await claim(r, kp);
  // pool = 3*10 + 10 - fee(5% of 10) = 39.5 -> 19.75 each
  assert.equal((await balance(a.publicKey)) - before[0], 19_750_000);
  assert.equal((await balance(b.publicKey)) - before[1], 19_750_000);
  assert.equal((await balance(c.publicKey)) - before[2], 0, 'the non-finisher forfeits');
  await failsWith(claim(r, a), /AlreadyClaimed|Already paid/);
  const feeBefore = await balance(feeRecipient.publicKey);
  await program.methods.claimFee().accounts({ room: r.room, vault: r.vault, destination: await ata(feeRecipient.publicKey), tokenProgram: TOKEN_PROGRAM } as never).rpc();
  assert.equal((await balance(feeRecipient.publicKey)) - feeBefore, 500_000);
  assert.equal(Number((await getAccount(connection, r.vault)).amount), 0);
});

test('by fraction: 100% earns the prize, 50% gets half back, 0% nothing (README example)', async () => {
  const [maria, daniel, kevin, brand] = [await runner(), await runner(), await runner(), await runner(100)];
  const r = await newRoom(1);
  for (const kp of [maria, daniel, kevin]) await join(r, kp);
  await sponsor(r, brand, USDC(75));
  await waitUntil(r.endsAt);
  await record(r, maria, 10000); await record(r, daniel, 5000); await record(r, kevin, 0);
  const before = [maria, daniel, kevin].map(async kp => balance(kp.publicKey));
  const b0 = await Promise.all(before);
  await finalize(r);
  for (const kp of [maria, daniel, kevin]) await claim(r, kp);
  // 3 x 10 USDC: Daniel gets 5 back, Kevin 0, Maria 10 + (5 + 10 + 75) = 100
  assert.equal((await balance(maria.publicKey)) - b0[0], 100_000_000);
  assert.equal((await balance(daniel.publicKey)) - b0[1], 5_000_000);
  assert.equal((await balance(kevin.publicKey)) - b0[2], 0);
  assert.equal(Number((await getAccount(connection, r.vault)).amount), 0);
});

test('nobody finishes: every stake and the sponsor bonus are returned', async () => {
  const [a, b, brand] = [await runner(), await runner(), await runner(100)];
  const r = await newRoom(0);
  await join(r, a); await join(r, b); await sponsor(r, brand, USDC(25));
  await waitUntil(r.endsAt);
  await record(r, a, 9000); await record(r, b, 0);
  await finalize(r);
  const [ba, bb, bs] = [await balance(a.publicKey), await balance(b.publicKey), await balance(brand.publicKey)];
  await claim(r, a); await claim(r, b);
  await program.methods.returnSponsor().accounts({ room: r.room, vault: r.vault, sponsor: sponsorPda(r.room, brand.publicKey), destination: await ata(brand.publicKey), tokenProgram: TOKEN_PROGRAM } as never).rpc();
  assert.equal((await balance(a.publicKey)) - ba, D); assert.equal((await balance(b.publicKey)) - bb, D);
  assert.equal((await balance(brand.publicKey)) - bs, USDC(25));
  assert.equal(Number((await getAccount(connection, r.vault)).amount), 0);
});

test('payouts can only go to the participant’s own token account', async () => {
  const [a, thief] = [await runner(), await runner()];
  const r = await newRoom(0);
  await join(r, a);
  await waitUntil(r.endsAt);
  await record(r, a, 10000); await finalize(r);
  await failsWith(claim(r, a, await ata(thief.publicKey)), /ConstraintTokenOwner|owner/i);
  await claim(r, a);
});

test('no result before the timeout: everyone is refunded and finalizing is no longer possible', async () => {
  const [a, brand] = [await runner(), await runner(100)];
  const r = await newRoom(0, 4, 6);
  await join(r, a); await sponsor(r, brand, USDC(10));
  await failsWith(claim(r, a), /WrongPhase|phase/);
  await waitUntil(r.timeoutAt);
  await failsWith(finalize(r), /NotAllRecorded|WrongPhase|phase|recorded/);
  const [ba, bs] = [await balance(a.publicKey), await balance(brand.publicKey)];
  await claim(r, a);
  await program.methods.returnSponsor().accounts({ room: r.room, vault: r.vault, sponsor: sponsorPda(r.room, brand.publicKey), destination: await ata(brand.publicKey), tokenProgram: TOKEN_PROGRAM } as never).rpc();
  assert.equal((await balance(a.publicKey)) - ba, D); assert.equal((await balance(brand.publicKey)) - bs, USDC(10));
});

test('deposits close when the room ends, and a wallet can join only once', async () => {
  const a = await runner();
  const r = await newRoom(0, 8, 30);
  const late = await runner();
  await join(r, a);
  await failsWith(join(r, a), /already in use|custom program error/i);
  await waitUntil(r.endsAt);
  await failsWith(join(r, late), /RoomClosed|closed/);
});
