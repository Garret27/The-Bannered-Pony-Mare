import { NextResponse } from "next/server";
import { readRedirects, writeRedirects, validateRedirectsConfig } from "@/lib/redirects";
import type { RedirectsConfig } from "@/lib/redirects";

export const runtime = "nodejs";

export async function GET() {
  try {
    const redirects = await readRedirects();
    return NextResponse.json(redirects);
  } catch (error) {
    console.error("Failed to read redirects:", error);
    return NextResponse.json(
      { error: "Failed to read redirects" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Partial<RedirectsConfig>;

    if (!validateRedirectsConfig(body)) {
      return NextResponse.json(
        { error: "Invalid redirects. Each entry needs a valid URL and status (200, 301, or 302)." },
        { status: 400 },
      );
    }

    await writeRedirects(body);
    const redirects = await readRedirects();

    return NextResponse.json({
      message: "Redirects saved",
      redirects,
    });
  } catch (error) {
    console.error("Failed to write redirects:", error);
    return NextResponse.json(
      { error: "Failed to save redirects" },
      { status: 500 },
    );
  }
}
