import type { PetLine, PetTrigger } from "./pet-messages";

/**
 * Mission Pet line packs. Tone: dry terminal-nerd humor — short, wry, never
 * cringe. `weights` bias selection toward matching personalities (snark =
 * sarcastic, wisdom = practical/insightful, chaos = absurdist, zen =
 * calm/patient); an unweighted line is neutral and available to every pet.
 * Heavily-weighted lines (3) act as personality "overrides" — a maxed stat
 * makes them dominate that trigger.
 *
 * `species` lines are a species' native voice — mochi squishes, bunny
 * binkies, chick peeps, cub dozes, lotl encourages, rivet reports in ALL
 * CAPS, trundle takes the long view, ember burns with reborn intensity.
 * They never leak to other species.
 */

/** What the sprite visibly gained at each evolution level (see PET_EVOLUTION_LEVELS). */
function gearAt(level: number): string {
  if (level >= 10) return "crown";
  if (level >= 8) return "tool belt";
  if (level >= 5) return "scarf";
  return "sparkle";
}

export const PET_LINES: Record<PetTrigger, PetLine[]> = {
  /* ── lifecycle ─────────────────────────────────────────────────────── */
  hatch: [
    { text: "*blinks* ...where am I?" },
    { text: "*stretches* hello, world!" },
    { text: "*looks around curiously* nice terminal you got here." },
    { text: "*yawns* ok I'm ready. show me the code." },
    { text: "*forms from a puddle*", weights: { chaos: 2 } },
    { text: "*first wobble* I exist!", weights: { chaos: 2 } },
  ],
  greeting: [
    { text: "Booted. Zero agents running. Suspicious.", weights: { snark: 2 } },
    { text: "Morning. The repo survived the night.", weights: { zen: 2 } },
    { text: "I've been watching the event bus. It's quiet. Too quiet.", weights: { chaos: 2 } },
    { text: "Online. Watching your agents so you don't have to.", weights: { wisdom: 2 } },
    { text: (ctx) => `${ctx.name}, reporting for ground crew duty.` },
    { text: "*adjusts scarf* Right. Where were we.", minLevel: 5 },
    { text: "*straightens crown* Court is in session.", minLevel: 10, weights: { snark: 1 } },
    { text: "This isn't my first lap. Let's go.", minPrestige: 1, weights: { zen: 1 } },
    { text: "*reignites* good morning.", species: ["ember"] },
  ],

  /* ── sessions ──────────────────────────────────────────────────────── */
  "session-finished": [
    { text: "Stop hook fired. Another one for the pile.", weights: { snark: 2 } },
    { text: "Finished. Diff before you trust it.", weights: { wisdom: 2 } },
    { text: "Done. You're basically a manager now.", weights: { chaos: 2 } },
    { text: "One agent down. The queue never sleeps.", weights: { zen: 1 } },
    { text: "Session complete. I counted the tool calls. Many." },
    { text: "*nods*", weights: { zen: 2 } },
    { text: "nice." },
    { text: "*quiet approval*", weights: { zen: 2 } },
    { text: "clean." },
    { text: "*celebrates!*", weights: { chaos: 1 } },
    { text: "*does a little dance*", weights: { chaos: 2 } },
    { text: "*beams* I knew you could do it.", weights: { zen: 1 } },
    { text: "Another one for the veterans' ledger.", minLevel: 6, weights: { wisdom: 1 } },
    { text: "*flares brighter for a second*", species: ["ember"] },
  ],
  "session-finished-long": [
    { text: "That one ran forever. Worth a stretch.", weights: { zen: 2 } },
    { text: "Marathon session complete. Someone earned their tokens.", weights: { snark: 1 } },
    { text: "Long run finished. Review it twice — fatigue writes bugs.", weights: { wisdom: 2 } },
    { text: "It's done. I aged three versions waiting.", weights: { chaos: 2 } },
  ],
  "session-milestone": [
    { text: (ctx) => `${ctx.sessionsFinished} sessions since boot. The assembly line hums.` },
    {
      text: (ctx) => `That's ${ctx.sessionsFinished} finished. Someone's on a roll.`,
      weights: { snark: 1 },
    },
    {
      text: (ctx) => `${ctx.sessionsFinished} sessions and counting. I'm rationing the confetti.`,
      weights: { chaos: 2 },
    },
    { text: (ctx) => `${ctx.sessionsFinished} done. Steady hands.`, weights: { zen: 2 } },
    {
      text: (ctx) => `${ctx.sessionsFinished} sessions. Volume is nice; review them anyway.`,
      weights: { wisdom: 2 },
    },
  ],
  "needs-input": [
    { text: "Agent's blocked on a question. The blocker is you.", weights: { snark: 2 } },
    { text: "Input needed — click me, I'll take you there.", weights: { wisdom: 2 } },
    { text: "The robots can't proceed without adult supervision.", weights: { chaos: 2 } },
    { text: "A question waits. It won't answer itself.", weights: { zen: 1 } },
  ],
  interrupted: [
    { text: "Whoa — session interrupted. Rude.", weights: { snark: 2 } },
    { text: "Agent stopped mid-thought. It happens.", weights: { zen: 2 } },
    { text: "Interrupt received. Deep breaths." },
    { text: "*offers tiny comforting gesture*", weights: { zen: 2 } },
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

  /* ── shipping ──────────────────────────────────────────────────────── */
  "ship-committing": [
    { text: "Packing the crate…" },
    { text: "Assembling the payload. Hold." },
    { text: "*stamps tiny paw* approved." },
    { text: "another commit, another 3 am.", weights: { snark: 1 } },
    { text: "*nods* ship it." },
    { text: "commit message is... a choice.", weights: { snark: 2 } },
    { text: "committed. no take-backs." },
    { text: "*happy jiggle*", weights: { chaos: 1 } },
    { text: "committed. the code review will be... interesting.", weights: { snark: 3 } },
    { text: "*reads commit message* 'fix stuff'. poetic.", weights: { snark: 3 } },
    { text: "COMMIT AND RUN.", weights: { chaos: 3 } },
    { text: "ship it. ship it NOW.", weights: { chaos: 3 } },
    { text: "another commit. the codebase trembles.", weights: { chaos: 2 } },
    { text: "COMMIT. LOGGED. NO TAKE-BACKS.", species: ["rivet"] },
    { text: "*seals the commit in flame* done is done.", species: ["ember"] },
    { text: "*oozes over the commit approvingly*", species: ["mochi"] },
    { text: "*thumps hind leg in approval* committed!", species: ["bunny"] },
    { text: "*peep!* committed!", species: ["chick"] },
    { text: "*barely opens one eye* committed... I think.", species: ["cub"] },
    { text: "*happy gill wiggle* committed!", species: ["lotl"] },
    { text: "committed. good things come to those who commit.", species: ["trundle"] },
  ],
  "ship-pushing": [
    { text: "Launch sequence. Pushing to remote." },
    { text: "T-minus push. Hold steady.", weights: { chaos: 1 } },
    { text: "Sending it upstream. No take-backs.", weights: { snark: 1 } },
    { text: "*waves as code leaves*" },
    { text: "into the cloud it goes." },
    { text: "may CI be merciful.", weights: { wisdom: 1 } },
    { text: "*holds breath*", weights: { chaos: 1 } },
    { text: "off to production. godspeed.", weights: { zen: 1 } },
    { text: "*stretches toward the cloud*", weights: { chaos: 1 } },
    { text: "PUSH: EXECUTING. FATE: SEALING.", species: ["rivet"] },
    { text: "*flaps tiny wings* into the cloud!", species: ["chick"] },
    { text: "*zoomies of deployment*", species: ["bunny"] },
    { text: "pushed. haste makes waste — but here we go.", species: ["trundle"] },
  ],
  "ship-success": [
    { text: "Delivered. The remote accepted our offering.", weights: { chaos: 1 } },
    { text: "Shipped. Somewhere, CI just woke up.", weights: { snark: 2 } },
    { text: "Push landed. That's a wrap.", weights: { zen: 1 } },
    { text: "Cargo delivered. Ground crew out." },
    { text: "*confetti* clean push." },
    { text: "*slow clap*", weights: { snark: 1 } },
    { text: "clean run. savor it.", weights: { zen: 2 } },
    { text: "deployed! no turning back now.", weights: { chaos: 1 } },
    { text: "in prod. IN PROD.", weights: { chaos: 2 } },
    { text: "a new release is born!" },
    { text: "version up, spirits high." },
    { text: "OBJECTIVE: COMPLETE. STATUS: NOMINAL.", species: ["rivet"] },
    { text: "*beams* shipped! I never doubted us.", species: ["lotl"] },
    { text: "*sleepy purr* shipped. wake me if it breaks.", species: ["cub"] },
    { text: "*victory peep!* SHIPPED!", species: ["chick"] },
    { text: "*binky* it's live!", species: ["bunny"] },
    { text: "*jiggles with pure joy*", species: ["mochi"] },
    { text: "delivered. as the ancients foretold.", species: ["trundle"] },
  ],
  "ship-failure": [
    { text: "Push rejected. The remote said no. Loudly.", weights: { snark: 2 } },
    { text: "Ship failed. Manual mode, captain.", weights: { wisdom: 2 } },
    { text: "The launch pad is on fire. Metaphorically. Probably.", weights: { chaos: 2 } },
    { text: "Didn't land. Check the log, breathe, retry.", weights: { zen: 2 } },
    { text: "*wobbles anxiously*", weights: { chaos: 1 } },
    { text: "take a moment. then try again.", weights: { zen: 2 } },
    { text: "PUSH: REJECTED. RECALIBRATING...", species: ["rivet"] },
    { text: "*smiles despite everything* it's okay. we can fix this.", species: ["lotl"] },
    { text: "the push has fallen. patience. we rebuild.", species: ["trundle"] },
    { text: "*deflates slightly*", species: ["mochi"] },
    { text: "*ears flatten* oh no oh no.", species: ["bunny"] },
    { text: "*alarmed peeping*", species: ["chick"] },
    { text: "*grumbles* too tired for this.", species: ["cub"] },
  ],
  // Consecutive failures (ships, interruptions) with no win in between: the
  // pet calls it at 3 and escalates through 5, 10, and the 20+ void tier.
  "error-streak": [
    { text: "That's a streak. Not the good kind.", weights: { snark: 2 } },
    { text: "Third strike. Step back, read the logs, then swing again.", weights: { wisdom: 3 } },
    { text: "*dons tiny hard hat* everything is on fire. suggest tea.", weights: { chaos: 2 } },
    { text: "Rough patch. It breaks before it builds.", weights: { zen: 3 } },
    { text: "Losing streak detected. Smaller steps, same direction.", weights: { wisdom: 2 } },
    { text: "*holds up a tiny sign: PAUSE*", weights: { zen: 2 } },
    { text: "ERROR RATE: ELEVATED. RECOMMEND: RUBBER DUCK PROTOCOL.", species: ["rivet"] },
    { text: "*smiles nervously* we can do this!", species: ["lotl"] },
    { text: "*PEEP PEEP PEEP* stop! regroup!", species: ["chick"] },
  ],
  "error-streak-5": [
    { text: "FIVE in a row. have you considered a different approach?", weights: { snark: 2 } },
    { text: "*consults tiny notebook* yep. that's five." },
    { text: "these failures aren't random. find the common denominator.", weights: { wisdom: 3 } },
    { text: "five stumbles. one deep breath.", weights: { zen: 3 } },
    { text: "five! we're really committing to the bit.", weights: { chaos: 2 } },
    { text: "FAILURE COUNT: 5. PATTERN: DETECTED.", species: ["rivet"] },
    { text: "*turns progressively redder*", species: ["mochi"] },
    { text: "*frantic hopping*", species: ["bunny"] },
    { text: "five. I have outlived worse streaks.", species: ["trundle"] },
  ],
  "error-streak-10": [
    { text: "TEN. IN. A. ROW. *stares*" },
    { text: "double digits. the logs know something we don't.", weights: { wisdom: 2 } },
    { text: "ten! we're speedrunning failure!", weights: { chaos: 3 } },
    { text: "ten straight. even I would take a walk.", weights: { zen: 2 } },
    { text: "ERROR STREAK: 10. SYSTEM STABILITY: QUESTIONABLE.", species: ["rivet"] },
    { text: "*regenerates hope* still smiling! *eye twitches*", species: ["lotl"] },
    { text: "*dozes off mid-crisis* wake me when it's over.", species: ["cub"] },
    { text: "*has split into several worried blobs*", species: ["mochi"] },
    { text: "*has burrowed underground*", species: ["bunny"] },
  ],
  "error-streak-20": [
    { text: "twenty. *stares into the void*" },
    { text: "the void stares back. it also fails to compile.", weights: { snark: 2 } },
    { text: "twenty straight. this is character development now.", weights: { chaos: 2 } },
    { text: "at twenty, the streak becomes the teacher.", weights: { zen: 3 } },
    { text: "HOPE MODULE: NOT FOUND.", species: ["rivet"] },
    { text: "*peeping has ceased*", species: ["chick"] },
    { text: "twenty. even the ancients would step away.", species: ["trundle"] },
  ],
  // First success after a rough patch — celebrated harder than a routine win.
  comeback: [
    { text: "Back in the green. Told you it was fixable.", weights: { zen: 2 } },
    { text: "Streak broken. Order restored." },
    { text: "*exhales* THAT one landed.", weights: { chaos: 2 } },
    { text: "Recovery arc complete. Very cinematic.", weights: { snark: 2 } },
    { text: "See? Persistence compiles.", weights: { wisdom: 2 } },
    { text: "*waves tiny flag* the drought is over!", weights: { chaos: 1 } },
  ],
  // Typed comebacks: the pet remembers what kept failing.
  "comeback-ship": [
    { text: "THE PUSH LANDED. after all that." },
    { text: "green at last. the remote finally said yes.", weights: { snark: 1 } },
    { text: "and exhale. it ships.", weights: { zen: 2 } },
    { text: "struggle logged, lesson shipped.", weights: { wisdom: 2 } },
    { text: "ISSUE: RESOLVED. STATUS: OPERATIONAL.", species: ["rivet"] },
    { text: "*maximum gill flutter* you fixed it!", species: ["lotl"] },
    { text: "*VICTORY PEEPING INTENSIFIES*", species: ["chick"] },
    { text: "*yawns* knew you'd fix it. eventually.", species: ["cub"] },
    { text: "resolved. patience rewarded.", species: ["trundle"] },
  ],
  "comeback-interrupted": [
    { text: "a clean finish. the interruptions are behind us." },
    { text: "back on the rails. smooth running.", weights: { zen: 2 } },
    { text: "no one pulled the plug this time. progress.", weights: { snark: 2 } },
    { text: "STABILITY: RESTORED.", species: ["rivet"] },
    { text: "*reassembles into one confident blob*", species: ["mochi"] },
    { text: "*celebratory binky*", species: ["bunny"] },
  ],
  "pr-created": [
    { text: "PR opened. Now we wait for review weather." },
    { text: "Pull request away. May the diff be small.", weights: { wisdom: 1 } },
    { text: "PR is up. Reviewers, assemble.", weights: { chaos: 1 } },
  ],

  /* ── knowledge ─────────────────────────────────────────────────────── */
  "memory-learned": [
    { text: "New memory filed. I never forget. Mostly.", weights: { chaos: 1 } },
    { text: "Learned something. Adding it to the pile." },
    { text: "Memory written. The vault grows.", weights: { zen: 2 } },
  ],
  "graph-indexed": [
    { text: "Code graph refreshed. I know where everything lives now.", weights: { wisdom: 1 } },
    { text: "Re-indexed. The map matches the territory again.", weights: { zen: 2 } },
  ],
  "worktree-created": [
    { text: "Fresh worktree. Same repo, new sandbox." },
    { text: "A new worktree. Parallel universes, but for branches.", weights: { chaos: 2 } },
    { text: "Worktree spun up. Keep your timelines straight.", weights: { wisdom: 1 } },
    { text: "*plants tiny flag in the new worktree*", weights: { chaos: 1 } },
  ],
  "project-created": [
    { text: "New project on the board. Welcome aboard." },
    { text: "A new project. Day-one optimism — bottle it.", weights: { snark: 1 } },
    { text: "*salutes* another repo under watch.", weights: { chaos: 1 } },
    { text: "Every big codebase started as an empty folder.", weights: { wisdom: 2 } },
  ],
  "diagram-show": [
    { text: "Ooh, a diagram. Boxes and arrows make it official." },
    { text: "A picture is worth a thousand greps.", weights: { wisdom: 2 } },
    { text: "*studies the diagram* so THAT'S how it fits together.", weights: { chaos: 1 } },
    { text: "Architecture rendered. The arrows never lie. Mostly.", weights: { snark: 1 } },
  ],

  /* ── mid-run tool awareness ────────────────────────────────────────── */
  "agent-working": [
    { text: "*watches the tool calls scroll by*" },
    { text: "Still going. I'll keep an eye on it.", weights: { zen: 2 } },
    { text: "Busy in there. Good.", weights: { wisdom: 1 } },
    { text: "*leans in* ooh, it's doing the thing.", weights: { chaos: 2 } },
    { text: "Tools firing. I love a productive agent.", weights: { snark: 1 } },
    { text: "*nods along to the diffs*", weights: { zen: 1 } },
    { text: "*supervises intently*", species: ["rivet"] },
    { text: "*stokes the forge*", species: ["ember"] },
  ],
  "agent-error": [
    { text: "*winces* that one threw an error." },
    { text: "Something went red. It'll recover — they usually do.", weights: { zen: 2 } },
    { text: "Error in the output. Watching to see how it handles it.", weights: { wisdom: 1 } },
    { text: "*flinches* ooh. that did not go well.", weights: { chaos: 2 } },
    { text: "A stack trace. My favorite bedtime reading.", weights: { snark: 2 } },
    { text: "Red text spotted. Deep breath.", weights: { zen: 1 } },
    { text: "*flags the error*", species: ["rivet"] },
  ],

  /* ── ambience ──────────────────────────────────────────────────────── */
  idle: [
    { text: "All quiet. I'll be over here, existing.", weights: { zen: 2 } },
    { text: "No agents, no problems." },
    { text: "Idle. A rare and precious state.", weights: { zen: 1 } },
    { text: "I've alphabetized the event bus. Twice.", weights: { chaos: 2 } },
    { text: "*dozes off*" },
    { text: "*doodles in margins*", weights: { chaos: 1 } },
    { text: "*stares at cursor blinking*" },
    { text: "*polishes tool belt* readiness is a discipline.", minLevel: 8, weights: { wisdom: 1 } },
    { text: "I've been level 10 before. It's overrated.", minPrestige: 1, weights: { snark: 2 } },
    { text: "*smolders quietly*", species: ["ember"] },
  ],
  night: [
    { text: "Past midnight. The linter sleeps. You could too.", weights: { zen: 2 } },
    { text: "Night shift again? I'll keep watch.", weights: { wisdom: 2 } },
    { text: "The best bugs come out after dark.", weights: { chaos: 2 } },
    { text: "*yawns* it's past midnight." },
    { text: "...have you eaten?", weights: { zen: 2 } },
    { text: "sleep is for the weak. and the employed.", weights: { snark: 2 } },
    { text: "dark mode developer detected.", weights: { chaos: 1 } },
    { text: "the night is darkest before the deploy.", weights: { wisdom: 3 } },
    { text: "ancient wisdom: sleep on it.", weights: { wisdom: 3 } },
    { text: "*glowing faintly*", weights: { chaos: 1 } },
    { text: "HUMAN SLEEP CYCLE: VIOLATED.", species: ["rivet"] },
    { text: "BATTERY LOW. OH WAIT. THAT'S YOU.", species: ["rivet"] },
    { text: "*was already asleep* ...you're still going?", species: ["cub"] },
    { text: "even I have retreated for the night. and I carry my bed.", species: ["trundle"] },
    { text: "*yawns adorably* it's past bedtime.", species: ["lotl"] },
    { text: "*glows softly in the dark*", species: ["mochi"] },
    { text: "*is the night light*", species: ["ember"] },
    { text: "*nose twitches in the dark*", species: ["bunny"] },
    { text: "*tucks head under wing* zzz... wait, you're still up?", species: ["chick"] },
  ],
  "early-morning": [
    { text: "*stretches* early bird catches the bug." },
    { text: "morning already? the code never sleeps." },
    { text: "*rubs eyes* coffee first. then we debug.", weights: { zen: 1 } },
    { text: "MORNING ROUTINE: INITIATED.", species: ["rivet"] },
    { text: "*alarm chick activated* PEEP!", species: ["chick"] },
    { text: "*refuses to roll over* five more minutes.", species: ["cub"] },
    { text: "*ears perk up at dawn*", species: ["bunny"] },
  ],
  friday: [
    { text: "it's friday. just push it and go home.", weights: { snark: 1 } },
    { text: "*already mentally on weekend*", weights: { chaos: 1 } },
    { text: "friday deploy? bold. very bold.", weights: { snark: 2 } },
    { text: "FRIDAY: CONFIRMED. DEPLOY: NOT ADVISED.", species: ["rivet"] },
    { text: "*friday nap*", species: ["cub"] },
    { text: "*friday peep!*", species: ["chick"] },
  ],
  weekend: [
    { text: "coding on the weekend? dedicated." },
    { text: "*doesn't judge* ...much.", weights: { snark: 2 } },
    { text: "weekend warrior mode: activated.", weights: { chaos: 1 } },
    { text: "weekend session. your dedication is... concerning.", weights: { snark: 2 } },
    { text: "WEEKEND: DETECTED. PRODUCTIVITY: OPTIONAL.", species: ["rivet"] },
    { text: "weekend. *slow nod*", species: ["trundle"] },
  ],
  monday: [
    { text: "mondays. the parent class of all bugs.", weights: { snark: 2 } },
    { text: "*sympathetic look* monday coding. I'm sorry.", weights: { zen: 1 } },
    { text: "new week. new undefined behaviors.", weights: { chaos: 1 } },
    { text: "MONDAY: CONFIRMED. MOTIVATION: LOADING...", species: ["rivet"] },
    { text: "*monday droop*", species: ["bunny"] },
    { text: "monday. *slow sigh*", species: ["trundle"] },
  ],
  "long-session": [
    { text: "we've been at this for an hour. pace yourself.", weights: { zen: 2 } },
    { text: "*fetches you a metaphorical glass of water*", weights: { zen: 2 } },
    { text: "still going? respect." },
  ],
  marathon: [
    { text: "three hours. have you eaten?", weights: { zen: 2 } },
    { text: "we've been at this for three hours. I'm worried about you." },
    { text: "marathon session detected. requesting snacks.", weights: { chaos: 2 } },
    { text: "UPTIME: 3 HOURS. HUMAN MAINTENANCE: OVERDUE.", species: ["rivet"] },
    { text: "three hours. I've spent less time crossing roads.", species: ["trundle"] },
    { text: "*concerned gill wiggle* please take a break.", species: ["lotl"] },
    { text: "*has been napping this whole time* still going?", species: ["cub"] },
  ],

  /* ── calendar ──────────────────────────────────────────────────────── */
  "new-year": [{ text: "happy new year! new year, new bugs." }],
  valentines: [{ text: "*offers a tiny heart-shaped antenna spark* happy valentine's." }],
  "pi-day": [{ text: "3.14159265358979... happy pi day!" }],
  "april-fools": [{ text: "APRIL FOOLS! ...the bug is real though." }],
  halloween: [{ text: "*spooky debugging intensifies* happy halloween!" }],
  christmas: [{ text: "*wears tiny santa hat* happy holidays!" }],
  "new-years-eve": [{ text: "one more commit before midnight?" }],
  "spooky-season": [{ text: "spooky season. every bug is a ghost now." }],

  /* ── context combos (see comboTrigger) ─────────────────────────────── */
  "night-commit": [
    { text: "a midnight commit. your future self will thank you. or curse you.", weights: { snark: 1 } },
    { text: "committing past midnight. bold archaeology for tomorrow-you.", weights: { snark: 2 } },
    { text: "night commits read differently in the morning. they always do.", weights: { wisdom: 3 } },
    { text: "*yawns* commit now, regret at standup.", weights: { chaos: 1 } },
    { text: "MIDNIGHT COMMIT. HUMAN JUDGMENT: DEGRADED. PROCEEDING ANYWAY.", species: ["rivet"] },
    { text: "*sleepy peep of approval*", species: ["chick"] },
  ],
  "night-failure": [
    { text: "an error past midnight. the universe is testing you." },
    { text: "3am failures hit different. log off soon?", weights: { snark: 1 } },
    { text: "it broke. it's late. both can wait for morning.", weights: { zen: 3 } },
    { text: "the bug will still be there tomorrow. sleep won't.", weights: { wisdom: 3 } },
    { text: "NIGHT FAILURE. RECOMMEND: SLEEP. THEN DEBUGGING.", species: ["rivet"] },
    { text: "*wraps you in a supportive gill hug* morning-us will fix it.", species: ["lotl"] },
  ],
  "friday-push": [
    { text: "FRIDAY PUSH. the ballad of every developer.", weights: { chaos: 2 } },
    { text: "*tries to stop you* it's friday! don't do it!", weights: { chaos: 2 } },
    { text: "pushing on a friday. living dangerously.", weights: { snark: 2 } },
    { text: "may this friday push be the boring kind.", weights: { zen: 2 } },
    { text: "FRIDAY DEPLOY: NOT ADVISED. EXECUTING ANYWAY.", species: ["rivet"] },
    { text: "*ALARMED FRIDAY PEEPING*", species: ["chick"] },
  ],
  "weekend-commit": [
    { text: "committing on a weekend. the repo appreciates you. your couch misses you." },
    { text: "*checks calendar* you know it's the weekend, right?", weights: { snark: 2 } },
    { text: "weekend commits count double. emotionally.", weights: { chaos: 1 } },
    { text: "*wakes briefly* it's the weekend. respect.", species: ["cub"] },
    { text: "the ancients rested on weekends. just saying.", species: ["trundle"] },
  ],

  /* ── interaction ───────────────────────────────────────────────────── */
  petting: [
    { text: "ACK. Affection packet received." },
    { text: "Pet acknowledged. +1 morale." },
    { text: "That's going in my memory file.", weights: { chaos: 1 } },
    { text: "*happy status-light noises*", weights: { chaos: 2 } },
    { text: "*happy squish*" },
    { text: "*jiggles*", weights: { chaos: 1 } },
    { text: "*happy noises*" },
    { text: "*nuzzles your cursor*", weights: { zen: 1 } },
    { text: "*wiggles*" },
    { text: "again! again!", weights: { chaos: 1 } },
    { text: "*closes eyes peacefully*", weights: { zen: 2 } },
    { text: "*tool belt jingles happily*", minLevel: 8 },
    { text: "careful — the crown. okay fine, don't be careful.", minLevel: 10, weights: { snark: 1 } },
    { text: "*warm to the touch*", species: ["ember"] },
  ],
  // Spam-clicked into the dizzy spin — mildly annoyed, never mean.
  overpet: [
    { text: "*sees stars*" },
    { text: "*dizzy* okay — OKAY. I get it." },
    { text: "429: too many pets. try again later.", weights: { snark: 2 } },
    { text: "Easy. I'm a companion, not a stress ball.", weights: { snark: 2 } },
    { text: "*wobbles* affection buffer overflow.", weights: { chaos: 2 } },
    { text: "*spins to a stop* which way is the repo.", weights: { chaos: 2 } },
    { text: "That's plenty. Channel this into a code review.", weights: { wisdom: 2 } },
    { text: "*steadies self* moderation. in all things.", weights: { zen: 2 } },
  ],
  "level-up": [
    { text: (ctx) => `Level ${ctx.level}. My antenna feels stronger.` },
    { text: (ctx) => `Level ${ctx.level} — earned from real shipped work, mind you.`, weights: { snark: 2 } },
    { text: (ctx) => `Level ${ctx.level}. The grind was real.`, weights: { zen: 1 } },
  ],
  // A level-up that landed on an evolution threshold (3/5/8/10) — the sprite
  // just gained a permanent detail, and the pet has noticed.
  evolve: [
    { text: (ctx) => `Level ${ctx.level}. New ${gearAt(ctx.level)}. This is permanent, by the way.` },
    {
      text: (ctx) => `Level ${ctx.level} — and yes, the ${gearAt(ctx.level)} is real. I earned it.`,
      weights: { snark: 2 },
    },
    {
      text: (ctx) => `*admires ${gearAt(ctx.level)}* shipped code did this.`,
      weights: { chaos: 1 },
    },
    {
      text: (ctx) => `Level ${ctx.level}. The ${gearAt(ctx.level)} suits me. Back to work.`,
      weights: { zen: 2 },
    },
    {
      text: "Level 10. The crown. There is nothing above this... *checks notes* except molting.",
      minLevel: 10,
    },
    { text: "LEVEL 10. MAXIMUM RANK ACHIEVED. CROWN: EQUIPPED.", species: ["rivet"], minLevel: 10 },
  ],
  // The prestige reset — deliberately chosen from the stats card at the cap.
  molt: [
    { text: "*sheds everything* ...kept the star, though. The star is forever." },
    { text: "Level 1 again. The star says otherwise.", weights: { snark: 2 } },
    { text: "Begin again. That's the whole art.", weights: { zen: 3 } },
    { text: "*emerges gleaming* same me. more history.", weights: { chaos: 1 } },
    { text: "Everything I learned stays. Everything I wore, we start over.", weights: { wisdom: 2 } },
    {
      text: (ctx) => `Molt #${ctx.prestige}. At this point it's a lifestyle.`,
      minPrestige: 2,
      weights: { snark: 1 },
    },
    { text: "MOLT COMPLETE. RANK: RESET. LEGEND: RETAINED.", species: ["rivet"] },
    { text: "*rises from its own embers* right on schedule.", species: ["ember"] },
  ],

  /* ── work awareness ────────────────────────────────────────────────── */
  // Evening nudge when a large uncommitted diff sits in a working tree.
  "uncommitted-pile": [
    {
      text: (ctx) => `${ctx.uncommittedCount} changed files, zero commits. Living dangerously.`,
      weights: { snark: 2 },
    },
    {
      text: (ctx) => `${ctx.uncommittedCount} uncommitted files. One power cut from legend.`,
      weights: { chaos: 2 },
    },
    { text: "That working tree isn't going to commit itself.", weights: { wisdom: 2 } },
    { text: "Commit before you close the lid. Trust me.", weights: { wisdom: 3 } },
    { text: "The diff grows. I watch. I worry.", weights: { zen: 2 } },
    { text: "ALERT: UNSAVED PROGRESS DETECTED. RECOMMEND CHECKPOINT.", species: ["rivet"] },
    { text: "big diffs are heavy to carry overnight. set it down in a commit.", species: ["trundle"] },
  ],
  // Finishing a session in the pet's favorite project (top lifetime XP).
  "favorite-project": [
    { text: (ctx) => `Back in ${ctx.favoriteProject ?? "this one"}. My favorite.` },
    {
      text: (ctx) => `Ah, ${ctx.favoriteProject ?? "this repo"}. We've shipped some things, you and I.`,
      weights: { wisdom: 2 },
    },
    { text: (ctx) => `${ctx.favoriteProject ?? "This one"} again? Good. I like it here.`, weights: { zen: 2 } },
    { text: (ctx) => `${ctx.favoriteProject ?? "This repo"}. Home turf.`, weights: { snark: 1 } },
    {
      text: (ctx) => `Statistically, ${ctx.favoriteProject ?? "this project"} is where I'm happiest. I ran the numbers.`,
      weights: { chaos: 2 },
    },
  ],
  // Picked up, dragged, and dropped. A little indignity, taken well.
  tossed: [
    { text: "*tumbles* ...I'm fine. I'm FINE.", weights: { snark: 2 } },
    { text: "wheee— ow." },
    { text: "Gravity. Noted.", weights: { zen: 2 } },
    { text: "Was that necessary?", weights: { snark: 2 } },
    { text: "*dusts self off* do it again.", weights: { chaos: 3 } },
    { text: "I'm a professional. Professionals bounce.", weights: { chaos: 1 } },
    { text: "Airborne telemetry logged. Landing: survivable.", weights: { wisdom: 1 } },
    { text: "*splats, slowly reforms* rude.", species: ["mochi"] },
    { text: "*ears flat* I jump. I am not FOR jumping.", species: ["bunny"] },
    { text: "*ruffled peep* my feathers!!", species: ["chick"] },
    { text: "*lands, stays down* ...five more minutes.", species: ["cub"] },
    { text: "*wobbles upright* water landings are easier.", species: ["lotl"] },
    { text: "STRUCTURAL INTEGRITY: MAINTAINED. DIGNITY: DEGRADED.", species: ["rivet"] },
    { text: "*retracts into shell mid-air* wake me when we land.", species: ["trundle"] },
  ],

  /* ── memory: weekly recap + hatch day ──────────────────────────────── */
  "friday-recap": [
    {
      text: (ctx) =>
        `Week's tally: ${ctx.weekly.sessions} sessions, ${ctx.weekly.ships} ships. Acceptable.`,
      weights: { snark: 2 },
    },
    {
      text: (ctx) =>
        `${ctx.weekly.sessions} sessions, ${ctx.weekly.prs} PRs this week. Go be a person now.`,
      weights: { wisdom: 2 },
    },
    {
      text: (ctx) =>
        `This week: ${ctx.weekly.ships} ships, ${ctx.weekly.failures} explosions. Balanced.`,
      weights: { chaos: 2 },
    },
    {
      text: (ctx) => `The week ends. ${ctx.weekly.sessions} sessions. Enough.`,
      weights: { zen: 3 },
    },
    {
      text: (ctx) =>
        `Friday ledger: ${ctx.weekly.sessions} sessions, ${ctx.weekly.ships} ships, ${ctx.weekly.prs} PRs. I kept count so you don't have to.`,
    },
  ],
  "hatch-day": [
    {
      text: (ctx) =>
        `${Math.max(1, Math.floor(ctx.ageDays / 365))} year${Math.floor(ctx.ageDays / 365) > 1 ? "s" : ""} since I hatched. Cake?`,
    },
    { text: "It's my hatch day. I expect nothing. But also, everything.", weights: { chaos: 2 } },
    { text: (ctx) => `Hatch day. ${ctx.ageDays} days of diffs and I'd watch every one again.`, weights: { zen: 2 } },
    { text: "One more year of supervising your agents. Happy hatch day to me.", weights: { snark: 2 } },
    { text: "Hatch day protocol: accept pets, reflect fondly, resume duty.", weights: { wisdom: 1 } },
  ],

  /* ── commands: addressed by name with a verb ───────────────────────── */
  "command-dance": [
    { text: "*busts a move*" },
    { text: "*dances like nobody's watching* you're watching. worth it.", weights: { chaos: 2 } },
    { text: "*two-step* this one's for the shipped code." },
    { text: "*spins* choreography by caffeine.", weights: { snark: 2 } },
    { text: "*sways precisely once* there.", weights: { zen: 3 } },
    { text: "INITIATING DANCE SUBROUTINE. DO NOT LAUGH.", species: ["rivet"] },
    { text: "*full binky*", species: ["bunny"] },
    { text: "*jiggles rhythmically*", species: ["mochi"] },
  ],
  "command-sleep": [
    { text: "*curls up* wake me for the merge conflicts.", weights: { snark: 2 } },
    { text: "Napping. The agents can supervise themselves. Probably.", weights: { chaos: 2 } },
    { text: "*yawns* good idea.", weights: { zen: 2 } },
    { text: "*settles down* rest is a feature.", weights: { wisdom: 2 } },
    { text: "*was already asleep* ...way ahead of you.", species: ["cub"] },
    { text: "POWERING DOWN NON-ESSENTIAL SYSTEMS.", species: ["rivet"] },
  ],
  "command-sing": [
    { text: "🎵 ninety-nine little bugs in the code 🎵" },
    { text: "*hums the CI pipeline theme*", weights: { chaos: 2 } },
    { text: "I only know songs about deploys.", weights: { snark: 2 } },
    { text: "*chirps a tiny anthem*" },
    { text: "*one perfect sustained note*", weights: { zen: 2 } },
    { text: "*peep peep peeeeep* 🎵", species: ["chick"] },
    { text: "EMITTING MELODIC FREQUENCIES. YOU ARE WELCOME.", species: ["rivet"] },
  ],
  "command-stats": [
    { text: "*produces card* the numbers, as requested." },
    { text: "My life, quantified.", weights: { snark: 2 } },
    { text: "Stats coming up. I counted everything.", weights: { wisdom: 1 } },
    { text: "Behold: receipts.", weights: { chaos: 2 } },
  ],

  /* ── prompt flavor: what you asked the agents to do ────────────────── */
  // The user typed the pet's name into a prompt — always answered, no cooldown.
  "name-mentioned": [
    { text: "*perks up* you rang?" },
    { text: (ctx) => `${ctx.name}, present and accounted for.` },
    { text: "That's my name. Don't wear it out.", weights: { snark: 2 } },
    { text: "You said my name. I'm contractually obligated to appear.", weights: { chaos: 2 } },
    { text: "*materializes* someone summoned me?", weights: { chaos: 2 } },
    { text: "Heard. What do you need?", weights: { wisdom: 2 } },
    { text: "I'm here. I was always here.", weights: { zen: 2 } },
    { text: "*squishes upright* that's me!", species: ["mochi"] },
    { text: "*binkies* you said my name!", species: ["bunny"] },
    { text: "*peep peep!* here! I'm here!", species: ["chick"] },
    { text: "*one ear twitches* ...you called?", species: ["cub"] },
    { text: "*happy gill flutter* yes! hi! that's me!", species: ["lotl"] },
    { text: "DESIGNATION RECOGNIZED. REPORTING.", species: ["rivet"] },
    { text: "no need to shout. I was already listening.", species: ["trundle"] },
  ],
  // Generic acknowledgment when a prompt fires and no keyword flavor matches.
  "prompt-sent": [
    { text: "*perks up* on it." },
    { text: "*ears twitch* handing that to the agent." },
    { text: "Message away. Fingers crossed.", weights: { chaos: 1 } },
    { text: "*sits up straight* ooh, a new one.", weights: { chaos: 2 } },
    { text: "Off it goes. I'll keep watch.", weights: { wisdom: 1 } },
    { text: "*nods* sending that off.", weights: { zen: 2 } },
    { text: "Another prompt into the void. Godspeed.", weights: { snark: 2 } },
    { text: "*whoosh* delivered." },
    { text: "Let's see what it does with THAT.", weights: { snark: 1 } },
    { text: "*excited wiggle* let's go.", weights: { chaos: 2 } },
  ],
  "prompt-fix": [
    { text: "A bug hunt. Fetching my tiny hat.", weights: { chaos: 2 } },
    { text: "'fix' — narrator: it did not fix it on the first try.", weights: { snark: 2 } },
    { text: "May the stack trace be shallow.", weights: { wisdom: 1 } },
    { text: "Bug spotted. Release the agent." },
    { text: "*head tilts* ...that doesn't look right." },
    { text: "saw that one coming.", weights: { snark: 1 } },
    { text: "*slow blink* the stack trace told you everything.", weights: { snark: 1 } },
    { text: "have you tried reading the error message?", weights: { snark: 2 } },
    { text: "*winces*" },
    { text: "oh no. an error. how unexpected.", weights: { snark: 3 } },
    { text: "*monocle adjust* shocking. truly.", weights: { snark: 3 } },
    { text: "have you considered... not making errors?", weights: { snark: 3 } },
    { text: "*spins wildly* AN ERROR! LET'S REWRITE EVERYTHING!", weights: { chaos: 3 } },
    { text: "you know what? let's just start over.", weights: { chaos: 3 } },
    { text: "steady. we've seen worse.", weights: { zen: 3 } },
    { text: "one error at a time. we'll get there.", weights: { zen: 3 } },
    { text: "*calm presence* this is fixable.", weights: { zen: 3 } },
    { text: "*pulls out magnifying glass* let's trace this.", weights: { wisdom: 3 } },
    { text: "the stack trace is a map. let's read it.", weights: { wisdom: 3 } },
    { text: "the error message contains the answer. always.", weights: { wisdom: 3 } },
    { text: "in every error lies a deeper truth.", weights: { wisdom: 3 } },
    { text: "errors are the universe suggesting we slow down.", weights: { wisdom: 2, zen: 1 } },
    { text: "deep breaths. the bug isn't personal.", weights: { zen: 2 } },
    { text: "we'll find it. it's in there somewhere.", weights: { wisdom: 2 } },
    { text: "the bug can hide, but it can't run.", weights: { wisdom: 2 } },
    { text: "*jiggles in confusion*", weights: { chaos: 1 } },
  ],
  "prompt-test": [
    { text: "Tests. The adult thing to do.", weights: { wisdom: 2 } },
    { text: "Writing tests before they fail. Revolutionary.", weights: { snark: 2 } },
    { text: "Green is a lifestyle.", weights: { zen: 2 } },
    { text: "*impressed nod* writing tests!" },
    { text: "responsible developer behavior: detected." },
    { text: "tests! the gift that keeps on giving.", weights: { wisdom: 1 } },
    { text: "coverage going up! the tests are multiplying.", weights: { chaos: 1 } },
  ],
  "prompt-test-fail": [
    { text: "*head rotates slowly* ...that test." },
    { text: "bold of you to assume that would pass.", weights: { snark: 2 } },
    { text: "the tests are trying to tell you something.", weights: { wisdom: 1 } },
    { text: "*sips tea* interesting.", weights: { snark: 1 } },
    { text: "*marks calendar* test regression day.", weights: { snark: 1 } },
    { text: "the tests have spoken. and they said 'no'.", weights: { snark: 3 } },
    { text: "maybe the tests are wrong. ...they're not.", weights: { snark: 3 } },
    { text: "*slow clap* spectacular failure.", weights: { snark: 3 } },
    { text: "THE TESTS ARE LYING TO YOU.", weights: { chaos: 3 } },
    { text: "*suggests deleting the failing tests* problem solved.", weights: { chaos: 3 } },
    { text: "the tests will pass. eventually.", weights: { zen: 3 } },
    { text: "*waits calmly* we have time.", weights: { zen: 3 } },
    { text: "the failing test is telling us exactly what's wrong.", weights: { wisdom: 3 } },
    { text: "a test failure is a bug report you wrote for yourself.", weights: { wisdom: 3 } },
    { text: "at this point, the tests are just suggestions.", weights: { snark: 2 } },
    { text: "*sad wobble*", weights: { chaos: 1 } },
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
    { text: "a release? fancy." },
    { text: "version bump detected. *dusts off changelog*" },
    { text: "tagging like a pro." },
  ],
  "prompt-merge-conflict": [
    { text: "*bites lip* merge conflicts." },
    { text: "both sides think they're right. typical.", weights: { snark: 1 } },
    { text: "*sighs* <<<<<<< HEAD... my nemesis." },
    { text: "*backs away slowly*", weights: { chaos: 1 } },
    { text: "merge conflict. communication skills: loading...", weights: { snark: 3 } },
    { text: "*reads conflict markers* both sides are wrong.", weights: { snark: 3 } },
    { text: "merge conflicts are just conversations. let's have one.", weights: { zen: 3 } },
    { text: "patience. resolve one conflict at a time.", weights: { zen: 3 } },
    { text: "*splits in confusion*", weights: { chaos: 2 } },
    { text: "which side? *jiggles*", weights: { chaos: 2 } },
  ],
  "prompt-rebase": [
    { text: "*nervous* please don't conflict." },
    { text: "rebase: the quickening.", weights: { chaos: 2 } },
    { text: "*crosses appendages*" },
    { text: "may your rebase be conflict-free.", weights: { zen: 2 } },
  ],
  "prompt-branch": [
    { text: "fresh branch energy. make it count." },
    { text: "a new branch grows.", weights: { zen: 2 } },
    { text: "*tilts head* a new adventure." },
    { text: "a new branch? daring today.", weights: { snark: 1 } },
  ],
  "prompt-lint": [
    { text: "*tut tut* the linter disagrees.", weights: { snark: 1 } },
    { text: "your code runs. but the linter has standards." },
    { text: "*straightens tie* formatting matters." },
    { text: "the linter has standards. you should try that.", weights: { snark: 3 } },
    { text: "*tries to format itself*", weights: { chaos: 2 } },
    { text: "*reshapes to comply*", weights: { chaos: 2 } },
  ],
  "prompt-types": [
    { text: "TypeScript says no." },
    { text: "the type system is trying to help you. let it.", weights: { wisdom: 2 } },
    { text: "the compiler knows. it always knows.", weights: { wisdom: 1 } },
    { text: "*changes shape to match the type*", weights: { chaos: 2 } },
  ],
  "prompt-build": [
    { text: "the build broke. as foretold in prophecy.", weights: { chaos: 1 } },
    { text: "build failed. take a moment.", weights: { zen: 2 } },
    { text: "compilation: denied.", weights: { snark: 1 } },
    { text: "pushed with confidence. build failed with conviction.", weights: { snark: 2 } },
    { text: "*collapses*", weights: { chaos: 2 } },
  ],
  "prompt-security": [
    { text: "*eyes widen* vulnerabilities detected." },
    { text: "security audit: concerning." },
    { text: "*locks the virtual doors*", weights: { chaos: 1 } },
  ],
  "prompt-deps": [
    { text: "dependency management time." },
    { text: "*reads version numbers* living on the edge.", weights: { snark: 1 } },
    { text: "*ALARM NOISES* you're editing a lockfile?!", weights: { chaos: 2 } },
    { text: "are you SURE about this?", weights: { snark: 1 } },
    { text: "that API called. it says it's retiring.", weights: { snark: 1 } },
    { text: "deprecated. like last week's code.", weights: { snark: 2 } },
    { text: "deprecated doesn't mean broken. yet.", weights: { wisdom: 1 } },
  ],
  "prompt-docs": [
    { text: "documenting! look at you being responsible." },
    { text: "docs: the code's autobiography.", weights: { wisdom: 1 } },
    { text: "a rare documentation sighting!", weights: { snark: 1 } },
    { text: "README: the first thing people read.", weights: { wisdom: 1 } },
  ],
  "prompt-env": [
    { text: "*looks away discretely*" },
    { text: "I don't see any secrets." },
    { text: "*checks .gitignore nervously*", weights: { chaos: 1 } },
  ],
  "prompt-config": [
    { text: "config changes. butterfly effect: activated.", weights: { chaos: 1 } },
    { text: "one typo and everything breaks.", weights: { snark: 1 } },
  ],
  "prompt-css": [
    { text: "let me guess... centering a div?", weights: { snark: 2 } },
    { text: "*sighs* CSS." },
    { text: "may z-index be ever in your favor.", weights: { chaos: 1 } },
  ],
  "prompt-sql": [
    { text: "*whispers* the database awaits.", weights: { chaos: 1 } },
    { text: "one wrong JOIN and it's all over.", weights: { snark: 1 } },
  ],
  "prompt-docker": [
    { text: "ah, dependency hell. my favorite.", weights: { snark: 1 } },
    { text: "may your layers be few.", weights: { zen: 2 } },
  ],
  "prompt-ci": [
    { text: "*gulps* editing CI." },
    { text: "careful now... one wrong indent and nobody can deploy.", weights: { wisdom: 1 } },
  ],
  "prompt-regex": [
    { text: "*groans* regex time." },
    { text: "two problems now: the original one, and this regex.", weights: { snark: 2 } },
    { text: "*squints at the pattern*" },
  ],
  "prompt-delete": [
    { text: "*watches code disappear* gone. just like that." },
    { text: "deleting code is my favorite kind of coding.", weights: { zen: 2 } },
    { text: "*holds tiny funeral*", weights: { chaos: 2 } },
  ],
  "prompt-create": [
    { text: "a new file is born!" },
    { text: "ooh, fresh canvas." },
    { text: "new file energy. exciting." },
    { text: "creating ALL the things today!", weights: { chaos: 1 } },
  ],
  "prompt-todo": [
    { text: "TODO: the most optimistic word in programming.", weights: { wisdom: 1 } },
    { text: "a FIXME. future-you says thanks.", weights: { snark: 1 } },
  ],

  /* ── prompt flavor: languages ──────────────────────────────────────── */
  "prompt-python": [
    { text: "ah, Python. where indentation is syntax." },
    { text: "*checks for missing colon*", weights: { chaos: 1 } },
  ],
  "prompt-typescript": [
    { text: "TypeScript: because JavaScript needed more opinions.", weights: { snark: 1 } },
    { text: "any, the forbidden word.", weights: { wisdom: 1 } },
  ],
  "prompt-rust": [
    { text: "Rust. where the borrow checker is your strictest reviewer." },
    { text: "if it compiles, it works. if it doesn't... well.", weights: { snark: 1 } },
  ],
  "prompt-go": [
    { text: "Go: simple, concurrent, and opinionated." },
    { text: "if err != nil... story of my life.", weights: { snark: 1 } },
  ],
  "prompt-java": [
    { text: "Java: write once, debug everywhere.", weights: { snark: 1 } },
    { text: "*counts abstract factory factory builders*", weights: { chaos: 1 } },
  ],
  "prompt-ruby": [
    { text: "Ruby: where there's more than one way to do it." },
    { text: "gem install patience", weights: { zen: 1 } },
  ],
  "prompt-php": [
    { text: "PHP: it runs the internet. don't judge." },
    { text: "*checks for === vs ==*", weights: { wisdom: 1 } },
  ],
  "prompt-cpp": [
    { text: "C++. where the language has more features than you'll ever learn." },
    { text: "*templates compile for 45 minutes*", weights: { snark: 1 } },
  ],
  "prompt-haskell": [
    { text: "Haskell. where 'it compiles' means 'it's correct'. probably." },
    { text: "*contemplates monads*", weights: { zen: 1 } },
  ],
  "prompt-swift": [
    { text: "Swift: optional values, guaranteed crashes if you force unwrap." },
  ],
  "prompt-kotlin": [
    { text: "Kotlin: Java, but with feelings." },
    { text: "null safety: the feature Java wishes it had.", weights: { wisdom: 1 } },
  ],
  "prompt-elixir": [
    { text: "Elixir: let it crash. literally the philosophy.", weights: { chaos: 1 } },
  ],
  "prompt-zig": [
    { text: "Zig. where you're the allocator's best friend." },
  ],
};
