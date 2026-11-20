import 'server-only';
import { PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { assertDevnet } from './solana-network';
import { connection, verifierKeypair } from './solana-server';
import { USDC_MINT, type Challenge } from './config';
import { rateBps } from './settle';
import { ROOM_STATUS, claimFeeIx, claimIx, decodeParticipant, decodeRoom, decodeSponsor, finalizeIx, participantPda, recordResultIx, returnSponsorIx, roomPda, sponsorPda } from './escrow-ix';

const mint = new PublicKey(USDC_MINT);
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true);
const BATCH = 6;

async function send(ixs: TransactionInstruction[]) {
  const payer = verifierKeypair();
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
}
async function roomState(id: string) {
  const info = await connection.getAccountInfo(roomPda(id), 'confirmed');
  if (!info) throw new Error('Escrow room not found on Solana.');
  return decodeRoom(info.data);
}

/**
 * Drives a finished room to settlement. Every step reads on-chain state first, so a retry after a failure resumes
 * where it stopped and never pays anyone twice (the program also refuses double claims). The program, not this
 * server, computes every amount: the server only reports who finished and cranks the payouts.
 */
export async function settleOnchain(c: Challenge, hooks: { shouldClaim: (wallet: string) => boolean; onPaid: (wallet: string, sig: string) => Promise<void>; onSponsorReturned: (funder: string, sig: string) => Promise<void> }) {
  await assertDevnet(connection);
  const verifier = verifierKeypair();
  let room = await roomState(c.id);
  if (!room.verifier.equals(verifier.publicKey)) throw new Error('This server is not the verifier for this room.');

  if (room.status === ROOM_STATUS.open) {
    // Record results in the order wallets joined on-chain.
    const infos = await connection.getMultipleAccountsInfo(c.participants.map(p => participantPda(roomPda(c.id), new PublicKey(p.address))), 'confirmed');
    const ordered = c.participants
      .map((p, i) => ({ p, index: infos[i] ? decodeParticipant(infos[i]!.data).index : -1 }))
      .filter(x => x.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (ordered.length !== room.participants) throw new Error('Participants in the app do not match the on-chain room.');
    const todo = ordered.slice(room.recorded);
    for (let i = 0; i < todo.length; i += BATCH) {
      await send(todo.slice(i, i + BATCH).map(({ p }) => recordResultIx({ verifier: verifier.publicKey, challengeId: c.id, wallet: new PublicKey(p.address), rateBps: rateBps(c, p) })));
    }
    await send([finalizeIx({ verifier: verifier.publicKey, challengeId: c.id })]);
    room = await roomState(c.id);
  }
  if (room.status === ROOM_STATUS.open) throw new Error('Room is still open on-chain.');

  // Permissionless cranks: each payout can only reach that participant's own token account.
  for (const p of c.participants) {
    if (!hooks.shouldClaim(p.address)) continue;
    const wallet = new PublicKey(p.address);
    const pda = participantPda(roomPda(c.id), wallet);
    const info = await connection.getAccountInfo(pda, 'confirmed');
    if (!info || decodeParticipant(info.data).claimed) continue;
    const sig = await send([createAssociatedTokenAccountIdempotentInstruction(verifier.publicKey, ata(wallet), wallet, mint), claimIx({ challengeId: c.id, wallet, destination: ata(wallet) })]);
    await hooks.onPaid(p.address, sig);
  }
  for (const s of c.sponsors || []) {
    if (!s.address || room.status !== ROOM_STATUS.nobodyFinished) continue;
    const funder = new PublicKey(s.address);
    const info = await connection.getAccountInfo(sponsorPda(roomPda(c.id), funder), 'confirmed');
    if (!info || decodeSponsor(info.data).returned) continue;
    const sig = await send([createAssociatedTokenAccountIdempotentInstruction(verifier.publicKey, ata(funder), funder, mint), returnSponsorIx({ challengeId: c.id, funder, destination: ata(funder) })]);
    await hooks.onSponsorReturned(s.address, sig);
  }
  if (room.status === ROOM_STATUS.finalized && room.feeAmount > 0n && !room.feeClaimed) {
    await send([createAssociatedTokenAccountIdempotentInstruction(verifier.publicKey, ata(room.feeRecipient), room.feeRecipient, mint), claimFeeIx({ challengeId: c.id, destination: ata(room.feeRecipient) })]);
  }
  return { status: room.status };
}
