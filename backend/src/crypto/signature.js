import crypto from 'crypto';
import { getPrivateKey, getPublicKey } from './keys.js';
import { AppError } from '../utils/errors.js';

export function signPayload(payload) {
  const privateKey = getPrivateKey();
  if (!privateKey) throw new AppError('Private key not available', 503, 'KEY_UNAVAILABLE');
  const sign = crypto.createSign('SHA256');
  sign.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return sign.sign(privateKey, 'base64');
}

export function verifySignature(payload, signature) {
  const publicKey = getPublicKey();
  if (!publicKey) throw new AppError('Public key not available', 503, 'KEY_UNAVAILABLE');
  const verify = crypto.createVerify('SHA256');
  verify.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return verify.verify(publicKey, signature, 'base64');
}
