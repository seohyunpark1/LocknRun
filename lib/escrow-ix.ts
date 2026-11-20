// Instruction builders, PDAs and a strict inspector for the lockrun_escrow Anchor program.
// Shared by the server (building) and the browser (checking exactly what the wallet is asked to sign).
// Discriminators come from the program's IDL (anchor-tests/lockrun_escrow.idl.json).
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export const ESCROW_PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID || 'DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj');
export const MODE_POOL = 0, MODE_FRACTION = 1;
/** How long after a room ends a missing result lets everyone take a refund. Longer than the 24 h review window. */
export const TIMEOUT_SECS = 72 * 3600;

const DISC = {
  create_room: [130, 166, 32, 2, 247, 120, 178, 53],
  join_room: [95, 232, 188, 81, 124, 130, 78, 139],
  fund_sponsor: [107, 108, 222, 170, 128, 23, 44, 101],
  record_result: [208, 243, 63, 218, 63, 116, 76, 80],
  finalize: [171, 61, 218, 56, 127, 115, 12, 217],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  return_sponsor: [107, 221, 30, 156, 123, 55, 102, 228],
  claim_fee: [169, 32, 79, 137, 136, 232, 70, 137],
} as const;

/** A challenge id (hex) maps to the 16-byte room id: the id's bytes, zero padded. */
export function roomIdBytes(challengeId: string) {
  const out = new Uint8Array(16);
  const hex = challengeId.replace(/[^a-f0-9]/gi, '');
  for (let i = 0; i < Math.min(16, Math.floor(hex.length / 2)); i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const find = (seeds: (Uint8Array | Buffer)[]) => PublicKey.findProgramAddressSync(seeds, ESCROW_PROGRAM_ID)[0];
const te = new TextEncoder();
export const roomPda = (challengeId: string) => find([te.encode('room'), roomIdBytes(challengeId)]);
export const vaultPda = (room: PublicKey) => find([te.encode('vault'), room.toBytes()]);
export const participantPda = (room: PublicKey, wallet: PublicKey) => find([te.encode('p'), room.toBytes(), wallet.toBytes()]);
export const sponsorPda = (room: PublicKey, funder: PublicKey) => find([te.encode('s'), room.toBytes(), funder.toBytes()]);

const u64 = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const i64 = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const data = (name: keyof typeof DISC, ...args: Uint8Array[]) => Buffer.from(concat(Uint8Array.from(DISC[name]), ...args));
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
const ix = (keys: ReturnType<typeof meta>[], d: Buffer) => new TransactionInstruction({ programId: ESCROW_PROGRAM_ID, keys, data: d });

export function createRoomIx(p: { creator: PublicKey; mint: PublicKey; challengeId: string; stake: bigint; mode: number; endsAt: number; timeoutSecs: number; verifier: PublicKey; feeRecipient: PublicKey }) {
  const room = roomPda(p.challengeId);
  return ix(
    [meta(p.creator, true, true), meta(p.mint, false, false), meta(room, false, true), meta(vaultPda(room), false, true), meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false), meta(SYSVAR_RENT_PUBKEY, false, false)],
    data('create_room', roomIdBytes(p.challengeId), u64(p.stake), Uint8Array.of(p.mode), i64(p.endsAt), i64(p.timeoutSecs), p.verifier.toBytes(), p.feeRecipient.toBytes())
  );
}
export function joinRoomIx(p: { user: PublicKey; challengeId: string; mint: PublicKey; userToken: PublicKey }) {
  const room = roomPda(p.challengeId);
  return ix([meta(p.user, true, true), meta(room, false, true), meta(vaultPda(room), false, true), meta(p.userToken, false, true), meta(participantPda(room, p.user), false, true), meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false)], data('join_room'));
}
export function fundSponsorIx(p: { funder: PublicKey; challengeId: string; funderToken: PublicKey; amount: bigint }) {
  const room = roomPda(p.challengeId);
  return ix([meta(p.funder, true, true), meta(room, false, true), meta(vaultPda(room), false, true), meta(p.funderToken, false, true), meta(sponsorPda(room, p.funder), false, true), meta(TOKEN_PROGRAM_ID, false, false), meta(SystemProgram.programId, false, false)], data('fund_sponsor', u64(p.amount)));
}
// Server-only cranks (the verifier signs record/finalize; anyone may claim/return/claim_fee).
export function recordResultIx(p: { verifier: PublicKey; challengeId: string; wallet: PublicKey; rateBps: number }) {
  const room = roomPda(p.challengeId);
  const bps = new Uint8Array(2); new DataView(bps.buffer).setUint16(0, p.rateBps, true);
  return ix([meta(p.verifier, true, false), meta(room, false, true), meta(participantPda(room, p.wallet), false, true)], data('record_result', bps));
}
export function finalizeIx(p: { verifier: PublicKey; challengeId: string }) {
  return ix([meta(p.verifier, true, false), meta(roomPda(p.challengeId), false, true)], data('finalize'));
}
export function claimIx(p: { challengeId: string; wallet: PublicKey; destination: PublicKey }) {
  const room = roomPda(p.challengeId);
  return ix([meta(room, false, false), meta(vaultPda(room), false, true), meta(participantPda(room, p.wallet), false, true), meta(p.destination, false, true), meta(TOKEN_PROGRAM_ID, false, false)], data('claim'));
}
export function returnSponsorIx(p: { challengeId: string; funder: PublicKey; destination: PublicKey }) {
  const room = roomPda(p.challengeId);
  return ix([meta(room, false, false), meta(vaultPda(room), false, true), meta(sponsorPda(room, p.funder), false, true), meta(p.destination, false, true), meta(TOKEN_PROGRAM_ID, false, false)], data('return_sponsor'));
}
export function claimFeeIx(p: { challengeId: string; destination: PublicKey }) {
  const room = roomPda(p.challengeId);
  return ix([meta(room, false, true), meta(vaultPda(room), false, true), meta(p.destination, false, true), meta(TOKEN_PROGRAM_ID, false, false)], data('claim_fee'));
}

// ------------------------------------------------------------------ inspection (what the wallet is asked to sign)

export type EscrowExpectation = {
  kind: 'create' | 'join' | 'sponsor';
  user: PublicKey; // signer and fee payer
  challengeId: string;
  mint: PublicKey;
  userToken: PublicKey;
  amount: bigint; // stake (create/join) or sponsor bonus
  mode?: number; // create only
};
const same = (a: Uint8Array, b: ArrayLike<number>) => a.length === b.length && a.every((v, i) => v === b[i]);
const keyEq = (a: PublicKey, b: PublicKey) => a.equals(b);

/** Throws unless `ixs` is exactly the program instructions this app would build for `want` (budget instructions already removed). */
export function assertEscrowInstructions(ixs: TransactionInstruction[], want: EscrowExpectation) {
  const room = roomPda(want.challengeId), vault = vaultPda(room);
  const expectedCount = want.kind === 'create' ? 2 : 1;
  if (ixs.length !== expectedCount || ixs.some(i => !keyEq(i.programId, ESCROW_PROGRAM_ID))) throw new Error('Transaction does not match the reviewed deposit.');
  const [first, second] = ixs;
  const checkKeys = (i: TransactionInstruction, keys: PublicKey[]) => {
    if (i.keys.length !== keys.length || !i.keys.every((k, n) => keyEq(k.pubkey, keys[n]))) throw new Error('Transaction accounts do not match the reviewed deposit.');
  };
  const token = TOKEN_PROGRAM_ID;
  if (want.kind === 'create') {
    if (!same(first.data.subarray(0, 8), DISC.create_room)) throw new Error('Unexpected program instruction.');
    checkKeys(first, [want.user, want.mint, room, vault, token, SystemProgram.programId, SYSVAR_RENT_PUBKEY]);
    // create_room args: room_id[16] | stake u64 | mode u8 | ends_at i64 | timeout i64 | verifier | fee_recipient
    const d = first.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    if (d.length !== 8 + 16 + 8 + 1 + 8 + 8 + 32 + 32) throw new Error('Unexpected program instruction data.');
    if (!same(d.subarray(8, 24), roomIdBytes(want.challengeId))) throw new Error('Wrong room.');
    if (dv.getBigUint64(24, true) !== want.amount) throw new Error('Wrong stake amount.');
    if (d[32] !== want.mode) throw new Error('Wrong reward mode.');
  }
  const join = want.kind === 'create' ? second : first;
  if (want.kind === 'sponsor') {
    if (!same(join.data.subarray(0, 8), DISC.fund_sponsor) || join.data.length !== 16) throw new Error('Unexpected program instruction.');
    checkKeys(join, [want.user, room, vault, want.userToken, sponsorPda(room, want.user), token, SystemProgram.programId]);
    if (new DataView(join.data.buffer, join.data.byteOffset, 16).getBigUint64(8, true) !== want.amount) throw new Error('Wrong sponsor amount.');
  } else {
    if (!same(join.data, DISC.join_room)) throw new Error('Unexpected program instruction.');
    checkKeys(join, [want.user, room, vault, want.userToken, participantPda(room, want.user), token, SystemProgram.programId]);
  }
}

// ------------------------------------------------------------------ on-chain account decoding (offsets follow the Rust structs)

export type RoomState = { creator: PublicKey; verifier: PublicKey; feeRecipient: PublicKey; mint: PublicKey; stake: bigint; mode: number; endsAt: number; timeoutAt: number; participants: number; recorded: number; finishers: number; sponsorTotal: bigint; status: number; share: bigint; remainder: number; feeAmount: bigint; feeClaimed: boolean };
export function decodeRoom(buf: Uint8Array): RoomState {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const key = (o: number) => new PublicKey(buf.subarray(o, o + 32));
  const base = 8 + 16;
  return {
    creator: key(base), verifier: key(base + 32), feeRecipient: key(base + 64), mint: key(base + 96),
    stake: dv.getBigUint64(base + 128, true), mode: buf[base + 136],
    endsAt: Number(dv.getBigInt64(base + 139, true)), timeoutAt: Number(dv.getBigInt64(base + 147, true)),
    participants: dv.getUint32(base + 155, true), recorded: dv.getUint32(base + 159, true), finishers: dv.getUint32(base + 163, true),
    sponsorTotal: dv.getBigUint64(base + 167, true), status: buf[base + 183],
    share: dv.getBigUint64(base + 184, true), remainder: dv.getUint32(base + 192, true), feeAmount: dv.getBigUint64(base + 196, true), feeClaimed: buf[base + 204] === 1,
  };
}
export const decodeParticipant = (buf: Uint8Array) => ({ index: new DataView(buf.buffer, buf.byteOffset).getUint32(72, true), claimed: buf[91] === 1 });
export const decodeSponsor = (buf: Uint8Array) => ({ returned: buf[80] === 1 });
export const ROOM_STATUS = { open: 0, finalized: 1, nobodyFinished: 2 } as const;
