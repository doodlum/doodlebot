import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "./config";
import {
  INSTANCE_RESOURCE,
  acquireLease,
  checkoutResource,
  listLeases,
  type LeaseEnv,
} from "./lease";
import { DEFAULT_ARTIFACT_DIR, DEFAULT_CACHE_DIR, SLOTS_DIR } from "./paths";
import { MAX_SLOTS, assignSlot, instanceResource, listSlots, parseSlot, slotPaths } from "./slots";

let dir: string;
let env: LeaseEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-slots-"));
  env = { dir };
  vi.stubEnv("VORTEX_AI_LEASE_DIR", dir);
  for (const name of ["VORTEX_AI_SLOT", "VORTEX_MCP_PORT", "VORTEX_AI_CDP_PORT"])
    vi.stubEnv(name, "");
  for (const name of ["VORTEX_AI_CACHE_DIR", "VORTEX_AI_ARTIFACT_DIR"]) delete process.env[name];
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("slotPaths", () => {
  it("keeps slot 0 on the defaults every command used before slots", () => {
    expect(slotPaths(0)).toEqual({
      slot: 0,
      cacheDir: DEFAULT_CACHE_DIR,
      artifactDir: DEFAULT_ARTIFACT_DIR,
      mcpPort: 3701,
      cdpPort: 9222,
    });
  });

  it("gives slot n its own cache, artifacts and ports", () => {
    expect(slotPaths(2)).toEqual({
      slot: 2,
      cacheDir: path.join(SLOTS_DIR, "2", "cache"),
      artifactDir: path.join(SLOTS_DIR, "2", "artifacts"),
      mcpPort: 3721,
      cdpPort: 9242,
    });
  });

  it("gives no two slots a port in common", () => {
    const ports = Array.from({ length: MAX_SLOTS }, (_, n) => slotPaths(n)).flatMap((s) => [
      s.mcpPort,
      s.cdpPort,
    ]);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it("refuses a slot out of range", () => {
    expect(() => slotPaths(-1)).toThrow(/whole number/);
    expect(() => slotPaths(MAX_SLOTS)).toThrow(/whole number/);
    expect(() => slotPaths(1.5)).toThrow(/whole number/);
  });
});

describe("parseSlot", () => {
  it("reads a number, auto or nothing", () => {
    expect(parseSlot("3")).toBe(3);
    expect(parseSlot(" AUTO ")).toBe("auto");
    expect(parseSlot("")).toBeUndefined();
    expect(parseSlot(undefined)).toBeUndefined();
    expect(() => parseSlot("two")).toThrow(/whole number/);
  });
});

describe("instanceResource", () => {
  it("keeps the bare key for the default cache, however it is spelled", () => {
    expect(instanceResource(DEFAULT_CACHE_DIR)).toBe(INSTANCE_RESOURCE);
    expect(instanceResource(`${DEFAULT_CACHE_DIR}${path.sep}`)).toBe(INSTANCE_RESOURCE);
  });

  it("keys a slot's cache as instance:<path>, as checkouts are checkout:<path>", () => {
    const expected = slotPaths(1).cacheDir.replace(/\\/g, "/");
    const key = (text: string): string =>
      process.platform === "win32" ? text.toLowerCase() : text;
    expect(instanceResource(slotPaths(1).cacheDir)).toBe(`instance:${key(expected)}`);
    expect(checkoutResource(slotPaths(1).cacheDir)).toBe(`checkout:${key(expected)}`);
  });

  it("gives every other cache a key of its own", () => {
    const one = instanceResource(slotPaths(1).cacheDir);
    const two = instanceResource(slotPaths(2).cacheDir);
    expect(one).toMatch(/^instance:/);
    expect(one).not.toBe(two);
    expect(instanceResource(slotPaths(1).cacheDir.toUpperCase())).toBe(
      process.platform === "win32" ? one : instanceResource(slotPaths(1).cacheDir.toUpperCase()),
    );
  });
});

describe("assignSlot", () => {
  it("gives each owner its own slot from 1, and the same one again", () => {
    expect(assignSlot("fix-a", env)).toBe(1);
    expect(assignSlot("fix-b", env)).toBe(2);
    expect(assignSlot("fix-a", env)).toBe(1);
    expect(assignSlot("fix-b", env)).toBe(2);
  });

  it("needs an owner", () => {
    expect(() => assignSlot("anonymous", env)).toThrow(/needs --owner/);
  });

  it("moves an owner whose slot another owner now runs", () => {
    expect(assignSlot("fix-a", env)).toBe(1);
    acquireLease(instanceResource(slotPaths(1).cacheDir), "someone", {
      ...env,
      mode: "explicit",
      ttlMinutes: 5,
    });
    expect(assignSlot("fix-a", env)).toBe(2);
  });

  it("skips a slot someone runs without having been given it", () => {
    acquireLease(instanceResource(slotPaths(1).cacheDir), "by-hand", {
      ...env,
      mode: "explicit",
      ttlMinutes: 5,
    });
    expect(assignSlot("fix-a", env)).toBe(2);
  });

  it("takes over the least recently used slot once all are given out", () => {
    let clock = Date.parse("2026-09-27T12:00:00Z");
    const ticking = { ...env, now: () => (clock += 1000) };
    for (let n = 1; n < MAX_SLOTS; n++) expect(assignSlot(`owner-${String(n)}`, ticking)).toBe(n);
    expect(assignSlot("owner-1", ticking)).toBe(1); // owner-1 is the most recent now
    expect(assignSlot("late", ticking)).toBe(2);
    // the owner it was taken from moves to the next least recently used
    expect(assignSlot("owner-2", ticking)).toBe(3);
  });

  it("refuses when every slot runs another owner's Vortex", () => {
    for (let n = 1; n < MAX_SLOTS; n++) {
      acquireLease(instanceResource(slotPaths(n).cacheDir), `owner-${String(n)}`, {
        ...env,
        mode: "explicit",
        ttlMinutes: 5,
      });
    }
    expect(() => assignSlot("late", env)).toThrow(/All 19 slots/);
  });

  it("keeps its record out of the lease listing", () => {
    assignSlot("fix-a", env);
    expect(fs.existsSync(path.join(dir, "slots.json"))).toBe(true);
    expect(listLeases(env)).toEqual([]);
  });

  it("lists who has which slot and whether it runs", () => {
    assignSlot("fix-a", env);
    acquireLease(instanceResource(slotPaths(1).cacheDir), "fix-a", {
      ...env,
      mode: "explicit",
      ttlMinutes: 5,
    });
    const slots = listSlots(env);
    expect(slots[0]?.slot).toBe(0);
    const one = slots.find((s) => s.slot === 1);
    expect(one?.assignedTo).toBe("fix-a");
    expect(one?.holder).toMatchObject({ owner: "fix-a", live: true });
  });
});

describe("loadConfig with a slot", () => {
  it("takes the slot's cache, artifacts and ports", () => {
    const config = loadConfig({ slot: 3 });
    expect(config.slot).toBe(3);
    expect(config.cacheDir).toBe(path.join(SLOTS_DIR, "3", "cache"));
    expect(config.artifactDir).toBe(path.join(SLOTS_DIR, "3", "artifacts"));
    expect([config.mcpPort, config.cdpPort]).toEqual([3731, 9252]);
  });

  it("lets an explicit port or cache win over the slot's", () => {
    const config = loadConfig({ slot: 3, mcpPort: 4000, cacheDir: dir });
    expect([config.mcpPort, config.cdpPort]).toEqual([4000, 9252]);
    expect(config.cacheDir).toBe(path.resolve(dir));
  });

  it("reads VORTEX_AI_SLOT, auto included", () => {
    vi.stubEnv("VORTEX_AI_SLOT", "2");
    expect(loadConfig().mcpPort).toBe(3721);
    vi.stubEnv("VORTEX_AI_SLOT", "auto");
    vi.stubEnv("VORTEX_AI_OWNER", "fix-a");
    expect(loadConfig().slot).toBe(1);
    expect(loadConfig({ owner: "fix-b" }).slot).toBe(2);
  });

  it("stays on slot 0 when nothing asks for another", () => {
    const config = loadConfig();
    expect(config.slot).toBe(0);
    expect(config.cacheDir).toBe(DEFAULT_CACHE_DIR);
    expect([config.mcpPort, config.cdpPort]).toEqual([3701, 9222]);
  });
});
