import { NextResponse } from "next/server";
import { getInviteTargets, getResolvedInviteLocation } from "@/lib/invite-targets";
import {
  getCurrentUser,
  isVrchatConfigured,
  sendInvite,
  setInviteMessageSlot,
  sleep,
  VrchatAuthError,
  VrchatConfigError,
} from "@/lib/vrchat";

export const runtime = "nodejs";

type InviteBody = {
  userIds?: string[];
  message?: string;
  messageSlot?: number;
  withMessage?: boolean;
  dryRun?: boolean;
  includeAlreadyInInstance?: boolean;
};

export async function POST(request: Request) {
  if (!isVrchatConfigured()) {
    return NextResponse.json(
      { error: "VRChat credentials are not configured" },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as InviteBody;
    const userIds = body.userIds ?? [];
    const message = (body.message ?? "").trim();
    const messageSlot = body.messageSlot ?? 1;
    const withMessage = Boolean(body.withMessage);
    const dryRun = Boolean(body.dryRun);
    const includeAlreadyInInstance = Boolean(body.includeAlreadyInInstance);

    if (userIds.length === 0) {
      return NextResponse.json(
        { error: "userIds is required and must not be empty" },
        { status: 400 },
      );
    }

    if (withMessage && message.length > 64) {
      return NextResponse.json(
        { error: "Invite message must be 64 characters or fewer" },
        { status: 400 },
      );
    }

    if (messageSlot < 0 || messageSlot > 11) {
      return NextResponse.json(
        { error: "messageSlot must be between 0 and 11" },
        { status: 400 },
      );
    }

    const location = await getResolvedInviteLocation();
    const targets = await getInviteTargets();
    const targetMap = new Map(
      [...targets.regulars, ...targets.others].map((t) => [t.userId, t]),
    );

    const toSend: string[] = [];
    const skipped: Array<{ userId: string; displayName: string; reason: string }> = [];

    for (const userId of userIds) {
      const target = targetMap.get(userId);
      if (!target) {
        skipped.push({ userId, displayName: userId, reason: "not_in_online_friends" });
        continue;
      }
      if (target.blocked) {
        skipped.push({
          userId,
          displayName: target.displayName,
          reason: "blocked",
        });
        continue;
      }
      if (target.alreadyInInstance && !includeAlreadyInInstance) {
        skipped.push({
          userId,
          displayName: target.displayName,
          reason: "already_in_instance",
        });
        continue;
      }
      toSend.push(userId);
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        location,
        wouldSend: toSend.map((id) => ({
          userId: id,
          displayName: targetMap.get(id)?.displayName ?? id,
        })),
        skipped,
      });
    }

    if (toSend.length === 0) {
      return NextResponse.json({
        location,
        sent: 0,
        sentUsers: [],
        skipped,
        failed: [],
      });
    }

    const me = await getCurrentUser();
    let slotUpdated = false;
    if (withMessage && message) {
      const slotResult = await setInviteMessageSlot(me.id, messageSlot, message);
      slotUpdated = slotResult.ok;
    }

    const failed: Array<{
      userId: string;
      displayName: string;
      status: number;
      body: string;
    }> = [];
    const sentUsers: Array<{ userId: string; displayName: string }> = [];
    let sent = 0;

    const slotForSend = withMessage ? messageSlot : undefined;

    for (const userId of toSend) {
      const result = await sendInvite(userId, location, slotForSend);
      if (result.ok) {
        sent += 1;
        sentUsers.push({
          userId,
          displayName: targetMap.get(userId)?.displayName ?? userId,
        });
      } else {
        failed.push({
          userId,
          displayName: targetMap.get(userId)?.displayName ?? userId,
          status: result.status,
          body: result.body,
        });
      }
      await sleep(350);
    }

    return NextResponse.json({
      location,
      sent,
      sentUsers,
      skipped,
      failed,
      slotUpdated,
      messageSlot: withMessage ? messageSlot : undefined,
    });
  } catch (error) {
    if (error instanceof VrchatConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof VrchatAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes("not in a world")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Invite send failed:", error);
    return NextResponse.json({ error: "Failed to send invites" }, { status: 500 });
  }
}
