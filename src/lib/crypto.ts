import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { dataRoot, secretFile } from './paths';

/**
 * API Key 加密。
 *
 * 密钥保存在本机 data/secret.key，权限收紧为仅当前用户可读。
 * 使用 AES-256-GCM，每次加密生成独立随机盐与向量，密文格式为
 * v1:<salt>:<iv>:<tag>:<cipher>。所有数据不出本机。
 */

const VERSION = 'v1';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  fs.mkdirSync(dataRoot, { recursive: true });
  if (fs.existsSync(secretFile)) {
    const raw = fs.readFileSync(secretFile, 'utf8').trim();
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_LENGTH) {
      throw new Error('本机密钥文件损坏，请删除 data/secret.key 后重新配置 API Key');
    }
    cachedKey = key;
    return key;
  }
  const key = crypto.randomBytes(KEY_LENGTH);
  fs.writeFileSync(secretFile, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  cachedKey = key;
  return key;
}

/** 由主密钥与随机盐派生出本次加密使用的密钥。 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(loadKey(), salt, KEY_LENGTH);
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(salt), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, salt.toString('base64'), iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('密文格式不受支持');
  }
  const [, saltB64 = '', ivB64 = '', tagB64 = '', cipherB64 = ''] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(cipherB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** 只保留首尾若干字符，用于在界面上确认配的是哪把 Key。 */
export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '•'.repeat(plain.length);
  return `${plain.slice(0, 4)}${'•'.repeat(Math.min(12, plain.length - 8))}${plain.slice(-4)}`;
}

export function novelIdFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return slug ? `${slug}-${stamp}-${rand}` : `novel-${stamp}-${rand}`;
}

export function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

/** 保证目录存在，返回目录本身，省去逐级 mkdir 的重复代码。 */
export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 保证文件所在目录存在。 */
export function ensureParent(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}
