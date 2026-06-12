const DEFAULT_PAYMENT_STATUS = 'DEFAULT';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePaymentStatus(value) {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'FULLY PAID' || normalized === 'PENDING' || normalized === 'DEFAULT') {
    return normalized;
  }
  return DEFAULT_PAYMENT_STATUS;
}

function normalizeAccessCell(value) {
  const normalized = normalizeText(value).toUpperCase();
  return normalized === 'YES' || normalized === 'Y' || normalized === 'TRUE' || normalized === '1';
}

function buildRuleKey(course, paymentStatus) {
  return `${normalizeText(course)}::${normalizePaymentStatus(paymentStatus)}`;
}

function mapRulesByKey(ruleRows = []) {
  const ruleMap = new Map();
  ruleRows.forEach((rule) => {
    ruleMap.set(buildRuleKey(rule.course, rule.paymentStatus), rule);
  });
  return ruleMap;
}

function isClassAccessible({ student, className, ruleMap }) {
  if (!student || !className || !ruleMap) {
    return false;
  }

  const course = normalizeText(student.course);
  const paymentStatus = normalizePaymentStatus(student.paymentStatus);
  const directRule = ruleMap.get(buildRuleKey(course, paymentStatus));
  const fallbackRule = ruleMap.get(buildRuleKey(course, DEFAULT_PAYMENT_STATUS));
  const rule = directRule || fallbackRule;

  if (!rule) {
    return false;
  }

  const accessMap = rule.accessMap instanceof Map ? Object.fromEntries(rule.accessMap.entries()) : (rule.accessMap || {});
  return Boolean(accessMap[className]);
}

module.exports = {
  DEFAULT_PAYMENT_STATUS,
  normalizeText,
  normalizePaymentStatus,
  normalizeAccessCell,
  buildRuleKey,
  mapRulesByKey,
  isClassAccessible
};
