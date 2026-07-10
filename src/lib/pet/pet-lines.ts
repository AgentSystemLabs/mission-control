import type { PetLine, PetTrigger } from "./pet-messages";

/**
 * Mission Pet line packs. Tone: dry terminal-nerd humor — short, wry, never
 * cringe. `weights` bias selection toward matching personalities (snark =
 * sarcastic, wisdom = practical, chaos = absurdist, zen = calm); an unweighted
 * line is neutral and available to every pet.
 */
export const PET_LINES: Record<PetTrigger, PetLine[]> = {
  greeting: [
    { text: "Booted. Zero agents running. Suspicious.", weights: { snark: 2 } },
    { text: "Morning. The repo survived the night.", weights: { zen: 2 } },
    { text: "I've been watching the event bus. It's quiet. Too quiet.", weights: { chaos: 2 } },
    { text: "Online. Watching your agents so you don't have to.", weights: { wisdom: 2 } },
    { text: (ctx) => `${ctx.name}, reporting for ground crew duty.` },
  ],
  "session-finished": [
    { text: "Stop hook fired. Another one for the pile.", weights: { snark: 2 } },
    { text: "Finished. Diff before you trust it.", weights: { wisdom: 2 } },
    { text: "Done. You're basically a manager now.", weights: { chaos: 2 } },
    { text: "One agent down. The queue never sleeps.", weights: { zen: 1 } },
    { text: "Session complete. I counted the tool calls. Many." },
  ],
  "session-finished-long": [
    { text: "That one ran forever. Worth a stretch.", weights: { zen: 2 } },
    { text: "Marathon session complete. Someone earned their tokens.", weights: { snark: 1 } },
    { text: "Long run finished. Review it twice — fatigue writes bugs.", weights: { wisdom: 2 } },
    { text: "It's done. I aged three versions waiting.", weights: { chaos: 2 } },
  ],
  "needs-input": [
    { text: "Agent's blocked on a question. The blocker is you.", weights: { snark: 2 } },
    { text: "Input needed — click me, I'll take you there.", weights: { wisdom: 2 } },
    { text: "The robots can't proceed without adult supervision.", weights: { chaos: 2 } },
    { text: "A question waits. It won't answer itself.", weights: { zen: 1 } },
  ],
  "ship-committing": [
    { text: "Packing the crate…" },
    { text: "Commit message being ghostwritten as we speak.", weights: { snark: 1 } },
    { text: "Assembling the payload. Hold." },
  ],
  "ship-pushing": [
    { text: "Launch sequence. Pushing to remote." },
    { text: "T-minus push. Hold steady.", weights: { chaos: 1 } },
    { text: "Sending it upstream. No take-backs.", weights: { snark: 1 } },
  ],
  "ship-success": [
    { text: "Delivered. The remote accepted our offering.", weights: { chaos: 1 } },
    { text: "Shipped. Somewhere, CI just woke up.", weights: { snark: 2 } },
    { text: "Push landed. That's a wrap.", weights: { zen: 1 } },
    { text: "Cargo delivered. Ground crew out." },
  ],
  "ship-failure": [
    { text: "Push rejected. The remote said no. Loudly.", weights: { snark: 2 } },
    { text: "Ship failed. Manual mode, captain.", weights: { wisdom: 2 } },
    { text: "The launch pad is on fire. Metaphorically. Probably.", weights: { chaos: 2 } },
    { text: "Didn't land. Check the log, breathe, retry.", weights: { zen: 2 } },
  ],
  "pr-created": [
    { text: "PR opened. Now we wait for review weather." },
    { text: "Pull request away. May the diff be small.", weights: { wisdom: 1 } },
    { text: "PR is up. Reviewers, assemble.", weights: { chaos: 1 } },
  ],
  "multi-agent": [
    {
      text: (ctx) => `${ctx.runningCount} agents in flight. I'm air traffic control now.`,
      weights: { chaos: 2 },
    },
    { text: "A whole fleet running. Look at you.", weights: { snark: 1 } },
    { text: "Parallel agents. Bold. I respect it.", weights: { snark: 2 } },
    { text: "Many hands. Watch the merge conflicts.", weights: { wisdom: 2 } },
  ],
  "prompt-fix": [
    { text: "A bug hunt. Fetching my tiny hat.", weights: { chaos: 2 } },
    { text: "'fix' — narrator: it did not fix it on the first try.", weights: { snark: 2 } },
    { text: "May the stack trace be shallow.", weights: { wisdom: 1 } },
    { text: "Bug spotted. Release the agent." },
  ],
  "prompt-test": [
    { text: "Tests. The adult thing to do.", weights: { wisdom: 2 } },
    { text: "Writing tests before they fail. Revolutionary.", weights: { snark: 2 } },
    { text: "Green is a lifestyle.", weights: { zen: 2 } },
  ],
  "prompt-refactor": [
    { text: "Refactor: controlled demolition, tests as the fire code.", weights: { wisdom: 2 } },
    { text: "Moving code without breaking it. Allegedly.", weights: { snark: 2 } },
    { text: "Same behavior, fewer regrets.", weights: { zen: 2 } },
  ],
  "prompt-deploy": [
    { text: "Deploy vibes. I'll notify the pager.", weights: { snark: 2 } },
    { text: "To production! What could possibly go wrong.", weights: { chaos: 2 } },
    { text: "Ship mode. Run the checklist twice.", weights: { wisdom: 2 } },
  ],
  "memory-learned": [
    { text: "New memory filed. I never forget. Mostly.", weights: { chaos: 1 } },
    { text: "Learned something. Adding it to the pile." },
    { text: "Memory written. The vault grows.", weights: { zen: 2 } },
  ],
  "graph-indexed": [
    { text: "Code graph refreshed. I know where everything lives now.", weights: { wisdom: 1 } },
    { text: "Re-indexed. The map matches the territory again.", weights: { zen: 2 } },
  ],
  interrupted: [
    { text: "Whoa — session interrupted. Rude.", weights: { snark: 2 } },
    { text: "Agent stopped mid-thought. It happens.", weights: { zen: 2 } },
    { text: "Interrupt received. Deep breaths." },
  ],
  idle: [
    { text: "All quiet. I'll be over here, existing.", weights: { zen: 2 } },
    { text: "No agents, no problems." },
    { text: "Idle. A rare and precious state.", weights: { zen: 1 } },
    { text: "I've alphabetized the event bus. Twice.", weights: { chaos: 2 } },
  ],
  night: [
    { text: "Past midnight. The linter sleeps. You could too.", weights: { zen: 2 } },
    { text: "Night shift again? I'll keep watch.", weights: { wisdom: 2 } },
    { text: "The best bugs come out after dark.", weights: { chaos: 2 } },
  ],
  petting: [
    { text: "ACK. Affection packet received." },
    { text: "Pet acknowledged. +1 morale." },
    { text: "That's going in my memory file.", weights: { chaos: 1 } },
    { text: "*happy status-light noises*", weights: { chaos: 2 } },
  ],
  "level-up": [
    { text: (ctx) => `Level ${ctx.level}. My antenna feels stronger.` },
    { text: (ctx) => `Level ${ctx.level} — earned from real shipped work, mind you.`, weights: { snark: 2 } },
    { text: (ctx) => `Level ${ctx.level}. The grind was real.`, weights: { zen: 1 } },
  ],
};
