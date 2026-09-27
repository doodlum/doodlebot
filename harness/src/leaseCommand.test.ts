import { describe, expect, it } from "vitest";

import { callerCwd } from "./leaseCommand";

describe("callerCwd", () => {
  it("runs lease run's command where the caller was, not in the kit's root", () => {
    // `pnpm run ai -- lease run …` starts the CLI in the kit; pnpm keeps the caller's directory
    expect(callerCwd(undefined, { INIT_CWD: "J:/kit/.vortex-worktrees/fix-a" })).toBe(
      "J:/kit/.vortex-worktrees/fix-a",
    );
  });

  it("prefers an explicit directory, and falls back to this process's", () => {
    expect(callerCwd("J:/elsewhere", { INIT_CWD: "J:/kit" })).toBe("J:/elsewhere");
    expect(callerCwd(undefined, {})).toBe(process.cwd());
    expect(callerCwd(undefined, { INIT_CWD: "" })).toBe(process.cwd());
  });
});
