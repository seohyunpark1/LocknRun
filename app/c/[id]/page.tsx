"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import NameGate from "@/components/NameGate";
import RunTracker from "@/components/RunTracker";
import { Challenge, countedRuns, explorerTx, isFinisher, money, pace } from "@/lib/config";
import { computePayouts } from "@/lib/settle";
import { speak, timeLeft, useMe, useNow } from "@/lib/client";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const { me, ready, join } = useMe();
  const now = useNow();
  const [c, setC] = useState<Challenge | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [demo, setDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<{ big: string; line: string } | null>(null);
  const announcedPayout = useRef(false);

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

  // Announce my payout once the challenge is paid out.
  useEffect(() => {
    if (!c || !me || c.status !== "settled" || announcedPayout.current) return;
    const mine = c.participants.find((p) => p.address === me.address);
    if (!mine) return;
    announcedPayout.current = true;
    if ((mine.payout || 0) > 0) {
      const bonus = Math.round(((mine.payout || 0) - c.deposit) * 100) / 100;
      setToast({ big: `+${money(mine.payout || 0)}`, line: bonus > 0 ? `Your ${money(c.deposit)} back + ${money(bonus)} from the quitters` : "Your deposit is back" });
      speak(
        bonus > 0
          ? `You did it! You got your ${c.deposit} dollars back, plus ${bonus} dollars from the people who quit.`
          : `Your ${c.deposit} dollars are back in your account.`
      );
      setTimeout(() => setToast(null), 5000);
    }
  }, [c, me]);

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
      setC(d.challenge);
      if (action === "join") speak(`You're in, ${me.name}! Your deposit is locked. Now go run.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  async function saveRun(km: number, sec: number) {
    const r = await fetch(`/api/challenges/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run", address: me?.address, km, sec }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not save run");
    setC(d.challenge);
    return { counts: d.run.counts, reason: d.reason };
  }

  if (!ready) return null;
  if (notFound)
    return (
      <main className="wrap">
        <Link href="/" className="brand">← Lock&Run</Link>
        <div className="empty" style={{ marginTop: 30 }}>Challenge not found.</div>
      </main>
    );
  if (!c) return <main className="wrap"><p className="muted">Loading…</p></main>;

  const live = c.status === "active" && now < c.endsAt;
  const mine = c.participants.find((p) => p.address === me?.address);
  const pot = c.deposit * c.participants.length;
  const { payouts } = computePayouts(c);
  const myProjected = payouts.find((p) => p.address === me?.address);
  const board = [...c.participants].sort((a, b) => countedRuns(b) - countedRuns(a));

  return (
    <main className="wrap">
      <div className="top">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>
          <span className="brand-dot" /> Lock&Run
        </Link>
        {me && <div className="me">{me.name}</div>}
      </div>

      <div className="hero2">
        <div>
          <span className={`status ${live ? "st-open" : c.status === "settled" ? "st-done" : "st-claimed"}`}>
            {live ? timeLeft(c.endsAt, now) : c.status === "settled" ? "Paid out" : "Ended"}
          </span>
          <h1 style={{ marginTop: 10 }}>{c.title}</h1>
          <p className="lede">
            Run <b>{c.goalKm} km</b>, <b>{c.runsRequired} time{c.runsRequired > 1 ? "s" : ""}</b> before the clock runs out.
            Deposit <b>{money(c.deposit)}</b>. Finishers split the quitters&apos; deposits.
          </p>
        </div>
        <div className="potbox">
          <div className="pot-amt" style={{ fontSize: 54 }}>{money(pot)}</div>
          <div className="pot-label">in the pot · {c.participants.length} runner{c.participants.length > 1 ? "s" : ""}</div>
          <button
            className="btn ghost"
            style={{ marginTop: 12 }}
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

      <div className="layout" style={{ marginTop: 22 }}>
        <section>
          {live && !mine && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2>Join this challenge</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Lock {money(c.deposit)}. Finish {c.runsRequired}× {c.goalKm} km and you get it back
                {c.participants.length > 0 ? ", plus a share of anyone who quits" : ""}.
              </p>
              <button className="btn primary block" disabled={!!busy || !me} onClick={() => act("join")}>
                {busy === "join" ? "Locking your deposit…" : `Join & lock ${money(c.deposit)}`}
              </button>
            </div>
          )}

          {live && mine && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h2>Your run</h2>
                <span className="muted small">
                  {countedRuns(mine)}/{c.runsRequired} runs counted {isFinisher(c, mine) ? "· finished" : ""}
                </span>
              </div>
              <RunTracker goalKm={c.goalKm} demo={demo} onFinish={saveRun} />
            </div>
          )}

          {!live && c.status !== "settled" && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h2>Time&apos;s up! Ready to pay out</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {payouts.filter((p) => p.finisher).length} of {c.participants.length} finished. Anyone can trigger the payout;
                the rules decide who gets what.
              </p>
              <button className="btn primary block" disabled={!!busy} onClick={() => act("settle")}>
                {busy === "settle" ? "Paying out on Solana…" : "Pay out the pot"}
              </button>
            </div>
          )}

          <h2>Leaderboard</h2>
          <div className="list">
            {board.map((p, i) => {
              const done = countedRuns(p);
              const fin = isFinisher(c, p);
              const po = payouts.find((x) => x.address === p.address);
              const best = p.runs.filter((r) => r.counts).sort((a, b) => a.sec / a.km - b.sec / b.km)[0];
              return (
                <div key={p.address} className={`lb ${p.address === me?.address ? "mine" : ""}`}>
                  <div className={`rank ${fin ? "fin" : ""}`}>{fin ? "✓" : i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 800 }}>
                      <span>{p.address === me?.address ? `${p.name} (you)` : p.name}</span>
                      <span>
                        {done}/{c.runsRequired}
                      </span>
                    </div>
                    <div className="bar thin" style={{ margin: "8px 0" }}>
                      <span style={{ width: `${Math.min(100, (done / c.runsRequired) * 100)}%` }} />
                    </div>
                    <div className="meta">
                      <span>{p.runs.length} run{p.runs.length === 1 ? "" : "s"} logged</span>
                      {best && <span>best pace {pace(best.sec / best.km)}/km</span>}
                      <a href={explorerTx(p.joinSig)} target="_blank" rel="noreferrer">deposit receipt ↗</a>
                      {p.paySig && (
                        <a href={explorerTx(p.paySig)} target="_blank" rel="noreferrer">payout receipt ↗</a>
                      )}
                    </div>
                  </div>
                  <div className="payout">
                    {c.status === "settled" ? (
                      <b className={(p.payout || 0) > 0 ? "win" : "lose"}>{(p.payout || 0) > 0 ? `+${money(p.payout || 0)}` : `-${money(c.deposit)}`}</b>
                    ) : (
                      <span className="muted small">{fin ? `on track for ${money(po?.amount || 0)}` : "not yet"}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="soft">
          <h2>How the pot splits</h2>
          <p className="small" style={{ lineHeight: 1.5 }}>
            Everyone locks the same <b>{money(c.deposit)}</b>. When time&apos;s up:
          </p>
          <ul className="small" style={{ lineHeight: 1.6, paddingLeft: 18 }}>
            <li>Finishers get their deposit back plus an equal share of the quitters&apos; deposits.</li>
            <li>Quitters lose their deposit.</li>
            <li>If nobody finishes, everyone is refunded.</li>
          </ul>
          {mine && myProjected && c.status !== "settled" && (
            <div className="result ok" style={{ marginTop: 10 }}>
              If it ended right now you&apos;d get <b>{money(myProjected.amount)}</b>
              {myProjected.finisher ? "" : " (finish your runs to get paid!)"}
            </div>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>
            Runs count when they reach {c.goalKm} km at a running pace (between 2:30 and 20:00 per km).
          </p>
        </aside>
      </div>

      <p className="foot">Hackathon demo · Solana devnet · test money only{demo ? " · demo mode on" : ""}</p>

      {!me && (
        <NameGate
          onJoin={(n) => {
            join(n);
            speak(`Welcome, ${n}!`);
          }}
        />
      )}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          <div className="toast-card">
            <div className="toast-big">{toast.big}</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 10 }}>{toast.line}</div>
          </div>
        </div>
      )}
    </main>
  );
}
