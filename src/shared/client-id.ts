/** Client-side id generator matching the server's `${prefix}-${base36 ts}-${6 hex}` shape. */
export function newClientId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 6)
      : Math.random().toString(16).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${suffix}`;
}

const DOMAIN_ID = /^[a-z][a-z0-9]*-[a-z0-9]+-[a-f0-9]{6,}$/i;

export function isClientDomainId(id: string): boolean {
  return DOMAIN_ID.test(id);
}
