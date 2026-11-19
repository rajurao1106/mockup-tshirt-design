import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/adminAuth";
import { DESIGN_CATEGORIES, type CatalogDesign } from "@/lib/designCatalog";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }

  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) {
    return NextResponse.json({ error: "Cloudinary cloud name and unsigned upload preset must be configured" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload form" }, { status: 400 });
  }
  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const category = String(form.get("category") ?? "");
  const popular = form.get("popular") === "true";

  if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return NextResponse.json({ error: "Upload a PNG, JPG, or WebP image" }, { status: 400 });
  }
  if (file.size < 1 || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Image size must be under 5 MB" }, { status: 400 });
  }
  if (!title || title.length > 60) {
    return NextResponse.json({ error: "Design name must be between 1 and 60 characters" }, { status: 400 });
  }
  if (!DESIGN_CATEGORIES.includes(category as (typeof DESIGN_CATEGORIES)[number])) {
    return NextResponse.json({ error: "Choose a valid design category" }, { status: 400 });
  }

  const uploadForm = new FormData();
  uploadForm.append("file", file, file.name);
  uploadForm.append("upload_preset", uploadPreset);
  uploadForm.append("folder", "mockwear/designs");
  const uploaded = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: "POST",
    body: uploadForm,
    cache: "no-store",
  });
  const uploadResult = await uploaded.json() as { secure_url?: string; error?: { message?: string } };
  if (!uploaded.ok || !uploadResult.secure_url) {
    return NextResponse.json(
      { error: uploadResult.error?.message ?? "Cloudinary image upload failed" },
      { status: 502 },
    );
  }

  const design: CatalogDesign = {
    id: randomUUID(),
    title,
    category: category as CatalogDesign["category"],
    imageUrl: uploadResult.secure_url,
    popular,
    createdAt: new Date().toISOString(),
  };
  const catalogPath = path.join(process.cwd(), "data", "designs.json");

  try {
    const current = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogDesign[];
    if (!Array.isArray(current)) throw new Error("Design catalog must be a JSON array");
    await writeFile(catalogPath, JSON.stringify([design, ...current], null, 2), "utf8");
  } catch (error) {
    console.error("Could not save uploaded design metadata", error);
    return NextResponse.json({ error: "Image uploaded, but catalog could not be saved" }, { status: 500 });
  }

  return NextResponse.json({ design }, { status: 201 });
}
