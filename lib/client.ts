"use client";
import { useEffect, useState } from "react";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export type Me = { name: string; address: string };
const ME_KEY = "lockrun.me";

/** The runner's identity. A Solana wallet is created silently in the browser on first visit. */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ME_KEY);
      if (saved) setMe(JSON.parse(saved));
    } catch {}
    setReady(true);
  }, []);
  function join(name: string) {
    // Hackathon demo: key in localStorage. Production: embedded wallet with email / passkey login.
    const kp = Keypair.generate();
    localStorage.setItem("lockrun.secret", bs58.encode(kp.secretKey));
    const m = { name: name.trim().slice(0, 24), address: kp.publicKey.toBase58() };
    localStorage.setItem(ME_KEY, JSON.stringify(m));
    setMe(m);
  }
  return { me, ready, join };
}

let voiceChain: Promise<void> = Promise.resolve();

/** Voice coach: ElevenLabs via /api/voice, with the browser's built-in voice as a fallback. Calls are queued. */
export function speak(text: string) {
  voiceChain = voiceChain.then(() => speakNow(text)).catch(() => {});
  return voiceChain;
}

async function speakNow(text: string) {
  try {
    const r = await fetch(`/api/voice?text=${encodeURIComponent(text)}`);
    if (r.status === 200) {
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return;
    }
  } catch {}
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }
}

export function timeLeft(endsAt: number, now: number) {
  const s = Math.max(0, Math.round((endsAt - now) / 1000));
  if (s === 0) return "Ended";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}:${String(sec).padStart(2, "0")} left`;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
