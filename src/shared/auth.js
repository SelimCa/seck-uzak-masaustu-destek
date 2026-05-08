const crypto = require('node:crypto');

function normalizeCode(input) {
  return String(input || '')
    .replace(/[^0-9]/g, '');
}

function generateDeviceCode() {
  const digits = String(Math.floor(Math.random() * 1000000000)).padStart(9, '0');
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
}

function generateSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashFixedPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 150000, 32, 'sha256').toString('hex');
}

function verifyFixedPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) {
    return false;
  }

  const actual = hashFixedPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function generateRollingPassword(secret, windowSeconds = 30, digits = 6, now = Date.now()) {
  const counter = Math.floor(now / 1000 / windowSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const key = Buffer.from(secret, 'hex');
  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % (10 ** digits)).padStart(digits, '0');
}

function secondsUntilPasswordRefresh(windowSeconds = 30, now = Date.now()) {
  const elapsed = Math.floor(now / 1000) % windowSeconds;
  return windowSeconds - elapsed;
}

module.exports = {
  generateDeviceCode,
  generateRollingPassword,
  generateSalt,
  generateSecret,
  hashFixedPassword,
  normalizeCode,
  secondsUntilPasswordRefresh,
  verifyFixedPassword,
};