// @mission-control-managed
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
      if (process.env.MC_TASK_ID) output.env.MC_TASK_ID = process.env.MC_TASK_ID;
      if (process.env.MC_API_URL) output.env.MC_API_URL = process.env.MC_API_URL;
      if (process.env.MC_API_TOKEN) output.env.MC_API_TOKEN = process.env.MC_API_TOKEN;
    },
    "chat.message": async (input, output) => {
      if (output.message?.role !== "user") return;
      const prompt = output.parts
        ?.map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
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
