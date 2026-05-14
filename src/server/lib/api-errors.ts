import { jsonError } from "./api-response";
import { logger } from "~/shared/logger";
import {
  DuplicateProjectPathError,
  ProjectCapExceededError,
  ProjectValidationError,
} from "../services/projects";
import { DuplicateGroupNameError } from "../services/groups";
import { DuplicateUserTerminalNameError } from "../services/user-terminals";
import { SkillsBundleError } from "../services/skills-bundle";
import { LaunchKitAuthorizationError } from "../services/launch-kit";
import { GitError } from "../services/git";
import type { ApiErrorDetails } from "~/shared/api-errors";

export const INTERNAL_ERROR_MESSAGE = "Internal server error";

type AppErrorInit = {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetails;
  extra?: Record<string, unknown>;
};

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: ApiErrorDetails;
  public readonly extra?: Record<string, unknown>;

  constructor(init: AppErrorInit) {
    super(init.message);
    this.name = "AppError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.extra = init.extra;
  }
}

type ErrorResponseContext = {
  route?: string;
  method?: string;
  logMessage?: string;
  fallbackStatus?: number;
  fallbackMessage?: string;
  fallbackCode?: string;
};

export function toApiErrorResponse(err: unknown, context: ErrorResponseContext = {}): Response {
  const appError = toAppError(err);
  if (appError) {
    return jsonError(appError.status, appError.message, {
      code: appError.code,
      details: appError.details,
      extra: appError.extra,
    });
  }

  logger.error(context.logMessage ?? "api handler failed", {
    err,
    route: context.route,
    method: context.method,
  });
  return jsonError(
    context.fallbackStatus ?? 500,
    context.fallbackMessage ?? INTERNAL_ERROR_MESSAGE,
    { code: context.fallbackCode ?? "internal_error" },
  );
}

export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ProjectCapExceededError) {
    return new AppError({
      status: 402,
      code: "free_tier_project_cap",
      message: err.message,
      extra: { limit: err.limit, current: err.current },
    });
  }
  if (err instanceof DuplicateProjectPathError) {
    return new AppError({
      status: 409,
      code: "duplicate_project",
      message: err.message,
    });
  }
  if (err instanceof ProjectValidationError) {
    return new AppError({
      status: 400,
      code: "invalid_project",
      message: err.message,
    });
  }
  if (err instanceof DuplicateGroupNameError) {
    return new AppError({
      status: 409,
      code: "duplicate_group",
      message: err.message,
    });
  }
  if (err instanceof DuplicateUserTerminalNameError) {
    return new AppError({
      status: 409,
      code: "duplicate_user_terminal",
      message: err.message,
    });
  }
  if (err instanceof SkillsBundleError) {
    return new AppError({
      status: err.code === "not_pro" || err.code === "no_key" ? 402 : 502,
      code: err.code,
      message: safeSkillsBundleMessage(err.code),
    });
  }
  if (err instanceof LaunchKitAuthorizationError) {
    return new AppError({
      status: 403,
      code: "launch_kit_directory_not_allowed",
      message: err.message,
    });
  }
  if (err instanceof GitError) {
    return new AppError({
      status: 400,
      code: "git_operation_failed",
      message: err.message,
    });
  }
  if (err instanceof Error) {
    const message = err.message;
    if (message.startsWith("Git repository")) {
      return new AppError({
        status: 400,
        code: "invalid_git_repository",
        message,
      });
    }
    if (
      message.startsWith("Project image") ||
      message === "Choose either a local image path or image data URL"
    ) {
      return new AppError({
        status: 400,
        code: "invalid_project_image",
        message,
      });
    }
    if (isSafeValidationMessage(message)) {
      return new AppError({
        status: 400,
        code: "invalid_request",
        message,
      });
    }
  }
  return null;
}

function safeSkillsBundleMessage(code: SkillsBundleError["code"]): string {
  switch (code) {
    case "no_key":
      return "No license key on file.";
    case "not_pro":
      return "Mission Control Pro is required to download the skills bundle.";
    case "network":
      return "Couldn't reach the skills server.";
    case "academy_rejected":
      return "Skills server rejected the request.";
    case "extract_failed":
      return "Failed to extract skills bundle.";
  }
}

function isSafeValidationMessage(message: string): boolean {
  return new Set([
    "Group name is required",
    "Name is required",
    "Project name is required",
    "Project name cannot be . or ..",
    "Project name cannot contain path separators",
    "Working directory is required",
    "Working directory must be an existing directory",
    "A file or folder already exists at the project path",
    "Academy access is required to download the Launch Kit.",
    "A valid Academy license key is required.",
  ]).has(message);
}
