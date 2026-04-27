export const TITLE_WAITING = "Waiting for initial prompt...";
export const TITLE_GENERATING = "Generating title...";

export function isSentinelTitle(title: string): boolean {
  return title === TITLE_WAITING || title === TITLE_GENERATING;
}
