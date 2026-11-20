"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import NameGate from "@/components/NameGate";
import AdSlot from "@/components/AdSlot";
import { Challenge } from "@/lib/config";
import { dayKey, resetIn, weekDays, weeklyRanking } from "@/lib/streaks";
import { useMe, useNow } from "@/lib/client";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** Streaks + weekly ranking: who ran the most (counted) km this week. */
export default function RankingPage() {
  const { me, ready, join } = useMe();
  const now = useNow(30_000);
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);

  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const d = await (await fetch("/api/challenges", { cache: "no-store" })).json();
        setChallenges(d.challenges || []);
      } catch {}
      if (!stop) t = setTimeout(load, 10_000);
    }
    load();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, []);

  const ranking = useMemo(() => weeklyRanking(challenges || [], now), [challenges, now]);
  const myIndex = me ? ranking.findIndex((r) => r.address === me.address) : -1;
  const mine = myIndex >= 0 ? ranking[myIndex] : null;
  const week = weekDays(now);
  const today = dayKey(now);
  const ranTodayAlready = !!mine?.days.has(today);
  const active = ranking.filter((r) => r.weekKm > 0);

  if (!ready) return null;

  return (
    <AppShell>
      <main className="wrap">
        <section className="hero">
          <h1>
            Ranking<br />
            <span className="hl">Keep the streak alive.</span>
          </h1>
          <p className="lede">Every counted run adds to your weekly km and your daily streak. The ranking resets every Monday.</p>
        </section>

        <div className="streak-card">
          <div className="streak-main">
            <span className={`streak-flame ${mine && mine.streak > 0 ? "on" : ""}`} aria-hidden>🔥</span>
            <div>
              <div className="streak-num">{mine?.streak || 0}<span>{(mine?.streak || 0) === 1 ? "day" : "days"} in a row</span></div>
              <div className="small streak-sub">
                {!mine || mine.streak === 0
                  ? "Log a counted run today to start one."
                  : ranTodayAlready
                    ? "You ran today. See you tomorrow!"
                    : "Run today to keep it going."}
              </div>
            </div>
          </div>
          <div className="week-dots" aria-label="This week">
            {week.map((k, i) => {
              const done = !!mine?.days.has(k);
              const isToday = k === today;
              const future = k > today;
              return (
                <div key={k} className={`wd ${done ? "done" : ""} ${isToday ? "today" : ""} ${future ? "future" : ""}`}>
                  <span className="wd-dot">{done ? "✓" : ""}</span>
                  <span className="wd-lbl">{DAY_LABELS[i]}</span>
                </div>
              );
            })}
          </div>
          <div className="streak-stats">
            <div><b>{mine ? `#${myIndex + 1}` : "—"}</b><span>This week</span></div>
            <div><b>{mine?.weekKm ?? 0} km</b><span>{mine?.weekRuns ?? 0} runs</span></div>
            <div><b>{mine?.bestStreak ?? 0}</b><span>Best streak</span></div>
          </div>
        </div>

        <div className="layout">
          <section>
            <div className="rank-head">
              <h2 style={{ margin: 0 }}>This week</h2>
              <span className="muted small">Resets in {resetIn(now)}</span>
            </div>
            {challenges === null ? (
              <div className="empty">Loading…</div>
            ) : active.length === 0 ? (
              <div className="empty">
                No counted runs yet this week. <Link href="/">Join a challenge</Link> and be #1.
              </div>
            ) : (
              <div className="rank-list">
                {active.map((r, i) => (
                  <div key={r.address} className={`rank-row ${me?.address === r.address ? "mine" : ""}`}>
                    <span className={`rank-pos p${i + 1}`}>{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
                    <span className="avatar">{r.name.charAt(0).toUpperCase()}</span>
                    <div className="rank-who">
                      <b>{r.name}{me?.address === r.address ? " (you)" : ""}</b>
                      <span className="muted small">
                        {r.weekRuns} run{r.weekRuns === 1 ? "" : "s"}
                        {r.streak > 0 && <> · <span className="rank-streak">🔥 {r.streak}</span></>}
                      </span>
                    </div>
                    <div className="rank-km">
                      <b>{r.weekKm}</b>
                      <span className="muted small">km</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="card">
            <h2>Longest streaks</h2>
            {ranking.filter((r) => r.streak > 0).length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nobody has a streak going yet. Be the first.</p>
            ) : (
              <div className="streak-list">
                {[...ranking]
                  .filter((r) => r.streak > 0)
                  .sort((a, b) => b.streak - a.streak || b.weekKm - a.weekKm)
                  .slice(0, 5)
                  .map((r) => (
                    <div key={r.address} className="streak-row">
                      <span>{r.name}{me?.address === r.address ? " (you)" : ""}</span>
                      <b>🔥 {r.streak} day{r.streak === 1 ? "" : "s"}</b>
                    </div>
                  ))}
              </div>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Only runs that count toward a challenge (distance met, real running pace, with a photo check-in or a Strava run) are ranked.
            </p>
          </aside>
        </div>

        <div style={{ marginTop: "1.5rem" }}>
          <AdSlot />
        </div>
        {!me && <NameGate onJoin={(n) => join(n)} />}
      </main>
    </AppShell>
  );
}
