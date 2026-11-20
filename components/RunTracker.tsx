"use client";
import { useEffect, useRef, useState } from "react";
import { pace } from "@/lib/config";

type Result = { status: "approved" | "pending" | "rejected"; reason?: string };
type Props = {
  goalKm: number;
  /** Opens a server-issued run session; its id is returned and must accompany the check-in. */
  onStart: () => Promise<string>;
  onFinish: (km: number, sec: number, photo: string, sessionId: string) => Promise<Result>;
};

// Distance between two GPS points in meters.
function haversine(a: GeolocationCoordinates, b: GeolocationCoordinates) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function RunTracker({ goalKm, onStart, onFinish }: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "proof" | "saving" | "done">("idle");
  const [photo, setPhoto] = useState<string>("");
  const sessionId = useRef("");
  const final = useRef({ km: 0, sec: 0 });
  const [meters, setMeters] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [gps, setGps] = useState<"waiting" | "good" | "weak" | "off">("waiting");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const watchId = useRef<number | null>(null);
  const last = useRef<{ c: GeolocationCoordinates; t: number } | null>(null);
  const startAt = useRef(0);
  const metersRef = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const km = meters / 1000;
  const curPace = km > 0.05 ? elapsed / km : 0;

  function addMeters(d: number) {
    metersRef.current += d;
    setMeters(metersRef.current);
  }

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startAt.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => stopWatching(), []);

  function stopWatching() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }

  async function start() {
    setError("");
    setResult(null);
    metersRef.current = 0;
    last.current = null;
    setMeters(0);
    setElapsed(0);
    try {
      sessionId.current = await onStart(); // the server's clock starts this run
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run.");
      return;
    }
    startAt.current = Date.now();
    setPhase("running");

    try {
      // Keep the screen on so the browser keeps receiving GPS.
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) || null;
    } catch {}

    if (!("geolocation" in navigator)) {
      setGps("off");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        if (c.accuracy > 35) {
          setGps("weak");
          return; // too imprecise, skip
        }
        setGps("good");
        const prev = last.current;
        if (!prev) {
          last.current = { c, t: pos.timestamp };
          return;
        }
        const d = haversine(prev.c, c);
        const dt = (pos.timestamp - prev.t) / 1000;
        if (d < 3) return; // GPS jitter while standing still
        if (dt > 0 && d / dt > 8) {
          // faster than ~29 km/h: a GPS jump or a vehicle; drop the segment
          last.current = { c, t: pos.timestamp };
          return;
        }
        last.current = { c, t: pos.timestamp };
        addMeters(d);
      },
      (err) => {
        setGps("off");
        setError(err.code === 1 ? "Allow location access to track your run." : "Can't get GPS right now. Try outside.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  async function finish() {
    stopWatching();
    const finalSec = Math.max(1, Math.round((Date.now() - startAt.current) / 1000));
    const finalKm = Math.round((metersRef.current / 1000) * 100) / 100;
    if (finalKm < 0.01) {
      setPhase("idle");
      setError("No distance recorded, so nothing was saved.");
      return;
    }
    final.current = { km: finalKm, sec: finalSec };
    setPhoto("");
    setPhase("proof");
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      setPhoto(await compressPhoto(file));
    } catch {
      setError("Couldn't read that photo. Try another one.");
    }
  }

  async function save() {
    if (!photo) return;
    setPhase("saving");
    setError("");
    try {
      const r = await onFinish(final.current.km, final.current.sec, photo, sessionId.current);
      setResult(r);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the run");
      setPhase("proof");
    }
  }

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const pct = Math.min(100, (km / goalKm) * 100);

  return (
    <div className="tracker">
      <div className="tracker-stats">
        <div>
          <div className="tk-big">{km.toFixed(2)}</div>
          <div className="tk-label">km / {goalKm}</div>
        </div>
        <div>
          <div className="tk-big">{mm}:{ss}</div>
          <div className="tk-label">time</div>
        </div>
        <div>
          <div className="tk-big">{pace(curPace)}</div>
          <div className="tk-label">pace /km</div>
        </div>
      </div>
      <div className="bar" style={{ margin: "0.9rem 0" }}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {phase === "idle" && (
        <button className="btn primary block big" onClick={start}>
          Start run
        </button>
      )}
      {phase === "running" && (
        <>
          <button className="btn go block big" onClick={finish}>
            Finish run
          </button>
          <p className="muted small" style={{ textAlign: "center" }}>
            <span className={`dot ${gps}`} /> Phone tracking {gps === "good" ? "active" : gps === "weak" ? "weak signal" : gps === "off" ? "off" : "starting…"} · keep this screen open while you run
          </p>
        </>
      )}
      {phase === "proof" && (
        <div className="proof">
          <b>Add your photo check-in</b>
          <p className="muted small" style={{ margin: "0.2rem 0 0.75rem" }}>
            One photo per day, taken after your run. Everyone in the challenge can see it, and its fingerprint is stamped on Solana.
          </p>
          <label className={`photo-pick ${photo ? "has" : ""}`}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Your run photo" />
            ) : (
              <span>Take your photo</span>
            )}
            <input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
          <button className="btn primary block big" style={{ marginTop: "0.75rem" }} disabled={!photo} onClick={save}>
            Submit check-in
          </button>
          <button className="btn ghost block" style={{ marginTop: "0.5rem" }} onClick={() => { setPhase("idle"); setPhoto(""); }}>
            Discard
          </button>
        </div>
      )}
      {phase === "saving" && <p className="muted">Submitting your check-in and stamping it on Solana…</p>}
      {phase === "done" && result && (
        <div className={`result ${result.status === "approved" ? "ok" : "no"}`}>
          <b>{result.status === "approved" ? "Check-in approved" : result.status === "pending" ? "Sent for review" : "Check-in rejected"}</b>
          {result.reason && <div className="small">{result.reason}</div>}
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => setPhase("idle")}>
            Done
          </button>
        </div>
      )}
      {error && <p className="err">{error}</p>}
    </div>
  );
}

/** Shrinks a photo in the browser (max 1024 px, JPEG) so uploads are fast on mobile data. */
async function compressPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const max = 1024;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    let q = 0.75;
    let out = canvas.toDataURL("image/jpeg", q);
    while (out.length > 550_000 && q > 0.35) {
      q -= 0.1;
      out = canvas.toDataURL("image/jpeg", q);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
