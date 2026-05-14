export const MAX_PROJECT_IMAGE_DATA_BYTES = 512 * 1024;
export const MAX_PROJECT_IMAGE_DATA_URL_LENGTH =
  "data:image/jpeg;base64,".length + Math.ceil(MAX_PROJECT_IMAGE_DATA_BYTES / 3) * 4;

const PROJECT_IMAGE_DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i;

export function normalizeProjectImageDataUrl(input: string | null): string | null {
  if (input === null) return null;
  const trimmed = input.trim();
  const match = trimmed.match(PROJECT_IMAGE_DATA_URL_RE);
  if (!match) {
    throw new Error("Project image must be a PNG, JPG, WebP, or GIF data URL");
  }
  const mime = match[1]!.toLowerCase();
  const base64 = match[2]!;
  const maxBase64Length = Math.ceil(MAX_PROJECT_IMAGE_DATA_BYTES / 3) * 4;
  if (base64.length > maxBase64Length) {
    throw new Error("Project image cannot exceed 512KB");
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    throw new Error("Project image cannot be empty");
  }
  if (bytes.length > MAX_PROJECT_IMAGE_DATA_BYTES) {
    throw new Error("Project image cannot exceed 512KB");
  }
  if (bytes.toString("base64") !== base64) {
    throw new Error("Project image data is not valid base64");
  }
  if (!imageBytesMatchMime(bytes, mime)) {
    throw new Error("Project image data does not match its declared type");
  }

  return `data:${mime};base64,${base64}`;
}

function imageBytesMatchMime(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/gif") {
    return bytes.subarray(0, 6).equals(Buffer.from("GIF87a")) || bytes.subarray(0, 6).equals(Buffer.from("GIF89a"));
  }
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  }
  return false;
}
