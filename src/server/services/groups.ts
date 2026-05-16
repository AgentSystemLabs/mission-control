import { randomBytes } from "node:crypto";
import type { Group } from "~/db/schema";
import { GROUP_COLORS } from "~/lib/design-meta";
import { events } from "../events";
import {
  deleteGroupRow,
  findAllGroups,
  findGroupById,
  insertGroup,
  updateGroupRow,
} from "../repositories/groups.repo";
import { orphanProjectsByGroupId } from "../repositories/projects.repo";

function newId() {
  return `g-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function listGroups(): Group[] {
  return findAllGroups();
}

export function createGroup(input: { name: string; color?: string }): Group {
  if (!input.name?.trim()) throw new Error("Group name is required");
  const existing = listGroups();
  const color = input.color || GROUP_COLORS[existing.length % GROUP_COLORS.length] || "#ff5a1f";
  const row: Group = {
    id: newId(),
    name: input.name.trim(),
    color,
    createdAt: Date.now(),
  };
  insertGroup(row);
  events.emit("group:created", { id: row.id });
  return row;
}

export function updateGroup(id: string, patch: Partial<Pick<Group, "name" | "color">>): Group | null {
  const existing = findGroupById(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  updateGroupRow(id, next);
  events.emit("group:updated", { id });
  return next;
}

export function deleteGroup(id: string): boolean {
  // orphan projects to ungrouped
  orphanProjectsByGroupId(id);
  const changes = deleteGroupRow(id);
  events.emit("group:deleted", { id });
  return changes > 0;
}
