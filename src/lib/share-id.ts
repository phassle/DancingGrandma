// RFC 4122 UUIDs: versions 1-8 with the variant bits set to 8, 9, a, or b.
export const SHARE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isShareId(value: string): boolean {
  return SHARE_ID_PATTERN.test(value);
}
