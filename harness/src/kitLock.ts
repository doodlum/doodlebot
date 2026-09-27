/**
 * The kit lock: one agent at a time changes doodlebot itself.
 *
 * Any number of agent sessions can work on Vortex at once, each in its own worktree and slot,
 * each looking after its own issue, review and PR. What they share is this repo: KNOWLEDGE.md,
 * the skills, the harness and the docs, in one working tree. Two sessions editing it at once
 * overwrite each other, and two pushing at once race. So a session that wants to change the kit
 * takes the `kit` lease first, pulls the latest main, edits, runs `pnpm run ci`, commits, pushes
 * with `kit push`, and releases. Everyone else waits (`kit lock --wait <minutes>`).
 *
 * The lock is explicit and lapses after its TTL unless taken again, so a session that dies
 * holding it can't block the others for long.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ConfigError } from "./errors";
import {
  ANONYMOUS_OWNER,
  acquireLease,
  readLease,
  releaseLease,
  type AcquireResult,
  type LeaseEnv,
  type ReleaseResult,
} from "./lease";
import { REPO_ROOT } from "./paths";

const execFileAsync = promisify(execFile);

export const KIT_RESOURCE = "kit";
/** Long enough to edit, run ci and push; taking the lock again renews it. */
export const DEFAULT_KIT_LOCK_MINUTES = 30;

export function kitLockHolder(env: LeaseEnv = {}): string | undefined {
  const state = readLease(KIT_RESOURCE, env);
  return state?.live === true ? state.lease.owner : undefined;
}

export function lockKit(
  owner: string,
  options: LeaseEnv & { ttlMinutes?: number; purpose?: string } = {},
): AcquireResult {
  if (owner === ANONYMOUS_OWNER)
    throw new ConfigError("The kit lock needs a name: pass --owner (or VORTEX_AI_OWNER).");
  return acquireLease(KIT_RESOURCE, owner, {
    ...options,
    mode: "explicit",
    ttlMinutes: options.ttlMinutes ?? DEFAULT_KIT_LOCK_MINUTES,
    purpose: options.purpose ?? "changing the doodlebot kit",
  });
}

export function unlockKit(
  owner: string,
  options: LeaseEnv & { force?: boolean } = {},
): ReleaseResult {
  return releaseLease(KIT_RESOURCE, owner, options);
}

/** Refuse unless `owner` holds the kit lock right now. */
export function requireKitLock(owner: string, env: LeaseEnv = {}): void {
  const holder = kitLockHolder(env);
  if (holder === owner) return;
  throw new ConfigError(
    holder === undefined
      ? `Take the kit lock first: pnpm run ai -- kit lock --owner ${owner}`
      : `The kit lock is held by "${holder}". Wait for it: pnpm run ai -- kit lock --owner ${owner} --wait 30`,
  );
}

export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const runGit: GitRunner = async (args, cwd) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new ConfigError(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, {
      cause: err,
    });
  }
};

export interface KitPushOptions extends LeaseEnv {
  owner: string;
  /** The branch the kit lives on. Default main. */
  branch?: string;
  remote?: string;
  repo?: string;
  git?: GitRunner;
  onProgress?: (message: string) => void;
}

/**
 * Push the kit's committed changes, under the lock: refuses without it, and with uncommitted
 * changes (commit them, or they'd be someone else's to find). Rebases the local branch onto
 * the remote's first, so a push never overwrites another session's, then pushes. Returns the
 * pushed sha.
 */
export async function pushKit(options: KitPushOptions): Promise<string> {
  const report = options.onProgress ?? ((): void => undefined);
  const git = options.git ?? runGit;
  const repo = options.repo ?? REPO_ROOT;
  const remote = options.remote ?? "origin";
  const branch = options.branch ?? "main";
  requireKitLock(options.owner, options);

  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], repo))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (dirty.length > 0)
    throw new ConfigError(
      `The kit has uncommitted changes; commit them first:\n${dirty.slice(0, 20).join("\n")}`,
    );
  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  if (current !== branch)
    throw new ConfigError(
      `The kit is on "${current}", not "${branch}". Merge your work into ${branch} first ` +
        `(git switch ${branch} && git merge --ff-only ${current}).`,
    );
  report(`fetching ${remote}`);
  await git(["fetch", remote, branch], repo);
  report(`rebasing ${branch} onto ${remote}/${branch}`);
  await git(["rebase", `${remote}/${branch}`], repo);
  report(`pushing ${branch}`);
  await git(["push", remote, `${branch}:${branch}`], repo);
  return git(["rev-parse", "HEAD"], repo);
}

/**
 * Bring the kit up to date before editing, under the lock: fast-forward the branch to the
 * remote's. Refuses with uncommitted changes, or a branch that has diverged (rebase it yourself).
 */
export async function syncKit(options: KitPushOptions): Promise<string> {
  const report = options.onProgress ?? ((): void => undefined);
  const git = options.git ?? runGit;
  const repo = options.repo ?? REPO_ROOT;
  const remote = options.remote ?? "origin";
  const branch = options.branch ?? "main";
  requireKitLock(options.owner, options);
  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"], repo)).trim();
  if (dirty !== "")
    throw new ConfigError(
      `The kit has uncommitted changes; commit or discard them first:\n${dirty}`,
    );
  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  if (current !== branch) {
    report(`switching to ${branch}`);
    await git(["switch", branch], repo);
  }
  report(`fetching ${remote}`);
  await git(["fetch", remote, branch], repo);
  await git(["merge", "--ff-only", `${remote}/${branch}`], repo);
  return git(["rev-parse", "HEAD"], repo);
}
