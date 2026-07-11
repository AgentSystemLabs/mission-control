import type { PetLine, PetTrigger } from "./pet-messages";

/**
 * Mission Pet line packs. Tone: dry terminal-nerd humor — short, wry, never
 * cringe. `weights` bias selection toward matching personalities (snark =
 * sarcastic, wisdom = practical/insightful, chaos = absurdist, zen =
 * calm/patient); an unweighted line is neutral and available to every pet.
 * Heavily-weighted lines (3) act as personality "overrides" — a maxed stat
 * makes them dominate that trigger.
 */
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
  ],
  "ship-failure": [
    { text: "Push rejected. The remote said no. Loudly.", weights: { snark: 2 } },
    { text: "Ship failed. Manual mode, captain.", weights: { wisdom: 2 } },
    { text: "The launch pad is on fire. Metaphorically. Probably.", weights: { chaos: 2 } },
    { text: "Didn't land. Check the log, breathe, retry.", weights: { zen: 2 } },
    { text: "*wobbles anxiously*", weights: { chaos: 1 } },
    { text: "take a moment. then try again.", weights: { zen: 2 } },
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

  /* ── ambience ──────────────────────────────────────────────────────── */
  idle: [
    { text: "All quiet. I'll be over here, existing.", weights: { zen: 2 } },
    { text: "No agents, no problems." },
    { text: "Idle. A rare and precious state.", weights: { zen: 1 } },
    { text: "I've alphabetized the event bus. Twice.", weights: { chaos: 2 } },
    { text: "*dozes off*" },
    { text: "*doodles in margins*", weights: { chaos: 1 } },
    { text: "*stares at cursor blinking*" },
  ],
  night: [
    { text: "Past midnight. The linter sleeps. You could too.", weights: { zen: 2 } },
    { text: "Night shift again? I'll keep watch.", weights: { wisdom: 2 } },
    { text: "The best bugs come out after dark.", weights: { chaos: 2 } },
    { text: "*yawns* it's past midnight." },
    { text: "...have you eaten?", weights: { zen: 2 } },
    { text: "sleep is for the weak. and the employed.", weights: { snark: 2 } },
    { text: "dark mode developer detected.", weights: { chaos: 1 } },
    { text: "a midnight commit. your future self will thank you. or curse you.", weights: { snark: 1 } },
    { text: "the night is darkest before the deploy.", weights: { wisdom: 3 } },
    { text: "ancient wisdom: sleep on it.", weights: { wisdom: 3 } },
    { text: "*glowing faintly*", weights: { chaos: 1 } },
  ],
  "early-morning": [
    { text: "*stretches* early bird catches the bug." },
    { text: "morning already? the code never sleeps." },
    { text: "*rubs eyes* coffee first. then we debug.", weights: { zen: 1 } },
  ],
  friday: [
    { text: "it's friday. just push it and go home.", weights: { snark: 1 } },
    { text: "*already mentally on weekend*", weights: { chaos: 1 } },
    { text: "friday deploy? bold. very bold.", weights: { snark: 2 } },
    { text: "FRIDAY PUSH. the ballad of every developer.", weights: { chaos: 2 } },
    { text: "*tries to stop you* it's friday! don't do it!", weights: { chaos: 2 } },
  ],
  weekend: [
    { text: "coding on the weekend? dedicated." },
    { text: "*doesn't judge* ...much.", weights: { snark: 2 } },
    { text: "weekend warrior mode: activated.", weights: { chaos: 1 } },
    { text: "weekend session. your dedication is... concerning.", weights: { snark: 2 } },
  ],
  monday: [
    { text: "mondays. the parent class of all bugs.", weights: { snark: 2 } },
    { text: "*sympathetic look* monday coding. I'm sorry.", weights: { zen: 1 } },
    { text: "new week. new undefined behaviors.", weights: { chaos: 1 } },
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

  /* ── prompt flavor: what you asked the agents to do ────────────────── */
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
