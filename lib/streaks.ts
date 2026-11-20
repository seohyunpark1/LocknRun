// Streaks and the weekly ranking, computed from every challenge's counted runs.
// Only runs that count (distance met, human pace, with proof) are used, so nobody can pad the ranking.
import { Challenge } from "./config";

const DAY = 86_400_000;

/** Local calendar day, e.g. "2026-11-20". */
export function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday 00:00 (local time) of the week that contains `ts`. */
export function weekStart(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return d.getTime();
}

/** The 7 days (Mon..Sun) of this week as day keys. */
export function weekDays(now: number) {
  const start = weekStart(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return dayKey(d.getTime());
  });
}

/** Current streak (still alive if you ran today or yesterday) and best-ever streak, in days. */
export function streakOf(days: Set<string>, now: number) {
  let current = 0;
  let t = now;
  if (!days.has(dayKey(t))) t -= DAY; // haven't run yet today: the streak is still alive
  while (days.has(dayKey(t))) {
    current++;
    t -= DAY;
  }
  let best = 0;
  let run = 0;
  let prev = "";
  for (const k of Array.from(days).sort()) {
    const d = new Date(k + "T12:00:00");
    d.setDate(d.getDate() - 1);
    run = prev && prev === dayKey(d.getTime()) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current, best: Math.max(best, current) };
}

export type RunnerStats = {
  address: string;
  name: string;
  weekKm: number;
  weekRuns: number;
  totalKm: number;
  days: Set<string>; // days with at least one counted run
  streak: number;
  bestStreak: number;
};

/** Every runner's stats, ranked by km this week (then runs, then streak). */
export function weeklyRanking(challenges: Challenge[], now: number): RunnerStats[] {
  const start = weekStart(now);
  const by = new Map<string, RunnerStats & { lastSeen: number }>();
  for (const c of challenges) {
    for (const p of c.participants) {
      const s =
        by.get(p.address) ||
        { address: p.address, name: p.name, weekKm: 0, weekRuns: 0, totalKm: 0, days: new Set<string>(), streak: 0, bestStreak: 0, lastSeen: 0 };
      if (p.joinedAt >= s.lastSeen) {
        s.name = p.name; // latest name they used
        s.lastSeen = p.joinedAt;
      }
      for (const r of p.runs) {
        if (!r.counts) continue;
        s.totalKm += r.km;
        s.days.add(dayKey(r.at));
        if (r.at >= start && r.at <= now) {
          s.weekKm += r.km;
          s.weekRuns++;
        }
      }
      by.set(p.address, s);
    }
  }
  return Array.from(by.values())
    .map((s) => {
      const { current, best } = streakOf(s.days, now);
      return { ...s, weekKm: Math.round(s.weekKm * 10) / 10, totalKm: Math.round(s.totalKm * 10) / 10, streak: current, bestStreak: best };
    })
    .sort((a, b) => b.weekKm - a.weekKm || b.weekRuns - a.weekRuns || b.streak - a.streak);
}

/** Days left until the weekly ranking resets (Monday 00:00). */
export function resetIn(now: number) {
  const next = weekStart(now) + 7 * DAY;
  const h = Math.max(0, Math.round((next - now) / 3_600_000));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
}
