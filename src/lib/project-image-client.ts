export const PROJECT_IMAGE_MAX_BYTES = 512 * 1024;
export const PROJECT_IMAGE_MAX_DIMENSION = 128;
export const PROJECT_IMAGE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

const PROJECT_IMAGE_OUTPUT_TYPE = "image/webp";
const PROJECT_IMAGE_QUALITY_STEPS = [0.82, 0.72, 0.6, 0.45] as const;

export type ImageDimensions = {
  width: number;
  height: number;
};

export function fitImageWithinBounds(
  { width, height }: ImageDimensions,
  maxDimension = PROJECT_IMAGE_MAX_DIMENSION,
): ImageDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxDimension) ||
    width <= 0 ||
    height <= 0 ||
    maxDimension <= 0
  ) {
    throw new Error("Image dimensions are invalid");
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressProjectImageFile(file: File): Promise<string> {
  if (file.size > PROJECT_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("Choose an image under 10MB so it can be optimized");
  }

  const image = await loadImage(file);
  const size = fitImageWithinBounds({
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image for upload");
  }
  context.drawImage(image, 0, 0, size.width, size.height);

  let smallestBlob: Blob | null = null;
  for (const quality of PROJECT_IMAGE_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, PROJECT_IMAGE_OUTPUT_TYPE, quality);
    if (!smallestBlob || blob.size < smallestBlob.size) {
      smallestBlob = blob;
    }
    if (blob.size <= PROJECT_IMAGE_MAX_BYTES) {
      return blobToDataUrl(blob);
    }
  }

  if (smallestBlob && smallestBlob.size <= PROJECT_IMAGE_MAX_BYTES) {
    return blobToDataUrl(smallestBlob);
  }

  throw new Error("Project image cannot exceed 512KB after compression");
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    const cleanup = () => URL.revokeObjectURL(url);
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Could not compress image"));
      },
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image"));
    };
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}
