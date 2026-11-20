"use client";
import { Challenge } from "@/lib/config";

type Row = { c: Challenge; rate: number; settled: boolean; bonusShare: number };

/** Achievement badges, Challengers-style: earned from finished challenges and logged runs. */
export default function Badges({ rows, address }: { rows: Row[]; address: string }) {
  const done = rows.filter((r) => r.settled);
  const perfect = done.filter((r) => r.rate >= 1);
  const km = rows
    .flatMap((r) => r.c.participants.find((p) => p.address === address)?.runs || [])
    .filter((run) => run.counts)
    .reduce((s, run) => s + run.km, 0);
  // Longest run of finished challenges in a row (oldest to newest).
  let streak = 0;
  let best = 0;
  [...done].sort((a, b) => (a.c.settledAt || 0) - (b.c.settledAt || 0)).forEach((r) => {
    streak = r.rate >= 1 ? streak + 1 : 0;
    best = Math.max(best, streak);
  });

  const badges = [
    { icon: "🎯", name: "First finish", desc: "Finish a challenge", got: perfect.length >= 1, progress: `${Math.min(perfect.length, 1)}/1` },
    { icon: "🔥", name: "Hot streak", desc: "3 perfect challenges in a row", got: best >= 3, progress: `${Math.min(best, 3)}/3` },
    { icon: "🏆", name: "Perfect five", desc: "Finish five challenges", got: perfect.length >= 5, progress: `${Math.min(perfect.length, 5)}/5` },
    { icon: "🤝", name: "Sponsor-backed", desc: "Win a sponsor bonus", got: rows.some((r) => r.bonusShare > 0), progress: "" },
    { icon: "👟", name: "10K club", desc: "Log 10 km of counted runs", got: km >= 10, progress: `${Math.min(km, 10).toFixed(1)}/10 km` },
    { icon: "🏃", name: "Marathoner", desc: "Log 42.2 km of counted runs", got: km >= 42.2, progress: `${Math.min(km, 42.2).toFixed(1)}/42.2 km` },
  ];
  const earned = badges.filter((b) => b.got).length;

  return (
    <section>
      <h2>
        Badges <span className="muted small" style={{ fontWeight: 500 }}>· {earned}/{badges.length} earned</span>
      </h2>
      <div className="badges">
        {badges.map((b) => (
          <div key={b.name} className={`badge ${b.got ? "got" : ""}`} title={b.desc}>
            <span className="badge-icon" aria-hidden>{b.icon}</span>
            <b>{b.name}</b>
            <span className="muted small">{b.got ? "Earned" : b.progress || b.desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
