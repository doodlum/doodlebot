/**
 * Downloads in flight on demand, for working on the UI that reports them: the spine's download
 * button and its panel, the Downloads page, a notification's progress.
 *
 * Throttled files from a local server (downloadServer.ts), so there is no network, account or
 * game involved, and a caller chooses how many run, for how long and how far apart they start.
 * Each is a real Vortex download: it goes through `start-download`, lands in the store and on
 * disk, and finishes on its own.
 */
import { startDownloadServer } from "./downloadServer";

export interface SlowDownloadOptions {
  /** How many downloads, each started `staggerSeconds` after the one before. */
  count: number;
  /** How long each takes at the throttled rate. */
  seconds: number;
  staggerSeconds?: number;
  bytesPerSecond?: number;
  onStarted?: (name: string) => void;
}

export interface SlowDownloadResult {
  names: string[];
  /** Whatever `start-download` reported for each: Vortex's download id, normally. */
  results: unknown[];
}

interface DispatchClient {
  call<T = unknown>(tool: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

const DEFAULT_BYTES_PER_SECOND = 256 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Starts the downloads and resolves once every one of them has finished. */
export async function runSlowDownloads(
  mcp: DispatchClient,
  options: SlowDownloadOptions,
): Promise<SlowDownloadResult> {
  const { count, seconds } = options;
  if (!Number.isInteger(count) || count < 1) throw new Error("count must be a whole number ≥ 1");
  if (!(seconds > 0)) throw new Error("seconds must be more than 0");
  const stagger = options.staggerSeconds ?? 0;
  if (!(stagger >= 0)) throw new Error("staggerSeconds must be 0 or more");

  const bytesPerSecond = options.bytesPerSecond ?? DEFAULT_BYTES_PER_SECOND;
  const server = await startDownloadServer({
    sizeBytes: Math.max(1, Math.round(bytesPerSecond * seconds)),
    bytesPerSecond,
  });

  // Unique per run, so a second run never collides with files the first left behind.
  const stamp = String(Date.now());
  const names = Array.from({ length: count }, (_, i) => `slow-${stamp}-${String(i + 1)}.zip`);

  try {
    const pending: Promise<unknown>[] = [];
    for (const [i, name] of names.entries()) {
      if (i > 0 && stagger > 0) await sleep(stagger * 1000);
      // `start-download` resolves when the download completes, so the timeout covers the whole
      // transfer. Vortex validates the arguments: the file name must be a string. The files are
      // zero-filled, so installing one fails with an "Archive damaged" dialog: `allowInstall:
      // false` keeps Vortex's auto-install off them, whatever the profile's setting.
      const download = mcp.call(
        "vortex_dispatch",
        {
          action: "start-download",
          args: [[server.url(name)], {}, name, "__CALLBACK__", "always", { allowInstall: false }],
        },
        (seconds + 120) * 1000,
      );
      // Marked handled now: one failing while the next waits out its stagger would otherwise
      // be an unhandled rejection. Promise.all below still reports it.
      download.catch(() => undefined);
      pending.push(download);
      options.onStarted?.(name);
    }
    return { names, results: await Promise.all(pending) };
  } finally {
    await server.close();
  }
}
