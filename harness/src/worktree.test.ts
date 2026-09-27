import path from "node:path";

import { describe, expect, it } from "vitest";

import { WORKTREES_DIR, parseWorktreeList, worktreeDir } from "./worktree";

describe("worktreeDir", () => {
  it("puts a worktree under .vortex-worktrees", () => {
    expect(worktreeDir("fix-24290")).toBe(path.join(WORKTREES_DIR, "fix-24290"));
  });

  it("refuses names that could leave it", () => {
    for (const name of ["..", "a/b", "a\\b", "../x", "", ".hidden", "a..b"])
      expect(() => worktreeDir(name)).toThrow(/worktree name/);
  });
});

describe("parseWorktreeList", () => {
  const root = path.resolve("/repo/.vortex-worktrees");
  const porcelain = [
    `worktree ${path.resolve("/repo/.vortex-src")}`,
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/master",
    "",
    `worktree ${path.join(root, "fix-a")}`,
    "HEAD 2222222222222222222222222222222222222222",
    "branch refs/heads/fix/plugins",
    "",
    `worktree ${path.join(root, "qa")}`,
    "HEAD 3333333333333333333333333333333333333333",
    "detached",
    "",
    `worktree ${path.resolve("/elsewhere/vx")}`,
    "HEAD 4444444444444444444444444444444444444444",
    "branch refs/heads/other",
  ].join("\n");

  it("keeps the worktrees under .vortex-worktrees, with their branches", () => {
    expect(parseWorktreeList(porcelain, root)).toEqual([
      {
        name: "fix-a",
        dir: path.join(root, "fix-a"),
        branch: "fix/plugins",
        head: "2222222222222222222222222222222222222222",
      },
      {
        name: "qa",
        dir: path.join(root, "qa"),
        branch: undefined,
        head: "3333333333333333333333333333333333333333",
      },
    ]);
  });

  it("reads Windows line endings", () => {
    expect(parseWorktreeList(porcelain.replace(/\n/g, "\r\n"), root)).toHaveLength(2);
  });
});
