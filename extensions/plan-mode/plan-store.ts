import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateSlug } from "./utils.ts";

/** Also serialize direct callers/tests; executionMode protects model-issued batches. */
export class SerialTaskQueue {
	private tail: Promise<void> = Promise.resolve();
	private count = 0;
	get pending(): number {
		return this.count;
	}
	run<T>(work: () => Promise<T>): Promise<T> {
		this.count++;
		const result = this.tail.then(work).finally(() => {
			this.count--;
		});
		this.tail = result.then(
			() => {},
			() => {},
		);
		return result;
	}
	idle(): Promise<void> {
		return this.tail;
	}
}

export class PlanRepository {
	constructor(
		private readonly exec: ExtensionAPI["exec"],
		private readonly baseDir: string,
	) {}

	private async git(dir: string, args: string[], signal?: AbortSignal, allowFailure = false) {
		signal?.throwIfAborted();
		const result = await this.exec("git", ["-C", dir, ...args], { timeout: 10_000, signal });
		signal?.throwIfAborted();
		if (result.code !== 0 && !allowFailure) {
			throw new Error(
				result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed (${result.code})`,
			);
		}
		return result;
	}

	async save(
		currentDir: string | null,
		title: string,
		content: string,
		iteration: number,
		signal: AbortSignal,
	): Promise<string> {
		signal.throwIfAborted();
		let dir = currentDir;
		let created = false;
		try {
			if (!dir) {
				await mkdir(this.baseDir, { recursive: true });
				signal.throwIfAborted();
				const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
				dir = await mkdtemp(join(this.baseDir, `${timestamp}_${generateSlug(title)}_`));
				created = true;
				await this.git(dir, ["init"], signal);
				await this.git(dir, ["config", "user.name", "pi plan mode"], signal);
				await this.git(dir, ["config", "user.email", "plan-mode@pi.local"], signal);
				await this.git(
					dir,
					["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "init plan repo"],
					signal,
				);
			}
			const planDir = dir;
			const path = join(planDir, "plan.md");
			await withFileMutationQueue(path, async () => {
				signal.throwIfAborted();
				let previous: string | undefined;
				try {
					previous = await readFile(path, "utf8");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
				}
				const temporary = join(planDir, `.plan-${randomUUID()}.tmp`);
				let replaced = false;
				try {
					await writeFile(temporary, content, { encoding: "utf8", signal });
					signal.throwIfAborted();
					await rename(temporary, path);
					replaced = true;
					await this.git(planDir, ["add", "--", "plan.md"], signal);
					const diff = await this.git(
						planDir,
						["diff", "--cached", "--quiet", "--", "plan.md"],
						signal,
						true,
					);
					if (diff.code !== 0 && diff.code !== 1)
						throw new Error(diff.stderr || "Unable to inspect staged plan");
					if (diff.code === 1)
						await this.git(
							planDir,
							[
								"-c",
								"commit.gpgsign=false",
								"commit",
								"--only",
								"-m",
								`Plan iteration ${iteration}`,
								"--",
								"plan.md",
							],
							signal,
						);
				} catch (error) {
					if (replaced) {
						// Restore only our own file/index entry. Never reset the entire repository.
						if (previous === undefined) await rm(path, { force: true });
						else await writeFile(path, previous, "utf8");
						await this.git(planDir, ["reset", "--", "plan.md"], undefined, true);
					}
					throw error;
				} finally {
					await rm(temporary, { force: true });
				}
			});
			return planDir;
		} catch (error) {
			// Only a freshly allocated private directory is ever removed.
			if (created && dir) await rm(dir, { recursive: true, force: true });
			throw error;
		}
	}

	async diff(previous: string, current: string, signal: AbortSignal): Promise<string> {
		if (previous === current) return "";
		signal.throwIfAborted();
		// Active-branch iteration text is authoritative. Git HEAD may belong to an
		// abandoned branch, or identical iterations may not have created a commit.
		const directory = await mkdtemp(join(tmpdir(), "pi-plan-diff-"));
		try {
			await writeFile(join(directory, "previous.md"), previous, { encoding: "utf8", signal });
			await writeFile(join(directory, "current.md"), current, { encoding: "utf8", signal });
			const result = await this.git(
				directory,
				["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--", "previous.md", "current.md"],
				signal,
				true,
			);
			if (result.code !== 0 && result.code !== 1)
				throw new Error(result.stderr || "Unable to generate plan diff");
			return result.stdout;
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}
