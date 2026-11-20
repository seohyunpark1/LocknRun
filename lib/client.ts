"use client";
import { useEffect, useState } from "react";
export { useWallet as useMe } from "@/components/WalletProvider";
export type { Me } from "@/components/WalletProvider";

/** Opens the "Connect wallet" sheet from anywhere (buttons that need a wallet call this). */
export const CONNECT_EVENT = "lockrun:connect";
export function openConnect() {
  window.dispatchEvent(new Event(CONNECT_EVENT));
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
