import { NextResponse } from "next/server";

export const runtime = "nodejs";

const HELPER_URL =
  process.env.STACK_HELPER_URL?.trim() ||
  "http://host.docker.internal:18097";

async function helperFetch(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${HELPER_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const data = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error =
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `Stack helper returned ${response.status}`;
      return { ok: false, error, status: response.status };
    }
    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Stack helper timed out"
        : error instanceof Error
          ? error.message
          : "Stack helper unreachable";
    return {
      ok: false,
      error: `${message}. Run web\\start-stack.ps1 on this PC to start the helper.`,
      status: 503,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const result = await helperFetch("/health");
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, helper: false, error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, helper: true });
}

export async function POST() {
  const result = await helperFetch("/remount", { method: "POST" });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    message:
      "Remounting drives and recreating containers. The site may briefly disconnect — refresh in a few seconds.",
  });
}
