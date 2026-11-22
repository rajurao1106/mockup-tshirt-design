import { NextResponse } from "next/server";
import { readDesignCatalog } from "@/lib/designCatalogStore";

export async function GET() {
  try {
    const designs = await readDesignCatalog();
    return NextResponse.json({ designs }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Could not read the design catalog", error);
    const message = error instanceof Error ? error.message : "Design catalog is unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
