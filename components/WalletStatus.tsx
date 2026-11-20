'use client';
import { useState } from 'react';
import { useWallet } from './WalletProvider';
export default function WalletStatus() {
  const { me, disconnect, pending, retryDeposit } = useWallet();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  return <div className="small wallet-status">
    <div>{me.name} · <span title={me.address}>{me.address.slice(0, 4)}…{me.address.slice(-4)}</span> · Devnet</div>
    <button className="btn ghost" onClick={() => disconnect().catch(e => setError(e.message))}>Disconnect</button>
    {pending && <button className="btn" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const d = await retryDeposit(); window.location.assign(`/c/${d.challenge.id}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Confirming…' : 'Retry deposit confirmation'}</button>}
    {error && <p className="err">{error}</p>}
  </div>;
}
