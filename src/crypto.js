// Encryption for integration secrets (WooCommerce keys, webhook secrets): AES-256-GCM with a key
// derived from SECRET_KEY. GCM's auth tag means a changed ciphertext fails to decrypt instead of
// silently producing garbage. Format: "v1:<iv>:<tag>:<data>" (base64url parts).
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 32;
// Development only: lets `npm start` work without setup. Production refuses to start without SECRET_KEY.
const DEV_SECRET = 'dev-only-secret-key-change-me-in-production!!';

/** @param {string} secret SECRET_KEY, at least 32 characters */
function createCipher(secret) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SECRET_KEY must be at least ${MIN_SECRET_LENGTH} characters (generate one: openssl rand -base64 48)`);
  }
  const key = crypto.createHash('sha256').update(secret).digest();
  return {
    encrypt(plain) {
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':');
    },
    /** Throws when the value was tampered with or encrypted under another key. */
    decrypt(value) {
      const [version, iv, tag, data] = String(value).split(':');
      if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('unreadable encrypted value');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Constant-time comparison of two strings (false when lengths differ). */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const hmac = (secret, body, encoding = 'hex') => crypto.createHmac('sha256', secret).update(body).digest(encoding);

module.exports = { createCipher, sha256, safeEqual, hmac, DEV_SECRET };
