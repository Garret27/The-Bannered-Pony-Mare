import { NextResponse } from "next/server";
import { getAgentHealth } from "@/lib/converter-agent";

export const runtime = "nodejs";

export async function GET() {
  const health = await getAgentHealth();
  if (!health.ok) {
    return NextResponse.json(
      { ok: false, error: health.error, tvOutputWritable: false },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: health.health.ok === true,
    enabled: health.health.enabled === true,
    tvReady: health.health.tvReady === true,
    moviesReady: health.health.moviesReady === true,
    tvOutputWritable: health.health.tvOutputWritable === true,
    outputWritable: health.health.outputWritable === true,
    activeJobId: health.health.activeJobId ?? null,
    tvOutputDir: health.health.tvOutputDir,
    disabledReason: health.health.disabledReason,
    error: health.health.disabledReason,
  });
}
