import { NextResponse } from "next/server";
import { getOcrJob } from "@/lib/ocr-jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = getOcrJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "OCR job not found" }, { status: 404 });
  }
  return NextResponse.json(job);
}
