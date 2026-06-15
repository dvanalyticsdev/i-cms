/**
 * DV Classroom Landing Page - Frontend Script (Updated for Dynamic Sessions)
 * Handles user authentication, session management, and dynamic Zoom SDK integration
 */

// ====================================
// GLOBAL VARIABLES
// ====================================

const API_BASE_URL = '/api';
const STUDENT_THEME_STORAGE_KEY = 'icms-student-theme';
let deviceToken = null;
let currentSession = null;
let forceLoginMode = false;
let lastLoginAttempt = null;
let availableSessions = [];
let selectedSession = null;
let sessionHeartbeatInterval = null; // Polling timer to detect remote session revocation

// ====================================
// INITIALIZATION
// ====================================

/**
 * Initialize the application on page load
 */
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
  generateDeviceToken();
  checkExistingSession();
  setupEventListeners();
  console.log('DV Classroom Landing Page initialized');
});

/**
 * Generate a unique device token for this browser session
 */
function generateDeviceToken() {
  // Check if device token already exists in localStorage
  let token = localStorage.getItem('dvClassroom_deviceToken');
  
  if (!token) {
    // Generate new token
    token = `DEVICE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('dvClassroom_deviceToken', token);
  }
  
  deviceToken = token;
  console.log('Device Token:', deviceToken);
}

/**
 * Open the issue report modal
 */
function openIssueModal() {
  const modal = document.getElementById('issueModal');
  modal.classList.remove('hidden');

  const issueLmsId = document.getElementById('issueLmsId');
  const issueName = document.getElementById('issueName');
  const issuePhoneNumber = document.getElementById('issuePhoneNumber');

  if (!issueLmsId.value) {
    issueLmsId.value = document.getElementById('lmsId').value.trim();
  }

  if (!issueName.value) {
    issueName.value = currentSession && currentSession.studentName ? currentSession.studentName : '';
  }

  if (issuePhoneNumber && !issuePhoneNumber.value) {
    issuePhoneNumber.value = '';
  }

  issueLmsId.focus();
}
/**
 * Check for an existing session in localStorage and validate it with the server.
 * Sends the deviceToken so the server can confirm this device owns the session.
 * If valid         → skip the hero and go straight to the sessions screen.
 * If gone/mismatch → clear localStorage and show the hero (require fresh login).
 * If network error → restore optimistically (don't punish user for a bad connection).
 */
async function checkExistingSession() {
  const savedSession = localStorage.getItem('dvClassroom_session');
  if (!savedSession) return;

  try {
    currentSession = JSON.parse(savedSession);
  } catch {
    localStorage.removeItem('dvClassroom_session');
    return;
  }

  // Immediately hide the hero to prevent a flash of the wrong screen
  const hero = document.querySelector('.hero');
  if (hero) hero.classList.add('hidden');

  try {
    // Pass deviceToken as a query param so the server can verify this device owns the session.
    // Without this, a second device that somehow has the same lmsId in localStorage
    // (e.g. via browser sync) would be allowed in without re-authenticating.
    const url = `${API_BASE_URL}/session/${encodeURIComponent(currentSession.lmsId)}?deviceToken=${encodeURIComponent(deviceToken)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.success) {
      // Session is still alive on the server and belongs to THIS device — proceed
      showSessionSelection();
    } else {
      // Session is gone, ended, or belongs to a different device — require fresh login
      localStorage.removeItem('dvClassroom_session');
      currentSession = null;
      if (hero) hero.classList.remove('hidden');
    }
  } catch (error) {
    // Network error — restore optimistically so a bad connection doesn't log the user out
    console.warn('Could not validate session with server:', error.message);
    showSessionSelection();
  }
}

/**
 * Close the issue report modal
 */
function closeIssueModal() {
  const modal = document.getElementById('issueModal');
  modal.classList.add('hidden');
  resetIssueForm();
}
/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Close modal when clicking overlay
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    const overlay = modal.querySelector('.modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeAllModals();
        }
      });
    }
  });

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', toggleTheme);
  });
}

function initializeTheme() {
  const savedTheme = localStorage.getItem(STUDENT_THEME_STORAGE_KEY) || document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nextTheme);
  localStorage.setItem(STUDENT_THEME_STORAGE_KEY, nextTheme);
  document.querySelectorAll('.theme-toggle-label').forEach(label => {
    label.textContent = nextTheme === 'dark' ? 'Dark' : 'Light';
  });
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.dataset.theme = nextTheme;
  });
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

// ====================================
// MODAL FUNCTIONS
// ====================================

/**
 * Open the login modal
 */
function openLoginModal() {
  const modal = document.getElementById('loginModal');
  modal.classList.remove('hidden');
  document.getElementById('lmsId').focus();
}

/**
 * Handle issue report submission
 */
async function handleIssueReport(event) {
  event.preventDefault();

  const lmsId = document.getElementById('issueLmsId').value.trim();
  const name = document.getElementById('issueName').value.trim();
  const phoneNumber = document.getElementById('issuePhoneNumber').value.trim();
  const description = document.getElementById('issueDescription').value.trim();

  if (!lmsId || !name || !description) {
    showErrorToast('Please fill in all issue report fields.');
    return;
  }

  setIssueSubmitLoading(true);

  try {
    const response = await fetch(`${API_BASE_URL}/issues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lmsId,
        name,
        phoneNumber,
        description
      })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Failed to submit issue');
    }

    closeIssueModal();
    showSuccessToast('Issue reported successfully. Our admin team will review it.');
  } catch (error) {
    console.error('Issue report error:', error);
    showErrorToast(error.message || 'Error submitting issue');
  } finally {
    setIssueSubmitLoading(false);
  }
}
/**
 * Close the login modal
 */
function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  modal.classList.add('hidden');
  resetLoginForm();
}

/**
 * Reset issue report form
 */
function resetIssueForm() {
  const form = document.getElementById('issueForm');
  form.reset();
  setIssueSubmitLoading(false);
}
/**
 * Close the "already logged in" modal
 */
function closeAlreadyLoggedInModal() {
  const modal = document.getElementById('alreadyLoggedInModal');
  modal.classList.add('hidden');
  forceLoginMode = false;
}

function showBlockingWarning(message) {
  const modal = document.getElementById('warningModal');
  const messageElement = document.getElementById('warningModalMessage');

  closeLoginModal();
  hideLoadingModal();
  closeAlreadyLoggedInModal();

  if (!modal || !messageElement) {
    showErrorToast(message);
    return;
  }

  messageElement.textContent = message;
  modal.classList.remove('hidden');
}

function closeWarningModal() {
  const modal = document.getElementById('warningModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

/**
 * Set issue submit button loading state
 */
function setIssueSubmitLoading(isLoading) {
  const submitBtn = document.querySelector('#issueForm button[type="submit"]');
  const submitText = document.getElementById('issueSubmitText');
  const submitLoader = document.getElementById('issueSubmitLoader');

  if (!submitBtn || !submitText || !submitLoader) {
    return;
  }

  if (isLoading) {
    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitLoader.classList.remove('hidden');
  } else {
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoader.classList.add('hidden');
  }
}
/**
 * Close all modals
 */
function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.add('hidden');
  });
  resetLoginForm();
}

/**
 * Show loading modal
 */
function showLoadingModal() {
  const modal = document.getElementById('loadingModal');
  modal.classList.remove('hidden');
}

/**
 * Hide loading modal
 */
function hideLoadingModal() {
  const modal = document.getElementById('loadingModal');
  modal.classList.add('hidden');
}

// ====================================
// SESSION SELECTION UI
// ====================================

/**
 * Show session selection screen
 */
function showSessionSelection() {
  const hero = document.querySelector('.hero');
  if (hero) hero.classList.add('hidden');

  const sessionsScreen = document.getElementById('sessionsScreen');
  if (sessionsScreen) {
    sessionsScreen.classList.remove('hidden');
    loadAndDisplaySessions();
  }

  // Begin heartbeat: silently poll the server so that if another device
  // force-logs in and revokes this session, we detect it immediately.
  startSessionHeartbeat();
}

/**
 * Hide session selection screen
 */
function hideSessionSelection() {
  const sessionsScreen = document.getElementById('sessionsScreen');
  if (sessionsScreen) {
    sessionsScreen.classList.add('hidden');
  }
  stopSessionHeartbeat();
}

// ====================================
// SESSION HEARTBEAT
// ====================================

/**
 * Start polling the server every 30 seconds to verify this device's session
 * is still active. If the server returns non-success (e.g. 403 because another
 * device stole the session, or 404 because it was ended), immediately revoke
 * the local session so the user is logged out in real-time — no refresh needed.
 */
function startSessionHeartbeat() {
  stopSessionHeartbeat(); // Clear any existing interval first

  sessionHeartbeatInterval = setInterval(async () => {
    if (!currentSession || !currentSession.lmsId) {
      stopSessionHeartbeat();
      return;
    }

    try {
      const url = `${API_BASE_URL}/session/${encodeURIComponent(currentSession.lmsId)}?deviceToken=${encodeURIComponent(deviceToken)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.success) {
        // Session is gone or belongs to a different device now
        console.warn('Heartbeat: session invalidated remotely. Logging out.');
        handleSessionRevoked();
      }
    } catch (err) {
      // Network hiccup — don't log out, just wait for the next tick
      console.warn('Heartbeat check failed (network):', err.message);
    }
  }, 30000); // 30 seconds
}

/**
 * Stop the session heartbeat polling.
 */
function stopSessionHeartbeat() {
  if (sessionHeartbeatInterval) {
    clearInterval(sessionHeartbeatInterval);
    sessionHeartbeatInterval = null;
  }
}

/**
 * Called when the heartbeat (or a pre-join check) detects that this device's
 * session has been revoked remotely. Clears local state and shows a clear
 * message so the user knows why they were logged out.
 */
function handleSessionRevoked() {
  stopSessionHeartbeat();

  // Clear all local session state
  localStorage.removeItem('dvClassroom_session');
  currentSession = null;
  selectedSession = null;

  // Hide the sessions screen
  const sessionsScreen = document.getElementById('sessionsScreen');
  if (sessionsScreen) sessionsScreen.classList.add('hidden');

  // Show the hero / login screen
  const hero = document.querySelector('.hero');
  if (hero) hero.classList.remove('hidden');

  // Inform the user with a clear, non-dismissible banner
  showErrorToast('You have been logged out because the same account signed in on another device.');
}

/**
 * Load and display available sessions
 */
async function loadAndDisplaySessions() {
  try {
    showLoadingModal();
    
    // Pass student's lmsId to get filtered sessions based on their course
    let url = `${API_BASE_URL}/class-sessions`;
    if (currentSession && currentSession.lmsId) {
      url += `?lmsId=${encodeURIComponent(currentSession.lmsId)}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    hideLoadingModal();
    
    // Check if ID has been revoked (for guest/mentor IDs)
    if (data.idRevoked) {
      console.warn('ID has been revoked by admin. Logging out immediately.');
      showErrorToast('Your ID has been revoked. Please contact support.');
      handleSessionRevoked();
      return;
    }
    
    if (!data.success) {
      showErrorToast('Failed to load sessions');
      return;
    }
    
    availableSessions = data.sessions;
    renderSessionCards();
    
  } catch (error) {
    console.error('Error loading sessions:', error);
    hideLoadingModal();
    showErrorToast('Error loading sessions');
  }
}

/**
 * Render session cards
 */
function renderSessionCards() {
  const container = document.getElementById('sessionsContainer');
  
  if (!container) return;
  
  if (availableSessions.length === 0) {
    container.innerHTML = `
      <div class="no-sessions">
        <p>No sessions available right now. Please check back later.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = availableSessions.map(session => `
    <div class="session-card ${session.status === 'off' ? 'inactive' : 'active'}">
      ${session.posterImage ? `
      <div class="session-poster-wrap">
        <img class="session-poster" src="${session.posterImage}" alt="${escapeHtml(session.title)} poster">
      </div>` : ''}
      <div class="session-card-header">
        <h3 class="session-title">${escapeHtml(session.title)}</h3>
        <span class="session-status ${session.status}">
          ${session.status === 'on' ? '● Active' : '● Inactive'}
        </span>
      </div>
      <div class="session-card-body">
        <p class="session-description">${session.description ? escapeHtml(session.description) : 'No description provided'}</p>
        <p class="session-meta">Session ID: ${session.sessionId}</p>
        <p class="session-meta">Class: ${escapeHtml(session.className || 'General')}</p>
        <p class="session-meta">Mentor: ${escapeHtml(session.mentorName || 'TBA')}</p>
      </div>
      <div class="session-card-footer">
        ${session.status === 'on'
          ? `<button class="btn btn-primary" onclick="joinSession('${session.sessionId}')">Join Now</button>`
          : `<button class="btn btn-disabled" disabled>Session Closed</button>`
        }
        <button class="btn btn-secondary" onclick="logoutSession()">Logout</button>
      </div>
    </div>
  `).join('');
}

/**
 * Join selected session
 */
async function joinSession(sessionId) {
  try {
    showLoadingModal();

    // --- Pre-join session ownership check ---
    // Before fetching Zoom credentials, confirm this device still owns the
    // active session. This blocks the join if another device has force-logged
    // in and revoked this session in between heartbeat ticks.
    if (currentSession && currentSession.lmsId) {
      try {
        const checkUrl = `${API_BASE_URL}/session/${encodeURIComponent(currentSession.lmsId)}?deviceToken=${encodeURIComponent(deviceToken)}`;
        const checkResponse = await fetch(checkUrl);
        const checkData = await checkResponse.json();

        if (!checkData.success) {
          hideLoadingModal();
          handleSessionRevoked();
          return;
        }
      } catch (checkErr) {
        // Network issue — allow the join attempt anyway (same optimistic policy as heartbeat)
        console.warn('Pre-join session check failed (network):', checkErr.message);
      }
    }

    // Fetch Zoom credentials for this session
    const response = await fetch(`${API_BASE_URL}/join-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionId, lmsId: currentSession?.lmsId })
    });

    const data = await response.json();
    hideLoadingModal();

    if (!data.success) {
      if (data.sessionInactive) {
        showBlockingWarning('This session is currently inactive');
      } else if (data.feePending) {
        showBlockingWarning('We can see you have some remaining fee balance to settle please reach out to finance deparmtent - 8431424165 or report an issue.');
      } else {
        showBlockingWarning(data.message || 'Failed to join session');
      }
      return;
    }

    selectedSession = data.session;
    const zoomData = data.zoom;

    showSuccessToast('Joining session...');
    hideSessionSelection();

    // Wait a moment then join Zoom
    setTimeout(() => {
      joinZoomMeeting(zoomData);
    }, 800);

  } catch (error) {
    console.error('Error joining session:', error);
    hideLoadingModal();
    showErrorToast('Error joining session');
  }
}

/**
 * Logout session
 */
async function logoutSession() {
  stopSessionHeartbeat();
  try {
    if (currentSession && currentSession.lmsId) {
      await fetch(`${API_BASE_URL}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lmsId: currentSession.lmsId })
      });
    }

    localStorage.removeItem('dvClassroom_session');
    currentSession = null;
    selectedSession = null;
    hideSessionSelection();

    const hero = document.querySelector('.hero');
    if (hero) hero.classList.remove('hidden');

  } catch (error) {
    console.error('Error logging out:', error);
  }
}

// ====================================
// FORM HANDLING
// ====================================

/**
 * Handle login form submission
 */
async function handleLogin(event) {
  event.preventDefault();
  
  // Clear previous errors
  clearFormErrors();
  
  // Get form values
  const lmsId = document.getElementById('lmsId').value.trim();
  const studentName = document.getElementById('studentName').value.trim();

  // Save attempt for the "already logged in" modal actions
  lastLoginAttempt = { lmsId, studentName };
  
  // Validate form
  if (!validateLoginForm(lmsId, studentName)) {
    return;
  }
  
  // Show loading state
  setSubmitButtonLoading(true);
  
  try {
    // Make API request
    const response = await fetch(`${API_BASE_URL}/verify-student`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lmsId,
        name: studentName,
        deviceToken,
        forceLogin: forceLoginMode
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Login successful
      forceLoginMode = false;
      handleLoginSuccess(data, lmsId, studentName);
    } else if (data.alreadyLoggedIn) {
      // Already logged in on another device
      setSubmitButtonLoading(false);
      closeLoginModal();
      showAlreadyLoggedInModal();
    } else {
      // Login failed
      showBlockingWarning(data.message || 'Login failed. Please try again.');
      setSubmitButtonLoading(false);
    }
  } catch (error) {
    console.error('Login error:', error);
    showErrorToast('Network error. Please check your connection and try again.');
    setSubmitButtonLoading(false);
  }
}

/**
 * Force logout the other device/session for this LMS ID.
 * This clears the server-side active session, then immediately retries login.
 */
async function forceLogoutOtherDevice() {
  try {
    if (!lastLoginAttempt || !lastLoginAttempt.lmsId || !lastLoginAttempt.studentName) {
      showBlockingWarning('Missing login details. Please enter your LMS ID and name again.');
      return;
    }

    showLoadingModal();

    // 1) Clear the active session for this LMS ID
    const clearResponse = await fetch(`${API_BASE_URL}/force-logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lmsId: lastLoginAttempt.lmsId,
        name: lastLoginAttempt.studentName,
        deviceToken
      })
    });

    const clearData = await clearResponse.json();
    if (!clearData.success) {
      showBlockingWarning(clearData.message || 'Failed to clear the active session.');
      return;
    }

    // 2) Retry login on this device (forceLogin mode)
    const response = await fetch(`${API_BASE_URL}/verify-student`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lmsId: lastLoginAttempt.lmsId,
        name: lastLoginAttempt.studentName,
        deviceToken,
        forceLogin: true
      })
    });

    const data = await response.json();
    hideLoadingModal();

    if (data.success) {
      forceLoginMode = false;
      closeAlreadyLoggedInModal();
      handleLoginSuccess(data, lastLoginAttempt.lmsId, lastLoginAttempt.studentName);
      return;
    }

    // If it still fails, bring user back to login modal
    showBlockingWarning(data.message || 'Please try logging in again.');
  } catch (error) {
    console.error('Force logout error:', error);
    hideLoadingModal();
    showErrorToast('Network error. Please try again.');
  }
}

/**
 * Handle successful login
 */
async function handleLoginSuccess(data, lmsId, studentName) {
  // Save session to localStorage
  currentSession = {
    sessionId: data.sessionToken || data.sessionId,
    lmsId,
    studentName: data.studentName || studentName || '',
    mobile: data.mobile || '',
    loginTime: new Date().toISOString()
  };
  localStorage.setItem('dvClassroom_session', JSON.stringify(currentSession));
  
  closeLoginModal();
  showSuccessToast(`Welcome ${currentSession.studentName || lmsId}!`);
  
  // Show session selection
  setTimeout(() => {
    showSessionSelection();
  }, 1000);
}

/**
 * Reset login form
 */
function resetLoginForm() {
  const form = document.getElementById('loginForm');
  form.reset();
  clearFormErrors();
  setSubmitButtonLoading(false);
}

/**
 * Validate login form
 */
function validateLoginForm(lmsId, studentName) {
  let isValid = true;
  
  // Validate LMS ID
  if (!lmsId) {
    showFormError('lmsIdError', 'LMS ID is required');
    isValid = false;
  } else if (lmsId.length < 3) {
    showFormError('lmsIdError', 'LMS ID must be at least 3 characters');
    isValid = false;
  }
  
  // Validate student name as display metadata only
  if (!studentName) {
    showFormError('nameError', 'Name is required');
    isValid = false;
  }
  
  return isValid;
}

/**
 * Show form error message
 */
function showFormError(fieldId, message) {
  const errorElement = document.getElementById(fieldId);
  if (errorElement) {
    errorElement.textContent = message;
    errorElement.style.display = 'block';
  }
}

/**
 * Clear all form errors
 */
function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(error => {
    error.textContent = '';
    error.style.display = 'none';
  });
}

/**
 * Set submit button loading state
 */
function setSubmitButtonLoading(isLoading) {
  const submitBtn = document.querySelector('#loginForm button[type="submit"]');
  const submitText = document.getElementById('submitButtonText');
  const submitLoader = document.getElementById('submitLoader');
  
  if (isLoading) {
    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitLoader.classList.remove('hidden');
  } else {
    submitBtn.disabled = false;
    submitText.classList.remove('hidden');
    submitLoader.classList.add('hidden');
  }
}

// ====================================
// TOAST NOTIFICATIONS
// ====================================

/**
 * Show error toast notification
 */
function showErrorToast(message) {
  const toast = document.getElementById('errorToast');
  const messageElement = document.getElementById('errorToastMessage');
  
  messageElement.textContent = message;
  toast.classList.remove('hidden');
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    closeErrorToast();
  }, 5000);
}

/**
 * Close error toast
 */
function closeErrorToast() {
  const toast = document.getElementById('errorToast');
  toast.classList.add('hidden');
}

/**
 * Show success toast notification
 */
function showSuccessToast(message) {
  const toast = document.getElementById('successToast');
  const messageElement = document.getElementById('successToastMessage');
  
  messageElement.textContent = message;
  toast.classList.remove('hidden');
  
  // Auto-hide after 4 seconds
  setTimeout(() => {
    closeSuccessToast();
  }, 4000);
}

/**
 * Close success toast
 */
function closeSuccessToast() {
  const toast = document.getElementById('successToast');
  toast.classList.add('hidden');
}

/**
 * Show already logged in modal
 */
function showAlreadyLoggedInModal() {
  const modal = document.getElementById('alreadyLoggedInModal');
  modal.classList.remove('hidden');
}

// ====================================
// ZOOM SDK INTEGRATION
// ====================================

function hideLandingUI() {
  // Hide landing page content so it can't overlay the Zoom UI
  document.querySelector('.navbar')?.classList.add('hidden');
  document.querySelector('.hero')?.classList.add('hidden');
}

function ensureZoomMeetingCssLoaded() {
  // Zoom Meeting SDK expects zoom-meetingsdk.css for proper rendering
  const existing = document.getElementById('zoom-meetingsdk-css');
  if (existing) return;

  const link = document.createElement('link');
  link.id = 'zoom-meetingsdk-css';
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = 'https://cdn.jsdelivr.net/npm/@zoom/meetingsdk@6.0.0/dist/ui/zoom-meetingsdk.css';
  document.head.appendChild(link);
}

function isSecureContextForMedia() {
  // getUserMedia (and Zoom video) requires a secure context in most cases.
  // Browsers treat http://localhost as secure, but http://<LAN IP> is NOT.
  return (
    window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '[::1]'
  );
}

async function joinZoomMeeting(authData) {
  try {
    hideLoadingModal();

    if (!isSecureContextForMedia()) {
      showErrorToast('Camera/Mic are blocked on non-HTTPS sites. Open this on https:// or on http://localhost to enable camera.');
      return;
    }

    hideLandingUI();
    ensureZoomMeetingCssLoaded();
    
    // Use real Zoom SDK if available and auth data provided
    if (window.ZoomMtg && authData.signature) {
      console.log('Initializing real Zoom SDK...');
      initZoomMeeting(authData);
    } else if (window.ZoomMtg) {
      console.warn('Zoom SDK loaded but missing meeting details');
      showErrorToast('Meeting details not available. Please try again.');
    } else {
      console.warn('Zoom SDK not available');
      showErrorToast('Zoom SDK failed to load. Please refresh the page.');
    }
  } catch (error) {
    console.error('Error joining Zoom meeting:', error);
    hideLoadingModal();
    showErrorToast('Failed to join the meeting. Please try again.');
  }
}

/**
 * Initialize Zoom meeting SDK (v6.0.0)
 * SECURITY: Display name is locked to LMS ID to prevent identity spoofing
 */
function initZoomMeeting(zoomData) {
  try {
    console.log('Initializing Zoom SDK v6.0.0 with JWT authentication...');
    console.log('Browser media context:', {
      isSecureContext: !!window.isSecureContext,
      crossOriginIsolated: !!window.crossOriginIsolated,
      hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    });
    console.log('Zoom config:', {
      meetingNumber: zoomData.meetingNumber,
      hasJWT: !!zoomData.signature,
      hasAppKey: !!zoomData.sdkKey,
      hasPassword: !!zoomData.passcode
    });

    try {
      const req = ZoomMtg.checkSystemRequirements?.();
      if (req) console.log('Zoom system requirements:', req);
    } catch (e) {
      console.warn('Unable to read Zoom system requirements:', e);
    }
    
    // Set library path for SDK resources (lib folder with wasm files, etc.)
    // Note: 2nd argument is required (default is '/av')
    const zoomLibBase = 'https://cdn.jsdelivr.net/npm/@zoom/meetingsdk@6.0.0/dist/lib';
    ZoomMtg.setZoomJSLib(zoomLibBase, '/av');
    
    // Configure Zoom SDK v6.0.0
    ZoomMtg.preLoadWasm();
    ZoomMtg.prepareWebSDK();

    // Load language support
    ZoomMtg.i18n.load('en-US');
    ZoomMtg.i18n.onLoad(function () {
      // Initialize SDK - appKey is already in JWT, don't pass it here
      ZoomMtg.init({
        leaveUrl: window.location.href,
        disableCORP: !window.crossOriginIsolated,
        // Improves camera/mic compatibility across browsers (recommended by Zoom samples)
        patchJsMedia: true,
        success: function () {
          console.log('✓ Zoom SDK initialized successfully');
          
           // Extract first name from student name for display name formatting
           const fullName = currentSession.studentName || '';
           const firstName = fullName.split(/\s+/)[0] || 'User'; // Get first word, fallback to 'User'
         
           // Prepare meeting configuration
           // Display name format: [LMSID]_[FirstName]
           const meetingConfig = {
             sdkKey: zoomData.sdkKey, // Required by Meeting SDK join() (aka appKey)
             meetingNumber: zoomData.meetingNumber.toString().replace(/\s/g, ''),  // Remove spaces from meeting number
             userName: `${currentSession.lmsId}_${firstName}`,  // Format: [LMSID]_[FirstName]
             signature: zoomData.signature,  // JWT token
             userEmail: currentSession.lmsId + '@dv-classroom.local',
             passWord: zoomData.passcode || ''
           };

          console.log('Joining meeting with JWT auth:', {
            meetingNumber: meetingConfig.meetingNumber,
            userName: meetingConfig.userName,
            hasPassword: !!meetingConfig.passWord,
            jwtTokenLength: meetingConfig.signature.length
          });

          // Join meeting
          ZoomMtg.join({
            ...meetingConfig,
            success: function (res) {
              console.log('✓ Successfully joined Zoom meeting:', res);
              showSuccessToast('Joined Zoom meeting successfully!');
            },
            error: function (error) {
              console.error('✗ Error joining Zoom meeting:', error);
              console.log('Error type:', error.type);
              console.log('Error message:', error.message);
              console.log('Full error:', JSON.stringify(error));
              showErrorToast('Failed to join Zoom meeting. Showing mock interface.');
              // Fallback to mock interface
              setTimeout(() => showMockZoomInterface(currentSession), 1000);
            }
          });
        },
        error: function (res) {
          console.error('✗ Zoom SDK initialization error:', res);
          showErrorToast('Failed to initialize Zoom SDK. Showing mock interface.');
          showMockZoomInterface(currentSession);
        }
      });
    });
  } catch (error) {
    console.error('Zoom initialization error:', error);
    showErrorToast('Failed to initialize Zoom meeting');
    showMockZoomInterface(currentSession);
  }
}

/**
 * Show mock Zoom interface (for development when SDK is not configured)
 * SECURITY: Displays LMS ID as permanent, non-editable meeting identity
 */
function showMockZoomInterface(sessionData) {
  const zoomContainer = document.getElementById('zoomContainer');

  hideLandingUI();
  
  // Create mock Zoom interface
  const mockHTML = `
    <div style="
      width: 100%;
      height: 100vh;
      background: linear-gradient(135deg, #003d82 0%, #1a5bb3 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: white;
      text-align: center;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      position: fixed;
      top: 0;
      left: 0;
      z-index: 9999;
    ">
      <div style="background: rgba(255, 255, 255, 0.1); padding: 40px; border-radius: 12px; max-width: 550px;">
        <h1 style="font-size: 36px; margin-bottom: 20px;">📹 Zoom Meeting Interface</h1>
        <p style="font-size: 20px; margin-bottom: 10px;">Welcome, ${escapeHtml(sessionData.studentName)}!</p>
        
        <div style="background: rgba(255, 87, 34, 0.3); border: 2px solid rgba(255, 87, 34, 0.8); padding: 16px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 12px; opacity: 0.9;">🔐 ZOOM MEETING IDENTITY (LOCKED)</p>
          <p style="margin: 8px 0 0 0; font-size: 18px; font-weight: bold; letter-spacing: 2px;">${escapeHtml(sessionData.lmsId)}</p>
          <p style="margin: 6px 0 0 0; font-size: 11px; opacity: 0.8;">This display name cannot be changed</p>
        </div>
        
        <div style="background: rgba(0, 0, 0, 0.2); padding: 20px; border-radius: 8px; margin-bottom: 30px; text-align: left; font-size: 14px;">
          <p style="margin: 8px 0;"><strong>Session ID:</strong> ${sessionData.sessionId}</p>
          <p style="margin: 8px 0;"><strong>Status:</strong> Connected to classroom</p>
          <p style="margin: 8px 0;"><strong>Device Token:</strong> ${deviceToken.substring(0, 20)}...</p>
          <p style="margin: 8px 0;"><strong>Login Time:</strong> ${new Date(sessionData.loginTime).toLocaleString()}</p>
        </div>
        
        <button onclick="endSession()" style="
            padding: 12px 30px;
            background-color: #f44336;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: all 0.3s ease;
          " onmouseover="this.style.backgroundColor='#d32f2f'" onmouseout="this.style.backgroundColor='#f44336'">
          Leave Meeting
        </button>
        </p>
      </div>
    </div>
  `;
  
  zoomContainer.innerHTML = mockHTML;
  zoomContainer.classList.remove('hidden');
}

/**
 * End session and logout
 */
async function endSession() {
  try {
    const lmsId = currentSession?.lmsId;
    
    if (lmsId) {
      // Call logout API
      await fetch(`${API_BASE_URL}/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ lmsId })
      });
    }
    
    // Clear session from localStorage
    localStorage.removeItem('dvClassroom_session');
    currentSession = null;
    selectedSession = null;
    
    // Redirect to home
    window.location.href = '/';
  } catch (error) {
    console.error('Error ending session:', error);
    // Force redirect anyway
    window.location.href = '/';
  }
}

// ====================================
// UTILITY FUNCTIONS
// ====================================

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ====================================
// ERROR HANDLING
// ====================================

/**
 * Global error handler
 */
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

/**
 * Handle unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

console.log('DV Classroom Script loaded successfully (Multi-Session Version)');
