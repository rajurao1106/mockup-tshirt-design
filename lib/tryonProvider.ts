const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const PROMPT =
  "Image 0 is the customer photo. Image 1 is the t-shirt. Dress the exact person from image 0 in the exact t-shirt from image 1. Do not change the person's face, gender, age, hair, skin tone, pose, body shape or background. Copy the t-shirt colour, graphic, artwork and all text exactly from image 1 and do not invent any new text or logos. Photorealistic, natural fabric folds and lighting.";

export interface TryOnImage {
  data: Uint8Array;
  contentType: string;
}

interface CloudflareRunResponse {
  result?: { image?: unknown };
  success?: boolean;
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function generateTryOn(personImage: TryOnImage, shirtImage: TryOnImage): Promise<ArrayBuffer> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error("Cloudflare AI is not configured");
  }

  const body = new FormData();
  body.append("prompt", PROMPT);
  body.append("input_image_0", new Blob([toArrayBuffer(personImage.data)], { type: personImage.contentType }), "person-photo");
  body.append("input_image_1", new Blob([toArrayBuffer(shirtImage.data)], { type: shirtImage.contentType }), "shirt-design.png");

  body.append("width", "768");
  body.append("height", "1024");

  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODEL}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}` },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Try-on generation timed out. Please try again.");
    }
    throw new Error("AI preview is temporarily unavailable. Please try again.");
  }

  if (!response.ok) {
    console.error("Cloudflare try-on error", response.status, (await response.text().catch(() => "")).slice(0, 500));
    throw new Error("AI preview could not be generated. Please try again.");
  }

  let result: CloudflareRunResponse;
  try {
    result = await response.json() as CloudflareRunResponse;
  } catch {
    throw new Error("AI preview returned an invalid response. Please try again.");
  }
  if (typeof result.result?.image !== "string" || !result.result.image) {
    throw new Error("AI preview did not return an image. Please try again.");
  }

  const encodedImage = result.result.image.replace(/^data:image\/[^;]+;base64,/, "");
  const image = Buffer.from(encodedImage, "base64");
  if (image.length === 0) {
    throw new Error("AI preview returned an invalid image. Please try again.");
  }
  return toArrayBuffer(image);
}