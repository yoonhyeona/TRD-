import sharp from "sharp";

import { sampleSvg, type SampleId } from "@/lib/sample-art";

export { sampleIds, sampleLabels, type SampleId } from "@/lib/sample-art";

export async function samplePng(id: SampleId): Promise<Buffer> {
  return sharp(Buffer.from(sampleSvg(id))).png().toBuffer();
}
