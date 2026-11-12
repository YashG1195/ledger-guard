import { readFileSync } from 'fs';
import { resolve } from 'path';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let privateKey = null;
let publicKey = null;

export function loadKeys() {
  try {
    privateKey = readFileSync(resolve(env.JWT_PRIVATE_KEY_PATH), 'utf8');
    logger.info({ path: env.JWT_PRIVATE_KEY_PATH }, 'loaded private rsa key');
  } catch (err) {
    logger.warn({ err }, 'could not load private rsa key');
  }

  try {
    publicKey = readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), 'utf8');
    logger.info({ path: env.JWT_PUBLIC_KEY_PATH }, 'loaded public rsa key');
  } catch (err) {
    logger.warn({ err }, 'could not load public rsa key');
  }
}

export const getPrivateKey = () => privateKey;
export const getPublicKey = () => publicKey;
