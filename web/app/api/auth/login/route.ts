import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  requiresLanAuth,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  verifyPassword,
} from "@/lib/lan-auth";

export async function POST(request: NextRequest) {
  const host = request.headers.get("host");
  if (!requiresLanAuth(host)) {
    return NextResponse.json(
      { error: "Sign-in is not required on this address." },
      { status: 400 },
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!verifyPassword(body.password ?? "")) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const token = await createSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "LAN sign-in is not configured." },
      { status: 503 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return response;
}
