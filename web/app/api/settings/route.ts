import { NextResponse } from "next/server";
import {
  getConfiguredFlags,
  getSettings,
  maskSettings,
  mergeSettingsUpdate,
  saveSettings,
  validateSettings,
  type MovieNightSettings,
} from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getSettings();
    const masked = maskSettings(settings);
    return NextResponse.json({
      settings: masked,
      configured: getConfiguredFlags(settings),
    });
  } catch (error) {
    console.error("Failed to read settings:", error);
    return NextResponse.json(
      { error: "Failed to read settings" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { settings?: Partial<MovieNightSettings> };
    if (!body.settings || typeof body.settings !== "object") {
      return NextResponse.json(
        { error: "settings object is required" },
        { status: 400 },
      );
    }

    const current = await getSettings();
    const merged = mergeSettingsUpdate(current, body.settings);
    const validationError = validateSettings(merged);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { requiresRestart } = await saveSettings(merged);
    const masked = maskSettings(merged);

    return NextResponse.json({
      message: "Settings saved",
      settings: masked,
      configured: getConfiguredFlags(merged),
      requiresRestart,
    });
  } catch (error) {
    console.error("Failed to save settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 },
    );
  }
}
