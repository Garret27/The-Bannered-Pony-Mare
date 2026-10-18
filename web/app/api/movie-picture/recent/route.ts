import { NextResponse } from "next/server";
import { getDiscordConfig } from "@/lib/discord-announcements";
import { EVENTS } from "@/lib/paths";
import {
  isVrchatPhotosDirConfigured,
  listRecentPhotos,
  VrchatPhotosConfigError,
} from "@/lib/vrchat-photos";

export const runtime = "nodejs";

export async function GET() {
  const dirConfigured = await isVrchatPhotosDirConfigured();
  const webhooks = Object.fromEntries(
    EVENTS.map((event) => [event, getDiscordConfig(event).webhookConfigured]),
  ) as Record<(typeof EVENTS)[number], boolean>;

  if (!dirConfigured) {
    return NextResponse.json({
      photos: [],
      dirConfigured: false,
      webhooks,
      error: "VRCHAT_PHOTOS_DIR is not configured or not accessible.",
    });
  }

  try {
    const photos = await listRecentPhotos(20);
    return NextResponse.json({
      photos,
      dirConfigured: true,
      webhooks,
    });
  } catch (error) {
    if (error instanceof VrchatPhotosConfigError) {
      return NextResponse.json({
        photos: [],
        dirConfigured: false,
        webhooks,
        error: error.message,
      });
    }

    console.error("Failed to list VRChat photos:", error);
    return NextResponse.json(
      { error: "Failed to scan VRChat photos folder" },
      { status: 500 },
    );
  }
}
