import { z } from "zod";
import {
  AI_RUNTIME_HARNESS_VALUES,
  type AiRuntimeHarness,
} from "~/shared/ai-runtime-defaults";
import { listAiRuntimeModels } from "../services/ai-runtime-models";
import { json, parseSearchParams } from "./_helpers";

const listModelsParams = z.object({
  agent: z.enum(AI_RUNTIME_HARNESS_VALUES),
});

export async function list(url: URL): Promise<Response> {
  const parsed = parseSearchParams(url, listModelsParams);
  if (!parsed.ok) return parsed.response;
  const agent = parsed.data.agent as AiRuntimeHarness;
  return json(await listAiRuntimeModels(agent));
}
