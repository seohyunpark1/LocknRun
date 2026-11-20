import { NextResponse } from "next/server";
import { connect, readState } from "@/lib/strava";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strava redirects here after the runner approves (or denies) access.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = readState(url.searchParams.get("state") || "");
  const back = state?.back || "/";
  const go = (status: string) => NextResponse.redirect(`${url.origin}${back}${back.includes("?") ? "&" : "?"}strava=${status}`);
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("error")) return go("cancelled");
  try {
    await connect(state.address, code);
    return go("connected");
  } catch (e) {
    console.error("strava callback:", e instanceof Error ? e.message : e);
    return go("failed");
  }
}
