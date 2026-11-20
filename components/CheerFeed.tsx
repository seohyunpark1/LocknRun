"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Challenge } from "@/lib/config";
import { runStatus } from "@/lib/config";
import { openConnect, useMe } from "@/lib/client";
import { photoFallback } from "@/lib/ui";

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
const time = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Check-in feed (Challengers-style): everyone's recent check-ins with a 👏 cheer button. */
export default function CheerFeed({ c }: { c: Challenge }) {
  const { me } = useMe();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch(`/api/cheers?challenge=${c.id}`, { cache: "no-store" })).json();
      setCounts(d.counts || {});
      setMine(d.mine || []);
    } catch {}
  }, [c.id]);
  useEffect(() => {
    load();
  }, [load, me?.address]);

  const items = useMemo(
    () =>
      c.participants
        .flatMap((p) => p.runs.filter((r) => runStatus(r) !== "rejected").map((r) => ({ p, r })))
        .sort((a, b) => b.r.at - a.r.at),
    [c]
  );
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, 4);

  async function cheer(runId: string) {
    if (!me) return openConnect();
    setErr("");
    const on = !mine.includes(runId);
    setMine((m) => (on ? [...m, runId] : m.filter((x) => x !== runId))); // optimistic
    setCounts((k) => ({ ...k, [runId]: Math.max(0, (k[runId] || 0) + (on ? 1 : -1)) }));
    try {
      const r = await fetch("/api/cheers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: c.id, runId }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't cheer");
      setCounts((k) => ({ ...k, [runId]: d.count }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't cheer");
      load();
    }
  }

  return (
    <section className="feed" aria-label="Check-in feed">
      <div className="feed-head">
        <h2 style={{ margin: 0 }}>Check-in feed</h2>
        <span className="muted small">{items.length} check-in{items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="feed-list">
        {shown.map(({ p, r }) => {
          const own = me?.address === p.address;
          const on = mine.includes(r.id);
          const n = counts[r.id] || 0;
          const pending = runStatus(r) === "pending";
          return (
            <article key={r.id} className={`feed-item ${own ? "own" : ""}`}>
              {r.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={me?.address || "guest"} className="feed-photo" src={`/api/photos/${r.id}`} alt="" loading="lazy" onError={photoFallback} />
              ) : (
                <span className="feed-photo feed-photo-none" aria-hidden>🏃</span>
              )}
              <div className="feed-body">
                <div className="feed-who">
                  <b>{p.name}{own ? " (you)" : ""}</b>
                  <span className="muted small">{ago(r.at)}</span>
                </div>
                <div className="feed-stats">
                  <span><b>{r.km}</b> km</span>
                  <span>{time(r.sec)}</span>
                  {r.source === "strava" && <span className="feed-tag">Strava</span>}
                  {pending && <span className="feed-tag review">In review</span>}
                </div>
              </div>
              <button
                className={`cheer ${on ? "on" : ""}`}
                onClick={() => cheer(r.id)}
                disabled={own}
                aria-pressed={on}
                aria-label={own ? `${n} cheers` : on ? "Remove your cheer" : `Cheer ${p.name}`}
                title={own ? "Cheers from other runners" : on ? "You cheered" : "Cheer"}
              >
                <span aria-hidden>👏</span>
                {n > 0 && <span className="cheer-n">{n}</span>}
              </button>
            </article>
          );
        })}
      </div>
      {items.length > 4 && (
        <button className="btn ghost block feed-more" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show all ${items.length} check-ins`}
        </button>
      )}
      {err && <p className="err">{err}</p>}
    </section>
  );
}
