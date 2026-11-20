import 'server-only';
import { NextResponse } from 'next/server';
import { createPublicKey, verify, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { kvGet, kvSet, acquireLock, releaseLock, sharedStorageUnavailable } from './store';
export const authCookie = 'lockrun_session';
export const sessionToken = () => randomBytes(32).toString('hex');
export function verifyWalletMessage(address: string, message: string, signature: string) {
  try {
    const bytes = bs58.decode(address);
    if (bytes.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message), key, bs58.decode(signature));
  } catch { return false; }
}
export async function walletSession(req: Request) {
  const token = req.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(authCookie + '='))?.slice(authCookie.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await kvGet<{ address: string; expires: number }>(`session:${token}`);
  return session && session.expires > Date.now() ? session.address : null;
}
export async function useNonce(id: string, address: string, signature: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return false;
  const key = `nonce:${id}`;
  const lock = await acquireLock(key);
  if (!lock) return false;
  try {
    const nonce = await kvGet<{ message: string; expires: number; used?: boolean }>(key);
    if (!nonce || nonce.used || nonce.expires < Date.now() || !verifyWalletMessage(address, nonce.message, signature)) return false;
    await kvSet(key, { ...nonce, used: true });
    return true;
  } finally { await releaseLock(key, lock); }
}

/** Distinguish an unavailable login service from an absent/expired wallet session. */
export function walletAuthFailure() {
  if (sharedStorageUnavailable()) return NextResponse.json({ error: 'Wallet sign-in is temporarily unavailable because the app service is not configured. Please contact the app owner.', code: 'SHARED_STORAGE_UNAVAILABLE' }, { status: 503 });
  return NextResponse.json({ error: 'Sign in with your wallet to continue. Reconnect if it is already connected.', code: 'WALLET_SESSION_REQUIRED' }, { status: 401 });
}
