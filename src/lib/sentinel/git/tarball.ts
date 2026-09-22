/**
 * Dependency-free gzip+tar extraction for GitHub codeload archives.
 * Hardened: path-traversal rejection, size caps, file-count caps.
 */
import { gunzipSync } from "node:zlib";
import { MAX_FILES_PER_REPO, MAX_FILE_BYTES, safeJoinPath } from "../security/guards";

const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024; // 120MB compressed cap

function readString(buf: Buffer, off: number, len: number): string {
  return buf
    .subarray(off, off + len)
    .toString("utf8")
    .replace(/\0.*$/, "");
}

function readOctal(buf: Buffer, off: number, len: number): number {
  const s = readString(buf, off, len).trim();
  if (!s) return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extract a .tar.gz buffer into path->content (text files only).
 * Returns skipped entries with reasons for transparency.
 */
export function extractTarGz(buffer: Buffer): {
  files: Map<string, string>;
  skipped: { file: string; reason: string }[];
  truncated: boolean;
} {
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Archive too large (${(buffer.length / 1048576).toFixed(1)}MB > 120MB cap).`
    );
  }
  let tar: Buffer;
  try {
    tar = gunzipSync(buffer);
  } catch {
    throw new Error("Could not gunzip archive (not a valid tar.gz).");
  }
  const files = new Map<string, string>();
  const skipped: { file: string; reason: string }[] = [];
  let truncated = false;
  let off = 0;

  // Strip the top-level "<owner>-<repo>-<sha>/" prefix from codeload archives.
  const stripRoot = (p: string): string => {
    const idx = p.indexOf("/");
    return idx >= 0 ? p.slice(idx + 1) : p;
  };

  while (off + 512 <= tar.length) {
    const name = readString(tar, off, 100);
    if (!name) break; // end-of-archive zero blocks
    const prefix = readString(tar, off + 345, 155);
    const fullName = (prefix ? `${prefix}/${name}` : name).replace(/\\/g, "/");
    const size = readOctal(tar, off + 124, 12);
    const typeflag = String.fromCharCode(tar[off + 156]);
    const dataStart = off + 512;

    off = dataStart + Math.ceil(size / 512) * 512;

    if (off > tar.length + 512) break; // corrupt
    const isFile = typeflag === "0" || typeflag === "\0" || typeflag === "";
    if (!isFile) continue; // skip dirs/symlinks/hardlinks (no link following, ever)

    let rel = stripRoot(fullName);
    if (!rel || rel.endsWith("/")) continue;
    const safe = safeJoinPath("", rel);
    if (!safe) {
      skipped.push({ file: fullName, reason: "rejected: unsafe path" });
      continue;
    }
    rel = safe;
    if (files.size >= MAX_FILES_PER_REPO) {
      truncated = true;
      skipped.push({ file: rel, reason: "archive file cap reached (5000)" });
      continue;
    }
    if (size > MAX_FILE_BYTES * 4) {
      skipped.push({ file: rel, reason: `file too large (${(size / 1024).toFixed(0)}KB)` });
      continue;
    }
    const slice = tar.subarray(dataStart, Math.min(dataStart + size, tar.length));
    // Decode as UTF-8; binary files are filtered later by the scanner.
    files.set(rel, slice.toString("utf8"));
  }

  return { files, skipped, truncated };
}
