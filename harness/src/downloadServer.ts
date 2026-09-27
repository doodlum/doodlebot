/**
 * A local HTTP server that serves files slowly, for downloads Vortex can make with no
 * network and no account.
 *
 * What goes wrong during long downloads — persistence churning through download progress
 * (LAZ-1168), the UI stuttering at every tick — only shows while transfers are in flight for
 * a while. Real mod downloads need Nexus and bandwidth; this serves zero-filled files at a
 * chosen rate on loopback, so a test controls how many run, how long for and how fast.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface DownloadServerOptions {
  /** Size of every served file. */
  sizeBytes: number;
  /** Rate each response is throttled to. */
  bytesPerSecond: number;
}

export interface DownloadServer {
  /** The URL of a file with this name; any name is served. */
  url: (name: string) => string;
  close: () => Promise<void>;
}

const TICK_MS = 100;

export async function startDownloadServer(options: DownloadServerOptions): Promise<DownloadServer> {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    // Vortex probes with HEAD and may resume with Range; serve both honestly.
    // Vortex downloads in chunks, each a closed range ("bytes=start-end").
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
    const start = range ? Math.min(Number(range[1]), options.sizeBytes) : 0;
    const end =
      range && range[2] !== "" && range[2] !== undefined
        ? Math.min(Number(range[2]), options.sizeBytes - 1)
        : options.sizeBytes - 1;
    const length = Math.max(0, end - start + 1);
    const headers: http.OutgoingHttpHeaders = {
      "content-type": "application/octet-stream",
      "content-length": String(length),
      "accept-ranges": "bytes",
      "content-disposition": `attachment; filename="${decodeURIComponent(
        (req.url ?? "/file").split("/").pop() ?? "file",
      )}"`,
    };
    if (range) {
      headers["content-range"] =
        `bytes ${String(start)}-${String(end)}/${String(options.sizeBytes)}`;
    }
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const perTick = Math.max(1, Math.round((options.bytesPerSecond * TICK_MS) / 1000));
    let sent = 0;
    const timer = setInterval(() => {
      const chunk = Math.min(perTick, length - sent);
      if (chunk <= 0) {
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(Buffer.alloc(chunk));
      sent += chunk;
    }, TICK_MS);
    res.on("close", () => clearInterval(timer));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (name) => `http://127.0.0.1:${String(port)}/${encodeURIComponent(name)}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

export interface ArchiveServerOptions {
  /**
   * Fail this request instead of serving it, by resetting the connection as a dropped
   * download does: `attempt` counts the GETs for that file so far, from 1. Default: never.
   */
  fail?: (name: string, attempt: number) => boolean;
}

export interface ArchiveServer {
  /** The URL a collection's direct member downloads the archive called `name` from. */
  url: (name: string) => string;
  /** Every request so far: method, file name, and whether it was failed. */
  hits: Array<{ method: string; name: string; failed: boolean }>;
  close: () => Promise<void>;
}

/**
 * Serve real archives, for a collection's direct members (`DirectMember` in
 * offlineCollection.ts), and fail chosen requests. A download that fails, then succeeds on a
 * retry or resume, is how a member ended up wrongly ignored in the field; this reproduces it
 * with no Nexus.
 */
export async function startArchiveServer(
  archives: Record<string, Uint8Array>,
  options: ArchiveServerOptions = {},
): Promise<ArchiveServer> {
  const sockets = new Set<import("node:net").Socket>();
  const hits: ArchiveServer["hits"] = [];
  const attempts = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "/").slice(1).split("?")[0] ?? "");
    const body = archives[name];
    const method = req.method ?? "GET";
    if (body === undefined) {
      hits.push({ method, name, failed: false });
      res.writeHead(404).end();
      return;
    }
    const attempt = method === "GET" ? (attempts.get(name) ?? 0) + 1 : (attempts.get(name) ?? 0);
    if (method === "GET") attempts.set(name, attempt);
    const failed = method === "GET" && options.fail?.(name, attempt) === true;
    hits.push({ method, name, failed });
    if (failed) {
      req.socket.destroy();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/zip",
      "content-length": String(body.length),
      "content-disposition": `attachment; filename="${name}"`,
    });
    res.end(method === "HEAD" ? undefined : Buffer.from(body));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (name) => `http://127.0.0.1:${String(port)}/${encodeURIComponent(name)}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
