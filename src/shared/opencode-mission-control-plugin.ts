import * as fs from "node:fs";
import * as path from "node:path";

/** Marker comment — MC replaces this file on every OpenCode spawn. */
export const OPENCODE_MISSION_CONTROL_PLUGIN_MARKER = "@mission-control-managed";

/** Env vars the host injects so a spawned agent can reach the MC hook API. */
export const MC_AGENT_ENV_KEYS = ["MC_TASK_ID", "MC_API_URL", "MC_API_TOKEN"] as const;

export const OPENCODE_MISSION_CONTROL_PLUGIN_SEGMENTS = [
  ".opencode",
  "plugins",
  "mission-control.js",
] as const;

export function opencodeMissionControlPluginSource(): string {
  return `// ${OPENCODE_MISSION_CONTROL_PLUGIN_MARKER}
/** Mission Control status bridge for OpenCode (auto-installed). */

function sessionIdFrom(event) {
  const props = event?.properties ?? {};
  const info = props.info ?? {};
  return (
    props.sessionID ??
    props.sessionId ??
    info.sessionID ??
    info.sessionId ??
    info.id ??
    props.id ??
    props.session_id ??
    ""
  );
}

async function postMissionControlHook(hookEventName, body = {}) {
  const taskId = process.env.MC_TASK_ID;
  const apiUrl = process.env.MC_API_URL;
  const token = process.env.MC_API_TOKEN;
  if (!taskId || !apiUrl || !token) return;

  const url =
    apiUrl +
    "/api/hooks/opencode?taskId=" +
    encodeURIComponent(taskId) +
    "&hookEvent=" +
    encodeURIComponent(hookEventName);

  const payload = { hook_event_name: hookEventName, ...body };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Mission-Control-Runtime": "electron-local",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* fail-soft — never block the user's session */
  }
}

export const MissionControlStatus = async () => {
  return {
    "shell.env": async (_input, output) => {
      ${MC_AGENT_ENV_KEYS.map(
        (key) => `if (process.env.${key}) output.env.${key} = process.env.${key};`,
      ).join("\n      ")}
    },
    "chat.message": async (input, output) => {
      if (output.message?.role !== "user") return;
      const prompt = output.parts
        ?.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\\n")
        .trim();
      await postMissionControlHook("UserPromptSubmit", {
        session_id: input.sessionID,
        ...(prompt ? { prompt } : {}),
      });
    },
    "tool.execute.before": async (input) => {
      if (input.tool !== "question") return;
      void postMissionControlHook(
        "QuestionRequest",
        input.sessionID ? { session_id: input.sessionID } : {},
      );
    },
    event: async ({ event }) => {
      if (!event?.type) return;

      if (event.type === "session.created") {
        const sessionId = sessionIdFrom(event);
        if (sessionId) {
          await postMissionControlHook("SessionStart", { session_id: sessionId });
        }
        return;
      }

      if (event.type === "session.status") {
        const props = event.properties ?? {};
        const sessionId = sessionIdFrom(event);
        const statusType = props.status?.type;
        if (statusType === "idle") {
          await postMissionControlHook("Stop", sessionId ? { session_id: sessionId } : {});
        }
        return;
      }

      if (event.type === "session.idle") {
        const sessionId = sessionIdFrom(event);
        await postMissionControlHook("Stop", sessionId ? { session_id: sessionId } : {});
        return;
      }

      if (event.type === "question.asked") {
        const sessionId = sessionIdFrom(event);
        await postMissionControlHook(
          "QuestionRequest",
          sessionId ? { session_id: sessionId } : {},
        );
        return;
      }

      if (event.type === "permission.asked") {
        const sessionId = sessionIdFrom(event);
        await postMissionControlHook(
          "PermissionRequest",
          sessionId ? { session_id: sessionId } : {},
        );
      }
    },
  };
};
`;
}

export function opencodeMissionControlPluginPath(cwd: string): string {
  return path.join(cwd, ...OPENCODE_MISSION_CONTROL_PLUGIN_SEGMENTS);
}

export function writeOpencodeMissionControlPlugin(cwd: string): void {
  const file = opencodeMissionControlPluginPath(cwd);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, opencodeMissionControlPluginSource(), "utf8");
  } catch {
    // best-effort — card status simply won't update if install fails
  }
}
