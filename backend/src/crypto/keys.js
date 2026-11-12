import { readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let privateKey = null;
let publicKey = null;

function resolveKeyPath(filePath) {
  if (isAbsolute(filePath) && existsSync(filePath)) {
    return filePath;
  }
  const directPath = resolve(process.cwd(), filePath);
  if (existsSync(directPath)) return directPath;

  const backendSubdir = resolve(process.cwd(), 'backend', filePath);
  if (existsSync(backendSubdir)) return backendSubdir;

  return directPath;
}

export function loadKeys() {
  const privatePath = resolveKeyPath(env.JWT_PRIVATE_KEY_PATH);
  const publicPath = resolveKeyPath(env.JWT_PUBLIC_KEY_PATH);

  try {
    privateKey = readFileSync(privatePath, 'utf8');
    logger.info({ path: privatePath }, 'loaded private rsa key');
  } catch (err) {
    logger.warn({ err, path: privatePath }, 'could not load private rsa key');
  }

  try {
    publicKey = readFileSync(publicPath, 'utf8');
    logger.info({ path: publicPath }, 'loaded public rsa key');
  } catch (err) {
    logger.warn({ err, path: publicPath }, 'could not load public rsa key');
  }
}

export function getPrivateKey() {
  if (!privateKey) {
    const privatePath = resolveKeyPath(env.JWT_PRIVATE_KEY_PATH);
    try {
      privateKey = readFileSync(privatePath, 'utf8');
    } catch {
      return null;
    }
  }
  return privateKey;
}

export function getPublicKey() {
  if (!publicKey) {
    const publicPath = resolveKeyPath(env.JWT_PUBLIC_KEY_PATH);
    try {
      publicKey = readFileSync(publicPath, 'utf8');
    } catch {
      return null;
    }
  }
  return publicKey;
}
