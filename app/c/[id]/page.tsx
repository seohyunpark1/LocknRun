"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import NameGate from "@/components/NameGate";
import AppShell from "@/components/AppShell";
import Money from "@/components/Money";
import { newDayLabel, photoFallback } from "@/lib/ui";
import TodayBar from "@/components/TodayBar";
import CheerFeed from "@/components/CheerFeed";
import RunTracker from "@/components/RunTracker";
import SponsorBox from "@/components/SponsorBox";
import AdSlot from "@/components/AdSlot";
import { SponsorMark } from "@/components/Logos";
import StravaImport from "@/components/StravaImport";
import { isMobileDevice } from "@/lib/device";
import { Challenge, Run, rewardModeOf, bonusOf, countedRuns, explorerTx, isFinisher, money, pace, potOf, runStatus } from "@/lib/config";
import { PLATFORM_FEE_RATE, computePayouts } from "@/lib/settle";
import { openConnect, timeLeft, useMe, useNow } from "@/lib/client";

export default function ChallengePage() {
  const { id } = useParams<{ id: string }>();
  const { me, ready, join, deposit: lockWalletDeposit } = useMe();
  const now = useNow();
  const [c, setC] = useState<Challenge | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [phone, setPhone] = useState(false);
  const [invite, setInvite] = useState("");
  useEffect(() => setInvite(new URLSearchParams(window.location.search).get("invite") || ""), []);
  useEffect(() => setPhone(isMobileDevice()), []);
  const [viewRun, setViewRun] = useState<{ run: Run; name: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/challenges/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`, { cache: "no-store" });
    if (r.status === 404) return setNotFound(true);
    const d = await r.json();
    if (d.challenge) setC(d.challenge);
  }, [id, invite]);

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
        body: JSON.stringify({ action, name: me.name, address: me.address, invite }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Something went wrong");
      const confirmed = action === "join" ? await lockWalletDeposit(d) : d;
      setC(confirmed.challenge);
      if (action === "settle") window.dispatchEvent(new Event("lockrun:refresh")); // shows the Congratulations pop-up right away
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  async function startRun() {
    const r = await fetch(`/api/challenges/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not start the run");
    return d.sessionId as string;
  }

  async function saveRun(km: number, sec: number, photo: string, sessionId: string) {
    const r = await fetch(`/api/challenges/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run", km, sec, photo, sessionId }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Could not submit the check-in");
    setC(d.challenge);
    return { status: runStatus(d.run), reason: d.reason as string | undefined };
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
          {c.visibility === "private" && <span className="status st-claimed" style={{ marginLeft: 8 }}>Private · invite only</span>}
          <h1 style={{ marginTop: 10 }}>{c.title}</h1>
          <p className="lede">
            Run <b>{c.goalKm} km</b>, <b>{c.runsRequired} time{c.runsRequired > 1 ? "s" : ""}</b> before the clock runs out.
            Stake <b>{money(c.deposit)}</b>. Finish and share the pool
            {bonus > 0 ? <>, which includes a <b>{money(bonus)} sponsor bonus</b></> : null}.
            One run counts per day; {newDayLabel(c.timeZone, now)}.
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
        <TodayBar c={c} now={now} />
        <div className="potbox">
          <div className="pot-amt"><Money n={pot} /></div>
          <div className="pot-label">in the pot · {c.participants.length} runner{c.participants.length > 1 ? "s" : ""}</div>
          <button
            className="btn ghost"
            onClick={() => {
              const link = window.location.href.split("?")[0] + (c.inviteCode ? `?invite=${c.inviteCode}` : "");
              navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Link copied" : c.visibility === "private" ? "Copy private invite link" : "Copy invite link"}
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
                Stake {money(c.deposit)}. Finish {c.runsRequired}× {c.goalKm} km, one run a day, to get it back{c.participants.length > 0 || bonus > 0 ? " plus your share of the pool" : ""}.
              </p>
              <details className="more">
                <summary>How rewards work</summary>
                <p className="muted small">
                  One check-in counts per day, and {newDayLabel(c.timeZone, now)}.
                  {rewardModeOf(c) === "fraction"
                    ? " Finish 100% to get your stake back plus a prize from what others don't get back. Finish at least 85% to keep your whole stake; less gets back the share you finished."
                    : " If you finish, you get your stake back plus a share of the stakes of anyone who doesn't. If no one finishes, every stake is refunded."}
                  {bonus > 0 ? ` The ${money(bonus)} sponsor bonus is shared among finishers.` : ""}
                </p>
              </details>
              <button className="btn primary block" disabled={!!busy} onClick={() => (me ? act("join") : openConnect())}>
                {busy === "join" ? "Locking your stake…" : me ? `Join & lock ${money(c.deposit)}` : `Connect wallet to join`}
              </button>
            </div>
          )}

          {live && mine && (
            <div className="card" id="checkin" style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h2>Daily check-in</h2>
                <span className="muted small">
                  {Math.min(countedRuns(mine), c.runsRequired)}/{c.runsRequired} days · {Math.round((Math.min(countedRuns(mine), c.runsRequired) / c.runsRequired) * 100)}%
                </span>
              </div>
              {phone ? (
                <>
                  <RunTracker goalKm={c.goalKm} onStart={startRun} onFinish={saveRun} />
                  <StravaImport challengeId={c.id} address={me!.address} onImported={(d) => setC(d.challenge as Challenge)} />
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Check-ins are only accepted from your phone, so we can use its location and live camera. Open this page on your phone to check in.
                </p>
              )}
            </div>
          )}

          {!live && c.status !== "settled" && (
            <div className="card" style={{ marginBottom: "1.25rem" }}>
              <h2>Time&apos;s up! Ready to pay out</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {payouts.filter((p) => p.finisher).length} of {c.participants.length} finished. Anyone can trigger the payout;
                the rules decide who gets what.
              </p>
              <button className="btn primary block" disabled={!!busy} onClick={() => act("settle")}>
                {busy === "settle" ? "Paying out on Solana…" : "Pay out rewards"}
              </button>
            </div>
          )}

          <CheerFeed c={c} />
          <h2>Leaderboard</h2>
          <div className="list board">
            <div className="lb lb-head" aria-hidden>
              <span className="lb-rank" />
              <span className="lb-name">Runner</span>
              <span className="lb-prog">Progress</span>
              <span className="lb-pace">Best pace</span>
              <span className="lb-rcpt">Receipts</span>
              <span className="lb-pay">{live ? "If it ended now" : "Payout"}</span>
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
                      <a href={explorerTx(p.joinSig)} target="_blank" rel="noreferrer" title="Stake receipt on Solana">receipt ↗</a>
                      {p.paySig && (
                        <a href={explorerTx(p.paySig)} target="_blank" rel="noreferrer">payout ↗</a>
                      )}
                    </span>
                  </div>
                  <div className="payout lb-pay">
                    {c.status === "settled" ? (
                      <b className={(p.payout || 0) > c.deposit ? "win" : (p.payout || 0) >= c.deposit ? "" : "lose"}>
                        {(p.payout || 0) > c.deposit ? <Money sign="+" n={p.payout || 0} /> : (p.payout || 0) >= c.deposit ? <><Money n={c.deposit} /> back</> : <Money sign="-" n={Math.round((c.deposit - (p.payout || 0)) * 100) / 100} />}
                      </b>
                    ) : (
                      <span className="muted small">{po ? `${Math.round(po.rate * 100)}% · ${money(po.amount)}` : "—"}</span>
                    )}
                  </div>
                  {p.runs.length > 0 && (
                    <div className="proofs lb-proofs">
                      {p.runs.slice(-6).reverse().map((r) => (
                        <button key={r.id} className={`proof-chip ${r.counts ? "" : "nope"}`} onClick={() => setViewRun({ run: r, name: p.name })} title={`Check-in: ${runStatus(r)}`}>
                          {r.photo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={me?.address || "guest"} src={`/api/photos/${r.id}`} alt="" loading="lazy" onError={photoFallback} />
                          )}
                          <span>{r.km} km{runStatus(r) === "pending" ? " · review" : ""}</span>
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
          {rewardModeOf(c) === "fraction" ? (
            <>
          <h2>Rewards</h2>
          <p className="small" style={{ lineHeight: 1.5, marginTop: 0 }}>
            Everyone stakes <b>{money(c.deposit)}</b>. What you get back depends on how many of your {c.runsRequired} check-ins you complete:
          </p>
          <div className="tiers">
            <div className="tier-row full">
              <span className="tier-pill tier-full">100%</span>
              <div>
                <b>Stake back + prize</b>
                <div className="muted small">
                  {prizeNow > 0 ? `${c.status === "settled" ? "Prize paid" : "Prize right now"}: +${money(prizeNow)} each` : c.status === "settled" ? "Nobody hit 100%, so everyone got their stake back" : "Prize grows as others miss runs or sponsors join"}
                </div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-safe">85–99%</span>
              <div>
                <b>Full stake back</b>
                <div className="muted small">No prize, no loss</div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-partial">&lt;85%</span>
              <div>
                <b>Part of your stake back</b>
                <div className="muted small">Same % as you finish</div>
              </div>
            </div>
          </div>
          <details className="more">
            <summary>Where the prize comes from</summary>
            <p className="muted small">
              The prize pool is what others don&apos;t get back plus any sponsor bonus, split among everyone at 100%. If nobody
              reaches 100%, everyone is refunded and sponsors get their bonus back.
            </p>
          </details>
            </>
          ) : (
            <>
          <h2>Rewards</h2>
          <p className="small" style={{ lineHeight: 1.5, marginTop: 0 }}>
            Everyone stakes <b>{money(c.deposit)}</b>. To finish, get {c.runsRequired} approved check-in{c.runsRequired > 1 ? "s" : ""} of {c.goalKm} km, one per day.
          </p>
          <div className="tiers">
            <div className="tier-row full">
              <span className="tier-pill tier-full">All finish</span>
              <div>
                <b>Everyone gets their stake back</b>
                <div className="muted small">{bonus > 0 ? `Plus the ${money(bonus)} sponsor bonus, shared equally` : "Plus any sponsor bonus"}</div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-safe">Some finish</span>
              <div>
                <b>Finishers split the pool</b>
                <div className="muted small">
                  {prizeNow > 0 ? `Right now: +${money(prizeNow)} each on top of your stake` : "Stakes of those who don't finish are shared among finishers"}
                </div>
              </div>
            </div>
            <div className="tier-row">
              <span className="tier-pill tier-partial">None finish</span>
              <div>
                <b>Every stake is refunded</b>
                <div className="muted small">Sponsors get their bonus back</div>
              </div>
            </div>
          </div>
          <details className="more">
            <summary>Fees</summary>
            <p className="muted small">
              A {Math.round(PLATFORM_FEE_RATE * 100)}% fee is taken from the stakes of runners who don&apos;t finish. Nothing is taken when everyone finishes or no one does.
              Runners who don&apos;t finish lose their stake.
            </p>
          </details>
            </>
          )}
          {mine && myProjected && c.status !== "settled" && (
            <div className="result ok" style={{ marginTop: 10 }}>
              {Math.min(countedRuns(mine), c.runsRequired)}/{c.runsRequired} days done. If it ended now you&apos;d get <b>{money(myProjected.amount)}</b>
              {myProjected.finisher ? "" : `. Complete all ${c.runsRequired} to ${rewardModeOf(c) === "fraction" ? "earn the prize" : "finish"}!`}
            </div>
          )}
          <details className="more">
            <summary>What counts as a check-in</summary>
            <p className="muted small">
            A check-in is approved when your run reaches {c.goalKm} km at a running pace and comes with your live photo (or is imported from Strava). Very fast runs go to
            review; they hold that day&apos;s slot until decided. Every check-in is stamped on Solana.
            </p>
          </details>
        </aside>
        <SponsorBox c={c} live={live} onUpdated={setC} invite={invite} />
        <AdSlot variant="card" />
        </div>
      </div>

      <p className="foot">Built on Solana</p>

      {!me && (
        <NameGate
          onJoin={async (n, wallet) => {
            await join(n, wallet);
          }}
        />
      )}
      {viewRun && (
        <div className="modal" onClick={() => setViewRun(null)}>
          <div className="card viewer" onClick={(e) => e.stopPropagation()}>
            {viewRun.run.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/photos/${viewRun.run.id}`} alt={`${viewRun.name}'s run photo`} onError={photoFallback} />
            )}
            <h2 style={{ margin: "0.9rem 0 0.25rem" }}>
              {viewRun.name} · {viewRun.run.km} km in {Math.floor(viewRun.run.sec / 60)}:{String(viewRun.run.sec % 60).padStart(2, "0")}
            </h2>
            <div className="meta">
              <span>{pace(viewRun.run.sec / viewRun.run.km)}/km</span>
              <span>{viewRun.run.source === "strava" ? `Strava: ${viewRun.run.stravaName || "run"}` : "Phone-recorded + photo"}</span>
              <span className={viewRun.run.counts ? "" : "nope-text"}>{{ approved: "Approved", pending: "Under review", rejected: "Rejected" }[runStatus(viewRun.run)]}</span>
            </div>
            <div className="meta" style={{ marginTop: "0.5rem" }}>
              {viewRun.run.stravaId && (
                <a href={`https://www.strava.com/activities/${viewRun.run.stravaId}`} target="_blank" rel="noreferrer">View on Strava ↗</a>
              )}
              {viewRun.run.reason && <span>{viewRun.run.reason}</span>}
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
