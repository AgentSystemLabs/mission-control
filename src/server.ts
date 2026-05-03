import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { handleApiRequest } from "~/server/api-router";

const startHandler = createStartHandler({ handler: defaultStreamHandler });

export default {
  async fetch(request: Request, opts?: Parameters<typeof startHandler>[1]) {
    const apiResponse = await handleApiRequest(request);
    if (apiResponse) return apiResponse;
    return startHandler(request, opts);
  },
};
