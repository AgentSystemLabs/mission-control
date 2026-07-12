import { EventEmitter } from "node:events";
import type { AgentQuestion } from "~/shared/agent-questions";
import type { GraphIndexProgress } from "~/shared/code-graph";
import type { PetToolKind } from "~/shared/pet-tool-classify";

export type AppEvent =
  | { type: "project:created"; id: string }
  | { type: "project:updated"; id: string }
  | { type: "project:deleted"; id: string }
  | { type: "worktree:created"; id: string; projectId: string }
  | { type: "worktree:deleted"; id: string; projectId: string }
  | { type: "group:created"; id: string }
  | { type: "group:updated"; id: string }
  | { type: "group:deleted"; id: string }
  | { type: "task:created"; id: string; projectId: string }
  | { type: "task:updated"; id: string; projectId: string }
  | { type: "task:archived"; id: string; projectId: string }
  | { type: "task:restored"; id: string; projectId: string }
  | { type: "task:deleted"; id: string; projectId: string }
  | {
      type: "session:finished";
      id: string;
      projectId: string;
      worktreeId: string | null;
      scopeId: string;
      projectName: string;
      taskTitle: string;
    }
  | {
      type: "task:question";
      taskId: string;
      projectId: string;
      questionId: string;
      questions: AgentQuestion[];
    }
  | { type: "task:question-cleared"; taskId: string; projectId: string }
  | { type: "prompt:submitted"; taskId: string; projectId: string; snippet: string }
  | {
      // A Bash/Write/Edit tool finished mid-turn. Emitted (pet-gated) so the
      // Mission Pet can react to the agent working, not just to turn boundaries.
      type: "agent:tool-used";
      taskId: string;
      projectId: string;
      toolName: string;
      sentiment: "error" | "success" | "neutral";
      // The specific thing the tool did (commit, test-fail, edit-styles…) —
      // the pet picks its reaction line from this; sentiment stays the coarse
      // fallback for older payloads and mood logic.
      kind: PetToolKind;
    }
  | {
      // Claude ended a response with an invisible `<!-- pet: … -->` cue
      // (see ~/shared/pet-remark); the pet speaks the line verbatim.
      type: "agent:remark";
      taskId: string;
      projectId: string;
      text: string;
    }
  | { type: "memory:created"; id: string; projectId: string }
  | { type: "memory:updated"; id: string; projectId: string }
  | { type: "memory:deleted"; id: string; projectId: string }
  | { type: "memory:learned"; projectId: string; count: number; sourceTaskId: string | null }
  | { type: "graph:index-progress"; projectId: string; progress: GraphIndexProgress }
  | { type: "graph:indexed"; projectId: string; ok: boolean; nodeCount: number; edgeCount: number }
  | {
      type: "diagram:show";
      id: string;
      taskId: string;
      projectId: string;
      title: string | null;
      source: string;
      format: "mermaid";
      projectName: string;
      taskTitle: string;
      worktreeId: string | null;
      scopeId: string;
    };

class TypedEmitter {
  private inner = new EventEmitter();

  emit<K extends AppEvent["type"]>(type: K, payload: Omit<Extract<AppEvent, { type: K }>, "type">) {
    this.inner.emit("event", { type, ...payload });
    this.inner.emit(type, payload);
  }

  onAny(cb: (e: AppEvent) => void) {
    this.inner.on("event", cb);
    return () => this.inner.off("event", cb);
  }

  setMaxListeners(n: number) {
    this.inner.setMaxListeners(n);
  }
}

export const events = new TypedEmitter();
events.setMaxListeners(50);
