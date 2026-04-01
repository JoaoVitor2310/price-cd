export type Disposable = {
	dispose: () => Promise<void>;
};

export function isDisposable(value: unknown): value is Disposable {
	if (typeof value !== "object" || value === null) return false;
	if (!("dispose" in value)) return false;
	return typeof (value as { dispose?: unknown }).dispose === "function";
}

export async function disposeIfPresent(value: unknown): Promise<void> {
	if (!isDisposable(value)) return;
	await value.dispose();
}
