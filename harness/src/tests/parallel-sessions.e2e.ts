/**
 * Opt-in check that two agent sessions can each run a Vortex of their own at the same time:
 * pnpm run ai:test:parallel-sessions -- [--a <checkout>] [--b <checkout>]
 *
 * Starts two sandbox instances at once, as two owners with `--slot auto`, each from its own
 * checkout (a worktree each, as harness/WORKFLOWS.md has agents work). Then, in both at once,
 * installs a mod only that session knows about and deploys it. Fails unless:
 *   - each instance answers on its own ports, with its own profile, under its own lease;
 *   - each session's mod reached its own sandbox game, and not the other's;
 *   - both stop cleanly and leave no lease behind.
 *
 * Without --a/--b both run the installed Vortex. Slots are given to the owners
 * "parallel-sessions-a" and "-b", so they don't take an agent's own.
 */
import fs from "node:fs";
import path from "node:path";

import { strToU8, zipSync } from "fflate";

import { bootstrap, type BootstrapResult } from "../bootstrap";
import { loadConfig, resolveTarget, type HarnessConfig } from "../config";
import { deployMods } from "../deployment";
import { processAlive, readLease } from "../lease";
import { installLocalMod } from "../localMod";
import { localOnlyConfig, sandboxConfig } from "../sandbox";
import { instanceResource } from "../slots";

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

interface Session {
  owner: string;
  config: HarnessConfig;
  started?: BootstrapResult;
}

const sessions: Session[] = ["a", "b"].map((side) => {
  const checkout = flag(side);
  const owner = `parallel-sessions-${side}`;
  const base = loadConfig({
    owner,
    slot: "auto",
    // never .vortex-src by default: it is the clone worktrees come from, not a session's own
    target: resolveTarget(
      checkout === undefined ? { preferInstalled: true } : { devDir: checkout },
    ),
  });
  return { owner, config: localOnlyConfig(sandboxConfig(base), false) };
});

const failures: string[] = [];
const result: Record<string, unknown> = {};
const [a, b] = sessions as [Session, Session];
if (a.config.mcpPort === b.config.mcpPort || a.config.cacheDir === b.config.cacheDir)
  throw new Error("The two sessions were given the same slot.");

/** Where a deployed file named `name` landed under the session's game, if anywhere. */
function deployedFile(session: Session, name: string): string | undefined {
  const root = session.config.gamePath!;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return undefined;
}

try {
  const startedAt = Date.now();
  const started = await Promise.all(
    sessions.map((session) =>
      bootstrap(session.config, {
        onProgress: (m) => process.stdout.write(`[${session.owner}] ${m}\n`),
      }),
    ),
  );
  sessions.forEach((session, i) => (session.started = started[i]));
  result.startedTogetherMs = Date.now() - startedAt;

  for (const session of sessions) {
    const status = await session.started!.instance.mcp.call<{ userDataDir?: string | null }>(
      "automation_status",
    );
    const lease = readLease(instanceResource(session.config.cacheDir));
    result[session.owner] = {
      slot: session.config.slot,
      mcpPort: session.config.mcpPort,
      cdpPort: session.config.cdpPort,
      userData: status.userDataDir ?? undefined,
      lease: lease === undefined ? null : { owner: lease.lease.owner, live: lease.live },
      checkout: session.config.target.sourceDir ?? session.config.target.executable,
    };
    if (lease?.live !== true || lease.lease.owner !== session.owner)
      failures.push(`${session.owner}'s instance is not under its own lease`);
  }
  const profiles = sessions.map((s) => (result[s.owner] as { userData?: string }).userData);
  if (profiles[0] === undefined || profiles[0] === profiles[1])
    failures.push(`the two instances share a profile (${String(profiles[0])})`);

  // Both at once: install a mod only this session has, and deploy it.
  const stamp = String(Date.now());
  await Promise.all(
    sessions.map(async (session) => {
      const name = `${session.owner}-${stamp}.txt`;
      const archive = path.join(session.config.cacheDir, `${session.owner}-${stamp}.zip`);
      fs.writeFileSync(archive, zipSync({ [name]: strToU8(session.owner) }));
      await installLocalMod(session.started!.instance.mcp, archive);
      await deployMods(session.started!.instance.mcp, session.config.gameId);
    }),
  );
  for (const session of sessions) {
    const other = session === a ? b : a;
    const name = `${session.owner}-${stamp}.txt`;
    const mine = deployedFile(session, name);
    const theirs = deployedFile(other, name);
    (result[session.owner] as Record<string, unknown>).deployed = mine ?? null;
    if (mine === undefined) failures.push(`${session.owner}'s mod did not reach its own game`);
    if (theirs !== undefined) failures.push(`${session.owner}'s mod reached ${other.owner}'s game`);
  }
} finally {
  await Promise.all(
    sessions.map((session) => session.started?.instance.stop().catch(() => undefined)),
  );
}
for (const session of sessions) {
  // This process still holds the lease until it exits, as any command does; the Vortex it
  // launched must not.
  const running = (
    readLease(instanceResource(session.config.cacheDir))?.lease.instancePids ?? []
  ).filter(processAlive);
  if (running.length > 0)
    failures.push(`${session.owner}'s Vortex (pid ${running.join(", ")}) is still running`);
}

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("PASS: two sessions ran, installed and deployed side by side, each in its own slot.");
process.exit(0);
