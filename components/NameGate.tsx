'use client';
import { useState } from 'react';
import type { Wallet } from '@wallet-standard/base';
import { useWallet } from './WalletProvider';
export default function NameGate({ onJoin }: { onJoin: (name: string, wallet?: Wallet) => Promise<void> }) {
  const { wallets } = useWallet();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function go() {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try { await onJoin(name, wallets.find(w => w.name === selected) || wallets[0]); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="modal"><div className="card" style={{ maxWidth: 440, width: '100%' }}>
    <h2>Run with your wallet</h2><p className="muted">Connect a Solana wallet to lock test USDC and receive rewards.</p>
    <label htmlFor="runner-name">Runner name</label><input id="runner-name" className="input" maxLength={24} value={name} onChange={e => setName(e.target.value)} />
    <label htmlFor="wallet-choice">Wallet · Solana Devnet</label><select id="wallet-choice" className="input" value={selected || wallets[0]?.name || ''} onChange={e => setSelected(e.target.value)}>{wallets.map(w => <option key={w.name} value={w.name}>{w.name}</option>)}</select>
    {!wallets.length && <p>Open this site inside Phantom or Solflare&apos;s wallet browser, or install a compatible browser wallet.</p>}
    <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim() || !wallets.length} onClick={go}>{busy ? 'Verify in your wallet…' : 'Connect wallet'}</button>
    <p className="muted small">Sign-in verifies ownership. Deposits require a separate transaction approval. Use devnet USDC and a little devnet SOL for fees.</p>
    {error && <p className="err">{error}</p>}
  </div></div>;
}
