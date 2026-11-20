"use client";
import { useCallback, useEffect, useState } from "react";
import { pace } from "@/lib/config";
import { speak } from "@/lib/client";

type StravaRun = { id: number; name: string; km: number; sec: number; startedAt: number; used: boolean };
type Props = { challengeId: string; address: string; onImported: (data: { challenge: unknown; run: { counts: boolean }; reason?: string }) => void };

/** Lets a runner connect Strava and use a run they recorded there. The server verifies it with Strava. */
export default function StravaImport({ challengeId, address, onImported }: Props) {
  const [status, setStatus] = useState<{ enabled: boolean; athlete: string | null } | null>(null);
  const [runs, setRuns] = useState<StravaRun[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const loadRuns = useCallback(async () => {
    const r = await fetch(`/api/strava/runs?address=${address}&challenge=${challengeId}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || "Couldn't load your Strava runs.");
    setRuns(d.runs || []);
  }, [address, challengeId]);

  useEffect(() => {
    fetch(`/api/strava/status?address=${address}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        setStatus(s);
        if (s.athlete) loadRuns();
      })
      .catch(() => setStatus({ enabled: false, athlete: null }));
    const q = new URLSearchParams(window.location.search).get("strava");
    if (q === "failed") setMsg("Strava sign-in didn't work. Try again.");
  }, [address, loadRuns]);

  async function use(run: StravaRun) {
    setBusy(run.id);
    setMsg("");
    try {
      const r = await fetch(`/api/challenges/${challengeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "strava", address, activityId: run.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't import that run.");
      onImported(d);
      speak(d.run.counts ? `Strava run added! ${run.km} kilometers. That one counts.` : `Run added, but it doesn't count. ${d.reason || ""}`);
      loadRuns();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!status?.enabled) return null; // Strava not configured on this server

  const back = encodeURIComponent(window.location.pathname + window.location.search.replace(/[?&]strava=[^&]*/, ""));

  return (
    <div className="strava">
      <div className="strava-head">
        <span className="strava-mark" aria-hidden />
        <b>Strava</b>
        {status.athlete && <span className="muted small">· {status.athlete}</span>}
      </div>
      {!status.athlete ? (
        <>
          <p className="muted small" style={{ margin: "0.25rem 0 0.75rem" }}>
            Already track runs with Strava? Connect it and use those runs as proof.
          </p>
          <a className="btn block strava-btn" href={`/api/strava/connect?address=${address}&back=${back}`}>
            Connect with Strava
          </a>
        </>
      ) : runs === null ? (
        <p className="muted small">Loading your runs…</p>
      ) : runs.length === 0 ? (
        <p className="muted small">No Strava runs since you joined. Go run, then come back!</p>
      ) : (
        <ul className="srun-list">
          {runs.map((r) => (
            <li key={r.id}>
              <div style={{ minWidth: 0 }}>
                <div className="srun-name">{r.name}</div>
                <div className="meta">
                  <span>{r.km} km</span>
                  <span>{pace(r.sec / r.km)}/km</span>
                  <span>{new Date(r.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                </div>
              </div>
              <button className="btn" disabled={r.used || busy !== null} onClick={() => use(r)}>
                {r.used ? "Used" : busy === r.id ? "Adding…" : "Use run"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="err">{msg}</p>}
      <p className="small" style={{ margin: "0.6rem 0 0", color: "var(--faint)" }}>Powered by Strava</p>
    </div>
  );
}
