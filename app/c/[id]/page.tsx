"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import NameGate from "@/components/NameGate";
import AppShell from "@/components/AppShell";
import RunTracker from "@/components/RunTracker";
import SponsorBox from "@/components/SponsorBox";
import AdSlot from "@/components/AdSlot";
import { SponsorMark } from "@/components/Logos";
import StravaImport from "@/components/StravaImport";
import { Challenge, Run, bonusOf, countedRuns, explorerTx, isFinisher, money, pace, potOf } from "@/lib/config";
import { computePayouts } from "@/lib/settle";
import { speak, timeLeft, useMe, useNow } from "@/lib/client";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const { me, ready, join, deposit: lockWalletDeposit } = useMe();
  const now = useNow();
  const [c, setC] = useState<Challenge | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [demo, setDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewRun, setViewRun] = useState<{ run: Run; name: string } | null>(null);

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("demo");
    if (flag === "1") localStorage.setItem("lockrun.demo", "1");
    if (flag === "0") localStorage.removeItem("lockrun.demo");
    setDemo(localStorage.getItem("lockrun.demo") === "1");
  }, []);

  const load = useCallback(async () => {
    const r = await fetch(`/api/challenges/${id}`, { cache: "no-store" });
    if (r.status === 404) return setNotFound(true);
    const d = await r.json();
    if (d.challenge) setC(d.challenge);
  }, [id]);

  useEffect(() => {
    let stop = false;
    async function loop() {
      try {
        await load();
      } catch {}
      if (!stop) setTimeout(loop, 4000);
    }
    loop();
    return () => {
      stop = true;
    };
  }, [load]);

  async function act(action: "join" | "settle") {
    if (!me) return;
    setBusy(action);
    setErr("");
    try {
      const r = await fetch(`/api/challenges/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: me.name, address: me.address }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      const confirmed = action === "join" ? await lockWalletDeposit(d) : d;
      setC(confirmed.challenge);
      if (action === "join") speak(`You're in, ${me.name}! Your deposit is locked. Now go run.`);
      if (action === "settle") window.dispatchEvent(new Event("lockrun:refresh")); // shows the Congratulations pop-up right away
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  async function saveRun(km: number, sec: number, photo: string) {
    const r = await fetch(`/api/challenges/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run", address: me?.address, km, sec, photo }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not save run");
    setC(d.challenge);
    return { counts: d.run.counts, reason: d.reason };
  }

  if (!ready) return null;
  if (notFound)
    return (
      <AppShell>
        <main className="wrap">
          <div className="empty" style={{ marginTop: "2rem" }}>
            Challenge not found. <Link href="/">Back to challenges</Link>
          </div>
        </main>
      </AppShell>
    );
  if (!c)
    return (
      <AppShell>
        <main className="wrap"><p className="muted">Loading…</p></main>
      </AppShell>
    );

  const live = c.status === "active" && now < c.endsAt;
  const mine = c.participants.find((p) => p.address === me?.address);
  const pot = potOf(c);
  const bonus = bonusOf(c);
  const { payouts } = computePayouts(c);
  const myProjected = payouts.find((p) => p.address === me?.address);
  const { prizePerWinner: prizeNow } = computePayouts(c);
  const board = [...c.participants].sort((a, b) => countedRuns(b) - countedRuns(a));

  return (
    <AppShell>
    <main className="wrap">
      <Link href="/" className="back small">← All challenges</Link>

      <div className="hero2">
        <div>
          <span className={`status ${live ? "st-open" : c.status === "settled" ? "st-done" : "st-claimed"}`}>
            {live ? timeLeft(c.endsAt, now) : c.status === "settled" ? "Paid out" : "Ended"}
          </span>
          <h1 style={{ marginTop: 10 }}>{c.title}</h1>
          <p className="lede">
            Run <b>{c.goalKm} km</b>, <b>{c.runsRequired} time{c.runsRequired > 1 ? "s" : ""}</b> before the clock runs out.
            Deposit <b>{money(c.deposit)}</b>. Hit 100% to win prize money
            {bonus > 0 ? <>, including a <b>{money(bonus)} sponsor bonus</b></> : null}.
          </p>
          {bonus > 0 && (
            <div className="sponsor-banner">
              <span className="sponsor-badge">+{money(bonus)} bonus</span>
              <span className="sponsor-marks">
                {c.sponsors!.map((s, i) => (
                  <SponsorMark key={i} c={c} index={i} s={s} />
                ))}
              </span>
              <span>Sponsored by {c.sponsors!.map((x) => x.name).join(", ")}</span>
            </div>
          )}
        </div>
        <div className="potbox">
          <div className="pot-amt">{money(pot)}</div>
          <div className="pot-label">in the pot · {c.participants.length} runner{c.participants.length > 1 ? "s" : ""}</div>
          <button
            className="btn ghost"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href.split("?")[0]);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        </div>
      </div>
      {err && <p className="err">{err}</p>}

      <div className="layout challenge-layout" style={{ marginTop: "1.5rem" }}>
        <section>
          {live && !mine && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2>Join this challenge</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Lock {money(c.deposit)}. Finish {c.runsRequired}× {c.goalKm} km and you get it back
                {c.participants.length > 0 ? ", plus prize money from anyone who doesn't" : ""}
                {bonus > 0 ? ` and the ${money(bonus)} sponsor bonus` : ""}.
              </p>
              <button className="btn primary block" disabled={!!busy || !me} onClick={() => act("join")}>
                {busy === "join" ? "Locking your deposit…" : `Join & lock ${money(c.deposit)}`}
              </button>
            </div>
          )}

          {live && mine && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h2>Your run</h2>
                <span className="muted small">
                  {Math.min(countedRuns(mine), c.runsRequired)}/{c.runsRequired} runs · {Math.round((Math.min(countedRuns(mine), c.runsRequired) / c.runsRequired) * 100)}%
                </span>
              </div>
              <RunTracker goalKm={c.goalKm} demo={demo} onFinish={saveRun} />
              <StravaImport
                challengeId={c.id}
                address={me!.address}
                onImported={(d) => setC(d.challenge as Challenge)}
              />
            </div>
          )}

          {!live && c.status !== "settled" && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2>Time&apos;s up! Ready to pay out</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {payouts.filter((p) => p.tier === "full").length} of {c.participants.length} hit 100%. Anyone can trigger the payout;
                the rules decide who gets what.
              </p>
              <button className="btn primary block" disabled={!!busy} onClick={() => act("settle")}>
                {busy === "settle" ? "Paying out on Solana…" : "Pay out the pot"}
              </button>
            </div>
          )}

          <h2>Leaderboard</h2>
          <div className="list board">
            <div className="lb lb-head" aria-hidden>
              <span className="lb-rank" />
              <span className="lb-name">Runner</span>
              <span className="lb-prog">Progress</span>
              <span className="lb-pace">Best pace</span>
              <span className="lb-rcpt">Receipts</span>
              <span className="lb-pay">Payout</span>
            </div>
            {board.map((p, i) => {
              const done = countedRuns(p);
              const fin = isFinisher(c, p);
              const po = payouts.find((x) => x.address === p.address);
              const best = p.runs.filter((r) => r.counts).sort((a, b) => a.sec / a.km - b.sec / b.km)[0];
              return (
                <div key={p.address} className={`lb ${p.address === me?.address ? "mine" : ""}`}>
                  <div className={`rank lb-rank ${fin ? "fin" : ""}`}>{fin ? "✓" : i + 1}</div>
                  <div className="lb-name">{p.address === me?.address ? `${p.name} (you)` : p.name}</div>
                  <div className="lb-prog">
                    <span className="lb-count">
                      {Math.min(done, c.runsRequired)}/{c.runsRequired}
                    </span>
                    <div className="bar thin">
                      <span style={{ width: `${Math.min(100, (done / c.runsRequired) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="lb-meta">
                    <span className="lb-pace">
                      {best ? `${pace(best.sec / best.km)}/km` : "—"}
                      <span className="phone-only"> best · {p.runs.length} run{p.runs.length === 1 ? "" : "s"}</span>
                    </span>
                    <span className="lb-rcpt">
                      <a href={explorerTx(p.joinSig)} target="_blank" rel="noreferrer">deposit ↗</a>
                      {p.paySig && (
                        <a href={explorerTx(p.paySig)} target="_blank" rel="noreferrer">payout ↗</a>
                      )}
                    </span>
                  </div>
                  <div className="payout lb-pay">
                    {c.status === "settled" ? (
                      <b className={(p.payout || 0) > c.deposit ? "win" : (p.payout || 0) >= c.deposit ? "" : "lose"}>
                        {(p.payout || 0) > c.deposit ? `+${money(p.payout || 0)}` : (p.payout || 0) >= c.deposit ? `${money(c.deposit)} back` : `-${money(Math.round((c.deposit - (p.payout || 0)) * 100) / 100)}`}
                      </b>
                    ) : (
                      <span className="muted small">{po ? `${Math.round(po.rate * 100)}% · ${money(po.amount)}` : "—"}</span>
                    )}
                  </div>
                  {p.runs.length > 0 && (
                    <div className="proofs lb-proofs">
                      {p.runs.slice(-6).reverse().map((r) => (
                        <button key={r.id} className={`proof-chip ${r.counts ? "" : "nope"}`} onClick={() => setViewRun({ run: r, name: p.name })} title="See proof">
                          {r.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/photos/${r.id}`} alt="" loading="lazy" />
                          ) : (
                            <span className="strava-mark" aria-hidden />
                          )}
                          <span>{r.km} km</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="side-col">
        <aside className="soft">
          <h2>Rewards</h2>
          <p className="small" style={{ lineHeight: 1.5, marginTop: 0 }}>
            Everyone locks <b>{money(c.deposit)}</b>. What you get back depends on how many of your {c.runsRequired} runs you finish:
          </p>
          <div className="tiers">
            <div className="tier-row full">
              <span className="tier-pill tier-full">100%</span>
              <div>
                <b>Deposit back + prize</b>
                <div className="muted small">
                  {prizeNow > 0 ? `Prize right now: +${money(prizeNow)} each` : "Prize grows as others miss runs or sponsors join"}
                </div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-safe">85–99%</span>
              <div>
                <b>Full deposit back</b>
                <div className="muted small">No prize, no loss</div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-partial">&lt;85%</span>
              <div>
                <b>Part of your deposit back</b>
                <div className="muted small">
                  Same % as you finish{c.runsRequired > 1 ? ` (e.g. ${Math.floor(c.runsRequired / 2)}/${c.runsRequired} runs → ${money(Math.floor((c.deposit * 100 * Math.floor(c.runsRequired / 2)) / c.runsRequired) / 100)})` : ""}
                </div>
              </div>
            </div>
          </div>
          <p className="muted small" style={{ lineHeight: 1.5 }}>
            The prize pool is what others don&apos;t get back plus any sponsor bonus, split among everyone at 100%. If nobody
            hits 100%, everyone is refunded and sponsors get their bonus back.
          </p>
          {mine && myProjected && c.status !== "settled" && (
            <div className="result ok" style={{ marginTop: 10 }}>
              You&apos;re at <b>{Math.round(myProjected.rate * 100)}%</b>. If it ended now you&apos;d get <b>{money(myProjected.amount)}</b>
              {myProjected.tier === "full" ? "" : `. Finish all ${c.runsRequired} runs for the prize!`}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Runs count when they reach {c.goalKm} km at a running pace (between 2:30 and 20:00 per km) and come with proof:
            a photo, or a run recorded on Strava. Every proof is stamped on Solana.
          </p>
        </aside>
        <SponsorBox c={c} live={live} onUpdated={setC} />
        <AdSlot variant="card" />
        </div>
      </div>

      <p className="foot">Hackathon demo · Solana devnet · test money only{demo ? " · demo mode on" : ""}</p>

      {!me && (
        <NameGate
          onJoin={async (n, wallet) => {
            await join(n, wallet);
            speak(`Welcome, ${n}!`);
          }}
        />
      )}
      {viewRun && (
        <div className="modal" onClick={() => setViewRun(null)}>
          <div className="card viewer" onClick={(e) => e.stopPropagation()}>
            {viewRun.run.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/photos/${viewRun.run.id}`} alt={`${viewRun.name}'s run photo`} />
            )}
            <h2 style={{ margin: "0.9rem 0 0.25rem" }}>
              {viewRun.name} · {viewRun.run.km} km in {Math.floor(viewRun.run.sec / 60)}:{String(viewRun.run.sec % 60).padStart(2, "0")}
            </h2>
            <div className="meta">
              <span>{pace(viewRun.run.sec / viewRun.run.km)}/km</span>
              <span>{viewRun.run.source === "strava" ? `Strava: ${viewRun.run.stravaName || "run"}` : "GPS + photo"}</span>
              <span className={viewRun.run.counts ? "" : "nope-text"}>{viewRun.run.counts ? "Counted" : "Didn't count"}</span>
            </div>
            <div className="meta" style={{ marginTop: "0.5rem" }}>
              {viewRun.run.stravaId && (
                <a href={`https://www.strava.com/activities/${viewRun.run.stravaId}`} target="_blank" rel="noreferrer">View on Strava ↗</a>
              )}
              {viewRun.run.proofSig && (
                <a href={explorerTx(viewRun.run.proofSig)} target="_blank" rel="noreferrer">Proof on Solana ↗</a>
              )}
            </div>
            <button className="btn block" style={{ marginTop: "1rem" }} onClick={() => setViewRun(null)}>Close</button>
          </div>
        </div>
      )}

    </main>
    </AppShell>
  );
}
