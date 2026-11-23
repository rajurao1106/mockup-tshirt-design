import { NextResponse } from "next/server";
import { generateTryOn } from "@/lib/tryonProvider";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_REQUEST_SIZE = 11 * 1024 * 1024;
const TRY_ON_LIMIT = 5;
const RATE_WINDOW = 24 * 60 * 60 * 1000;
const rateLimits = new Map<string, { count: number; expiresAt: number }>();

function isAllowedImageType(type: string) {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}

function matchesImageSignature(bytes: Uint8Array, type: string) {
  if (type === "image/png") {
    return bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return type === "image/webp"
    && bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function getRateLimit(ip: string) {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (entry.expiresAt <= now) rateLimits.delete(key);
  }
  const current = rateLimits.get(ip);
  if (current && current.expiresAt > now && current.count >= TRY_ON_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((current.expiresAt - now) / 1000) };
  }
  const next = current && current.expiresAt > now
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + RATE_WINDOW };
  rateLimits.set(ip, next);
  return { allowed: true, retryAfter: 0 };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_SIZE) {
    return NextResponse.json({ error: "Total try-on upload must be 11 MB or less." }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid try-on upload. Please choose your photo and try again." }, { status: 400 });
  }
  const personFile = form.get("personImage");
  const shirtFile = form.get("shirtImage");
  if (form.get("consent") !== "true") {
    return NextResponse.json({ error: "Permission is required to process your photo." }, { status: 400 });
  }
  if (!(personFile instanceof File) || !(shirtFile instanceof File)) {
    return NextResponse.json({ error: "Upload both your photo and the shirt design." }, { status: 400 });
  }
  if (!isAllowedImageType(personFile.type) || shirtFile.type !== "image/png") {
    return NextResponse.json({ error: "Upload a JPG, PNG, or WebP photo and a PNG shirt design." }, { status: 400 });
  }
  if (personFile.size < 1 || personFile.size > MAX_IMAGE_SIZE || shirtFile.size < 1 || shirtFile.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Each try-on image must be 5 MB or less." }, { status: 400 });
  }

  const personBytes = new Uint8Array(await personFile.arrayBuffer());
  const shirtBytes = new Uint8Array(await shirtFile.arrayBuffer());
  if (!matchesImageSignature(personBytes, personFile.type) || !matchesImageSignature(shirtBytes, shirtFile.type)) {
    return NextResponse.json({ error: "One of the uploaded files is not a valid image." }, { status: 400 });
  }

  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    return NextResponse.json({ error: "AI Try-On is not configured yet. Please try again later." }, { status: 503 });
  }

  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = (forwardedIp || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 128);
  const rateLimit = getRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "You’ve reached the limit of 5 try-ons in 24 hours. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfter) } },
    );
  }

  try {
    const image = await generateTryOn(
      { data: personBytes, contentType: personFile.type },
      { data: shirtBytes, contentType: shirtFile.type },
    );
    return new Response(image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Try-on generation timed out. Please try again.") {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    console.error("AI try-on request failed");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "AI preview could not be generated. Please try again." },
      { status: 502 },
    );
  }
}
