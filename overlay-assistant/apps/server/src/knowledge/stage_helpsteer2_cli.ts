import { pathToFileURL } from "node:url";
import { stageHelpSteer2File } from "./helpsteer2_staging.js";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const inputPath = valueAfter("--input");
  const outputPath = valueAfter("--output");
  const auditPath = valueAfter("--audit");
  const sourceRevision = valueAfter("--revision");
  if (!inputPath || !outputPath || !auditPath || !sourceRevision) {
    throw new Error(
      "usage: --input <preference.jsonl[.gz]> --output <staging.jsonl> --audit <audit.json> --revision <40-char commit>"
    );
  }
  const minimumPreferenceStrength = Number(valueAfter("--minimum-strength") ?? "2");
  const maximumPerDomain = Number(valueAfter("--maximum-per-domain") ?? "250");
  if (![1, 2, 3].includes(minimumPreferenceStrength) || !Number.isInteger(maximumPerDomain)) {
    throw new Error("minimum-strength must be 1, 2, or 3 and maximum-per-domain must be an integer");
  }

  const report = await stageHelpSteer2File({
    inputPath,
    outputPath,
    auditPath,
    options: {
      sourceRevision,
      minimumPreferenceStrength: minimumPreferenceStrength as 1 | 2 | 3,
      maximumPerDomain
    }
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
