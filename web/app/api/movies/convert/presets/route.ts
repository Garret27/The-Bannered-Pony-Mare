import { NextResponse } from "next/server";

import { getConversionPresets } from "@/lib/converter-agent";



export const runtime = "nodejs";



export async function GET(request: Request) {

  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("mode") ?? undefined;

  const presets = await getConversionPresets(mode);

  if (!presets.ok) {

    return NextResponse.json({ error: presets.error }, { status: 503 });

  }

  return NextResponse.json({ presets: presets.presets });

}

