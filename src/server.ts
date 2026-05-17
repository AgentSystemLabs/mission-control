import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { setServerApiTokenResolver } from "~/lib/api";
import { handleApiRequest } from "~/server/api-router";
import { getServerApiToken } from "~/server/auth";

setServerApiTokenResolver(getServerApiToken);

const startHandler = createStartHandler({ handler: defaultStreamHandler });

export default {
  async fetch(request: Request, opts?: Parameters<typeof startHandler>[1]) {
    const apiResponse = await handleApiRequest(request);
    if (apiResponse) return apiResponse;
    return startHandler(request, opts);
  },
};
