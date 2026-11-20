'use client';
import { useState } from 'react';
import { useWallet } from './WalletProvider';
import { openConnect } from '@/lib/client';

/**
 * Wallet controls. "side": address, network, disconnect (web sidebar, earnings page).
 * "top": phone top bar, only a Connect button or the pending-deposit retry, to keep the bar tidy.
 */
export default function WalletStatus({ variant = 'side' }: { variant?: 'side' | 'top' }) {
  const { me, ready, disconnect, pending, retryDeposit } = useWallet();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ready) return null;
  if (!me) return <button className={`btn primary connect-btn ${variant}`} onClick={openConnect}>Connect wallet</button>;
  const retry = async () => {
    setBusy(true); setError('');
    try { const d = await retryDeposit(); window.location.assign(`/c/${d.challenge.id}`); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className={`wallet-status ${variant}`}>
      {variant === 'side' && (
        <div className="wallet-line">
          <span className="wallet-addr" title={me.address}>{me.address.slice(0, 4)}…{me.address.slice(-4)}</span>
          <span className="net-pill">Devnet</span>
          <button className="link-btn" onClick={() => disconnect().catch(e => setError(e.message))}>Disconnect</button>
        </div>
      )}
      {pending && <button className="btn warn" disabled={busy} onClick={retry}>{busy ? 'Confirming…' : 'Retry deposit confirmation'}</button>}
      {error && <p className="err">{error}</p>}
    </div>
  );
}
