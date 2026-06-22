/**
 * Run an async mapper over `items` with a bounded number of concurrent
 * workers. Results are returned in the original order, matching the shape of
 * `Promise.all(items.map(mapper))` but without firing every request at once
 * (which can trip upstream rate limits, e.g. Strike).
 */
export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * Drop expired entries from a TTL map keyed by `{ expires: number }`. Module
 * level caches in route handlers never evict on their own, so a long-lived
 * Node process would otherwise keep one entry per distinct key forever.
 */
export function pruneExpired<V extends { expires: number }>(
    map: Map<string, V>,
    now = Date.now()
): void {
    map.forEach((value, key) => {
        if (value.expires <= now) map.delete(key);
    });
}
