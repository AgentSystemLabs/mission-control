import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { handleApiRequest } from "~/server/api-router";
import { ensureLocalApiTokenBootstrap } from "~/server/bootstrap";
import { toApiErrorResponse } from "~/server/lib/api-errors";

const startHandler = createStartHandler({ handler: defaultStreamHandler });

export default {
  async fetch(request: Request, opts?: Parameters<typeof startHandler>[1]) {
    try {
      const apiResponse = await handleApiRequest(request);
      if (apiResponse) return apiResponse;
      ensureLocalApiTokenBootstrap();
      return startHandler(request, opts);
    } catch (err: unknown) {
      const url = new URL(request.url);
      return toApiErrorResponse(err, {
        route: url.pathname,
        method: request.method,
      });
    }
  },
};
