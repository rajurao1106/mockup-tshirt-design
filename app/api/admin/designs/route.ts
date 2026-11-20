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

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid edit form" }, { status: 400 });
  }

  const id = String(form.get("id") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const category = String(form.get("category") ?? "");
  const popular = form.get("popular");
  const file = form.get("file");

  if (!id) {
    return NextResponse.json({ error: "Design ID is required" }, { status: 400 });
  }
  if (!title || title.length > 60) {
    return NextResponse.json({ error: "Design name must be between 1 and 60 characters" }, { status: 400 });
  }
  if (!DESIGN_CATEGORIES.includes(category as (typeof DESIGN_CATEGORIES)[number])) {
    return NextResponse.json({ error: "Choose a valid design category" }, { status: 400 });
  }
  if (popular !== "true" && popular !== "false") {
    return NextResponse.json({ error: "Choose whether the design is popular" }, { status: 400 });
  }
  if (file !== null && (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) {
    return NextResponse.json({ error: "Upload a PNG, JPG, or WebP image" }, { status: 400 });
  }
  if (file instanceof File && (file.size < 1 || file.size > 5 * 1024 * 1024)) {
    return NextResponse.json({ error: "Image size must be under 5 MB" }, { status: 400 });
  }

  const catalogPath = path.join(process.cwd(), "data", "designs.json");
  let current: CatalogDesign[];
  try {
    current = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogDesign[];
    if (!Array.isArray(current)) throw new Error("Design catalog must be a JSON array");
  } catch (error) {
    console.error("Could not read the design catalog for editing", error);
    return NextResponse.json({ error: "Design catalog is unavailable" }, { status: 500 });
  }

  const index = current.findIndex((design) => design.id === id);
  if (index < 0) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  let imageUrl: string | undefined;
  if (file instanceof File) {
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
    if (!cloudName || !uploadPreset) {
      return NextResponse.json({ error: "Cloudinary cloud name and unsigned upload preset must be configured" }, { status: 503 });
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
    imageUrl = uploadResult.secure_url;
  }

  const design: CatalogDesign = {
    ...current[index],
    title,
    category: category as CatalogDesign["category"],
    popular: popular === "true",
    ...(imageUrl ? { imageUrl } : {}),
  };
  current[index] = design;

  try {
    await writeFile(catalogPath, JSON.stringify(current, null, 2), "utf8");
  } catch (error) {
    console.error("Could not save edited design metadata", error);
    return NextResponse.json(
      { error: file instanceof File ? "Image uploaded, but design details could not be saved" : "Design details could not be saved" },
      { status: 500 },
    );
  }

  return NextResponse.json({ design });
}

export async function DELETE(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAdminSession(cookieStore.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }

  let payload: { id?: unknown };
  try {
    payload = await request.json() as { id?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid delete request" }, { status: 400 });
  }
  const id = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "Design ID is required" }, { status: 400 });
  }

  const catalogPath = path.join(process.cwd(), "data", "designs.json");
  let current: CatalogDesign[];
  try {
    current = JSON.parse(await readFile(catalogPath, "utf8")) as CatalogDesign[];
    if (!Array.isArray(current)) throw new Error("Design catalog must be a JSON array");
  } catch (error) {
    console.error("Could not read the design catalog for deletion", error);
    return NextResponse.json({ error: "Design catalog is unavailable" }, { status: 500 });
  }

  if (!current.some((design) => design.id === id)) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  try {
    await writeFile(catalogPath, JSON.stringify(current.filter((design) => design.id !== id), null, 2), "utf8");
  } catch (error) {
    console.error("Could not delete design metadata", error);
    return NextResponse.json({ error: "Design could not be removed from the customer library" }, { status: 500 });
  }

  return NextResponse.json({ deletedId: id });
}
