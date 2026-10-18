import { NextResponse } from "next/server";
import { readRedirects, validateRedirectsConfig, writeRedirects } from "@/lib/redirects";
import type { Event } from "@/lib/paths";
import { isEvent } from "@/lib/paths";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { event?: string; cdnUrl?: string };
  try {
    body = (await request.json()) as { event?: string; cdnUrl?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.event || !isEvent(body.event)) {
    return NextResponse.json(
      { error: "event must be main or hspc" },
      { status: 400 },
    );
  }

  if (!body.cdnUrl?.trim()) {
    return NextResponse.json({ error: "cdnUrl is required" }, { status: 400 });
  }

  try {
    new URL(body.cdnUrl);
  } catch {
    return NextResponse.json({ error: "cdnUrl must be a valid URL" }, { status: 400 });
  }

  const event = body.event as Event;
  const current = await readRedirects();
  const updated = {
    ...current,
    [event]: {
      ...current[event],
      url: body.cdnUrl.trim(),
    },
  };

  if (!validateRedirectsConfig(updated)) {
    return NextResponse.json({ error: "Invalid redirect configuration" }, { status: 400 });
  }

  await writeRedirects(updated);

  return NextResponse.json({
    message: `Set ${event === "main" ? "/main" : "/hspc"} redirect`,
    redirects: updated,
  });
}
