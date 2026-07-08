# Session Orchestrator — What it is and why it matters

## The short version

Mission Control lets you run several AI coding assistants at once, side by side.
Right now, a person has to drive each one by hand — start it, keep an eye on it,
answer its questions, and check its work. The **Session Orchestrator** puts a
"team lead" on top of that. You hand it a list of work, and it runs the whole
team of assistants for you: handing out tasks, keeping everyone unblocked, and
checking each finished piece before it's accepted.

You go from *doing the work yourself* to *supervising a team that does it*.

## The problem today

- You can only realistically babysit one or two assistants at a time.
- Every assistant needs someone watching it — to unstick it, answer its
  questions, and review what it produced.
- That attention is the bottleneck. The tool can run many assistants; a person
  can only manage a few.

## The idea

One "orchestrator" acts as the team lead for a pool of AI assistants:

1. **You give it a to-do list.** A set of tasks you want done.
2. **It hands out the work.** Each free assistant gets the next task, in its own
   isolated workspace so they never overwrite each other.
3. **It keeps everyone moving.** If an assistant finishes, gets stuck, or asks a
   question, the orchestrator handles it — answering when it can, and only
   pulling you in when it genuinely needs a human.
4. **It scales up when needed.** If everyone's busy and there's more work, it
   brings another assistant online.
5. **It checks the work before accepting it.** Every finished task is
   automatically tested and independently reviewed. Only clean work is accepted;
   anything with problems goes straight back to be fixed.

## Two ways to run it

- **Steady mode:** a standing team that works through the list carefully, one
  task at a time each — best when the work is connected and order matters.
- **All-at-once mode:** the whole list launched in parallel — best for lots of
  independent work you want done in a single pass.

## Why it's worth doing

- **More gets done in parallel** without more people watching screens.
- **Quality stays high** — nothing is accepted until it's tested and reviewed.
- **Your attention goes where it's actually needed** — you're pulled in for real
  decisions, not routine babysitting.
- **It builds on what we already have.** Mission Control already runs assistants
  side by side in their own workspaces; this mainly adds the "team lead" layer on
  top, rather than a whole new product.

## Still to decide

- Exactly how you'd hand the orchestrator its to-do list.
- How it shows you what the team is doing at a glance, and how it flags when it
  needs you.
- How much it's allowed to decide on its own vs. check in first.
