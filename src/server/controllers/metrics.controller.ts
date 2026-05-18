import { json } from "./_helpers";
import { readHostedMetrics } from "../services/hosted-metrics";

export async function read(): Promise<Response> {
  return json({ metrics: readHostedMetrics() });
}
