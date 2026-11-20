import type { Challenge } from "@/lib/config";
import { isPrivate, rewardModeOf } from "@/lib/config";

/** Small badges that state a challenge's rules before anyone stakes: reward mode and who can join. */
export default function RuleBadges({ c, detail = false }: { c: Challenge; detail?: boolean }) {
  const fraction = rewardModeOf(c) === "fraction";
  return (
    <span className="rule-badges">
      <span
        className={`rule-badge ${fraction ? "fraction" : "pool"}`}
        title={fraction ? "Get back the share of runs you finish; 100% also earns a prize" : "Finish 100% or lose your stake; finishers split the pool"}
      >
        {fraction ? "By fraction" : "All or nothing"}
        {detail && <span className="rule-badge-hint">{fraction ? "· paid by % finished" : "· 100% or lose your stake"}</span>}
      </span>
      {isPrivate(c) && (
        <span className="rule-badge private" title="Only people with the invite link can see and join">
          🔒 Private{detail ? " · invite only" : ""}
        </span>
      )}
    </span>
  );
}
