import { z } from "zod";
import {
  getBindings,
  resetAllBindings,
  resetBinding,
  setBinding,
} from "../services/keybindings";
import { HOTKEY_ACTIONS, type HotkeyAction } from "~/lib/keybindings/types";
import { isValidBinding } from "~/lib/keybindings/match";
import { json, jsonError, parseJsonBody } from "./_helpers";
import { HTTP_BAD_REQUEST } from "~/shared/http-status";

const hotkeyAction = z.enum(HOTKEY_ACTIONS);

const bindingSchema = z.object({
  mod: z.boolean(),
  shift: z.boolean(),
  alt: z.boolean(),
  key: z.string().min(1, "key required"),
});

const updateBindingBody = z.object({
  action: hotkeyAction,
  binding: bindingSchema,
});

export function list(): Response {
  return json({ bindings: getBindings() });
}

export async function set(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, updateBindingBody);
  if (!parsed.ok) return parsed.response;
  const { action, binding } = parsed.data;
  const valid = isValidBinding(binding);
  if (!valid.ok) return jsonError(HTTP_BAD_REQUEST, valid.reason);
  return json({ bindings: setBinding(action as HotkeyAction, binding) });
}

export function reset(url: URL): Response {
  const rawAction = url.searchParams.get("action");
  if (rawAction === null) return json({ bindings: resetAllBindings() });
  const parsed = hotkeyAction.safeParse(rawAction);
  if (!parsed.success) return jsonError(HTTP_BAD_REQUEST, "invalid action");
  return json({ bindings: resetBinding(parsed.data as HotkeyAction) });
}
