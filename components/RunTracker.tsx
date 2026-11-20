"use client";
import { useEffect, useRef, useState } from "react";
import { pace } from "@/lib/config";
import { setVoice, speak, voiceOn } from "@/lib/client";

type Result = { counts: boolean; reason?: string };
type Props = {
  goalKm: number;
  demo: boolean;
  onFinish: (km: number, sec: number, photo: string) => Promise<Result>;
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

function spokenPace(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m} minutes${s ? ` ${s}` : ""} per kilometer`;
}

export default function RunTracker({ goalKm, demo, onFinish }: Props) {
  const [phase, setPhase] = useState<"idle" | "running" | "proof" | "saving" | "done">("idle");
  const [photo, setPhoto] = useState<string>("");
  const [voice, setVoiceState] = useState(false);
  useEffect(() => setVoiceState(voiceOn()), []);
  const final = useRef({ km: 0, sec: 0 });
  const [meters, setMeters] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [gps, setGps] = useState<"waiting" | "good" | "weak" | "off">("waiting");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const watchId = useRef<number | null>(null);
  const last = useRef<{ c: GeolocationCoordinates; t: number } | null>(null);
  const startAt = useRef(0);
  const extraSec = useRef(0); // demo mode adds simulated time with simulated distance
  const metersRef = useRef(0);
  const announcedKm = useRef(0);
  const goalAnnounced = useRef(false);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const km = meters / 1000;
  const curPace = km > 0.05 ? elapsed / km : 0;

  function addMeters(d: number, secNow: number) {
    metersRef.current += d;
    setMeters(metersRef.current);
    const k = Math.floor(metersRef.current / 1000);
    if (k > announcedKm.current) {
      announcedKm.current = k;
      speak(`${k} kilometer${k > 1 ? "s" : ""} done. Pace: ${spokenPace(secNow / (metersRef.current / 1000))}.`);
    }
    if (!goalAnnounced.current && metersRef.current / 1000 >= goalKm) {
      goalAnnounced.current = true;
      speak(`Goal reached! ${goalKm} kilometers. Tap finish whenever you're ready.`);
    }
  }

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startAt.current) / 1000 + extraSec.current)), 1000);
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
    extraSec.current = 0;
    announcedKm.current = 0;
    goalAnnounced.current = false;
    last.current = null;
    setMeters(0);
    setElapsed(0);
    startAt.current = Date.now();
    setPhase("running");
    speak(`Let's go! Today's goal: ${goalKm} kilometer${goalKm > 1 ? "s" : ""}.`);

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
        addMeters(d, (Date.now() - startAt.current) / 1000 + extraSec.current);
      },
      (err) => {
        setGps("off");
        if (demo) return; // indoor stage demo: the "+250 m" button stands in for GPS
        setError(err.code === 1 ? "Allow location access to track your run." : "Can't get GPS right now. Try outside.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  async function finish() {
    stopWatching();
    const finalSec = Math.max(1, Math.round((Date.now() - startAt.current) / 1000 + extraSec.current));
    const finalKm = Math.round((metersRef.current / 1000) * 100) / 100;
    if (finalKm < 0.01) {
      setPhase("idle");
      setError("No distance recorded, so nothing was saved.");
      return;
    }
    final.current = { km: finalKm, sec: finalSec };
    setPhoto("");
    setPhase("proof");
    speak("Nice run! Snap a photo as proof to save it.");
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
      const r = await onFinish(final.current.km, final.current.sec, photo);
      setResult(r);
      speak(r.counts ? `Run saved! ${final.current.km} kilometers. That one counts. Great job!` : `Run saved, but it doesn't count. ${r.reason || ""}`);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the run");
      setPhase("proof");
    }
  }

  function simulate() {
    // Demo only: 250 m at a 6:00/km pace, for indoor stage demos.
    extraSec.current += 90;
    if (!startAt.current) return;
    addMeters(250, (Date.now() - startAt.current) / 1000 + extraSec.current);
    setElapsed(Math.round((Date.now() - startAt.current) / 1000 + extraSec.current));
  }

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");
  const pct = Math.min(100, (km / goalKm) * 100);

  return (
    <div className="tracker">
      <button
        type="button"
        className={`voice-toggle ${voice ? "on" : ""}`}
        onClick={() => {
          setVoice(!voice);
          setVoiceState(!voice);
        }}
      >
        {voice ? "Voice coach: on" : "Voice coach: off"}
      </button>
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
            Finish &amp; save
          </button>
          <p className="muted small" style={{ textAlign: "center" }}>
            <span className={`dot ${gps}`} /> GPS {gps === "good" ? "locked" : gps === "weak" ? "weak signal" : gps === "off" ? "off" : "searching…"} · keep this screen open while you run
          </p>
          {demo && (
            <button className="btn ghost block" onClick={simulate}>
              +250 m (demo)
            </button>
          )}
        </>
      )}
      {phase === "proof" && (
        <div className="proof">
          <b>Add a photo as proof</b>
          <p className="muted small" style={{ margin: "0.2rem 0 0.75rem" }}>
            A selfie at the finish or your watch screen. Everyone in the challenge can see it, and its fingerprint is stamped on Solana.
          </p>
          <label className={`photo-pick ${photo ? "has" : ""}`}>
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Your run photo" />
            ) : (
              <span>Take or choose a photo</span>
            )}
            <input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </label>
          <button className="btn primary block big" style={{ marginTop: "0.75rem" }} disabled={!photo} onClick={save}>
            Save run
          </button>
          <button className="btn ghost block" style={{ marginTop: "0.5rem" }} onClick={() => { setPhase("idle"); setPhoto(""); }}>
            Discard
          </button>
        </div>
      )}
      {phase === "saving" && <p className="muted">Saving your run and stamping the proof on Solana…</p>}
      {phase === "done" && result && (
        <div className={`result ${result.counts ? "ok" : "no"}`}>
          <b>{result.counts ? "Run counted" : "Saved, but it doesn't count"}</b>
          {!result.counts && result.reason && <div className="small">{result.reason}</div>}
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => setPhase("idle")}>
            Start another run
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
