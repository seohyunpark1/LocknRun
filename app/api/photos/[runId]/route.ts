import { walletSession } from "@/lib/wallet-auth";
import { NextResponse } from "next/server";
import { getPhoto, listChallenges } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/photos/<run id>  ->  the run's photo proof (JPEG)
export async function GET(req: Request, { params }: { params: { runId: string } }) {
  if (!/^[a-f0-9]{10}$/.test(params.runId)) return new NextResponse(null, { status: 400 });
  const address = await walletSession(req);
  if (!address) return new NextResponse(null, { status: 401 });
  const permitted = (await listChallenges()).some(c => c.participants.some(p => p.address === address) && c.participants.some(p => p.runs.some(r => r.id === params.runId)));
  if (!permitted) return new NextResponse(null, { status: 403 });
  const dataUrl = await getPhoto(params.runId);
  if (!dataUrl) return new NextResponse(null, { status: 404 });
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return new NextResponse(Buffer.from(b64, "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
