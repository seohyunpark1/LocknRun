"use client";
import { useEffect, useRef, useState } from "react";

/** Live camera only: the photo is taken from the camera stream, so there is no file picker or gallery. */
export default function CameraCapture({ onCapture, onCancel }: { onCapture: (jpeg: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't open the camera.");
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
          setReady(true);
        }
      } catch (e) {
        setError(e instanceof Error && e.name !== "NotAllowedError" ? e.message : "Allow camera access to take your check-in photo.");
      }
    })();
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    let q = 0.75;
    let out = canvas.toDataURL("image/jpeg", q);
    while (out.length > 550_000 && q > 0.35) {
      q -= 0.1;
      out = canvas.toDataURL("image/jpeg", q);
    }
    onCapture(out);
  }

  return (
    <div>
      <div className="photo-pick has" style={{ cursor: "default" }}>
        <video ref={video} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      {error && <p className="err">{error}</p>}
      <button className="btn primary block big" style={{ marginTop: "0.75rem" }} disabled={!ready} onClick={snap}>
        Take photo
      </button>
      <button className="btn ghost block" style={{ marginTop: "0.5rem" }} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
