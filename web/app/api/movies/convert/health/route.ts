import { NextResponse } from "next/server";
import { getAgentHealth } from "@/lib/converter-agent";

export const runtime = "nodejs";

export async function GET() {
  const health = await getAgentHealth();
  if (!health.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: health.error,
        handbrakeFound: false,
        outputWritable: false,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(health.health);
}
