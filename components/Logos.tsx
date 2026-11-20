"use client";
import { useState } from "react";
import { Challenge, Sponsor, sponsorLogoUrl } from "@/lib/config";

/** Official partner logo from /public/partners; shows nothing if the file hasn't been added yet. */
export function PartnerLogo({ src, name, className = "partner-logo" }: { src: string; name: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={src} alt={`${name} logo`} onError={() => setOk(false)} />;
}

/** A sponsor's uploaded logo, or their first letter if they didn't upload one. */
export function SponsorMark({ c, index, s, size = "md" }: { c: Challenge; index: number; s: Sponsor; size?: "sm" | "md" }) {
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
