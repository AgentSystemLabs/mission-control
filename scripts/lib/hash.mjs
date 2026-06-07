import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Stream a file through `algorithm` and resolve to its hex digest. */
export function digestFile(path, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
