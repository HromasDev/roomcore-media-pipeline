export const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const PREVIEW_WIDTHS = [320, 800, 1600] as const;

const EXTENSIONS: Record<AllowedContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedContentType(value: string): value is AllowedContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(value);
}

// Имя файла от клиента в ключ не попадает: только id и расширение по типу содержимого
export function originalKey(fileId: string, contentType: AllowedContentType): string {
  return `${fileId}/original.${EXTENSIONS[contentType]}`;
}

export function previewKey(fileId: string, width: number): string {
  return `${fileId}/${width}.webp`;
}
