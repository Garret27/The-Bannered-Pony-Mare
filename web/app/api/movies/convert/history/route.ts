import { NextResponse } from "next/server";
import {
  clearConversionHistory,
  deleteConversionHistoryEntry,
  getConversionHistory,
} from "@/lib/converter-agent";

export const runtime = "nodejs";

export async function GET() {
  const result = await getConversionHistory();
  if (!result.ok) {
    return NextResponse.json({ error: result.error, jobs: [] }, { status: 503 });
  }
  return NextResponse.json({ jobs: result.jobs });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("jobId")?.trim();

  if (jobId) {
    const result = await deleteConversionHistoryEntry(jobId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const result = await clearConversionHistory();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
