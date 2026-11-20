"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NameGate from "@/components/NameGate";
import { Challenge, DEPOSITS, DURATIONS, GOAL_KMS, RUNS_REQUIRED, countedRuns, explorerAddress, money } from "@/lib/config";
import { speak, timeLeft, useMe, useNow } from "@/lib/client";

type Data = { challenges: Challenge[]; escrow: { address: string | null; balance: number | null } };

function Chips<T extends number>({ options, value, onChange, fmt }: { options: T[]; value: T; onChange: (v: T) => void; fmt: (v: T) => string }) {
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} className={`chip ${o === value ? "on" : ""}`} onClick={() => onChange(o)}>
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { me, ready, join } = useMe();
  const now = useNow();
  const [data, setData] = useState<Data>({ challenges: [], escrow: { address: null, balance: null } });

  const [title, setTitle] = useState("");
  const [goalKm, setGoalKm] = useState(3);
  const [runsRequired, setRuns] = useState(2);
  const [deposit, setDeposit] = useState(10);
  const [minutes, setMinutes] = useState(DURATIONS[0].minutes);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [formInView, setFormInView] = useState(false);

  // Hide the phone "New challenge" button while the form itself is on screen.
  useEffect(() => {
    const el = document.getElementById("new");
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setFormInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [me]);

  useEffect(() => {
    let stop = false;
    async function load() {
      try {
        const r = await fetch("/api/challenges", { cache: "no-store" });
        setData(await r.json());
      } catch {}
      if (!stop) setTimeout(load, 5000);
    }
    load();
    return () => {
      stop = true;
    };
  }, []);

  async function create() {
    if (!me) return;
    setErr("");
    setCreating(true);
    try {
      const r = await fetch("/api/challenges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, goalKm, runsRequired, deposit, minutes, name: me.name, address: me.address }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not create");
      router.push(`/c/${d.challenge.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setCreating(false);
    }
  }

  if (!ready) return null;
  const active = data.challenges.filter((c) => c.status === "active" && c.endsAt > now);
  const ended = data.challenges.filter((c) => !(c.status === "active" && c.endsAt > now));
  const locked = data.challenges.filter((c) => c.status !== "settled").reduce((s, c) => s + c.deposit * c.participants.length, 0);

  return (
    <main className="wrap">
      <div className="top">
        <div className="brand">
          <span className="brand-dot" /> Lock&Run
        </div>
        {me && <div className="me">{me.name}</div>}
      </div>

      <h1>
        Bet on your own run.<br /><span className="hl">Finish, and get paid.</span>
      </h1>
      <p className="lede">
        Put money on your running goal with friends. Everyone who finishes gets their deposit back <b>plus</b> a share of
        the quitters&apos; money. The deposits wait in escrow on Solana, so nobody can back out of paying.
      </p>

      <div className="steps">
        <div className="step"><b>1 · Join &amp; lock</b>Pick a goal like 3 km × 2 runs. Your $10 is locked in escrow.</div>
        <div className="step"><b>2 · Run and prove it</b>GPS and a voice coach track every km. Add a photo or a Strava run as proof.</div>
        <div className="step"><b>3 · Split the pot</b>Finishers split the quitters&apos; deposits, paid out in about a second.</div>
      </div>

      <div className="escrow">
        <span>
          <b>{money(data.escrow.balance ?? locked)}</b> on the line right now
        </span>
        {data.escrow.address && (
          <a href={explorerAddress(data.escrow.address)} target="_blank" rel="noreferrer">
            Verify on Solana ↗
          </a>
        )}
      </div>

      <div className="layout">
        <section>
          <h2>Live challenges</h2>
          {active.length === 0 && <div className="empty">No live challenges yet.</div>}
          <div className="list">
            {active.map((c) => (
              <ChallengeCard key={c.id} c={c} now={now} meAddr={me?.address} />
            ))}
          </div>
          {ended.length > 0 && (
            <>
              <h2 style={{ marginTop: "1.75rem" }}>Finished</h2>
              <div className="list">
                {ended.map((c) => (
                  <ChallengeCard key={c.id} c={c} now={now} meAddr={me?.address} />
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="card post" id="new">
          <h2>Start a challenge</h2>
          <label>Name it (optional)</label>
          <input className="input" maxLength={60} placeholder="Morning 3K crew" value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Distance per run</label>
          <Chips options={GOAL_KMS} value={goalKm} onChange={setGoalKm} fmt={(v) => `${v} km`} />
          <label>Runs to finish</label>
          <Chips options={RUNS_REQUIRED} value={runsRequired} onChange={setRuns} fmt={(v) => `${v}×`} />
          <label>Deposit</label>
          <Chips options={DEPOSITS} value={deposit} onChange={setDeposit} fmt={(v) => `$${v}`} />
          <label>Ends in</label>
          <div className="chips">
            {DURATIONS.map((d) => (
              <button key={d.minutes} className={`chip ${d.minutes === minutes ? "on" : ""}`} onClick={() => setMinutes(d.minutes)}>
                {d.label}
              </button>
            ))}
          </div>
          <button className="btn primary block" style={{ marginTop: "1.25rem" }} disabled={creating} onClick={create}>
            {creating ? "Locking your deposit…" : `Create & lock ${money(deposit)}`}
          </button>
          <p className="muted small" style={{ textAlign: "center", margin: "8px 0 0" }}>
            Demo mode: paid like Apple Pay, with test dollars. "15 min" is for live demos.
          </p>
          {err && <p className="err">{err}</p>}
        </aside>
      </div>
      <p className="foot">Hackathon demo · Solana devnet · test money only</p>

      {!formInView && <a href="#new" className="btn primary fab">New challenge</a>}

      {!me && (
        <NameGate
          onJoin={(n) => {
            join(n);
            speak(`Welcome to Lock and Run, ${n}! Let's get running.`);
          }}
        />
      )}
    </main>
  );
}

function ChallengeCard({ c, now, meAddr }: { c: Challenge; now: number; meAddr?: string }) {
  const live = c.status === "active" && c.endsAt > now;
  const finishers = c.participants.filter((p) => countedRuns(p) >= c.runsRequired).length;
  const joined = c.participants.some((p) => p.address === meAddr);
  return (
    <Link href={`/c/${c.id}`} className={`ccard ${joined ? "mine" : ""}`}>
      <div className="pot">
        <div className="pot-amt">{money(c.deposit * c.participants.length)}</div>
        <div className="pot-label">pot</div>
      </div>
      <div>
        <div className="ctitle">{c.title}</div>
        <div className="meta">
          <span>{c.goalKm} km × {c.runsRequired}</span>
          <span>{money(c.deposit)} to join</span>
          <span>{c.participants.length} in · {finishers} finished</span>
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          <span className={`status ${live ? "st-open" : c.status === "settled" ? "st-done" : "st-claimed"}`}>
            {live ? timeLeft(c.endsAt, now) : c.status === "settled" ? "Paid out" : "Ended · ready to pay out"}
          </span>
          {joined && <span className="status st-claimed">You&apos;re in</span>}
        </div>
      </div>
    </Link>
  );
}
