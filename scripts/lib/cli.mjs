/** Build a `fail(message)` that logs `[prefix] message` to stderr and exits 1. */
export function makeFail(prefix) {
  return (message) => {
    console.error(`[${prefix}] ${message}`);
    process.exit(1);
  };
}
