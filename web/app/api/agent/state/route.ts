import { NextResponse } from "next/server";
import { getAgentState } from "@/lib/converter-agent";

export const runtime = "nodejs";

export async function GET() {
  const result = await getAgentState();
  if (!result.ok) {
    return NextResponse.json(
      {
        reachable: false,
        enabled: false,
        ok: false,
        error: result.error,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(result.state);
}
