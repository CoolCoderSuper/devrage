# devrage

Count how many times you swear at your coding agents.

## Supported Adapters

`devrage` currently includes adapters for:

- Amp
- Claude
- Cline / Roo Cline
- Codex
- Cursor
- OpenCode
- Pi
- VS Code chat storage
- Zed

## Requirements

- [Bun](https://bun.sh/)


## Usage

Run a scan across every supported adapter:

```sh
bun run dev
```

## CLI Options

```text
devrage scan --agent <name>   Scan only one adapter
devrage scan --by <mode>      Group by harness or model
devrage scan --since <date>   Only include messages after an ISO 8601 date
devrage scan --help           Show scan help
devrage --version             Print the current version
```

Valid `--agent` values are:

```text
claude, codex, opencode, amp, cursor, vscode, cline, zed, pi
```

Valid `--by` values are:

```text
harness, model
```

## Kudos

Kudos to [badlogic's `devrage 0.0.3` gist with Pi session support](https://gist.github.com/badlogic/76a46b20d11bdeca36d5dfb4c73f05f3), provided most of the adapters and the idea.
