"use client";
import { useState } from "react";
import { Challenge, Sponsor, sponsorLogoUrl } from "@/lib/config";

/**
 * Partner logo: tries each source in order (official file in /public/partners, then the company's site icon).
 * Shows nothing if none load, so the name next to it carries the brand.
 */
export function PartnerLogo({ src, name, className = "partner-logo" }: { src: string | string[]; name: string; className?: string }) {
  const sources = Array.isArray(src) ? src : [src];
  const [i, setI] = useState(0);
  if (i >= sources.length) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={sources[i]} alt={`${name} logo`} referrerPolicy="no-referrer" onError={() => setI(i + 1)} />
  );
}

/** A sponsor's uploaded logo, or their first letter if they didn't upload one. */
export function SponsorMark({ c, index, s, size = "md" }: { c: Challenge; index: number; s: Sponsor; size?: "sm" | "md" | "lg" }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={`sponsor-logo ${size}`} title={s.name}>
      {s.logo && ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sponsorLogoUrl(c.id, index)} alt={`${s.name} logo`} onError={() => setOk(false)} />
      ) : (
        s.name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
