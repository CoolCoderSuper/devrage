#!/usr/bin/env bun

import { main } from "./src/cli";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
