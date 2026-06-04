const SessionLog = require('../models/SessionLog');

function getTimestampParts(date = new Date()) {
  const localDate = date.toLocaleDateString('en-CA');
  const localTime = date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

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
