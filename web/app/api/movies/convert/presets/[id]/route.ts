import { NextResponse } from "next/server";

import { getPresetDetail, previewPresetTuning } from "@/lib/converter-agent";
import type { EncodingTuning } from "@/lib/converter-agent";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const presetId = id.trim();
  if (!presetId) {
    return NextResponse.json({ error: "Preset id is required" }, { status: 400 });
  }

  const result = await getPresetDetail(presetId);
  if (!result.ok) {
    const status = result.error.includes("Unknown preset") ? 404 : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.preset);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const presetId = id.trim();
  if (!presetId) {
    return NextResponse.json({ error: "Preset id is required" }, { status: 400 });
  }

  let body: { tuning?: EncodingTuning } = {};
  try {
    body = (await request.json()) as { tuning?: EncodingTuning };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await previewPresetTuning(presetId, body.tuning);
  if (!result.ok) {
    const status = result.error.includes("Unknown preset") ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json(result.preview);
}
