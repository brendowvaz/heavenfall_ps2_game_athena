import { link, mkdir, readFile, rename, rmdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const lockDirectoryName = ".project.lock";
const ownerFileName = "owner.json";

async function readOwner(ownerFile) {
  try {
    return JSON.parse(await readFile(ownerFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function restoreClaimedOwner(claimFile, ownerFile, expectedToken) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentOwner = await readOwner(ownerFile);
    if (currentOwner) {
      if (currentOwner.token === expectedToken) {
        await unlink(claimFile).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        return;
      }
      throw new Error("Cannot restore the scene project lock: another owner appeared");
    }
    try {
      // A hard link restores the owner atomically without replacing a newer
      // owner that might have appeared while this stale check was running.
      await link(claimFile, ownerFile);
      await unlink(claimFile);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(10 * (attempt + 1));
    }
  }
  throw new Error(`Cannot restore the scene project lock: ${lastError?.message || "unknown I/O error"}`);
}

async function removeStaleLock(lockDirectory, ownerFile, staleMs) {
  let heartbeatInfo;
  let ownerFileExists = true;
  try {
    heartbeatInfo = await stat(ownerFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    ownerFileExists = false;
    try {
      heartbeatInfo = await stat(lockDirectory);
    } catch (directoryError) {
      if (directoryError?.code === "ENOENT") return true;
      throw directoryError;
    }
  }
  if (Date.now() - heartbeatInfo.mtimeMs <= staleMs) return false;

  if (ownerFileExists) {
    const owner = await readOwner(ownerFile);
    let confirmationInfo;
    try {
      confirmationInfo = await stat(ownerFile);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    if (confirmationInfo.mtimeMs !== heartbeatInfo.mtimeMs
      || Date.now() - confirmationInfo.mtimeMs <= staleMs) return false;
    const confirmation = await readOwner(ownerFile);
    if ((owner?.token || null) !== (confirmation?.token || null)) return false;

    // Claim the observed owner atomically in a sibling file. If another
    // owner appeared in the narrow race above, its token will not match and
    // the claim is restored instead of deleting the new lock.
    const claimFile = path.join(
      path.dirname(lockDirectory),
      `.project-lock-claim-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await rename(ownerFile, claimFile);
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
    const claimedOwner = await readOwner(claimFile);
    const claimedInfo = await stat(claimFile);
    if ((owner?.token || null) !== (claimedOwner?.token || null)
      || claimedInfo.mtimeMs !== confirmationInfo.mtimeMs
      || Date.now() - claimedInfo.mtimeMs <= staleMs) {
      await restoreClaimedOwner(claimFile, ownerFile, claimedOwner?.token || null);
      return false;
    }
    await unlink(claimFile);
  } else {
    try {
      const confirmationInfo = await stat(lockDirectory);
      if (confirmationInfo.mtimeMs !== heartbeatInfo.mtimeMs
        || Date.now() - confirmationInfo.mtimeMs <= staleMs) return false;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      throw error;
    }
  }
  try {
    await rmdir(lockDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
    if (error?.code === "ENOTEMPTY") return false;
  }
  return true;
}

export async function withSceneProjectFileLock(
  scenesRoot,
  operation,
  { timeoutMs = 30000, staleMs = 15000, heartbeatMs = 500 } = {},
) {
  await mkdir(scenesRoot, { recursive: true });
  const lockDirectory = path.join(scenesRoot, lockDirectoryName);
  const ownerFile = path.join(lockDirectory, ownerFileName);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      await mkdir(lockDirectory);
      try {
        await writeFile(ownerFile, `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, { flag: "wx" });
      } catch (ownerError) {
        await rmdir(lockDirectory).catch(() => {});
        throw ownerError;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock(lockDirectory, ownerFile, staleMs)) continue;
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the scene project lock");
      }
      await delay(40);
    }
  }

  const heartbeat = setInterval(() => {
    const now = new Date();
    utimes(ownerFile, now, now).catch(() => {});
  }, Math.max(10, heartbeatMs));
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  try {
    return await operation();
  } finally {
    clearInterval(heartbeat);
    const owner = await readOwner(ownerFile);
    if (owner?.token === token) {
      await unlink(ownerFile).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
      await rmdir(lockDirectory).catch((error) => {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
      });
    }
  }
}
