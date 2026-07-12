// Generic "I'm working on something" one-liners for OTHER people's pets. These
// are picked at random on the receiving machine — nothing about the remote
// user's actual work is ever known or sent, so these are intentionally vague
// and cute (no AI, no inference).

const REMOTE_PET_MESSAGES = [
  "heads down on something ✨",
  "deep in the code mines ⛏️",
  "cooking up a feature 🍳",
  "shipping something cool 🚀",
  "wrangling some bugs 🐛",
  "in the zone rn 🎧",
  "building, building, building 🧱",
  "chasing a green checkmark ✅",
  "refactoring vibes 🧹",
  "typing furiously ⌨️",
  "making the thing work 🔧",
  "on a little coding quest 🗺️",
  "brewing up commits ☕",
  "tinkering away 🛠️",
  "focused and thriving 🌱",
  "poking at the codebase 👀",
  "one more thing then done 😅",
  "here to keep you company 💜",
] as const;

/**
 * Pick a cute message. Deterministic given `seed` (so a given peer keeps a
 * stable-ish message between renders) but varied across peers — avoids
 * Math.random churn on every render.
 */
export function pickRemotePetMessage(seed: string, salt = 0): string {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  const idx = Math.abs(h) % REMOTE_PET_MESSAGES.length;
  return REMOTE_PET_MESSAGES[idx];
}

export const REMOTE_PET_MESSAGE_COUNT = REMOTE_PET_MESSAGES.length;
