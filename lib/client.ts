"use client";
import { useEffect, useState } from "react";
export { useWallet as useMe } from "@/components/WalletProvider";
export type { Me } from "@/components/WalletProvider";

/** Opens the "Connect wallet" sheet from anywhere (buttons that need a wallet call this). */
export const CONNECT_EVENT = "lockrun:connect";
export function openConnect() {
  window.dispatchEvent(new Event(CONNECT_EVENT));
}

let voiceChain: Promise<void> = Promise.resolve();

const VOICE_KEY = "lockrun.voice";
/** Voice is off unless the runner turns on the voice coach (run screen). */
export function voiceOn() {
  try {
    return localStorage.getItem(VOICE_KEY) === "on";
  } catch {
    return false;
  }
}
export function setVoice(on: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {}
  if (!on && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Voice coach: ElevenLabs via /api/voice, with the browser's built-in voice as a fallback. Calls are queued. Silent unless turned on. */
export function speak(text: string) {
  if (!voiceOn()) return Promise.resolve();
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
