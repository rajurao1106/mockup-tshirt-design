import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/adminAuth";

export async function GET() {
  const cookieStore = await cookies();
  const authenticated = isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value);
  return NextResponse.json({ authenticated }, { headers: { "Cache-Control": "no-store" } });
}
