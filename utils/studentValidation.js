const PHONE_DIGITS_MIN = 10;
const PHONE_DIGITS_MAX = 15;

function sanitizeLmsId(value) {
  return String(value || '').trim();
}

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  return normalized.length >= PHONE_DIGITS_MIN && normalized.length <= PHONE_DIGITS_MAX;
}

module.exports = {
  PHONE_DIGITS_MIN,
  PHONE_DIGITS_MAX,
  sanitizeLmsId,
  normalizePhoneNumber,
  isValidPhoneNumber
};