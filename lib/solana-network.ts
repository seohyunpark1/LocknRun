import 'server-only';
import type { Connection } from '@solana/web3.js';
import { USDC_MINT } from './config';
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
/** Check the actual RPC chain before preparing, signing or broadcasting financial operations. */
export async function assertDevnet(connection: Connection) {
  if (USDC_MINT !== DEVNET_USDC_MINT) throw new Error('This demo only accepts Circle USDC on Solana Devnet.');
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error('RPC network mismatch: this demo requires Solana Devnet.');
}
