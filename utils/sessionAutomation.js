function toValidDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeAutomationWindows(session = {}) {
  if (Array.isArray(session.automationWindows) && session.automationWindows.length > 0) {
    return session.automationWindows.map((window) => {
      const startAt = toValidDate(window?.scheduledStartAt);
      const durationMinutes = Number(window?.activationDurationMinutes || 0);
      const storedEndAt = toValidDate(window?.scheduledEndAt);
      const computedEndAt = startAt && durationMinutes > 0
        ? new Date(startAt.getTime() + (durationMinutes * 60000))
        : null;
      const endAt = storedEndAt || computedEndAt;

      return {
        startAt,
        endAt,
        durationMinutes: durationMinutes > 0 ? durationMinutes : null
      };
    }).filter(window => window.startAt && window.endAt && window.endAt.getTime() > window.startAt.getTime())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  }

  const enabled = Boolean(session.automationEnabled);
  const startAt = toValidDate(session.scheduledStartAt);
  const durationMinutes = Number(session.activationDurationMinutes || 0);
  const storedEndAt = toValidDate(session.scheduledEndAt);
  const computedEndAt = startAt && durationMinutes > 0
    ? new Date(startAt.getTime() + (durationMinutes * 60000))
    : null;
  const endAt = storedEndAt || computedEndAt;
  if (!enabled || !startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
    return [];
  }

  return [{
    startAt,
    endAt,
    durationMinutes: durationMinutes > 0 ? durationMinutes : null
  }];
}

function resolveAutomationWindow(session = {}, now = new Date()) {
  const enabled = Boolean(session.automationEnabled);
  const windows = normalizeAutomationWindows(session);
  const nowTime = now.getTime();
  const activeWindow = windows.find(window => nowTime >= window.startAt.getTime() && nowTime < window.endAt.getTime());
  const nextWindow = windows.find(window => nowTime < window.startAt.getTime());
  const selectedWindow = activeWindow || nextWindow || windows[windows.length - 1] || {};
  const validWindow = Boolean(enabled && windows.length > 0);

  return {
    enabled,
    startAt: selectedWindow.startAt || null,
    endAt: selectedWindow.endAt || null,
    durationMinutes: selectedWindow.durationMinutes || null,
    validWindow,
    windows,
    activeWindow
  };
}

function getAutomatedSessionState(session = {}, now = new Date()) {
  const baseStatus = String(session.status || 'off').toLowerCase() === 'on' ? 'on' : 'off';
  const window = resolveAutomationWindow(session, now);

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
