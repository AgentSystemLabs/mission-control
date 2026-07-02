import { z } from "zod";
import {
  AI_MODEL_ID_HELP,
  AI_RUNTIME_HARNESS_VALUES,
  normalizeAiModelId,
  type AiModelId,
} from "~/shared/ai-runtime-defaults";
import {
  MARKDOWN_REFINE_MAX_ANNOTATIONS,
  MARKDOWN_REFINE_MAX_BYTES,
  MARKDOWN_REFINE_NOTE_MAX_LEN,
  MARKDOWN_REFINE_QUOTE_MAX_LEN,
} from "~/shared/markdown-refine";
import { HTTP_BAD_REQUEST, HTTP_INTERNAL_SERVER_ERROR } from "~/shared/http-status";
import { refineMarkdown } from "../services/markdown-refiner";
import { json, jsonError, parseJsonBody } from "./_helpers";

const aiModelBody = z.union([z.string(), z.null()]).transform((value, ctx): AiModelId | null => {
  const normalized = normalizeAiModelId(value);
  if (normalized || value === null || (typeof value === "string" && value.trim() === "")) {
    return normalized;
  }
  ctx.addIssue({ code: "custom", message: AI_MODEL_ID_HELP });
  return z.NEVER;
});

const refineBody = z.object({
  content: z.string(),
  harness: z.enum(AI_RUNTIME_HARNESS_VALUES).optional().default("claude-code"),
  model: aiModelBody.optional().default(null),
  annotations: z
    .array(
      z.object({
        lineStart: z.number().int().positive(),
        lineEnd: z.number().int().positive(),
        quote: z.string().max(MARKDOWN_REFINE_QUOTE_MAX_LEN),
        note: z.string().trim().min(1).max(MARKDOWN_REFINE_NOTE_MAX_LEN),
      }),
    )
    .min(1, "at least one annotation is required")
    .max(MARKDOWN_REFINE_MAX_ANNOTATIONS),
});

export async function refine(request: Request): Promise<Response> {
  const parsed = await parseJsonBody(request, refineBody);
  if (!parsed.ok) return parsed.response;
  const { content, harness, model, annotations } = parsed.data;

  if (Buffer.byteLength(content, "utf8") > MARKDOWN_REFINE_MAX_BYTES) {
    return jsonError(HTTP_BAD_REQUEST, `content exceeds ${MARKDOWN_REFINE_MAX_BYTES} bytes`);
  }

  try {
    const refined = await refineMarkdown({ content, annotations, harness, model });
    return json({ refined });
  } catch (e) {
    const message = e instanceof Error ? e.message : "refine failed";
    return jsonError(HTTP_INTERNAL_SERVER_ERROR, `Refine failed: ${message}`);
  }
}
