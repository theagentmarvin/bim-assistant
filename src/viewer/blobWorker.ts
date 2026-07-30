// src/viewer/blobWorker.ts
//
// Fetch the fragments worker source from unpkg and turn it into a
// same-origin Blob URL.
//
// CRITICAL: Use `%40` instead of literal `@` in the npm version pin.
// unpkg responses pass through Cloudflare's email-obfuscation feature,
// which rewrites `fragments@3.4.5` to `[email protected]` and breaks
// the fetch. `%40` bypasses the rewrite.
//
// Cross-origin workers are also blocked by the browser's CORP check
// when the page isn't using COEP/COOP — so a same-origin blob URL is
// the only safe delivery mechanism in dev.
//
// Caching: the same blob URL is reused across remounts, with an
// in-flight Promise dedup so concurrent calls share one fetch.

const DEFAULT_FRAGMENTS_WORKER_CDN =
  "https://unpkg.com/%40thatopen/fragments%403.4.7/dist/worker/worker.mjs";

let workerBlobUrlPromise: Promise<string> | null = null;

/**
 * Resolve to a same-origin blob URL for the fragments worker.
 *
 * The URL is cached for the lifetime of the page; if you ever need
 * to point at a different worker (e.g. on version bump), call
 * `resetFragmentWorkerCache()` to clear the cached promise.
 */
export function getFragmentWorkerUrl(
  cdn: string = DEFAULT_FRAGMENTS_WORKER_CDN,
): Promise<string> {
  if (workerBlobUrlPromise) return workerBlobUrlPromise;
  workerBlobUrlPromise = (async () => {
    const res = await fetch(cdn);
    if (!res.ok) {
      throw new Error(
        `Worker fetch failed: ${res.status} ${res.statusText} (${cdn})`,
      );
    }
    const text = await res.text();
    const blob = new Blob([text], { type: "application/javascript" });
    return URL.createObjectURL(blob);
  })();
  return workerBlobUrlPromise;
}

/** Reset the cached worker URL (useful when changing versions in dev). */
export function resetFragmentWorkerCache(): void {
  workerBlobUrlPromise = null;
}