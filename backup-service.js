import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = path.join(__dirname, "backup");

function todayDir() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const dir = path.join(BACKUP_DIR, date);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Save a snapshot of a secret's value before modification.
 * @param {string} secretName
 * @param {string} currentValue  raw string value from AWS
 * @param {string} [source]      e.g. "ui" or "chat"
 */
export function backupSecret(secretName, currentValue, source = "ui") {
  try {
    const dir = todayDir();
    const now = new Date();
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "-"); // HH-MM-SS
    const safeName = secretName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${safeName}_${time}.json`;
    const payload = {
      secretName,
      timestamp: now.toISOString(),
      source,
      value: currentValue,
    };
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error(`[backup] Failed to back up ${secretName}:`, e.message);
  }
}

/**
 * List all backups, newest first.
 */
export function listBackups() {
  const result = [];
  if (!fs.existsSync(BACKUP_DIR)) return result;
  for (const date of fs.readdirSync(BACKUP_DIR).sort().reverse()) {
    const dir = path.join(BACKUP_DIR, date);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort().reverse()) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
        result.push({ date, file, secretName: raw.secretName, timestamp: raw.timestamp, source: raw.source });
      } catch { /* skip corrupt files */ }
    }
  }
  return result;
}

/**
 * Read a single backup file's full content.
 */
export function readBackup(date, file) {
  const filepath = path.join(BACKUP_DIR, date, file);
  // Prevent path traversal
  const resolved = path.resolve(filepath);
  if (!resolved.startsWith(path.resolve(BACKUP_DIR))) {
    throw new Error("Invalid backup path");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf-8"));
}
