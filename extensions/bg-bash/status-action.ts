/**
 * Consumer side of the shared footer status-line contract (`Symbol.for("@stagefright5/pi-status-line/v1")`),
 * which Compact Status Bar and Prompt Truly Mine host. Only the parts needed to make a status
 * clickable are declared here; the hosts own layout, hit-testing, and keyboard focus.
 */
const STATUS_LINE_CHANNEL = Symbol.for("@stagefright5/pi-status-line/v1");

type StatusAction = { label: string; activate(): void };
type Channel = { statusActions?: Map<string, StatusAction>; focusedStatus?: string; version?: number };

function channel(): Channel {
	const store = globalThis as typeof globalThis & { [STATUS_LINE_CHANNEL]?: Channel };
	return (store[STATUS_LINE_CHANNEL] ??= {});
}

/** Same semantics as `registerStatusAction` in the hosts' `status-line.ts`. */
export function registerStatusAction(id: string, action: StatusAction): () => void {
	const shared = channel();
	(shared.statusActions ??= new Map()).set(id, action);
	shared.version = (shared.version ?? 0) + 1;
	return () => {
		if (shared.statusActions?.get(id) !== action) return;
		shared.statusActions.delete(id);
		if (shared.focusedStatus === id) shared.focusedStatus = undefined;
		shared.version = (shared.version ?? 0) + 1;
	};
}
