import { scan } from "./commands/scan";

var COMMANDS = {
  scan
};
function usage() {
  console.log(`devrage \u2014 count how many times you swear at your coding agents

Usage:
  devrage <command> [options]

Commands:
  scan          Scan sessions for profanity

Options:
  --help, -h    Show this help message
  --version     Show version

Examples:
  devrage scan
  devrage scan --agent claude
  devrage scan --by model
  devrage scan --since 2025-01-01`);
}
export async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }
  if (command === "--version") {
    console.log("0.0.3");
    process.exit(0);
  }
  const handler = command ? COMMANDS[command] : void 0;
  if (handler) {
    await handler(args.slice(1));
  } else {
    await scan(args);
  }
}
