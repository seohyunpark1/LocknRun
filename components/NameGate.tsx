'use client';
import { useEffect, useState } from 'react';
import type { Wallet } from '@wallet-standard/base';
import { useWallet } from './WalletProvider';
import { CONNECT_EVENT } from '@/lib/client';

const SEEN = 'lockrun.gateSeen';

/**
 * "Connect wallet" sheet. Opens once per visit so people can look around first, and again whenever an
 * action needs a wallet (openConnect()). Sign-in itself is WalletProvider.join (unchanged).
 */
export default function NameGate({ onJoin }: { onJoin: (name: string, wallet?: Wallet) => Promise<void> }) {
  const { wallets } = useWallet();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [here, setHere] = useState('');

  useEffect(() => {
    setHere(window.location.href);
    try {
      if (!sessionStorage.getItem(SEEN)) setOpen(true);
    } catch {
      setOpen(true);
    }
    const show = () => setOpen(true);
    window.addEventListener(CONNECT_EVENT, show);
    return () => window.removeEventListener(CONNECT_EVENT, show);
  }, []);

  function close() {
    if (busy) return;
    try { sessionStorage.setItem(SEEN, '1'); } catch {}
    setOpen(false);
  }

  const chosen = selected || wallets[0]?.name || '';
  async function go() {
    if (!name.trim() || busy || !wallets.length) return;
    setBusy(true); setError('');
    try {
      await onJoin(name, wallets.find(w => w.name === chosen) || wallets[0]);
      try { sessionStorage.setItem(SEEN, '1'); } catch {}
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!open) return null;
  const enc = encodeURIComponent;
  const origin = here ? new URL(here).origin : '';
  return (
    <div className="modal" onClick={close}>
      <div className="card connect" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={e => e.stopPropagation()}>
        <button className="connect-x" aria-label="Close" onClick={close}>×</button>
        <div className="connect-badge" aria-hidden><span className="brand-dot" /></div>
        <h2 id="connect-title">Run with your wallet</h2>
        <p className="muted small connect-lede">Lock test USDC on a running goal and get paid when you finish. Your wallet signs everything; Lock&amp;Run never holds your keys.</p>

        <label htmlFor="runner-name">Your runner name</label>
        <input id="runner-name" className="input" maxLength={24} placeholder="e.g. Daniel" autoComplete="nickname" value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }} />

        {wallets.length > 0 ? (
          <>
            <label>Wallet <span className="net-pill">Solana Devnet</span></label>
            <div className="wallet-tiles" role="radiogroup" aria-label="Wallet">
              {wallets.map(w => (
                <button key={w.name} type="button" role="radio" aria-checked={chosen === w.name}
                  className={`wallet-tile ${chosen === w.name ? 'on' : ''}`} onClick={() => setSelected(w.name)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={w.icon} alt="" />
                  <span>{w.name}</span>
                </button>
              ))}
            </div>
            <button className="btn primary block" style={{ marginTop: '1rem' }} disabled={busy || !name.trim()} onClick={go}>
              {busy ? 'Approve the sign-in in your wallet…' : name.trim() ? `Connect ${chosen}` : 'Enter your name to continue'}
            </button>
            <ol className="connect-steps small muted">
              <li><b>Sign in:</b> a free signature that proves the wallet is yours. No money moves.</li>
              <li><b>Each deposit</b> is a separate approval in your wallet, after you review it.</li>
            </ol>
          </>
        ) : (
          <div className="no-wallet">
            <b>No Solana wallet found in this browser.</b>
            <p className="muted small">On your phone, open Lock&amp;Run inside your wallet app. On a computer, install the extension and refresh.</p>
            <div className="no-wallet-links">
              <a className="btn block" href={`https://phantom.app/ul/browse/${enc(here)}?ref=${enc(origin)}`}>Open in Phantom</a>
              <a className="btn block" href={`https://solflare.com/ul/v1/browse/${enc(here)}?ref=${enc(origin)}`}>Open in Solflare</a>
            </div>
            <p className="muted small" style={{ marginBottom: 0 }}>
              Don&apos;t have one? <a href="https://phantom.app/download" target="_blank" rel="noreferrer">Get Phantom</a> or{' '}
              <a href="https://solflare.com/download" target="_blank" rel="noreferrer">Solflare</a>, then switch it to Devnet.
            </p>
          </div>
        )}

        <div className="faucets small">
          <span className="muted">Need test funds?</span>
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">Devnet SOL ↗</a>
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Devnet USDC ↗</a>
        </div>
        {error && <p className="err">{error}</p>}
        <button className="btn ghost block connect-later" onClick={close}>Just looking around</button>
      </div>
    </div>
  );
}
