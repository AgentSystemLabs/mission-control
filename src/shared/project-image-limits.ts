/** Max upload size for project card images (Electron picker + app:// handler). */
export const MAX_PROJECT_IMAGE_BYTES = 5 * 1024 * 1024;

/** File extensions accepted for project card images. */
export const PROJECT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

export const PROJECT_IMAGE_EXTENSION_SET = new Set<string>(PROJECT_IMAGE_EXTENSIONS);
