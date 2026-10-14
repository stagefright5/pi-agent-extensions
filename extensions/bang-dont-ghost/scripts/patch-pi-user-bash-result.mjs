#!/usr/bin/env node

import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const SUPPORTED_PI_VERSION = "1.2.0";

const EVENT_MARKER = /type\s*:\s*["']user_bash_result["']/;
const BUNDLED_SESSION_MARKER = "recordBashResult(command,result,options){let bashMessage=";

const DIRECT_RECORD_ANCHOR =
  "this.isStreaming?this._pendingBashMessages.push(bashMessage):(this.sessionManager.appendMessage(bashMessage),this._refreshFinalizedContext())}abortBash(){";

const DIRECT_RECORD_REPLACEMENT =
  'this.isStreaming?this._pendingBashMessages.push(bashMessage):(this.sessionManager.appendMessage(bashMessage),this._refreshFinalizedContext(),this._emitUserBashResult(bashMessage))}_emitUserBashResult(bashMessage){void this._extensionRunner.emit({type:"user_bash_result",command:bashMessage.command,excludeFromContext:bashMessage.excludeFromContext??false,result:{output:bashMessage.output,exitCode:bashMessage.exitCode,cancelled:bashMessage.cancelled,truncated:bashMessage.truncated,fullOutputPath:bashMessage.fullOutputPath}})}abortBash(){';

const DEFERRED_FLUSH_ANCHOR =
  "for(let bashMessage of this._pendingBashMessages)this.sessionManager.appendMessage(bashMessage);this._pendingBashMessages=[],this._refreshFinalizedContext()}";

const DEFERRED_FLUSH_REPLACEMENT =
  "for(let bashMessage of this._pendingBashMessages)this.sessionManager.appendMessage(bashMessage);let bashMessages=this._pendingBashMessages;this._pendingBashMessages=[],this._refreshFinalizedContext();for(let bashMessage of bashMessages)this._emitUserBashResult(bashMessage)}";

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
  if (EVENT_MARKER.test(source)) {
    if (
      countOccurrences(source, DIRECT_RECORD_REPLACEMENT) === 1 &&
      countOccurrences(source, DEFERRED_FLUSH_REPLACEMENT) === 1 &&
      !source.includes(DIRECT_RECORD_ANCHOR) &&
      !source.includes(DEFERRED_FLUSH_ANCHOR)
    ) {
      return { state: "already-applied", source };
    }
    throw new Error("Pi runtime already mentions user_bash_result, but not in the expected Pi 1.2.0 patch shape");
  }

  const directCount = countOccurrences(source, DIRECT_RECORD_ANCHOR);
  const deferredCount = countOccurrences(source, DEFERRED_FLUSH_ANCHOR);
  if (directCount !== 1 || deferredCount !== 1) {
    throw new Error(
      `Pi ${SUPPORTED_PI_VERSION} bundled patch anchors did not match exactly once ` +
        `(direct=${directCount}, deferred=${deferredCount}); Pi was not modified`,
    );
  }

  return {
    state: "applied",
    source: source
      .replace(DIRECT_RECORD_ANCHOR, DIRECT_RECORD_REPLACEMENT)
      .replace(DEFERRED_FLUSH_ANCHOR, DEFERRED_FLUSH_REPLACEMENT),
  };
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

function isSupportedCliPath(path) {
  return path.replaceAll("\\", "/").endsWith("/dist/bundle/cli.js");
}

function resolvePiCliPath(executable) {
  const executableTarget = realpathSync(executable);
  if (isSupportedCliPath(executableTarget)) return executableTarget;

  let shimSource;
  try {
    shimSource = readFileSync(executableTarget, "utf8");
  } catch {
    throw new Error(`resolved Pi executable has an unexpected target: ${executableTarget}`);
  }

  const marker = shimSource.match(/^# cmd-shim-target=(.+)$/m)?.[1]?.trim();
  if (!marker) {
    throw new Error(`resolved Pi executable is not a supported Pi ${SUPPORTED_PI_VERSION} command shim`);
  }

  const declaredTarget = resolve(dirname(executableTarget), marker);
  let cliPath;
  try {
    cliPath = realpathSync(declaredTarget);
  } catch {
    throw new Error(`Pi command shim target does not exist: ${declaredTarget}`);
  }
  if (!isSupportedCliPath(cliPath)) {
    throw new Error(`Pi command shim does not target the Pi ${SUPPORTED_PI_VERSION} bundled CLI: ${cliPath}`);
  }
  return cliPath;
}

function findPiPackage(cliPath) {
  let directory = dirname(cliPath);
  while (true) {
    const packageJsonPath = join(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (packageJson.name === "@earendil-works/pi-coding-agent") {
        return packageJson;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`could not find @earendil-works/pi-coding-agent package for ${cliPath}`);
}

function findBundledRuntime(cliPath) {
  const chunksDirectory = join(dirname(cliPath), "chunks");
  let entries;
  try {
    entries = readdirSync(chunksDirectory, { withFileTypes: true });
  } catch {
    throw new Error(`could not inspect Pi bundle chunks: ${chunksDirectory}`);
  }

  const candidates = entries
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".js"))
    .map((entry) => join(chunksDirectory, entry.name))
    .filter((path) => readFileSync(path, "utf8").includes(BUNDLED_SESSION_MARKER));
  if (candidates.length !== 1) {
    throw new Error(
      `could not locate exactly one Pi ${SUPPORTED_PI_VERSION} bundled AgentSession runtime ` +
        `(found ${candidates.length}) in ${chunksDirectory}`,
    );
  }
  return realpathSync(candidates[0]);
}

export function discoverInstalledPi(executable = findExecutable("pi")) {
  const cliPath = resolvePiCliPath(executable);
  const packageJson = findPiPackage(cliPath);
  const version = String(packageJson.version ?? "unknown");
  if (version !== SUPPORTED_PI_VERSION) {
    throw new Error(`unsupported Pi version ${version}; this patcher only supports ${SUPPORTED_PI_VERSION}`);
  }
  return {
    executable,
    version,
    targetPath: findBundledRuntime(cliPath),
  };
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`patched JavaScript failed syntax validation:\n${result.stderr || result.stdout}`);
  }
}

export function patchFile(targetPath, { check = false } = {}) {
  const original = readFileSync(targetPath, "utf8");
  const patch = patchSource(original);
  if (patch.state === "already-applied") return patch.state;
  if (check) return "not-applied";

  const mode = statSync(targetPath).mode;
  const temporaryPath = join(dirname(targetPath), `.pi-bang-dont-ghost.${process.pid}.js`);
  const rollbackPath = join(dirname(targetPath), `.pi-bang-dont-ghost.rollback.${process.pid}.js`);
  let replaced = false;
  try {
    writeFileSync(temporaryPath, patch.source, { encoding: "utf8", mode });
    syntaxCheck(temporaryPath);
    if (readFileSync(targetPath, "utf8") !== original) throw new Error("Pi runtime changed during patching");
    const backupPath = `${targetPath}.bang-dont-ghost.original`;
    if (existsSync(backupPath)) {
      if (readFileSync(backupPath, "utf8") !== original) throw new Error(`Unexpected backup at ${backupPath}`);
    } else {
      writeFileSync(backupPath, original, { encoding: "utf8", mode, flag: "wx" });
    }
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

export function restoreFile(targetPath) {
  const backupPath = `${targetPath}.bang-dont-ghost.original`;
  const original = readFileSync(backupPath, "utf8");
  const current = readFileSync(targetPath, "utf8");
  if (current === original) return "already-restored";
  if (patchSource(original).source !== current) {
    throw new Error("Pi runtime changed since patching; refusing to overwrite it");
  }
  const temporaryPath = `${targetPath}.restore.${process.pid}.js`;
  try {
    writeFileSync(temporaryPath, original, { encoding: "utf8", mode: statSync(targetPath).mode });
    syntaxCheck(temporaryPath);
    if (readFileSync(targetPath, "utf8") !== current) throw new Error("Pi runtime changed during restoration");
    renameSync(temporaryPath, targetPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return "restored";
}

function notifyFailure(message) {
  if (process.platform !== "darwin") return;
  const script = ["on run argv", 'display notification (item 1 of argv) with title "Pi patch failed"', "end run"];
  spawnSync("/usr/bin/osascript", ["-e", script[0], "-e", script[1], "-e", script[2], "--", message], {
    stdio: "ignore",
  });
}

function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--target" && args[i + 1] && !options.targetPath) options.targetPath = resolve(args[++i]);
    else if (args[i] === "--check" && !options.check) options.check = true;
    else if (args[i] === "--restore" && !options.restore) options.restore = true;
    else throw new Error("Usage: pi-patch-user-bash-result [--target <runtime.js>] [--check | --restore]");
  }
  if (options.check && options.restore) throw new Error("--check and --restore are mutually exclusive");
  return options;
}

export function run(args = process.argv.slice(2)) {
  try {
    const options = parseArguments(args);
    const discovered = options.targetPath
      ? { executable: undefined, version: `${SUPPORTED_PI_VERSION} explicit target`, targetPath: options.targetPath }
      : discoverInstalledPi();
    const state = options.restore
      ? restoreFile(discovered.targetPath)
      : patchFile(discovered.targetPath, { check: options.check });
    console.log(`${state}: user_bash_result patch`);
    console.log(`Pi version: ${discovered.version}`);
    console.log(`Target: ${discovered.targetPath}`);
    return state === "not-applied" ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pi-patch-user-bash-result: ${message}`);
    notifyFailure(message);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = run();
