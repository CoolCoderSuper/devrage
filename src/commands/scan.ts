import { createScanReport } from "./scan-report";
import type { ScanOptions } from "../types";
import { printPlainReport } from "../ui/plain-report";
import { renderScanTui } from "../ui/scan-tui";

function parseArgs(args): ScanOptions {
  const options: ScanOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent" || arg === "-a") {
      options.agent = args[++i];
    } else if (arg === "--by" || arg === "-b") {
      const val = args[++i];
      if (val === "harness" || val === "model") {
        options.by = val;
      } else {
        console.error(`invalid grouping: ${val} (expected harness or model)`);
        process.exit(1);
      }
    } else if (arg === "--since" || arg === "-s") {
      const val = args[++i];
      if (val) {
        options.since = new Date(val);
        if (isNaN(options.since.getTime())) {
          console.error(`invalid date: ${val}`);
          process.exit(1);
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`devrage scan — scan sessions for profanity

Options:
  --agent, -a <name>   Scan only a specific agent (claude, codex, opencode, amp, cursor, vscode, cline, zed, pi)
  --by, -b <mode>      Group results by harness or model (default: harness)
  --since, -s <date>   Only scan messages after this date (ISO 8601)
  --help, -h           Show this help`);
      process.exit(0);
    }
  }
  return options;
}

export async function scan(args) {
  const options = parseArgs(args);
  if (process.stdout.isTTY) {
    await renderScanTui(options);
    return;
  }

  printPlainReport(await createScanReport(options));
}
