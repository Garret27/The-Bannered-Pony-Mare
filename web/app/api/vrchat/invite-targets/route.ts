import { NextResponse } from "next/server";
import { getInviteTargets } from "@/lib/invite-targets";
import {
  isVrchatConfigured,
  VrchatAuthError,
  VrchatConfigError,
} from "@/lib/vrchat";

export const runtime = "nodejs";

export async function GET() {
  if (!isVrchatConfigured()) {
    return NextResponse.json(
      { error: "VRChat credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const targets = await getInviteTargets();
    return NextResponse.json(targets);
  } catch (error) {
    if (error instanceof VrchatConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof VrchatAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Invite targets failed:", error);
    return NextResponse.json(
      { error: "Failed to load invite targets" },
      { status: 500 },
    );
  }
}
