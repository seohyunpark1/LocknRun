"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Challenge, Sponsor, money } from "@/lib/config";
import { SponsorMark } from "./Logos";

type Ad = { c: Challenge; s: Sponsor; index: number };

/**
 * Ad spot. Shows real sponsors of live challenges (logo, name, their ad message, link), clearly labeled
 * "Sponsored", rotating every few seconds. With no sponsors yet, it advertises sponsoring a challenge.
 */
export default function AdSlot({ variant = "banner" }: { variant?: "banner" | "card" }) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let stop = false;
    fetch("/api/challenges", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        const now = Date.now();
        const list: Ad[] = (d.challenges || [])
          .filter((c: Challenge) => c.status === "active" && c.endsAt > now)
          .flatMap((c: Challenge) => (c.sponsors || []).map((s, index) => ({ c, s, index })))
          .sort((a: Ad, b: Ad) => b.s.amount - a.s.amount);
        setAds(list);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (ads.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % ads.length), 7000);
    return () => clearInterval(t);
  }, [ads.length]);

  if (ads.length === 0) {
    return (
      <Link href="/#live" className={`ad ad-${variant} ad-house`}>
        <span className="ad-label">Ad</span>
        <span className="ad-logo house" aria-hidden>+</span>
        <span className="ad-body">
          <b>Your brand here</b>
          <span className="muted small">Reach runners the moment they win. Add a bonus to a challenge and your logo leads their payout screen.</span>
        </span>
        <span className="ad-cta">Sponsor a challenge →</span>
      </Link>
    );
  }

  const { c, s, index } = ads[i % ads.length];
  const body = (
    <>
      <span className="ad-label">Sponsored</span>
      <SponsorMark c={c} index={index} s={s} />
      <span className="ad-body">
        <b>{s.name}</b>
        <span className="muted small">{s.tagline || `Backing runners in “${c.title}” with a ${money(s.amount)} bonus.`}</span>
      </span>
      <span className="ad-cta">{s.url ? "Visit →" : "See challenge →"}</span>
    </>
  );
  return s.url ? (
    <a key={`${c.id}-${index}`} href={s.url} target="_blank" rel="sponsored noopener noreferrer" className={`ad ad-${variant}`}>
      {body}
    </a>
  ) : (
    <Link key={`${c.id}-${index}`} href={`/c/${c.id}`} className={`ad ad-${variant}`}>
      {body}
    </Link>
  );
}
