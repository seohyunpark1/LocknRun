"use client";
import { openConnect, useMe } from "@/lib/client";
import { useState } from "react";
import { Challenge, MAX_SPONSORS, SPONSOR_BONUSES, explorerTx, money } from "@/lib/config";
import { SponsorMark } from "@/components/Logos";

/** Lets a brand add bonus money to a challenge's pot. The bonus is locked in escrow on Solana. */
export default function SponsorBox({ c, live, onUpdated, invite }: { c: Challenge; live: boolean; onUpdated: (c: Challenge) => void; invite?: string }) {
  const { me, deposit } = useMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [amount, setAmount] = useState(25);
  const [logo, setLogo] = useState("");
  const [tagline, setTagline] = useState("");
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
        body: JSON.stringify({ action: "sponsor", invite, name, amount, url: url.trim() || undefined, logo: logo || undefined, tagline: tagline.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't add the sponsor.");
      const confirmed = await deposit(d);
      onUpdated(confirmed.challenge);
      setOpen(false);
      setName("");
      setUrl("");
      setLogo("");
      setTagline("");
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
              <SponsorMark c={c} index={i} s={s} />
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
        <button className="btn block" onClick={() => (me ? setOpen(true) : openConnect())}>
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
          <label>Logo (optional)</label>
          <label className={`logo-pick ${logo ? "has" : ""}`}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Logo preview" />
            ) : (
              <span>Upload a PNG or JPG</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setLogo(await shrinkLogo(f));
                } catch {
                  setErr("Couldn't read that image.");
                }
              }}
            />
          </label>
          <label htmlFor="sp-tag">Ad message (optional)</label>
          <input id="sp-tag" className="input" maxLength={90} placeholder="20% off running shoes for Lock&Run finishers" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          <label htmlFor="sp-url">Website (optional)</label>
          <input id="sp-url" className="input" maxLength={200} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn primary block" style={{ marginTop: "1rem" }} disabled={busy} onClick={submit}>
            {busy ? "Locking the bonus…" : `Add ${money(amount)} bonus`}
          </button>
          <button className="btn ghost block" style={{ marginTop: "0.5rem" }} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
            Your logo and ad message appear in Lock&amp;Run&apos;s ad spots while the challenge is live, and on the payout
            screen of every runner who finishes. Your connected wallet approves the USDC bonus and pays network fees. If nobody finishes, the bonus returns to the wallet that funded it.
          </p>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

/** Shrinks a logo to fit 256x256 (keeps transparency as PNG; falls back to JPEG if too big). */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (png.length < 190_000) return png;
    const ctx = canvas.getContext("2d")!;
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
