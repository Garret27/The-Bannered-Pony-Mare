import { NextResponse } from "next/server";
import {
  checkBunnyHealth,
  getCdnHostname,
  getStoragePrefix,
  isBunnyConfigured,
} from "@/lib/bunny-storage";
import { checkJellyfinOutputAccess } from "@/lib/jellyfin-output";

export const runtime = "nodejs";

export async function GET() {
  const bunny = await checkBunnyHealth();
  const jellyfinOutput = await checkJellyfinOutputAccess();

  return NextResponse.json({
    bunny: {
      ...bunny,
      prefix: getStoragePrefix(),
      cdnHostname: getCdnHostname(),
      configured: isBunnyConfigured(),
    },
    jellyfinOutput: {
      ok: jellyfinOutput.ok,
      path: jellyfinOutput.path,
      error: jellyfinOutput.ok ? undefined : jellyfinOutput.error,
    },
  });
}
