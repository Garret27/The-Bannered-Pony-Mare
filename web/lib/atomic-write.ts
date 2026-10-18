import fs from "fs/promises";
import path from "path";

export async function atomicWrite(
  filePath: string,
  data: Buffer | string,
): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.tmp`,
  );

  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, filePath);
}
