"use client";
import type { Challenge } from "@/lib/config";
import { countedRuns, roomDay, runStatus } from "@/lib/config";
import { timeLeft, useMe } from "@/lib/client";
import { newDayTime } from "@/lib/ui";

/**
 * "Today" status for a runner in a live challenge: did I check in today, how far along am I,
 * how long is left, and the one action to take. Sits right under the title so it's on the
 * first screen of a phone.
 */
export default function TodayBar({ c, now }: { c: Challenge; now: number }) {
  const { me } = useMe();
  const mine = c.participants.find((p) => p.address === me?.address);
  const live = c.status === "active" && now < c.endsAt;
  if (!live || !mine) return null;

  const tz = c.timeZone || "UTC";
  const today = roomDay(now, tz);
  const todays = mine.runs.filter((r) => (r.roomDay || roomDay(r.at, tz)) === today && runStatus(r) !== "rejected");
  const state = todays.some((r) => runStatus(r) === "approved") ? "done" : todays.length ? "review" : "todo";
  const done = Math.min(countedRuns(mine), c.runsRequired);
  const pct = Math.round((done / c.runsRequired) * 100);
  const justJoined = now - mine.joinedAt < 90_000 && mine.runs.length === 0;

  const goToCheckIn = () => document.getElementById("checkin")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section className={`today today-${state}`} aria-label="Today">
      <div className="today-top">
        <span className="today-icon" aria-hidden>{state === "done" ? "✓" : state === "review" ? "…" : "🏃"}</span>
        <div className="today-text">
          <b>
            {justJoined
              ? "You're in! First check-in today"
              : state === "done"
                ? "Checked in today"
                : state === "review"
                  ? "Today's check-in is in review"
                  : `Not checked in today`}
          </b>
          <span className="small">
            {state === "done" ? `Next check-in opens at ${newDayTime(tz, now)}` : `Run ${c.goalKm} km before ${newDayTime(tz, now)}`} · {timeLeft(c.endsAt, now)}
          </span>
        </div>
        {state === "todo" && (
          <button className="btn primary today-go" onClick={goToCheckIn}>
            Check in
          </button>
        )}
      </div>
      <div className="today-progress">
        <div
          className="bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={c.runsRequired}
          aria-valuenow={done}
          aria-label={`${done} of ${c.runsRequired} days done`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="small today-count">
          <b>{done}/{c.runsRequired}</b> days · {pct}%
        </span>
      </div>
    </section>
  );
}
