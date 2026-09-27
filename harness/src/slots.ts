/**
 * Instance slots: several harness Vortex instances on one machine, one per agent session.
 *
 * An orchestrating session hands issues to subagents, each on its own Vortex worktree
 * (worktree.ts). Only one Vortex per cache and per port pair can run, so each session
 * also needs its own cache, ports and instance lease. A slot is that set, derived from
 * one number:
 *
 *   slot 0   harness/.cache, harness/.artifacts, MCP 3701, CDP 9222, lease `instance`
 *   slot n   harness/.slots/<n>/cache, …/artifacts, MCP 3701+10n, CDP 9222+10n,
 *            lease `instance:<that cache>`
 *
 * Slot 0 is what every command used before slots existed, and stays the default.
 * `--slot <n>` (or VORTEX_AI_SLOT) picks one. `--slot auto` gives the owner a slot of its
 * own from 1 up, remembered in `<lease dir>/slots.json`. The owner then gets the same slot,
 * with its warm profile, on every later command. Once all are given out, a new owner takes
 * the least recently used slot that isn't running. An explicit `--cache-dir`, `--port` or
 * `--cdp-port` still wins over what the slot would give.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { parseJson } from "./jsonFile";
import {
  ANONYMOUS_OWNER,
  INSTANCE_RESOURCE,
  type LeaseEnv,
  leaseDir,
  normalizedPath,
  readLease,
  withLeaseMutex,
} from "./lease";
import { DEFAULT_ARTIFACT_DIR, DEFAULT_CACHE_DIR, SLOTS_DIR } from "./paths";

export const MAX_SLOTS = 20;
export const SLOT_PORT_STRIDE = 10;
const BASE_MCP_PORT = 3701;
const BASE_CDP_PORT = 9222;

export type SlotRequest = number | "auto";

export interface SlotPaths {
  slot: number;
  cacheDir: string;
  artifactDir: string;
  mcpPort: number;
  cdpPort: number;
}

export function slotPaths(slot: number): SlotPaths {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SLOTS)
    throw new ConfigError(`A slot is a whole number from 0 to ${String(MAX_SLOTS - 1)}.`);
  if (slot === 0) {
    return {
      slot,
      cacheDir: DEFAULT_CACHE_DIR,
      artifactDir: DEFAULT_ARTIFACT_DIR,
      mcpPort: BASE_MCP_PORT,
      cdpPort: BASE_CDP_PORT,
    };
  }
  const root = path.join(SLOTS_DIR, String(slot));
  return {
    slot,
    cacheDir: path.join(root, "cache"),
    artifactDir: path.join(root, "artifacts"),
    mcpPort: BASE_MCP_PORT + SLOT_PORT_STRIDE * slot,
    cdpPort: BASE_CDP_PORT + SLOT_PORT_STRIDE * slot,
  };
}

/** `--slot` / VORTEX_AI_SLOT: a number, `auto`, or unset. */
export function parseSlot(value: string | undefined): SlotRequest | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const text = value.trim().toLowerCase();
  if (text === "auto") return "auto";
  const slot = Number(text);
  slotPaths(slot); // validates
  return slot;
}

/**
 * The instance lease for a cache. The default cache keeps the bare `instance` key it has
 * always had, so leases taken by older kit versions still count. Any other cache, a slot's
 * or an explicit `--cache-dir`, gets its own key, so two instances never refuse each other.
 */
export function instanceResource(cacheDir: string): string {
  const dir = normalizedPath(cacheDir);
  return dir === normalizedPath(DEFAULT_CACHE_DIR) ? INSTANCE_RESOURCE : `instance:${dir}`;
}

interface Assignment {
  slot: number;
  /** Last time the owner resolved `auto` to it. */
  at: string;
}

interface SlotFile {
  assignments: Record<string, Assignment>;
}

function slotFile(dir: string): string {
  return path.join(dir, "slots.json");
}

function readAssignments(dir: string): SlotFile {
  try {
    const parsed = parseJson<SlotFile>(fs.readFileSync(slotFile(dir), "utf8"));
    return { assignments: parsed.assignments ?? {} };
  } catch {
    return { assignments: {} };
  }
}

export function listSlotAssignments(env: LeaseEnv = {}): Record<string, Assignment> {
  return readAssignments(env.dir ?? leaseDir()).assignments;
}

/**
 * The owner's own slot for `--slot auto`: the one it was given before, unless another
 * owner now holds that slot's instance; otherwise the lowest slot from 1 that no other owner
 * was given and nobody holds. When every slot has been given out, the least recently used one
 * whose instance is not running is taken over. Slot 0 is never given out: it stays for commands
 * that don't ask for a slot.
 */
export function assignSlot(owner: string, env: LeaseEnv = {}): number {
  if (owner === ANONYMOUS_OWNER)
    throw new ConfigError(
      "--slot auto gives each owner its own slot, so it needs --owner (or VORTEX_AI_OWNER).",
    );
  const dir = env.dir ?? leaseDir();
  const now = env.now ?? Date.now;
  return withLeaseMutex(dir, () => {
    const file = readAssignments(dir);
    const heldByOther = (slot: number): boolean => {
      const state = readLease(instanceResource(slotPaths(slot).cacheDir), env);
      return state !== undefined && state.live && state.lease.owner !== owner;
    };
    const givenToOther = (slot: number): boolean =>
      Object.entries(file.assignments).some(([name, a]) => name !== owner && a.slot === slot);
    const slots = Array.from({ length: MAX_SLOTS - 1 }, (_, i) => i + 1);

    const lastUsed = (slot: number): number =>
      Math.max(
        0,
        ...Object.values(file.assignments)
          .filter((a) => a.slot === slot)
          .map((a) => Date.parse(a.at) || 0),
      );
    const previous = file.assignments[owner]?.slot;
    const chosen =
      previous !== undefined && previous > 0 && previous < MAX_SLOTS && !heldByOther(previous)
        ? previous
        : (slots.find((slot) => !givenToOther(slot) && !heldByOther(slot)) ??
          // every slot was given out: take the one whose owner asked for it longest ago
          slots
            .filter((slot) => !heldByOther(slot))
            .toSorted((a, b) => lastUsed(a) - lastUsed(b) || a - b)[0]);
    if (chosen === undefined)
      throw new ConfigError(
        `All ${String(MAX_SLOTS - 1)} slots are running an instance for another owner. ` +
          "See `doodlebot lease status`; stop one with `down --owner <its owner> --slot <n>`.",
      );
    // Taking over a slot another owner was given moves that owner on next time it asks.
    for (const [name, a] of Object.entries(file.assignments)) {
      if (name !== owner && a.slot === chosen) delete file.assignments[name];
    }
    file.assignments[owner] = { slot: chosen, at: new Date(now()).toISOString() };
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${slotFile(dir)}.${String(process.pid)}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`);
    fs.renameSync(tmp, slotFile(dir));
    return chosen;
  });
}

export interface SlotStatus extends SlotPaths {
  /** The owner `--slot auto` gave it to, if any. */
  assignedTo?: string;
  /** Who holds its instance lease, and whether that lease is live. */
  holder?: { owner: string; live: boolean; reason: string };
}

/** Slot 0, and every other slot that was given out, is leased, or has a cache on disk. */
export function listSlots(env: LeaseEnv = {}): SlotStatus[] {
  const assignments = listSlotAssignments(env);
  const result: SlotStatus[] = [];
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const paths = slotPaths(slot);
    const assignedTo = Object.entries(assignments).find(([, a]) => a.slot === slot)?.[0];
    const state = readLease(instanceResource(paths.cacheDir), env);
    if (
      slot !== 0 &&
      assignedTo === undefined &&
      state === undefined &&
      !fs.existsSync(paths.cacheDir)
    )
      continue;
    result.push({
      ...paths,
      assignedTo,
      holder:
        state === undefined
          ? undefined
          : { owner: state.lease.owner, live: state.live, reason: state.reason },
    });
  }
  return result;
}

export function formatSlots(slots: SlotStatus[], json = false): string {
  if (json) return JSON.stringify(slots, null, 2);
  return slots
    .map((s) => {
      const running =
        s.holder === undefined
          ? "free"
          : s.holder.live
            ? `HELD by "${s.holder.owner}" (${s.holder.reason})`
            : `stale lease from "${s.holder.owner}"`;
      const given = s.assignedTo === undefined ? "" : `, given to "${s.assignedTo}"`;
      return (
        `slot ${String(s.slot)}: ${running}${given}\n` +
        `  MCP ${String(s.mcpPort)}, CDP ${String(s.cdpPort)}, cache ${s.cacheDir}`
      );
    })
    .join("\n");
}
