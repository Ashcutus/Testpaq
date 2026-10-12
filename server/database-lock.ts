import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

function ownerAlive(path: string): boolean {
  try {
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isInteger(pid) || pid < 1) return Date.now() - statSync(path).mtimeMs < 10_000;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  } catch {
    return true;
  }
}

/** Exclusive local ownership; stale-lock recovery is serialized separately. */
export function acquireDatabaseLock(databasePath: string): () => void {
  const path = `${databasePath}.lock`;
  const recovery = `${path}.recovery`;
  const create = () => openSync(path, "wx", 0o600);
  let descriptor: number;
  try {
    descriptor = create();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (ownerAlive(path)) throw new Error("Testpaq is already running for this workspace. Close the other instance and retry.");
    try {
      mkdirSync(recovery, { mode: 0o700 });
    } catch {
      throw new Error("Another Testpaq launch is recovering the workspace lock. Retry shortly.");
    }
    try {
      if (existsSync(path) && !ownerAlive(path)) unlinkSync(path);
      descriptor = create();
    } catch {
      throw new Error("Testpaq is already running for this workspace. Close the other instance and retry.");
    } finally {
      rmdirSync(recovery);
    }
  }
  try {
    writeFileSync(descriptor, String(process.pid));
  } catch (error) {
    closeSync(descriptor);
    unlinkSync(path);
    throw error;
  }
  const identity = fstatSync(descriptor);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(descriptor);
    try {
      const current = statSync(path);
      if (current.ino === identity.ino && current.dev === identity.dev) unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}
