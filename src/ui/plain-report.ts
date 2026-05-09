import type { ScanReport } from "../types";

const c = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  cyan: "\x1B[36m"
};

export function printPlainReport(report: ScanReport) {
  console.log("");
  console.log(`  ${c.bold}${c.red}devrage${c.reset} ${c.dim}report${c.reset}`);
  console.log(`  ${c.dim}${"─".repeat(30)}${c.reset}`);
  console.log("");
  console.log(`  ${c.dim}messages scanned${c.reset}  ${c.bold}${report.totalMessages}${c.reset}`);
  console.log(`  ${c.dim}total swears${c.reset}      ${c.bold}${c.red}${report.totalSwears}${c.reset}`);

  if (report.groups.length > 1 || report.groupBy === "model") {
    console.log("");
    console.log(`  ${c.bold}by ${report.groupBy}${c.reset}`);
    for (const group of report.groups) {
      console.log(
        `    ${c.cyan}${group.name.padEnd(10)}${c.reset} ${c.bold}${String(group.swears).padStart(4)}${c.reset} ${c.dim}in ${group.messages} messages (${group.rate.toFixed(1)}%)${c.reset}`
      );
    }
  }

  if (report.topWords.length > 0) {
    console.log("");
    console.log(`  ${c.bold}top words${c.reset}`);
    for (const word of report.topWords) {
      const variantList = word.variants.map((variant) => `${c.dim}${variant.word}${c.reset} ${variant.count}`).join(`${c.dim},${c.reset} `);
      const suffix = variantList ? ` ${c.dim}(${c.reset}${variantList}${c.dim})${c.reset}` : "";
      console.log(
        `    ${c.yellow}${word.group.padEnd(12)}${c.reset} ${c.bold}${String(word.count).padStart(4)}${c.reset}${suffix}`
      );
    }
  }

  console.log("");
  if (report.totalSwears === 0) {
    console.log(`  ${c.green}squeaky clean! not a single swear found.${c.reset}`);
    console.log("");
  }

  if (report.sessions) {
    console.log(`  ${c.dim}sessions with swearing${c.reset} ${c.bold}${report.sessions.rate.toFixed(1)}%${c.reset} ${c.dim}(${report.sessions.sessionsWithSwears}/${report.sessions.sessions})${c.reset}`);
    console.log("");
  }
}
