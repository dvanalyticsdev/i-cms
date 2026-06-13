const SessionLog = require('../models/SessionLog');

const INDIAN_TIME_ZONE = 'Asia/Kolkata';

function getTimestampParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: INDIAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const parts = formatter.formatToParts(date);
  const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const localDate = `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
  const localTime = `${valueByType.hour}:${valueByType.minute}:${valueByType.second} ${String(valueByType.dayPeriod || '').toUpperCase()}`.trim();

  return {
    date: localDate,
    time: localTime,
    timestamp: date
  };
}

async function logSessionActivity({
  sessionId = '',
  sessionName,
  userName,
  actionPerformed,
  status,
  remarks = '',
  timestamp = new Date()
}) {
  if (!sessionName || !userName || !actionPerformed || !status) {
    return null;
  }

  const parts = getTimestampParts(timestamp);

  try {
    return await SessionLog.create({
      sessionId: sessionId || '',
      sessionName: sessionName.trim(),
      date: parts.date,
      time: parts.time,
      userName: userName.trim(),
      actionPerformed: actionPerformed.trim(),
      status: status.trim(),
      remarks: remarks ? String(remarks).trim() : '',
      timestamp: parts.timestamp
    });
  } catch (error) {
    console.error('Error writing session log:', error.message);
    return null;
  }
}

module.exports = {
  logSessionActivity,
  getTimestampParts
};
