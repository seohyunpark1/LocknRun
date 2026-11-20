import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/photos/<run id>  ->  the run's photo proof (JPEG)
export async function GET(_req: Request, { params }: { params: { runId: string } }) {
  if (!/^[a-f0-9]{10}$/.test(params.runId)) return new NextResponse(null, { status: 400 });
  const dataUrl = await getPhoto(params.runId);
  if (!dataUrl) return new NextResponse(null, { status: 404 });
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return new NextResponse(Buffer.from(b64, "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
