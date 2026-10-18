import { createReadStream } from "fs";
import { Transform } from "stream";

/** Read file for fetch upload while tracking bytes — do not attach "data" on the same stream. */
export function createCountingReadStream(
  filePath: string,
  onProgress: (bytesSent: number) => void,
): Transform {
  let bytesSent = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesSent += chunk.length;
      onProgress(bytesSent);
      callback(null, chunk);
    },
  });

  createReadStream(filePath).pipe(counter);
  return counter;
}
