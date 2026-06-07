import { EventEmitter } from "node:events";

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
      projectName: string;
      taskTitle: string;
    }
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
