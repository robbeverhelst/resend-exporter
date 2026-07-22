/**
 * Cross-compiles release binaries for all supported targets into dist/.
 * Invoked by semantic-release (see .releaserc.json) with the version as argv.
 */
import { $ } from "bun";

const version = process.argv[2] ?? "dev";
const targets = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"] as const;

console.log(`building resend-exporter ${version} binaries`);
for (const target of targets) {
  const outfile = `dist/resend-exporter-${target}`;
  // oxlint-disable-next-line no-await-in-loop -- sequential on purpose to bound memory
  await $`bun build --compile --minify --target=bun-${target} src/index.ts --outfile ${outfile}`;
  console.log(`built ${outfile}`);
}
