/**
 * Server-side re-export of the cross-runtime error helper so server modules
 * can import from a co-located `./lib/errors` path without reaching into
 * `~/shared`. Logic lives in `src/shared/errors.ts`.
 */
export { getErrorMessage } from "~/shared/errors";
