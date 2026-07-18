function toValidDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveAutomationWindow(session = {}) {
  const enabled = Boolean(session.automationEnabled);
  const startAt = toValidDate(session.scheduledStartAt);
  const durationMinutes = Number(session.activationDurationMinutes || 0);
  const storedEndAt = toValidDate(session.scheduledEndAt);
  const computedEndAt = startAt && durationMinutes > 0
    ? new Date(startAt.getTime() + (durationMinutes * 60000))
    : null;
  const endAt = storedEndAt || computedEndAt;
  const validWindow = Boolean(enabled && startAt && endAt && endAt.getTime() > startAt.getTime());

  return {
    enabled,
    startAt,
    endAt,
    durationMinutes: durationMinutes > 0 ? durationMinutes : null,
    validWindow
  };
}

function getAutomatedSessionState(session = {}, now = new Date()) {
  const baseStatus = String(session.status || 'off').toLowerCase() === 'on' ? 'on' : 'off';
  const window = resolveAutomationWindow(session);

  if (!window.enabled || !window.validWindow) {
    return {
      ...window,
      effectiveStatus: baseStatus,
      isActiveWindow: baseStatus === 'on',
      inactiveReason: null
    };
  }

  if (now.getTime() < window.startAt.getTime()) {
    return {
      ...window,
      effectiveStatus: 'off',
      isActiveWindow: false,
      inactiveReason: 'before_start'
    };
  }

  if (now.getTime() >= window.endAt.getTime()) {
    return {
      ...window,
      effectiveStatus: 'off',
      isActiveWindow: false,
      inactiveReason: 'ended'
    };
  }

  return {
    ...window,
    effectiveStatus: 'on',
    isActiveWindow: true,
    inactiveReason: null
  };
}

module.exports = {
  getAutomatedSessionState,
  resolveAutomationWindow,
  toValidDate
};
