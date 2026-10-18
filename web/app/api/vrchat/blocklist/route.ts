import { NextResponse } from "next/server";
import {
  addToBlocklist,
  canUnblockUser,
  removeFromBlocklist,
} from "@/lib/invite-lists";
import { isVrchatConfigured } from "@/lib/vrchat";

export const runtime = "nodejs";

type BlocklistBody = {
  action?: "add" | "remove";
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
    const body = (await request.json()) as BlocklistBody;
    const action = body.action;
    const userId = body.userId?.trim();
    const displayName = body.displayName?.trim() ?? "";

    if (!userId || !action) {
      return NextResponse.json(
        { error: "action and userId are required" },
        { status: 400 },
      );
    }

    if (action === "add") {
      const overrides = await addToBlocklist(userId);
      return NextResponse.json({ ok: true, overrides });
    }

    if (action === "remove") {
      if (!canUnblockUser(userId, displayName)) {
        return NextResponse.json(
          { error: "This user cannot be removed from the blocklist" },
          { status: 400 },
        );
      }
      const overrides = await removeFromBlocklist(userId);
      return NextResponse.json({ ok: true, overrides });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Blocklist update failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update blocklist" },
      { status: 500 },
    );
  }
}
