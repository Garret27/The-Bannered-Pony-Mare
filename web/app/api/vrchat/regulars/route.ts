import { NextResponse } from "next/server";
import { addRegular, removeRegular } from "@/lib/invite-lists";
import { syncMovieNightRegularsFromVrcx } from "@/lib/movie-night-regulars";
import { isVrcxAvailable } from "@/lib/vrcx";
import { isVrchatConfigured } from "@/lib/vrchat";

export const runtime = "nodejs";

type RegularsBody = {
  action?: "add" | "remove" | "sync-from-vrcx";
  userId?: string;
  displayName?: string;
};

export async function POST(request: Request) {
  if (!isVrchatConfigured()) {
    return NextResponse.json(
      { error: "VRChat credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as RegularsBody;
    const action = body.action;
    const userId = body.userId?.trim();
    const displayName = body.displayName?.trim() ?? "";

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    if (action === "sync-from-vrcx") {
      if (!isVrcxAvailable()) {
        return NextResponse.json(
          { error: "VRCX database is not available" },
          { status: 503 },
        );
      }
      const snapshot = await syncMovieNightRegularsFromVrcx();
      return NextResponse.json({
        ok: true,
        count: snapshot.members.length,
        updatedAt: snapshot.updatedAt,
      });
    }

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 },
      );
    }

    if (action === "add") {
      if (!displayName) {
        return NextResponse.json(
          { error: "displayName is required when adding a regular" },
          { status: 400 },
        );
      }
      const overrides = await addRegular(userId, displayName);
      return NextResponse.json({ ok: true, overrides });
    }

    if (action === "remove") {
      const overrides = await removeRegular(userId);
      return NextResponse.json({ ok: true, overrides });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Regulars update failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update regulars" },
      { status: 500 },
    );
  }
}
