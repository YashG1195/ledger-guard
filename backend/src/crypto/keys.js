import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createSign, createVerify } from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ServiceUnavailableError } from '../utils/errors.js';

let privateKey = null;
let publicKey = null;

export function loadKeys() {
  try {
    privateKey = readFileSync(resolve(env.JWT_PRIVATE_KEY_PATH), 'utf8');
    logger.info({ path: env.JWT_PRIVATE_KEY_PATH }, 'RSA private key loaded');
  } catch (err) {
    logger.warn({ err }, 'RSA private key not found — signing disabled');
  }

  try {
    publicKey = readFileSync(resolve(env.JWT_PUBLIC_KEY_PATH), 'utf8');
    logger.info({ path: env.JWT_PUBLIC_KEY_PATH }, 'RSA public key loaded');
  } catch (err) {
    logger.warn({ err }, 'RSA public key not found — verification disabled');
  }
}

export const getPrivateKey = () => privateKey;
export const getPublicKey = () => publicKey;

/**
 * Signs a payload with the RSA private key (SHA-256).
 * @param {object|string} payload
 * @returns {string} Base64 signature
 */
export function signPayload(payload) {
  if (!privateKey) throw new ServiceUnavailableError('RSA private key unavailable');
  const sign = createSign('SHA256');
  sign.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return sign.sign(privateKey, 'base64');
}

/**
 * Verifies a base64 RSA signature against a payload.
 * @param {object|string} payload
 * @param {string} signature  Base64 signature
 * @returns {boolean}
 */
export function verifySignature(payload, signature) {
  if (!publicKey) throw new ServiceUnavailableError('RSA public key unavailable');
  const verify = createVerify('SHA256');
  verify.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return verify.verify(publicKey, signature, 'base64');
}
