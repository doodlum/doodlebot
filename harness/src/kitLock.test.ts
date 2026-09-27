import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LeaseHeldError, type LeaseEnv } from "./lease";
import {
  type GitRunner,
  kitLockHolder,
  lockKit,
  pushKit,
  requireKitLock,
  syncKit,
  unlockKit,
} from "./kitLock";

let dir: string;
let env: LeaseEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-kitlock-"));
  env = { dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A git that answers from a script and records every call. */
function fakeGit(answers: Record<string, string> = {}): { git: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = async (args) => {
    const line = args.join(" ");
    calls.push(line);
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    return key === undefined ? "" : answers[key]!;
  };
  return { git, calls };
}

describe("the kit lock", () => {
  it("lets one owner change the kit at a time", () => {
    lockKit("session-a", env);
    expect(kitLockHolder(env)).toBe("session-a");
    expect(() => lockKit("session-b", env)).toThrow(LeaseHeldError);
    // taking it again renews it
    expect(lockKit("session-a", env).joined).toBe(true);
    unlockKit("session-a", env);
    expect(kitLockHolder(env)).toBeUndefined();
    expect(lockKit("session-b", env).joined).toBe(false);
  });

  it("needs an owner", () => {
    expect(() => lockKit("anonymous", env)).toThrow(/needs a name/);
  });

  it("refuses kit work without the lock, naming who holds it", () => {
    expect(() => requireKitLock("session-a", env)).toThrow(/Take the kit lock first/);
    lockKit("session-b", env);
    expect(() => requireKitLock("session-a", env)).toThrow(/held by "session-b"/);
    expect(() => requireKitLock("session-b", env)).not.toThrow();
  });
});

describe("kit push", () => {
  const clean = {
    "status --porcelain": "",
    "rev-parse --abbrev-ref HEAD": "main",
    "rev-parse HEAD": "abc1234def",
  };

  it("rebases onto the remote, then pushes, under the lock", async () => {
    lockKit("session-a", env);
    const { git, calls } = fakeGit(clean);
    expect(await pushKit({ owner: "session-a", git, repo: dir, ...env })).toBe("abc1234def");
    expect(calls.filter((c) => !c.startsWith("status") && !c.startsWith("rev-parse"))).toEqual([
      "fetch origin main",
      "rebase origin/main",
      "push origin main:main",
    ]);
  });

  it("refuses without the lock, with uncommitted changes, or off main", async () => {
    const { git, calls } = fakeGit(clean);
    await expect(pushKit({ owner: "session-a", git, repo: dir, ...env })).rejects.toThrow(
      /Take the kit lock first/,
    );
    expect(calls).toEqual([]);

    lockKit("session-a", env);
    const dirty = fakeGit({ ...clean, "status --porcelain": " M KNOWLEDGE.md" });
    await expect(
      pushKit({ owner: "session-a", git: dirty.git, repo: dir, ...env }),
    ).rejects.toThrow(/uncommitted changes/);
    expect(dirty.calls.some((c) => c.startsWith("push"))).toBe(false);

    const branch = fakeGit({ ...clean, "rev-parse --abbrev-ref HEAD": "fix/x" });
    await expect(
      pushKit({ owner: "session-a", git: branch.git, repo: dir, ...env }),
    ).rejects.toThrow(/Merge your work into main first/);
  });
});

describe("kit sync", () => {
  it("fast-forwards main to the remote, under the lock", async () => {
    lockKit("session-a", env);
    const { git, calls } = fakeGit({
      "status --porcelain": "",
      "rev-parse --abbrev-ref HEAD": "fix/old",
      "rev-parse HEAD": "fedcba9",
    });
    expect(await syncKit({ owner: "session-a", git, repo: dir, ...env })).toBe("fedcba9");
    expect(calls).toContain("switch main");
    expect(calls).toContain("merge --ff-only origin/main");
  });
});
