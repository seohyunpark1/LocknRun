'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardDisconnectFeature, StandardEventsFeature } from '@wallet-standard/features';
import type { SolanaSignMessageFeature, SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import bs58 from 'bs58';
export type Me = { name: string; address: string };
type ConnectedWallet = Wallet & { features: StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignMessageFeature & SolanaSignTransactionFeature };
type Prepared = { intentId: string; transaction: string; summary: { amount: number; mint: string; recipient: string; feeSol: number; feePayer: string; network: string } };
const Context = createContext<{
  me: Me | null; ready: boolean; wallets: Wallet[];
  join: (name: string, wallet?: Wallet) => Promise<void>;
  disconnect: () => Promise<void>;
  deposit: (prepared: Prepared) => Promise<any>;
  retryDeposit: () => Promise<any>;
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
    if (!nonceResponse.ok) throw new Error('Sign-in service unavailable.');
    const nonce = await nonceResponse.json();
    const [signed] = await wallet.features['solana:signMessage'].signMessage({ account, message: new TextEncoder().encode(nonce.message) });
    const r = await fetch('/api/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce.id, address: account.address, signature: bs58.encode(signed.signature) }) });
    if (!r.ok) throw new Error('Could not verify wallet ownership.');
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
  async function deposit(prepared: Prepared) {
    if (!connected || !me) throw new Error('Connect your wallet first.');
    if (sessionStorage.getItem('lockrun.deposit')) throw new Error('Confirm your pending deposit before making another.');
    const s = prepared.summary;
    if (s.feePayer !== me.address) throw new Error('Wallet changed. Start again.');
    if (!window.confirm(`Lock ${s.amount} test USDC\nNetwork: ${s.network}\nUSDC mint: ${s.mint}\nRecipient (server-managed escrow): ${s.recipient}\nFee payer: ${s.feePayer}\nNetwork fee: ${s.feeSol} SOL, plus token account rent if needed\nSimulation passed.\nRewards return to ${me.address}.\n\nContinue to your wallet to approve?`)) throw new Error('Deposit cancelled. No transaction signed.');
    const [signed] = await connected.wallet.features['solana:signTransaction'].signTransaction({ account: connected.account, chain: 'solana:devnet', transaction: Uint8Array.from(atob(prepared.transaction), c => c.charCodeAt(0)) });
    const signedTransaction = btoa(Array.from(signed.signedTransaction, b => String.fromCharCode(b)).join(''));
    sessionStorage.setItem('lockrun.deposit', JSON.stringify({ intentId: prepared.intentId, signedTransaction, address: me.address }));
    setPending(true);
    return retryDeposit();
  }
  return <Context.Provider value={{ me, ready, wallets, join, disconnect, deposit, retryDeposit, pending }}>{children}</Context.Provider>;
}
