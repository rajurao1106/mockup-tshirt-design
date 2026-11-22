import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminSession } from "@/lib/adminAuth";
import { DESIGN_CATEGORIES, type CatalogDesign } from "@/lib/designCatalog";
import { readDesignCatalog, writeDesignCatalog } from "@/lib/designCatalogStore";

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

  let current: CatalogDesign[];
  try {
    current = await readDesignCatalog();
  } catch (error) {
    console.error("Could not read the design catalog before upload", error);
    const message = error instanceof Error ? error.message : "Design catalog is unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
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

  try {
    await writeDesignCatalog([design, ...current]);
  } catch (error) {
    console.error("Could not save uploaded design metadata", error);
    const message = error instanceof Error ? error.message : "catalog could not be saved";
    return NextResponse.json({ error: `Image uploaded, but ${message}` }, { status: 500 });
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

  let current: CatalogDesign[];
  try {
    current = await readDesignCatalog();
  } catch (error) {
    console.error("Could not read the design catalog for editing", error);
    const message = error instanceof Error ? error.message : "Design catalog is unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
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
    await writeDesignCatalog(current);
  } catch (error) {
    console.error("Could not save edited design metadata", error);
    const message = error instanceof Error ? error.message : "Design details could not be saved";
    return NextResponse.json(
      { error: file instanceof File ? `Image uploaded, but ${message}` : message },
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

  let current: CatalogDesign[];
  try {
    current = await readDesignCatalog();
  } catch (error) {
    console.error("Could not read the design catalog for deletion", error);
    const message = error instanceof Error ? error.message : "Design catalog is unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (!current.some((design) => design.id === id)) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  try {
    await writeDesignCatalog(current.filter((design) => design.id !== id));
  } catch (error) {
    console.error("Could not delete design metadata", error);
    const message = error instanceof Error ? error.message : "Design could not be removed from the customer library";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ deletedId: id });
}
