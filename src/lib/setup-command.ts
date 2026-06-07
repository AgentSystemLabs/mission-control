export function setupCommandNeedsPackageJson(command: string): boolean {
  return /(?:^|[\n;&|])\s*(?:corepack\s+)?(?:(?:npm)\s+(?:i|install|ci)|(?:pnpm|yarn|bun)\s+(?:i|install))\b/.test(
    command,
  );
}
