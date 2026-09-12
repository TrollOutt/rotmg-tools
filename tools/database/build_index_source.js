"use strict";

// SQLite consumes the exact same upstream construction as the production
// Index writer. This wrapper deliberately has no Index-building rules of its
// own and never supplies data/Index/index.json as an input.
const childProcess = require("child_process");
const path = require("path");

const at = process.argv.indexOf("--output");
const output = at >= 0 ? process.argv[at + 1] : null;
if (!output) throw new Error("--output <temporary JSON path> is required");

const root = path.resolve(__dirname, "..", "..");
childProcess.execFileSync(
  process.execPath,
  [path.join(root, "tools", "build-index.js"), "--sqlite-source", path.resolve(output)],
  { cwd: root, stdio: "inherit", env: process.env }
);
