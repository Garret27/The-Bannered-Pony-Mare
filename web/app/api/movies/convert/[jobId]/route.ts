import { NextResponse } from "next/server";
import {
  cancelConversionJob,
  getConversionJob,
  openJobOutputFolder,
} from "@/lib/converter-agent";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const result = await getConversionJob(jobId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.job);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  const result = await cancelConversionJob(jobId);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.job);
}

export async function POST(request: Request, context: RouteContext) {
  const { jobId } = await context.params;
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "open-folder") {
    const result = await openJobOutputFolder(jobId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
