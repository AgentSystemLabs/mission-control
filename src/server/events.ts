import { EventEmitter } from "node:events";
import type { HostedAuthContext } from "./hosted-auth-context";

export type AppEventScope = {
  organizationId: string | null;
  userId: string | null;
};

type ScopedEvent = {
  scope?: AppEventScope;
};

export type AppEvent =
  | ({ type: "project:created"; id: string } & ScopedEvent)
  | ({ type: "project:updated"; id: string } & ScopedEvent)
  | ({ type: "project:deleted"; id: string } & ScopedEvent)
  | ({ type: "worktree:created"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "worktree:deleted"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "group:created"; id: string } & ScopedEvent)
  | ({ type: "group:updated"; id: string } & ScopedEvent)
  | ({ type: "group:deleted"; id: string } & ScopedEvent)
  | ({ type: "task:created"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "task:updated"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "task:archived"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "task:restored"; id: string; projectId: string } & ScopedEvent)
  | ({ type: "task:deleted"; id: string; projectId: string } & ScopedEvent)
  | ({
      type: "session:finished";
      id: string;
      projectId: string;
      worktreeId: string | null;
      projectName: string;
      taskTitle: string;
    } & ScopedEvent)
  | ({
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
    } & ScopedEvent);

export function scopeForHostedContext(context: HostedAuthContext): AppEventScope {
  return {
    organizationId: context.organizationId,
    userId: context.organizationId ? null : context.userId,
  };
}

export function eventVisibleToScope(event: AppEvent, scope: AppEventScope): boolean {
  if (!event.scope) return false;
  if (event.scope.organizationId) {
    return event.scope.organizationId === scope.organizationId;
  }
  return !scope.organizationId && event.scope.userId === scope.userId;
}

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
