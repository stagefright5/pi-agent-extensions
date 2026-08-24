#!/usr/bin/env node

import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EVENT_MARKER = 'type: "user_bash_result"';
const METHOD_MARKER = "_emitUserBashResult(bashMessage)";

const DIRECT_RECORD_ANCHOR = `            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
    }
    /**
     * Cancel running bash command.
     */`;

const DIRECT_RECORD_REPLACEMENT = `            // Save to session
            this.sessionManager.appendMessage(bashMessage);
            this._emitUserBashResult(bashMessage);
        }
    }
    _emitUserBashResult(bashMessage) {
        void this._extensionRunner.emit({
            type: "user_bash_result",
            command: bashMessage.command,
            excludeFromContext: bashMessage.excludeFromContext ?? false,
            result: {
                output: bashMessage.output,
                exitCode: bashMessage.exitCode,
                cancelled: bashMessage.cancelled,
                truncated: bashMessage.truncated,
                fullOutputPath: bashMessage.fullOutputPath,
            },
        });
    }
    /**
     * Cancel running bash command.
     */`;

const DEFERRED_FLUSH_ANCHOR = `            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
        this._pendingBashMessages = [];`;

const DEFERRED_FLUSH_REPLACEMENT = `            // Save to session
            this.sessionManager.appendMessage(bashMessage);
            this._emitUserBashResult(bashMessage);
        }
        this._pendingBashMessages = [];`;

function countOccurrences(source, search) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(search, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + search.length;
  }
}

export function patchSource(source) {
  if (source.includes(EVENT_MARKER)) {
    const methodOccurrences = countOccurrences(source, METHOD_MARKER);
    if (methodOccurrences >= 3) {
      return { state: "already-applied", source };
    }
    throw new Error("agent-session.js already mentions user_bash_result, but not in the expected patched shape");
  }

  const directCount = countOccurrences(source, DIRECT_RECORD_ANCHOR);
  const deferredCount = countOccurrences(source, DEFERRED_FLUSH_ANCHOR);
  if (directCount !== 1 || deferredCount !== 1) {
    throw new Error(
      `patch anchors did not match exactly once (direct=${directCount}, deferred=${deferredCount}); Pi was not modified`,
    );
  }

  const patched = source
    .replace(DIRECT_RECORD_ANCHOR, DIRECT_RECORD_REPLACEMENT)
    .replace(DEFERRED_FLUSH_ANCHOR, DEFERRED_FLUSH_REPLACEMENT);

  return { state: "applied", source: patched };
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through PATH.
    }
  }
  throw new Error(`${name} was not found on PATH`);
}

export function discoverInstalledPi() {
  const executable = findExecutable("pi");
  const cliPath = realpathSync(executable);
  if (cliPath.endsWith("/dist/cli.js") === false) {
    throw new Error(`resolved Pi executable has an unexpected target: ${cliPath}`);
  }

  const packageRoot = dirname(dirname(cliPath));
  const packageJsonPath = join(packageRoot, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  return {
    executable,
    version: String(packageJson.version ?? "unknown"),
    targetPath: join(dirname(cliPath), "core", "agent-session.js"),
  };
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`patched JavaScript failed syntax validation:\n${result.stderr || result.stdout}`);
  }
}

export function patchFile(targetPath) {
  const original = readFileSync(targetPath, "utf8");
  const patch = patchSource(original);
  if (patch.state === "already-applied") return patch.state;

  const mode = statSync(targetPath).mode;
  const temporaryPath = join(dirname(targetPath), `.agent-session.bang-dont-ghost.${process.pid}.js`);
  const rollbackPath = join(dirname(targetPath), `.agent-session.bang-dont-ghost.rollback.${process.pid}.js`);
  let replaced = false;
  try {
    writeFileSync(temporaryPath, patch.source, { encoding: "utf8", mode });
    syntaxCheck(temporaryPath);
    renameSync(temporaryPath, targetPath);
    replaced = true;

    const installed = readFileSync(targetPath, "utf8");
    if (patchSource(installed).state !== "already-applied") {
      throw new Error("post-write verification did not recognize the installed patch");
    }
  } catch (error) {
    if (replaced) {
      try {
        writeFileSync(rollbackPath, original, { encoding: "utf8", mode });
        renameSync(rollbackPath, targetPath);
      } catch (rollbackError) {
        const patchMessage = error instanceof Error ? error.message : String(error);
        const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        throw new Error(`patch failed (${patchMessage}) and rollback failed (${rollbackMessage})`);
      }
    }
    throw error;
  } finally {
    rmSync(temporaryPath, { force: true });
    rmSync(rollbackPath, { force: true });
  }

  return patch.state;
}

function notifyFailure(message) {
  if (process.platform !== "darwin") return;
  const script = ["on run argv", 'display notification (item 1 of argv) with title "Pi patch failed"', "end run"];
  spawnSync("/usr/bin/osascript", ["-e", script[0], "-e", script[1], "-e", script[2], "--", message], {
    stdio: "ignore",
  });
}

function parseArguments(args) {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--target") return { targetPath: resolve(args[1]) };
  throw new Error("Usage: pi-patch-user-bash-result [--target <agent-session.js>]");
}

export function run(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    const discovered = options.targetPath
      ? { executable: undefined, version: "explicit target", targetPath: options.targetPath }
      : discoverInstalledPi();
    const state = patchFile(discovered.targetPath);
    const action = state === "applied" ? "Applied" : "Already applied";
    console.log(`${action}: user_bash_result patch`);
    console.log(`Pi version: ${discovered.version}`);
    console.log(`Target: ${discovered.targetPath}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pi-patch-user-bash-result: ${message}`);
    notifyFailure(message);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run();
