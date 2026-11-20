import { usd } from "@/lib/config";

/** Big amounts: "$68.75" with a small "USDC" label, so headline numbers don't wrap. */
export default function Money({ n, sign = "" }: { n: number; sign?: "" | "+" | "-" }) {
  return (
    <>
      {sign}
      {usd(n)}
      <span className="unit">USDC</span>
    </>
  );
}
