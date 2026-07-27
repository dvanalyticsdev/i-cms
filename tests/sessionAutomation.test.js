const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAutomatedSessionState,
  getSessionAutomationSelectFields,
  withEffectiveSessionStatus
} = require('../utils/sessionAutomation');

test('returns active status when current time falls inside an automated window even if persisted status is off', () => {
  const session = {
    status: 'off',
    automationEnabled: true,
    automationWindows: [
      {
        scheduledStartAt: '2026-07-27T07:00:00.000Z',
        scheduledEndAt: '2026-07-27T08:00:00.000Z',
        activationDurationMinutes: 60
      }
    ]
  };

  const effectiveSession = withEffectiveSessionStatus(session, new Date('2026-07-27T07:30:00.000Z'));

  assert.equal(effectiveSession.status, 'on');
  assert.equal(effectiveSession.automation.enabled, true);
  assert.equal(effectiveSession.automation.activeWindow, true);
  assert.equal(
    effectiveSession.automation.scheduledStartAt.toISOString(),
    '2026-07-27T07:00:00.000Z'
  );
});

test('supports later automation windows instead of only the primary stored schedule fields', () => {
  const session = {
    status: 'off',
    automationEnabled: true,
    scheduledStartAt: '2026-07-27T07:00:00.000Z',
    scheduledEndAt: '2026-07-27T08:00:00.000Z',
    activationDurationMinutes: 60,
    automationWindows: [
      {
        scheduledStartAt: '2026-07-27T07:00:00.000Z',
        scheduledEndAt: '2026-07-27T08:00:00.000Z',
        activationDurationMinutes: 60
      },
      {
        scheduledStartAt: '2026-07-27T10:00:00.000Z',
        scheduledEndAt: '2026-07-27T11:30:00.000Z',
        activationDurationMinutes: 90
      }
    ]
  };

  const automationState = getAutomatedSessionState(session, new Date('2026-07-27T10:45:00.000Z'));

  assert.equal(automationState.effectiveStatus, 'on');
  assert.equal(automationState.isActiveWindow, true);
  assert.equal(automationState.startAt.toISOString(), '2026-07-27T10:00:00.000Z');
  assert.equal(automationState.endAt.toISOString(), '2026-07-27T11:30:00.000Z');
});

test('reports before-start and ended states consistently for scheduled sessions', () => {
  const session = {
    status: 'off',
    automationEnabled: true,
    automationWindows: [
      {
        scheduledStartAt: '2026-07-27T12:00:00.000Z',
        scheduledEndAt: '2026-07-27T13:00:00.000Z',
        activationDurationMinutes: 60
      }
    ]
  };

  const beforeStart = getAutomatedSessionState(session, new Date('2026-07-27T11:59:00.000Z'));
  const afterEnd = getAutomatedSessionState(session, new Date('2026-07-27T13:01:00.000Z'));

  assert.equal(beforeStart.effectiveStatus, 'off');
  assert.equal(beforeStart.inactiveReason, 'before_start');
  assert.equal(afterEnd.effectiveStatus, 'off');
  assert.equal(afterEnd.inactiveReason, 'ended');
});

test('automation query field helper always includes the fields needed for live status evaluation', () => {
  const selectFields = getSessionAutomationSelectFields(['sessionId', 'title']).split(' ');

  assert.ok(selectFields.includes('sessionId'));
  assert.ok(selectFields.includes('title'));
  assert.ok(selectFields.includes('status'));
  assert.ok(selectFields.includes('automationEnabled'));
  assert.ok(selectFields.includes('scheduledStartAt'));
  assert.ok(selectFields.includes('scheduledEndAt'));
  assert.ok(selectFields.includes('activationDurationMinutes'));
  assert.ok(selectFields.includes('automationWindows'));
});
