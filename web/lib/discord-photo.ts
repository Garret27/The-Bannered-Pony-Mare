import { getDiscordConfig } from "./discord-announcements";
import type { Event } from "./paths";
import { getImageMime } from "./vrchat-photos";

export async function postPhotoToDiscord(
  event: Event,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const config = getDiscordConfig(event);

  if (!config.webhookUrl) {
    return {
      ok: false,
      error: "Discord webhook is not configured for this event.",
    };
  }

  const content = (caption ?? "").trim();
  if (content.length > 2000) {
    return {
      ok: false,
      error: "Caption exceeds Discord's 2000 character limit.",
    };
  }

  const mime = getImageMime(filename);
  const payload = {
    content,
    allowed_mentions: { parse: [] as string[] },
  };

  const formData = new FormData();
  formData.append("payload_json", JSON.stringify(payload));
  formData.append(
    "files[0]",
    new Blob([new Uint8Array(buffer)], { type: mime }),
    filename,
  );

  const response = await fetch(config.webhookUrl, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      error: body || `Discord returned ${response.status}`,
      status: response.status,
    };
  }

  return { ok: true };
}
