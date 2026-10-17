import { appendFile, chmod, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { notifyIfActive } from "@stagefright5/pi-extension-utils";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MAX_LOG_BYTES = 1024 * 1024;

/** A bounded log, shared safely by multiple Pi instances. No request-path filesystem awaits. */
export async function appendProviderLog(agentDir: string, line: string): Promise<void> {
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	const path = join(agentDir, "provider-urls.log");
	const release = await lockfile.lock(path, {
		realpath: false,
		retries: { retries: 100, minTimeout: 10, maxTimeout: 100 },
	});
	try {
		try {
			const info = await stat(path);
			await chmod(path, 0o600);
			if (info.size + Buffer.byteLength(line) > MAX_LOG_BYTES) await rename(path, `${path}.1`);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		await appendFile(path, line, { mode: 0o600 });
	} finally {
		await release();
	}
}

export default function (pi: ExtensionAPI) {
	let queue = Promise.resolve();
	let recorded = false;
	let session = new AbortController();
	let warned = false;
	// Pi 1.3 exposes no request identity on these hooks. This follows its serial agent loop,
	// not a complete HTTP/access log for overlapping requests or UI-owned model calls.
	pi.on("before_provider_request", () => {
		recorded = false;
	});
	pi.on("provider_stream_event", (event, ctx) => {
		if (recorded) return;
		recorded = true;
		// ctx.model is the user's selection and may be virtual. Stream identity is dispatched.
		const model = ctx.modelRegistry.find(event.provider, event.model);
		const clean = (value: string) => value.replace(/[\r\n\t]/g, " ");
		const line = `${new Date().toISOString()} ${clean(event.provider)}/${clean(event.model)} ${clean(model?.baseUrl ?? "(unknown URL)")}\n`;
		const agentDir = getAgentDir();
		const { signal } = session;
		queue = queue
			.then(() => appendProviderLog(agentDir, line))
			.catch((error: unknown) => {
				if (signal.aborted || warned) return;
				warned = true;
				notifyIfActive(signal, ctx, `Provider URL log failed: ${String(error)}`);
			});
	});
	pi.on("session_start", () => {
		session.abort();
		session = new AbortController();
		recorded = false;
		warned = false;
	});
	pi.on("session_shutdown", async () => {
		session.abort();
		await queue;
	});
}
