"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NameGate from "@/components/NameGate";
import Dial from "@/components/Dial";
import AdSlot from "@/components/AdSlot";
import TypeValue from "@/components/TypeValue";
import AppShell from "@/components/AppShell";
import { PartnerLogo, SponsorMark } from "@/components/Logos";
import { Challenge, DEPOSITS, DURATION_UNITS, GOAL_KMS, RUNS_REQUIRED, PARTNERS, RANGES, partnerLogoSources, bonusOf, countedRuns, durationLabel, money, potOf } from "@/lib/config";
import { speak, timeLeft, useMe, useNow } from "@/lib/client";

type Data = { challenges: Challenge[]; escrow: { address: string | null; balance: number | null } };

export default function Home() {
  const router = useRouter();
  const { me, ready, join, deposit: lockWalletDeposit } = useMe();
  const now = useNow();
  const [data, setData] = useState<Data>({ challenges: [], escrow: { address: null, balance: null } });

  const [title, setTitle] = useState("");
  const [goalKm, setGoalKm] = useState(3);
  const [runsRequired, setRuns] = useState(2);
  const [deposit, setDeposit] = useState(10);
  const [durUnit, setDurUnit] = useState(0); // index into DURATION_UNITS (0 = Min)
  const [durValue, setDurValue] = useState(15);
  const unit = DURATION_UNITS[durUnit];
  const minutes = durValue * unit.minutes;
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
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
      const confirmed = await lockWalletDeposit(d);
      router.push(`/c/${confirmed.challenge.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setCreating(false);
    }
  }

  if (!ready) return null;
  // Sponsored challenges are listed first.
  const active = data.challenges
    .filter((c) => c.status === "active" && c.endsAt > now)
    .sort((a, b) => bonusOf(b) - bonusOf(a));
  const ended = data.challenges.filter((c) => !(c.status === "active" && c.endsAt > now));
  const locked = data.challenges.filter((c) => c.status !== "settled").reduce((s, c) => s + potOf(c), 0);

  const runners = new Set(active.flatMap((c) => c.participants.map((p) => p.address))).size;

  return (
    <AppShell>
    <main className="wrap">
      <section className="hero hero-split">
        <div>
          <h1>
            Bet on your own run.<br /><span className="hl">Finish, and get paid.</span>
          </h1>
          <p className="lede">
            Put money on your running goal with friends. Hit 100% and get your deposit back <b>plus</b> prize money from
            the runners who didn&apos;t. Your wallet signs a test USDC deposit into server-managed escrow on Solana.
          </p>
        </div>
        <aside className="app-sponsors" aria-label="Partners">
          <div className="muted small">Partners</div>
          <div className="partner-grid">
            {PARTNERS.map((pt) => (
              <a key={pt.name} className="partner-tile" href={pt.url} target="_blank" rel="noreferrer noopener" title={pt.role}>
                <PartnerLogo src={partnerLogoSources(pt)} name={pt.name} className="partner-tile-logo" />
                <b>{pt.name}</b>
              </a>
            ))}
          </div>
          <a className="small app-sponsor-cta" href="#live">Want your brand here? Pick a challenge to sponsor →</a>
        </aside>
      </section>

      <div className="stats">
        <div className="stat-tile">
          <div className="muted small">On the line</div>
          <div className="stat-num">{money(data.escrow.balance ?? locked)}</div>
        </div>
        <div className="stat-tile">
          <div className="muted small">Live</div>
          <div className="stat-num">{active.length}</div>
        </div>
        <div className="stat-tile">
          <div className="muted small">Runners in</div>
          <div className="stat-num">{runners}</div>
        </div>
      </div>

      <AdSlot />

      <div className="layout">
        <section>
          <h2 id="live" style={{ scrollMarginTop: "5rem" }}>Live challenges</h2>
          {active.length === 0 && <div className="empty">No live challenges yet.</div>}
          <div className="list cards">
            {active.map((c) => (
              <ChallengeCard key={c.id} c={c} now={now} meAddr={me?.address} />
            ))}
          </div>
          {ended.length > 0 && (
            <>
              <h2 style={{ marginTop: "1.75rem" }}>Finished</h2>
              <div className="list cards">
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
          <Dial label="Distance per run" options={GOAL_KMS} value={goalKm} onChange={setGoalKm} format={(v) => `${v} km`}
            typeable={{ ...RANGES.goalKm, suffix: () => "km" }} />
          <Dial label="Runs to finish" options={RUNS_REQUIRED} value={runsRequired} onChange={setRuns} format={(v) => `${v} run${v > 1 ? "s" : ""}`}
            typeable={{ ...RANGES.runs, suffix: (v) => (v === 1 ? "run" : "runs") }} />
          <Dial label="Deposit · test USDC" options={DEPOSITS} value={deposit} onChange={setDeposit} format={(v) => `$${v}`} tick={(v) => `$${v}`}
            typeable={{ ...RANGES.deposit, prefix: "$" }} />
          <div className="dial">
            <div className="dial-head">
              <span>Ends in</span>
              <TypeValue
                label={`Ends in (${unit.word}s)`}
                value={durValue}
                min={unit.min}
                max={unit.max}
                suffix={unit.key === "min" ? "min" : `${unit.word}${durValue === 1 ? "" : "s"}`}
                onCommit={setDurValue}
              />
            </div>
            <div className="chips unit-chips">
              {DURATION_UNITS.map((u, i) => (
                <button
                  key={u.key}
                  className={`chip ${i === durUnit ? "on" : ""}`}
                  onClick={() => {
                    setDurUnit(i);
                    setDurValue(u.key === "min" ? 15 : u.values[0]);
                  }}
                >
                  {u.label}
                </button>
              ))}
            </div>
          </div>
          <Dial
            key={unit.key}
            label={`Number of ${unit.label.toLowerCase()}${unit.key === "min" ? "utes" : "s"}`}
            options={unit.values}
            value={durValue}
            onChange={setDurValue}
            format={() => durationLabel(minutes)}
            hideHead
          />
          <button className="btn primary block" style={{ marginTop: "1.25rem" }} disabled={creating} onClick={create}>
            {creating ? "Locking your deposit…" : `Create & lock ${money(deposit)}`}
          </button>
          <p className="muted small" style={{ textAlign: "center", margin: "8px 0 0" }}>
            Test USDC from your connected wallet. Small devnet SOL balance required for fees. Use 15 min for demos.
          </p>
          {err && <p className="err">{err}</p>}
        </aside>
      </div>
      <section className="steps" id="how">
        <div className="step"><b>1 · Join &amp; lock</b>Pick a goal like 3 km × 2 runs. Your 10 test USDC is locked in escrow.</div>
        <div className="step"><b>2 · Run and prove it</b>GPS and a voice coach track every km. Add a photo or a Strava run as proof.</div>
        <div className="step"><b>3 · Get rewarded</b>100% = deposit + prize. 85%+ = deposit back. Less = the % you finished.</div>
      </section>

      <section className="partners" aria-label="Powered by">
        <div className="muted small">Powered by</div>
        <div className="partner-row">
          {PARTNERS.map((pt) => (
            <div className="partner" key={pt.name}>
              <PartnerLogo src={partnerLogoSources(pt)} name={pt.name} />
              <b>{pt.name}</b>
              <span>{pt.role}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="foot">Hackathon demo · Solana devnet · test money only</p>

      {!me && (
        <NameGate
          onJoin={async (n, wallet) => {
            await join(n, wallet);
            speak(`Welcome to Lock and Run, ${n}! Let's get running.`);
          }}
        />
      )}
    </main>
    </AppShell>
  );
}

function ChallengeCard({ c, now, meAddr }: { c: Challenge; now: number; meAddr?: string }) {
  const live = c.status === "active" && c.endsAt > now;
  const finishers = c.participants.filter((p) => countedRuns(p) >= c.runsRequired).length;
  const joined = c.participants.some((p) => p.address === meAddr);
  return (
    <Link href={`/c/${c.id}`} className={`ccard ${joined ? "mine" : ""} ${bonusOf(c) > 0 ? "sponsored" : ""}`}>
      <div className="pot">
        <div className="pot-amt">{money(potOf(c))}</div>
        <div className="pot-label">pot</div>
      </div>
      <div>
        {bonusOf(c) > 0 && (
          <div className="sponsor-badge">
            {c.sponsors!.map((s, i) => (
              <SponsorMark key={i} c={c} index={i} s={s} size="sm" />
            ))}
            +{money(bonusOf(c))} bonus · Sponsored by {c.sponsors!.map((x) => x.name).join(", ")}
          </div>
        )}
        <div className="ctitle">{c.title}</div>
        <div className="meta">
          <span>{c.goalKm} km × {c.runsRequired}</span>
          <span>{money(c.deposit)} to join</span>
          <span>{c.participants.length} in · {finishers} finished</span>
        </div>
        <div className="meta" style={{ marginTop: "0.4rem" }}>
          <span className={`status ${live ? "st-open" : c.status === "settled" ? "st-done" : "st-claimed"}`}>
            {live ? timeLeft(c.endsAt, now) : c.status === "settled" ? "Paid out" : "Ended · ready to pay out"}
          </span>
          {joined && <span className="status st-claimed">You&apos;re in</span>}
        </div>
      </div>
    </Link>
  );
}
