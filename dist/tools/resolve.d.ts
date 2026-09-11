/**
 * Resolve an agent target (unique agent name, or a pane id hosting an agent) to
 * its current pane id. Tries `agent get` first, then `pane get` so a raw pane id
 * also works.
 *
 * Note: a pane moved to another workspace is issued a *new* pane id, so callers
 * should resolve immediately before use rather than caching the result.
 */
export declare function resolvePaneId(target: string): Promise<string>;
