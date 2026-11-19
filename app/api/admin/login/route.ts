import { NextResponse } from "next/server";
import { ADMIN_COOKIE, createAdminSession, verifyAdminCredentials } from "@/lib/adminAuth";

export async function POST(request: Request) {
  let credentials: { username?: unknown; password?: unknown };
  try {
    credentials = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid login request" }, { status: 400 });
  }

  if (typeof credentials.username !== "string" || typeof credentials.password !== "string") {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }
  if (!verifyAdminCredentials(credentials.username, credentials.password)) {
    return NextResponse.json({ error: "Incorrect username or password" }, { status: 401 });
  }

  const session = createAdminSession();
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_COOKIE, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: session.maxAge,
  });
  return response;
}
