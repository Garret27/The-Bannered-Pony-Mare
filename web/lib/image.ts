import sharp from "sharp";
import { atomicWrite } from "./atomic-write";

const TARGET_WIDTH = 900;

export async function processPoster(
  input: Buffer,
  outputPath: string,
): Promise<void> {
  const processed = await sharp(input)
    .rotate()
    .resize(TARGET_WIDTH, null, { withoutEnlargement: false })
    .jpeg({ quality: 90 })
    .toBuffer();

  await atomicWrite(outputPath, processed);
}
