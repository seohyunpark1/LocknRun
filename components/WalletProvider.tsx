'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from '@wallet-standard/features';
import type { SolanaSignMessageFeature, SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import bs58 from 'bs58';
import { inspectWalletTransfer, equalBytes, WALLET_USDC_MINT } from '@/lib/wallet-transaction';
import { VersionedTransaction } from '@solana/web3.js';
export type Me = { name: string; address: string };
type ConnectedWallet = Wallet & { features: StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignMessageFeature & SolanaSignTransactionFeature };
type Prepared = { intentId: string; transaction: string; summary: { kind?: "join" | "sponsor"; amount: number; mint: string; recipient: string; feeSol: number; feePayer: string; network: string; transactionVersion: number; minContextSlot?: number; preparedAt: number } };
const Context = createContext<{
  me: Me | null; ready: boolean; wallets: Wallet[];
  join: (name: string, wallet?: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
  deposit: (prepared: Prepared) => Promise<any>;
  retryDeposit: () => Promise<any>;
  signWithdrawal: (transaction: string, amount: number, to: string, feePayer: string) => Promise<{ signedTransaction: string; intentId: string }>;
  pending: boolean;
}>(null!);
export const useWallet = () => useContext(Context);
export default function WalletProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [connected, setConnected] = useState<{ wallet: ConnectedWallet; account: WalletAccount } | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    localStorage.removeItem('lockrun.secret');
    localStorage.removeItem('lockrun.me');
    setPending(!!sessionStorage.getItem('lockrun.deposit'));
    const registry = getWallets();
    const update = () => setWallets(registry.get().filter(w => w.chains.includes('solana:devnet') && ['standard:connect', 'standard:events', 'solana:signMessage', 'solana:signTransaction'].every(f => f in w.features)));
    update();
    const off = [registry.on('register', update), registry.on('unregister', update)];
    setReady(true);
    return () => off.forEach(fn => fn());
  }, []);
  useEffect(() => {
    if (!connected) return;
    return connected.wallet.features['standard:events'].on('change', ({ accounts }) => {
      if (accounts && !accounts.some(a => a.address === connected.account.address)) {
        setMe(null); setConnected(null);
        void fetch('/api/wallet', { method: 'DELETE' });
      }
    });
  }, [connected]);
  async function join(name: string, selected?: Wallet) {
    const wallet = (selected || wallets[0]) as ConnectedWallet | undefined;
    if (!wallet) throw new Error('Open this site in your Solana wallet browser, or install a compatible wallet such as Phantom or Solflare.');
    const { accounts } = await wallet.features['standard:connect'].connect();
    const account = accounts.find(a => a.chains.includes('solana:devnet') && a.features.includes('solana:signTransaction') && a.features.includes('solana:signMessage'));
    if (!account) throw new Error('Select an account supporting Solana Devnet, transaction signing and message signing.');
    const nonceResponse = await fetch('/api/wallet', { cache: 'no-store' });
    const nonce = await nonceResponse.json();
    if (!nonceResponse.ok) throw new Error(nonce.error || 'Wallet sign-in service is unavailable.');
    const [signed] = await wallet.features['solana:signMessage'].signMessage({ account, message: new TextEncoder().encode(nonce.message) });
    const r = await fetch('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce.id, address: account.address, signature: bs58.encode(signed.signature) }) });
    if (!r.ok) { const failure = await r.json(); throw new Error(failure.error || 'Could not verify wallet ownership.'); }
    const check = await fetch('/api/wallet', { cache: 'no-store' });
    const session = await check.json();
    if (!check.ok || session.address !== account.address) throw new Error(session.error || 'Phantom connected, but the app could not retain your sign-in session. Please try signing in again.');
    setConnected({ wallet, account });
    setMe({ name: name.trim().slice(0, 24), address: account.address });
  }
  async function disconnect() {
    await fetch('/api/wallet', { method: 'DELETE' });
    try { await connected?.wallet.features['standard:disconnect']?.disconnect(); } finally { setMe(null); setConnected(null); }
  }
  async function retryDeposit() {
    const saved = sessionStorage.getItem('lockrun.deposit');
    if (!saved) throw new Error('No pending deposit.');
    const b = JSON.parse(saved);
    if (b.address !== me?.address) throw new Error('Connect the wallet that signed this pending deposit.');
    const r = await fetch('/api/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const data = await r.json();
    if (!r.ok) throw new Error(`${data.error} Your signed deposit is saved. Retry confirmation; do not pay again.`);
    sessionStorage.removeItem('lockrun.deposit'); setPending(false);
    return data;
  }
  async function signReviewedTransfer(transaction: string, expected: { from: string; to: string; amount: number; feePayer: string }, minContextSlot?: number) {
    if (!connected || !me) throw new Error('Connect your wallet first.');
    const bytes = Uint8Array.from(atob(transaction), c => c.charCodeAt(0));
    const parsed = inspectWalletTransfer(bytes, expected);
    const feature = connected.wallet.features['solana:signTransaction'];
    if (!feature.supportedTransactionVersions.includes(parsed.version)) throw new Error('This wallet does not support the required v0 transaction format.');
    const [signed] = await feature.signTransaction({ account: connected.account, chain: 'solana:devnet', transaction: bytes, options: { preflightCommitment: 'confirmed', ...(minContextSlot === undefined ? {} : { minContextSlot }) } });
    const returned = VersionedTransaction.deserialize(signed.signedTransaction);
    if (!equalBytes(parsed.message.serialize(), returned.message.serialize())) throw new Error('The wallet returned a different transaction message. Nothing was submitted.');
    return btoa(Array.from(signed.signedTransaction, b => String.fromCharCode(b)).join(''));
  }
  async function signWithdrawal(transaction: string, amount: number, to: string, feePayer: string) {
    if (!connected || !me) throw new Error('Connect your wallet first.');
    inspectWalletTransfer(Uint8Array.from(atob(transaction), c => c.charCodeAt(0)), { from: me.address, to, amount, feePayer });
    if (!window.confirm(`Send ${amount} test USDC\nFrom: ${me.address}\nTo: ${to}\nNetwork: Solana Devnet\nNetwork fee: paid from your wallet in SOL\nApprove this transfer in your external wallet?`)) throw new Error('Transfer cancelled.');
    // Re-prepare after human review to avoid handing the wallet a stale blockhash.
    const response = await fetch('/api/withdrawals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare', to, amount }) });
    const fresh = await response.json();
    if (!response.ok) throw new Error(fresh.error || 'Could not refresh transfer.');
    if (fresh.feePayer !== feePayer) throw new Error('Fee payer changed. Please review the transfer again.');
    const signed = await signReviewedTransfer(fresh.tx, { from: me.address, to, amount, feePayer });
    // The caller must submit the refreshed intent, rather than the superseded preview.
    return { signedTransaction: signed, intentId: fresh.intentId };
  }
  async function deposit(prepared: Prepared) {
    if (!connected || !me) throw new Error('Connect your wallet first.');
    if (sessionStorage.getItem('lockrun.deposit')) throw new Error('Confirm your pending deposit before making another.');
    const s = prepared.summary;
    if (s.mint !== WALLET_USDC_MINT || s.network !== 'Solana Devnet') throw new Error('This demo only supports Circle USDC on Solana Devnet.');
    if (s.feePayer !== me.address) throw new Error('Wallet changed. Start again.');
    if (!window.confirm(`Lock ${s.amount} test USDC${s.kind === "sponsor" ? " as a sponsor bonus" : ""}\nNetwork: ${s.network}\nUSDC mint: ${s.mint}\nRecipient (server-managed escrow): ${s.recipient}\nFee payer: ${s.feePayer}\nNetwork fee: ${s.feeSol} SOL, plus token account rent if needed\nSimulation passed.\n${s.kind === "sponsor" ? "Bonus is split among finishers; a zero-finisher refund returns to" : "Rewards return to"} ${me.address}.\n\nContinue to your wallet to approve?`)) throw new Error('Deposit cancelled. No transaction signed.');
    const response = await fetch('/api/deposits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh', intentId: prepared.intentId }) });
    const fresh: Prepared & { error?: string } = await response.json();
    if (!response.ok) throw new Error(fresh.error || 'Could not refresh deposit.');
    if (fresh.summary.kind !== s.kind || fresh.summary.amount !== s.amount || fresh.summary.recipient !== s.recipient || fresh.summary.feePayer !== s.feePayer || fresh.summary.mint !== s.mint || fresh.summary.network !== s.network) throw new Error('Deposit terms changed. Review the deposit again.');
    const signedTransaction = await signReviewedTransfer(fresh.transaction, { from: me.address, to: s.recipient, amount: s.amount, feePayer: me.address }, fresh.summary.minContextSlot);
    sessionStorage.setItem('lockrun.deposit', JSON.stringify({ intentId: fresh.intentId, signedTransaction, address: me.address }));
    setPending(true);
    return retryDeposit();
  }
  return <Context.Provider value={{ me, ready, wallets, join, disconnect, deposit, retryDeposit, pending, signWithdrawal }}>{children}</Context.Provider>;
}
