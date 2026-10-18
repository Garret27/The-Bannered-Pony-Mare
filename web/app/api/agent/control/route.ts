import { NextResponse } from "next/server";
import {
  controlAgent,
  type AgentControlAction,
} from "@/lib/converter-agent";

export const runtime = "nodejs";

const VALID_ACTIONS = new Set<AgentControlAction>([
  "enable",
  "disable",
  "reset",
]);

export async function POST(request: Request) {
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as AgentControlAction;
  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "action must be enable, disable, or reset" },
      { status: 400 },
    );
  }

  const result = await controlAgent(action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return NextResponse.json(result.state);
}
