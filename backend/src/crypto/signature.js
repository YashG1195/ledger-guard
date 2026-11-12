import { createSign, createVerify } from 'crypto';
import { getPrivateKey, getPublicKey } from './keys.js';
import { ServiceUnavailableError } from '../utils/errors.js';

export function signPayload(payload) {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new ServiceUnavailableError('Private key not loaded');
  }

  const sign = createSign('SHA256');
  sign.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return sign.sign(privateKey, 'base64');
}

export function verifySignature(payload, signature) {
  const publicKey = getPublicKey();
  if (!publicKey) {
    throw new ServiceUnavailableError('Public key not loaded');
  }

  const verify = createVerify('SHA256');
  verify.update(typeof payload === 'string' ? payload : JSON.stringify(payload));
  return verify.verify(publicKey, signature, 'base64');
}
