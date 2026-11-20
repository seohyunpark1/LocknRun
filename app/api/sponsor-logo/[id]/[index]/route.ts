import { NextResponse } from "next/server";
import { kvGet } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/sponsor-logo/<challenge id>/<sponsor index>  ->  the sponsor's uploaded logo (PNG or JPEG)
export async function GET(_req: Request, { params }: { params: { id: string; index: string } }) {
  if (!/^[a-f0-9]{10}$/.test(params.id) || !/^\d{1,2}$/.test(params.index)) return new NextResponse(null, { status: 400 });
  const dataUrl = await kvGet<string>(`sponsorlogo:${params.id}:${params.index}`);
  if (!dataUrl) return new NextResponse(null, { status: 404 });
  const type = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  return new NextResponse(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
