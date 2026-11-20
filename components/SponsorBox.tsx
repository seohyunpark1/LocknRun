"use client";
import { useState } from "react";
import { Challenge, MAX_SPONSORS, SPONSOR_BONUSES, explorerTx, money } from "@/lib/config";

/** Lets a brand add bonus money to a challenge's pot. The bonus is locked in escrow on Solana. */
export default function SponsorBox({ c, live, onUpdated }: { c: Challenge; live: boolean; onUpdated: (c: Challenge) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [amount, setAmount] = useState(25);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sponsors = c.sponsors || [];
  const full = sponsors.length >= MAX_SPONSORS;

  async function submit() {
    setErr("");
    if (!name.trim()) return setErr("Add the sponsor's name.");
    setBusy(true);
    try {
      const r = await fetch(`/api/challenges/${c.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sponsor", name, amount, url: url.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add the sponsor.");
      onUpdated(d.challenge);
      setOpen(false);
      setName("");
      setUrl("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card sponsor-box">
      <h2>Sponsors</h2>
      {sponsors.length === 0 ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          No sponsors yet. Brands can add bonus money to the pot. It&apos;s split among everyone who finishes.
        </p>
      ) : (
        <ul className="sponsor-list">
          {sponsors.map((s, i) => (
            <li key={i}>
              <span className="sponsor-logo" aria-hidden>{s.name.charAt(0).toUpperCase()}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="sponsor-name">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer noopener">{s.name} ↗</a>
                  ) : (
                    s.name
                  )}
                </div>
                <a className="muted small" href={explorerTx(s.sig)} target="_blank" rel="noreferrer">bonus receipt ↗</a>
              </div>
              <b className="sponsor-amt">+{money(s.amount)}</b>
            </li>
          ))}
        </ul>
      )}

      {live && !full && !open && (
        <button className="btn block" onClick={() => setOpen(true)}>
          Sponsor this challenge
        </button>
      )}
      {live && open && (
        <div>
          <label htmlFor="sp-name">Brand or business name</label>
          <input id="sp-name" className="input" maxLength={40} placeholder="Austin Running Co." value={name} onChange={(e) => setName(e.target.value)} />
          <label>Bonus for finishers</label>
          <div className="chips">
            {SPONSOR_BONUSES.map((a) => (
              <button key={a} className={`chip ${a === amount ? "on" : ""}`} onClick={() => setAmount(a)}>
                ${a}
              </button>
            ))}
          </div>
          <label htmlFor="sp-url">Website (optional)</label>
          <input id="sp-url" className="input" maxLength={200} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary block" style={{ marginTop: "1rem" }} disabled={busy} onClick={submit}>
            {busy ? "Locking the bonus…" : `Add ${money(amount)} bonus`}
          </button>
          <button className="btn ghost block" style={{ marginTop: "0.5rem" }} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
            Demo mode: paid with test dollars. If nobody finishes, the bonus goes back to the sponsor.
          </p>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
