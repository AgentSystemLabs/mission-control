/**
 * Every `set-cookie` value on a fetch `Headers` object as a separate string.
 *
 * Prefers the spec'd `getSetCookie()` (Node 19.7+/undici) and falls back to
 * splitting the comma-joined legacy value on cookie boundaries only — never on
 * the commas inside an `Expires=` date.
 */
export function getSetCookieHeaders(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = withGetSetCookie.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}
