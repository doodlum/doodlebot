import { describe, expect, it } from "vitest";

import { runSlowDownloads } from "./slowDownload";

interface Dispatched {
  args: Record<string, unknown> | undefined;
  at: number;
  body: string;
}

/** Stands in for Vortex: fetches each URL it is asked to download, as Vortex would. */
function fakeVortex() {
  const dispatched: Dispatched[] = [];
  return {
    dispatched,
    async call<T>(tool: string, args?: Record<string, unknown>): Promise<T> {
      expect(tool).toBe("vortex_dispatch");
      const at = Date.now();
      const [[url]] = (args?.args as [[string]]) ?? [[""]];
      const body = await (await fetch(url)).text();
      dispatched.push({ args, at, body });
      return `id-${String(dispatched.length)}` as T;
    },
  };
}

describe("runSlowDownloads", () => {
  it("starts each download through start-download, with a URL Vortex can fetch", async () => {
    const vortex = fakeVortex();

    const { names, results } = await runSlowDownloads(vortex, {
      count: 2,
      seconds: 0.2,
      bytesPerSecond: 50,
    });

    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(results).toEqual(["id-1", "id-2"]);
    for (const { args, body } of vortex.dispatched) {
      expect(args?.action).toBe("start-download");
      const [urls, , name, , , options] = (args?.args ?? []) as [
        string[],
        unknown,
        string,
        unknown,
        unknown,
        unknown,
      ];
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(names).toContain(name);
      // The files are zero-filled: installing one would put up an "Archive damaged" dialog.
      expect(options).toEqual({ allowInstall: false });
      // 0.2 s at 50 bytes/s: ten bytes each.
      expect(body).toHaveLength(10);
    }
  });

  it("spaces the starts out, so each arrives as news of its own", async () => {
    const vortex = fakeVortex();
    const starts: number[] = [];

    await runSlowDownloads(
      { call: (tool, args) => (starts.push(Date.now()), vortex.call(tool, args)) },
      { count: 2, seconds: 0.1, bytesPerSecond: 100, staggerSeconds: 0.3 },
    );

    const [first = 0, second = 0] = starts;
    expect(second - first).toBeGreaterThanOrEqual(250);
  });

  it("refuses a count that is not a whole number", async () => {
    await expect(runSlowDownloads(fakeVortex(), { count: 0, seconds: 1 })).rejects.toThrow(/count/);
    await expect(runSlowDownloads(fakeVortex(), { count: 1.5, seconds: 1 })).rejects.toThrow(
      /count/,
    );
  });

  it("reports a download Vortex refused, after the others were started", async () => {
    let calls = 0;
    const failing = {
      async call<T>(): Promise<T> {
        calls++;
        if (calls === 1) throw new Error("refused");
        return "ok" as T;
      },
    };

    await expect(
      runSlowDownloads(failing, { count: 2, seconds: 0.1, staggerSeconds: 0.05 }),
    ).rejects.toThrow("refused");
    expect(calls).toBe(2);
  });
});
