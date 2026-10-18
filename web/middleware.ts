import { NextResponse, type NextRequest } from "next/server";
import {
  requiresLanAuth,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/lan-auth";

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (!requiresLanAuth(host)) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
