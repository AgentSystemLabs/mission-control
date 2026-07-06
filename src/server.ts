import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { setServerApiTokenResolver } from "~/lib/api";
import { handleApiRequest } from "~/server/api-router";
import { getServerApiToken } from "~/server/auth";
import { registerRecallAutoDistill } from "~/server/services/recall-auto-distill";
import { registerGraphWatchCoalesce } from "~/server/services/graph-watcher";

setServerApiTokenResolver(getServerApiToken);
// Subscribe the Recall auto-distill pass to session:finished for the life of the
// server process (idempotent). Real app runtime only — unit tests that import
// the router directly opt in by calling registerRecallAutoDistill() themselves.
registerRecallAutoDistill();
// Subscribe the live code-graph watcher's coalescing re-fire to graph:indexed so
// edits that land mid-build aren't dropped (idempotent).
registerGraphWatchCoalesce();

const startHandler = createStartHandler({ handler: defaultStreamHandler });

export default {
  async fetch(request: Request, opts?: Parameters<typeof startHandler>[1]) {
    const apiResponse = await handleApiRequest(request);
    if (apiResponse) return apiResponse;
    return startHandler(request, opts);
  },
};
