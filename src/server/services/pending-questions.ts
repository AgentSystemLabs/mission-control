import { randomUUID } from "node:crypto";
import type { AgentQuestion, PendingQuestion } from "~/shared/agent-questions";
import { events } from "../events";

// In-memory on purpose: a pending question is only meaningful while its PTY
// (and the TUI menu inside it) is alive, and both die with the app process.
const pending = new Map<string, PendingQuestion>();

export function setPendingQuestion(input: {
  taskId: string;
  projectId: string;
  questions: AgentQuestion[];
  id?: string;
}): PendingQuestion {
  const question: PendingQuestion = {
    id: input.id?.trim() || randomUUID(),
    taskId: input.taskId,
    projectId: input.projectId,
    questions: input.questions,
    createdAt: Date.now(),
  };
  pending.set(input.taskId, question);
  events.emit("task:question", {
    taskId: question.taskId,
    projectId: question.projectId,
    questionId: question.id,
    questions: question.questions,
  });
  return question;
}

export function getPendingQuestion(taskId: string): PendingQuestion | null {
  return pending.get(taskId) ?? null;
}

export function clearPendingQuestion(taskId: string): void {
  const existing = pending.get(taskId);
  if (!existing) return;
  pending.delete(taskId);
  events.emit("task:question-cleared", {
    taskId,
    projectId: existing.projectId,
  });
}
