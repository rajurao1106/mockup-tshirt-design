import { get, put } from "@vercel/blob";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogDesign } from "./designCatalog";

const CATALOG_BLOB_PATH = "catalog/designs.json";

function usesBlobStorage() {
  return process.env.VERCEL === "1"
    || Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function ensureBlobCredentials() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Set BLOB_READ_WRITE_TOKEN after connecting a Vercel Blob store to this project");
  }
}

function parseCatalog(content: string): CatalogDesign[] {
  const designs: unknown = JSON.parse(content);
  if (!Array.isArray(designs)) throw new Error("Design catalog must be a JSON array");
  return designs as CatalogDesign[];
}

async function readLocalCatalog() {
  const file = path.join(process.cwd(), "data", "designs.json");
  return parseCatalog(await readFile(file, "utf8"));
}

export async function readDesignCatalog(): Promise<CatalogDesign[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return readLocalCatalog();

  const blob = await get(CATALOG_BLOB_PATH, { access: "public" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return readLocalCatalog();

  return parseCatalog(await new Response(blob.stream).text());
}

export async function writeDesignCatalog(designs: CatalogDesign[]): Promise<void> {
  const content = JSON.stringify(designs, null, 2);
  if (!usesBlobStorage()) {
    const file = path.join(process.cwd(), "data", "designs.json");
    await writeFile(file, content, "utf8");
    return;
  }

  ensureBlobCredentials();
  await put(CATALOG_BLOB_PATH, content, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}
