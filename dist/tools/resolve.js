import { runHerdr } from "../herdr.js";
/** Recursively find the first `pane_id` value in a parsed herdr JSON response. */
function findPaneId(node) {
    if (!node || typeof node !== "object")
        return undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            const found = findPaneId(item);
            if (found)
                return found;
        }
        return undefined;
    }
    const obj = node;
    if (typeof obj.pane_id === "string")
        return obj.pane_id;
    for (const v of Object.values(obj)) {
        const found = findPaneId(v);
        if (found)
            return found;
    }
    return undefined;
}
/**
 * Resolve an agent target (unique agent name, or a pane id hosting an agent) to
 * its current pane id. Tries `agent get` first, then `pane get` so a raw pane id
 * also works.
 *
 * Note: a pane moved to another workspace is issued a *new* pane id, so callers
 * should resolve immediately before use rather than caching the result.
 */
export async function resolvePaneId(target) {
    for (const cmd of [
        ["agent", "get", target],
        ["pane", "get", target],
    ]) {
        try {
            const res = await runHerdr(cmd);
            const paneId = findPaneId(res.json);
            if (paneId)
                return paneId;
        }
        catch {
            /* try next resolver */
        }
    }
    throw new Error(`could not resolve pane_id for target "${target}"`);
}
//# sourceMappingURL=resolve.js.map