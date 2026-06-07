# Project Sandbox Workflow Request

## Summary

Optimize sandboxes around a project-first workflow. A user should be able to open a project, decide the next piece of work needs isolation, and create a sandbox directly from that project screen.

## Desired Experience

- `Create sandbox` should only appear on the project screen, not as a generic global action.
- Creating a sandbox should feel like continuing work from the current project, not configuring infrastructure from scratch.
- The sandbox should start from the project's `main` branch.
- User sessions created after switching into the sandbox should be scoped to that sandbox.
- Users should be able to switch between Local and any sandbox easily.
- Creating or selecting a sandbox should not create a second project or hide the user's existing project list.

## Sandbox Creation Flow

1. Create a new sandbox from the current project.
2. Clone a fresh copy of the repo using the user's existing SSH keys.
3. Copy project `.env` files into the sandbox.
4. Run the sandbox boot script for project-specific binaries and services.
5. Run the project init command, such as `npm i`.
6. Activate the sandbox so new sessions run inside it.

## Important Requirements

- Each project may need different tools, binaries, or services installed in its sandbox.
- Each sandbox should have isolated database and service state.
- The UX should make it obvious whether the user is working in Local or a sandbox.
- Switching sandboxes should not be hidden behind project setup or global settings.
- Returning to Local should be quick and visible.

## Product Direction

Model sandboxes as project-scoped work environments owned by the project that created them. The primary action is not "manage sandboxes"; it is "start isolated work from this project."
