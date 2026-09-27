/**
 * Where this kit keeps things. Its own module, free of imports, so config.ts, lease.ts
 * and slots.ts can all use it without importing each other in a circle.
 */
import path from "node:path";

export const HARNESS_ROOT = path.resolve(import.meta.dirname, "..");
/** The doodlebot checkout — this repo. */
export const REPO_ROOT = path.resolve(HARNESS_ROOT, "..");
/** Slot 0's profiles and login cache, and the instance a bare `doodlebot up` runs. */
export const DEFAULT_CACHE_DIR = path.join(HARNESS_ROOT, ".cache");
export const DEFAULT_ARTIFACT_DIR = path.join(HARNESS_ROOT, ".artifacts");
/** Every other slot's cache and artifacts (slots.ts). Gitignored. */
export const SLOTS_DIR = path.join(HARNESS_ROOT, ".slots");
