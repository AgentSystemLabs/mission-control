// Loopback host helpers shared by renderer + (limited) shared modules.
// Centralizes the list of hostnames we treat as "this machine" so URL parsing
// + regex matching stay in sync.

export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

export function isLoopbackHost(host: string): boolean {
  return (LOOPBACK_HOSTS as readonly string[]).includes(host);
}

// Matches `http(s)://<loopback>(:port)?(/path)?` with capture group 1 = port.
// Hosts: localhost, 127.0.0.1, [::1]. (Bare ::1 isn't valid in a URL.)
export const LOOPBACK_URL_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?(?:\/[^\s'"<>)\]]*)?/g;
