"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import NameGate from "@/components/NameGate";
import { SponsorMark } from "@/components/Logos";
import { Challenge, countedRuns, explorerAddress, explorerTx, money } from "@/lib/config";
import { computePayouts, prizeBreakdown } from "@/lib/settle";
import Badges from "@/components/Badges";
import AdSlot from "@/components/AdSlot";
import { timeLeft, useMe, useNow } from "@/lib/client";

type Row = {
  c: Challenge;
  state: "live" | "ready" | "won" | "back" | "lost" | "refunded";
  rate: number;
  payout: number;
  bonusShare: number;
  paySig?: string;
  joinSig: string;
  done: number;
};


/** "Getting paid": balance, winnings, payout history and cash out. */
export default function EarningsPage() {
  const { me, ready, join, signWithdrawal } = useMe();
  const now = useNow(5000);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [cs, w] = await Promise.all([
        fetch("/api/challenges", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/withdrawals", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setChallenges(cs.challenges || []);
      setBalance(typeof w.usdc === "number" ? w.usdc : null);
    } catch {}
  }, [me]);

  useEffect(() => {
    setPendingTransfer(!!sessionStorage.getItem("lockrun.withdrawal"));
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const rows: Row[] = useMemo(() => {
    if (!me) return [];
    return challenges
      .filter((c) => c.participants.some((p) => p.address === me.address))
      .map((c) => {
        const p = c.participants.find((x) => x.address === me.address)!;
        const { payouts } = computePayouts(c);
        const mine = payouts.find((x) => x.address === me.address)!;
        const nobodyWon = mine.tier === "refund";
        const bonusShare = mine.tier === "finished" ? prizeBreakdown(c).bonusShare : 0;
        const live = c.status === "active" && now < c.endsAt;
        let state: Row["state"] = "live";
        let payout = 0;
        if (!live && c.status !== "settled") {
          state = "ready";
          payout = mine.amount;
        } else if (c.status === "settled") {
          payout = p.payout || 0;
          state = nobodyWon ? "refunded" : payout > c.deposit ? "won" : payout >= c.deposit ? "back" : "lost";
        }
        return { c, state, rate: mine.rate, payout, bonusShare, paySig: p.paySig, joinSig: p.joinSig, done: countedRuns(p) };
      })
      .sort((a, b) => b.c.createdAt - a.c.createdAt);
  }, [challenges, me, now]);

  const settled = rows.filter((r) => ["won", "back", "lost", "refunded"].includes(r.state));
  const won = settled.reduce((s, r) => s + r.payout, 0);
  const deposited = settled.reduce((s, r) => s + r.c.deposit, 0);
  const net = Math.round((won - deposited) * 100) / 100;
  const bonusTotal = settled.reduce((s, r) => s + r.bonusShare, 0);
  const atStake = rows.filter((r) => r.state === "live" || r.state === "ready").reduce((s, r) => s + r.c.deposit, 0);

  async function cashOut() {
    if (!me) return;
    setMsg(null);
    if (sessionStorage.getItem("lockrun.withdrawal")) return setMsg({ ok: false, text: "Retry confirmation of your pending transfer before sending again." });
    const amt = Number(amount || balance || 0);
    if (!to.trim()) return setMsg({ ok: false, text: "Paste the Solana address to send to." });
    setBusy(true);
    try {
      // 1) Server builds the transfer and signs only as fee payer.
      const r1 = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", from: me.address, to: to.trim(), amount: amt }),
      });
      const d1 = await r1.json();
      if (!r1.ok) throw new Error(d1.error || "Couldn't prepare the transfer.");
      // The connected external wallet signs; private keys remain inside Phantom/Solflare.
      const refreshed = await signWithdrawal(d1.tx, amt, to.trim(), d1.feePayer);
      const signed = refreshed.signedTransaction;
      sessionStorage.setItem("lockrun.withdrawal", JSON.stringify({ intentId: refreshed.intentId, tx: signed, address: me.address }));
      setPendingTransfer(true);
      const r2 = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", intentId: refreshed.intentId, tx: signed }),
      });
      const d2 = await r2.json();
      if (!r2.ok) throw new Error(d2.error || "Cash out failed.");
      sessionStorage.removeItem("lockrun.withdrawal");
      setPendingTransfer(false);
      setMsg({ ok: true, text: `Sent ${money(amt)}.`, sig: d2.signature });
      setAmount("");
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  async function retryTransfer() {
    setBusy(true); setMsg(null);
    try {
      const saved = JSON.parse(sessionStorage.getItem("lockrun.withdrawal") || "null");
      if (!saved || saved.address !== me?.address) throw new Error("Reconnect the wallet that signed the pending transfer.");
      const r = await fetch("/api/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "submit", ...saved }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Confirmation failed.");
      sessionStorage.removeItem("lockrun.withdrawal"); setPendingTransfer(false);
      setMsg({ ok: true, text: "Transfer confirmed.", sig: d.signature });
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!ready) return null;

  return (
    <AppShell>
      <main className="wrap">
        <section className="hero">
          <h1>
            My earnings<br />
            <span className={net >= 0 ? "hl" : "neg"}>{net >= 0 ? `+${money(net)}` : `-${money(-net)}`} so far.</span>
          </h1>
          <p className="lede">Everything you&apos;ve won, every payout receipt, and your balance, ready to cash out.</p>
        </section>

        <div className="stats stats-4">
          <div className="stat-tile highlight">
            <div className="small">Balance</div>
            <div className="stat-num">{balance === null ? "—" : money(balance)}</div>
          </div>
          <div className="stat-tile">
            <div className="muted small">Paid out to you</div>
            <div className="stat-num">{money(won)}</div>
          </div>
          <div className="stat-tile">
            <div className="muted small">Sponsor bonuses</div>
            <div className="stat-num">{money(bonusTotal)}</div>
          </div>
          <div className="stat-tile">
            <div className="muted small">Locked in live challenges</div>
            <div className="stat-num">{money(atStake)}</div>
          </div>
        </div>

        <div className="layout">
          <section>
            <Badges rows={rows.map((r) => ({ c: r.c, rate: r.rate, settled: ["won", "back", "lost", "refunded"].includes(r.state), bonusShare: r.bonusShare }))} address={me?.address || ""} />
            <h2 style={{ marginTop: "1.75rem" }}>Payouts</h2>
            {rows.length === 0 ? (
              <div className="empty">
                No challenges yet. <Link href="/#new">Start one</Link> and get paid for finishing.
              </div>
            ) : (
              <div className="list">
                {rows.map((r) => (
                  <Link key={r.c.id} href={`/c/${r.c.id}`} className={`earn-row ${r.state}`}>
                    <div style={{ minWidth: 0 }}>
                      <div className="ctitle">{r.c.title}</div>
                      <div className="meta">
                        <span>{money(r.c.deposit)} deposit</span>
                        <span>
                          {Math.min(r.done, r.c.runsRequired)}/{r.c.runsRequired} runs · {Math.round(r.rate * 100)}%
                        </span>
                        {r.state === "live" && <span className="st-open">{timeLeft(r.c.endsAt, now)}</span>}
                        {r.state === "ready" && <span>Ended · tap to pay out</span>}
                      </div>
                      {r.bonusShare > 0 && (
                        <div className="earn-bonus">
                          {(r.c.sponsors || []).map((s, i) => (
                            <SponsorMark key={i} c={r.c} index={i} s={s} size="sm" />
                          ))}
                          incl. {money(r.bonusShare)} bonus from {(r.c.sponsors || []).map((s) => s.name).join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="earn-amt">
                      {r.state === "won" && <b className="win">+{money(r.payout)}</b>}
                      {r.state === "lost" && <b className="lose">-{money(r.c.deposit)}</b>}
                      {r.state === "back" && <b>{money(r.payout)} back</b>}
                      {r.state === "refunded" && <b>{money(r.payout)} back</b>}
                      {r.state === "ready" && <span className="muted small">{r.payout > 0 ? `${money(r.payout)} waiting` : "no payout"}</span>}
                      {r.state === "live" && <span className="muted small">in progress</span>}
                      {r.paySig && (
                        <span className="small receipt" onClick={(e) => { e.preventDefault(); window.open(explorerTx(r.paySig!), "_blank"); }}>
                          receipt ↗
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <aside className="card">
            <h2>Cash out</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Send your winnings to any Solana wallet (like Phantom). A small network fee is paid from your wallet in SOL.
            </p>
            <div className="cash-bal">
              <span className="muted small">Available</span>
              <b>{balance === null ? "—" : money(balance)}</b>
            </div>
            <Link href="/shop" className="btn block shop-link">🛍️ Spend it in the Shop</Link>
            <div className="muted small" style={{ textAlign: "center", margin: "0.6rem 0 0" }}>or send it to your wallet</div>
            <label htmlFor="amt">Amount (USDC)</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                id="amt"
                className="input"
                inputMode="decimal"
                placeholder={balance ? String(balance) : "0"}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <button className="btn" onClick={() => setAmount(String(balance || 0))}>Max</button>
            </div>
            <label htmlFor="to">Send to (Solana address)</label>
            <input id="to" className="input" placeholder="Paste a wallet address" value={to} onChange={(e) => setTo(e.target.value)} />
            <button className="btn primary block" style={{ marginTop: "1rem" }} disabled={busy || !balance || pendingTransfer} onClick={cashOut}>
              {busy ? "Sending…" : `Cash out ${amount ? money(Number(amount)) : balance ? money(balance) : ""}`}
            </button>
            {pendingTransfer && <button className="btn block" disabled={busy} onClick={retryTransfer}>Retry transfer confirmation</button>}
            {msg && (
              <p className={msg.ok ? "result ok" : "err"}>
                {msg.text}{" "}
                {msg.sig && (
                  <a href={explorerTx(msg.sig)} target="_blank" rel="noreferrer">receipt ↗</a>
                )}
              </p>
            )}
            {me && (
              <p className="muted small" style={{ marginBottom: 0 }}>
                Your wallet:{" "}
                <a href={explorerAddress(me.address)} target="_blank" rel="noreferrer">
                  {me.address.slice(0, 4)}…{me.address.slice(-4)} ↗
                </a>
                <br />
                This sends USDC to another Solana wallet. It does not convert it to cash.
              </p>
            )}
          </aside>
        </div>
        <div style={{ marginTop: "1.5rem" }}>
          <AdSlot />
        </div>
        <p className="foot">Built on Solana</p>
        {!me && <NameGate onJoin={(n, wallet) => join(n, wallet)} />}
      </main>
    </AppShell>
  );
}
