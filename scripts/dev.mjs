#!/usr/bin/env node
// The web service's command: Tailwind rebuilding the CSS and the server restarting on change.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, parseArgs, plain } from "../src/data/cli.mjs";

plain(parseArgs(process.argv.slice(2)), `usage: npm run dev

The web service's command, running until stopped: the CSS rebuilt on each change, and
the site on localhost:3000 reading content/ and index/ fresh on every request. Search
uses the last build's index. Its output is the service log.`, "dev");

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (/** @type {string} */ name) => join(app, "node_modules", ".bin", name);
for (const name of ["tailwindcss", "tsx"]) if (!existsSync(bin(name))) fail(`dev: ${name} is missing`, "npm install, then npm run dev");

const children = [
  // --watch=always keeps watching with stdin closed, as it is under a service.
  spawn(bin("tailwindcss"), ["-i", "styles/input.css", "-o", "static/site.css", "--watch=always"], { stdio: "inherit", cwd: app }),
  spawn(bin("tsx"), ["watch", "--clear-screen=false", join(app, "src/server.ts")], { stdio: "inherit" }),
];
let stopping = false;
const stop = (/** @type {NodeJS.Signals} */ signal, code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill(signal);
  process.exit(code);
};
for (const s of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM"])) process.on(s, () => stop(s));
for (const c of children) c.on("exit", (code) => stop("SIGTERM", code ?? 1));
