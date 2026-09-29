import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, ensureParent } from '../crypto';

/**
 * 文件读写工具。
 * 写入统一走「先写临时文件再重命名」，避免中途失败留下半截内容。
 */

export function readText(file: string, fallback = ''): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function readFileIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function writeText(file: string, content: string): void {
  ensureParent(file);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeBuffer(file: string, data: Buffer): void {
  ensureParent(file);
  fs.writeFileSync(file, data);
}

export function removeFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 文件已被移除时忽略
  }
}

export function moveFile(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  ensureParent(to);
  fs.renameSync(from, to);
}

export function listFiles(dir: string, suffix?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (suffix ? name.endsWith(suffix) : true));
}

export function listDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function ensureDirectory(dir: string): string {
  return ensureDir(dir);
}

export function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // 文件在统计过程中被删除时忽略
        }
      }
    }
  }
  return total;
}

/**
 * 统计正文字数。
 * 中文写作以字符为计量单位，这里忽略空白字符，与常见网文平台的统计口径一致。
 */
export function countWords(content: string): number {
  return content.replace(/\s+/g, '').length;
}

/** 时间戳文件名，用于导出与备份。 */
export function stampName(prefix: string, ext: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}.${ext}`;
}
