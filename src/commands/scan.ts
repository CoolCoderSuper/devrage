import { allAdapters, createAdapter } from "../adapters/index";
import { detect } from "../detector";
import type { AgentStats, CountMap, ScanOptions, VariantTally } from "../types";

var c = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  white: "\x1B[37m",
  gray: "\x1B[90m"
};
var SPINNER_MESSAGES = [
  "Tallying the damage",
  "Reviewing your outbursts",
  "Judging your vocabulary",
  "Computing your shame",
  "Cataloging the profanity",
  "Measuring your frustration",
  "Assessing the verbal carnage",
  "Quantifying your displeasure",
  "Auditing your language",
  "Tabulating regrets"
];
function createSpinner() {
  let messageIdx = 0;
  let dotCount = 0;
  let timer = null;
  return {
    start() {
      messageIdx = Math.floor(Math.random() * SPINNER_MESSAGES.length);
      timer = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        const msg = SPINNER_MESSAGES[messageIdx % SPINNER_MESSAGES.length];
        const dots = ".".repeat(dotCount || 1);
        process.stdout.write(
          `\r  ${c.dim}${msg}${dots}${c.reset}   `
        );
      }, 300);
    },
    update() {
      messageIdx++;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write("\r" + " ".repeat(60) + "\r");
    }
  };
}
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
      console.log(`devrage scan \u2014 scan sessions for profanity

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
  const groupBy = options.by ?? "harness";
  const adapters = options.agent ? [createAdapter(options.agent)] : allAdapters();
  const spinner = createSpinner();
  spinner.start();
  const groupTally: CountMap = {};
  const variantTally: VariantTally = {};
  let totalMessages = 0;
  let totalSwears = 0;
  const perGroup: Record<string, AgentStats> = {};
  const sessions = new Set<string>();
  const sessionsWithSwears = new Set<string>();
  const sessionsByAgent: Record<string, Set<string>> = {};
  const sessionsWithSwearsByAgent: Record<string, Set<string>> = {};
  for (const adapter of adapters) {
    spinner.update();
    for await (const message of adapter.messages({ since: options.since })) {
      totalMessages++;
      const groupName = groupBy === "model" ? message.model ?? "unknown" : adapter.name;
      const groupStats = perGroup[groupName] ??= { messages: 0, swears: 0 };
      groupStats.messages++;
      const sessionKey = message.session ? `${adapter.name}\0${message.session}` : undefined;
      if (sessionKey) {
        sessions.add(sessionKey);
        (sessionsByAgent[adapter.name] ??= new Set()).add(sessionKey);
      }
      const result = detect(message.text);
      if (result.count > 0) {
        totalSwears += result.count;
        groupStats.swears += result.count;
        if (sessionKey) {
          sessionsWithSwears.add(sessionKey);
          (sessionsWithSwearsByAgent[adapter.name] ??= new Set()).add(sessionKey);
        }
        for (const match of result.matches) {
          groupTally[match.group] = (groupTally[match.group] ?? 0) + 1;
          const variants = variantTally[match.group] ??= {};
          variants[match.word] = (variants[match.word] ?? 0) + 1;
        }
      }
    }
  }
  spinner.stop();
  console.log("");
  console.log(`  ${c.bold}${c.red}devrage${c.reset} ${c.dim}report${c.reset}`);
  console.log(`  ${c.dim}${"\u2500".repeat(30)}${c.reset}`);
  console.log("");
  console.log(`  ${c.dim}messages scanned${c.reset}  ${c.bold}${totalMessages}${c.reset}`);
  console.log(`  ${c.dim}total swears${c.reset}      ${c.bold}${c.red}${totalSwears}${c.reset}`);
  const activeGroups = Object.entries(perGroup);
  if (activeGroups.length > 1 || groupBy === "model") {
    console.log("");
    console.log(`  ${c.bold}by ${groupBy}${c.reset}`);
    for (const [name, stats] of activeGroups) {
      const rate = (stats.swears / stats.messages * 100).toFixed(1);
      console.log(
        `    ${c.cyan}${name.padEnd(10)}${c.reset} ${c.bold}${String(stats.swears).padStart(4)}${c.reset} ${c.dim}in ${stats.messages} messages (${rate}%)${c.reset}`
      );
    }
  }
  if (totalSwears > 0) {
    const sorted = Object.entries(groupTally).sort(([, a], [, b]) => b - a);
    console.log("");
    console.log(`  ${c.bold}top words${c.reset}`);
    for (const [group, count] of sorted.slice(0, 10)) {
      const variants = variantTally[group] ?? {};
      const variantList = Object.entries(variants).sort(([, a], [, b]) => b - a).filter(([v]) => v !== group).slice(0, 15).map(([v, cnt]) => `${c.dim}${v}${c.reset} ${cnt}`).join(`${c.dim},${c.reset} `);
      const suffix = variantList ? ` ${c.dim}(${c.reset}${variantList}${c.dim})${c.reset}` : "";
      console.log(
        `    ${c.yellow}${group.padEnd(12)}${c.reset} ${c.bold}${String(count).padStart(4)}${c.reset}${suffix}`
      );
    }
  }
  console.log("");
  if (totalSwears === 0) {
    console.log(`  ${c.green}squeaky clean! not a single swear found.${c.reset}`);
    console.log("");
  }
  if (sessions.size > 0) {
    const sessionRate = (sessionsWithSwears.size / sessions.size * 100).toFixed(1);
    console.log(`  ${c.dim}sessions with swearing${c.reset} ${c.bold}${sessionRate}%${c.reset} ${c.dim}(${sessionsWithSwears.size}/${sessions.size})${c.reset}`);
    const sessionAgents = Object.entries(sessionsByAgent);
    if (sessionAgents.length > 1) {
      console.log(`  ${c.dim}by editor${c.reset}`);
      for (const [name, agentSessions] of sessionAgents) {
        const agentSessionsWithSwears = sessionsWithSwearsByAgent[name]?.size ?? 0;
        const agentSessionRate = (agentSessionsWithSwears / agentSessions.size * 100).toFixed(1);
        console.log(`    ${c.cyan}${name.padEnd(10)}${c.reset} ${c.bold}${agentSessionRate.padStart(5)}%${c.reset} ${c.dim}(${agentSessionsWithSwears}/${agentSessions.size})${c.reset}`);
      }
    }
    console.log("");
  }
}
