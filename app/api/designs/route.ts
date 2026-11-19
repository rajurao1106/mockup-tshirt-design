import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { CatalogDesign } from "@/lib/designCatalog";

export async function GET() {
  try {
    const file = path.join(process.cwd(), "data", "designs.json");
    const designs = JSON.parse(await readFile(file, "utf8")) as CatalogDesign[];
    return NextResponse.json({ designs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not read the design catalog", error);
    return NextResponse.json({ error: "Design catalog is unavailable" }, { status: 500 });
  }
}
