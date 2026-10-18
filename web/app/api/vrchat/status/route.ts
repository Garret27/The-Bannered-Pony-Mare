import { NextResponse } from "next/server";
import { getInviteTargets } from "@/lib/invite-targets";
import {
  getCurrentUser,
  isVrchatConfigured,
  locationFromPresence,
  VrchatAuthError,
  VrchatConfigError,
} from "@/lib/vrchat";
import { isVrcxAvailable, locationFromVrcx, usersInInstance } from "@/lib/vrcx";

export const runtime = "nodejs";

export async function GET() {
  if (!isVrchatConfigured()) {
    return NextResponse.json(
      { error: "VRChat credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const user = await getCurrentUser();
    const apiLocation = locationFromPresence(user);
    const vrcxLocation = locationFromVrcx();
    let instanceMemberCount = 0;

    if (vrcxLocation) {
      instanceMemberCount = usersInInstance(vrcxLocation).length;
    }

    return NextResponse.json({
      authenticated: true,
      displayName: user.displayName ?? null,
      userId: user.id,
      apiLocation,
      vrcxLocation,
      vrcxAvailable: isVrcxAvailable(),
      instanceMemberCount,
    });
  } catch (error) {
    if (error instanceof VrchatConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof VrchatAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("VRChat status failed:", error);
    return NextResponse.json({ error: "Failed to read VRChat status" }, { status: 500 });
  }
}
