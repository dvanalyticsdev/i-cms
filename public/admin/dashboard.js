/**
 * Admin Dashboard JavaScript
 * Handles session management and monitoring
 */

const API_BASE_URL = '/api/admin';
const THEME_STORAGE_KEY = 'icms-admin-theme';
const attendanceDemoMode = new URLSearchParams(window.location.search).get('attendanceDemo') === '1';
let authToken = null;
let currentEditingSessionId = null;
let deleteTargetSessionId = null;
let allSessions = [];
let availableCourses = [];
let availableClassNames = [];
let classAccessRules = [];
let allCourses = [];
let currentEditingCourseId = null;
let deleteTargetCourseId = null;
let allStudents = [];
let filteredStudents = [];
let studentPageMeta = { page: 1, limit: 20, total: 0, totalPages: 1 };
let studentSearchQuery = { search: '', course: '', batches: [], year: '', paymentStatus: '', feeStatusException: '' };
let studentSearchTimer = null;
let studentBatchFilterSearchTerm = '';
let deleteTargetLmsId = null;
let availableBatches = [];
let availableStudentYears = [];
let studentBatchSelection = new Set();
let allIssues = [];
let issueSearchTimer = null;
let allSessionLogs = [];
let availableMentors = [];
let sessionLogsMeta = { page: 1, limit: 10, total: 0, totalPages: 1 };
let sessionLogsQuery = {
    search: '',
    status: '',
    action: '',
    sortBy: 'timestamp',
    sortOrder: 'desc'
};
let sessionLogsSearchTimer = null;
let currentExportFormat = 'json';
let currentExportScope = 'all';
let attendanceInsightsState = {
    metrics: {},
    sessionSummaries: [],
    sessionAttendance: [],
    selectedSession: null,
    pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    detailPagination: { page: 1, limit: 30, total: 0, totalPages: 1 },
    roster: [],
    rosterPagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: {}
};
let attendanceInsightsLoading = false;
let attendanceRosterSearchTimer = null;
let sessionBatchSelection = new Set();
let selectedAttendanceBatches = [];
let attendanceBatchFilterSearchTerm = '';
const attendanceDemoData = {
    metrics: {
        totalStudents: 42,
        totalSessionsConducted: 2
    },
    sessionSummaries: [
        {
            sessionId: 'DEMO_SESSION_001',
            sessionName: 'Frontend Attendance Demo',
            batch: 'Batch A',
            course: 'UI Engineering',
            attendanceDate: '2026-06-06',
            uniqueStudents: 24
        },
        {
            sessionId: 'DEMO_SESSION_002',
            sessionName: 'Backend Attendance Demo',
            batch: 'Batch B',
            course: 'Node.js API',
            attendanceDate: '2026-06-05',
            uniqueStudents: 18
        }
    ],
    sessionAttendance: {
        DEMO_SESSION_001: [
            { lmsId: 'LMS1001', studentName: 'Aarav Mehta', phoneNumber: '9000011111', attendedAt: '2026-06-06T09:00:00.000Z', durationMinutes: 84, status: 'present' },
            { lmsId: 'LMS1002', studentName: 'Diya Shah', phoneNumber: '9000022222', attendedAt: '2026-06-06T09:04:00.000Z', durationMinutes: 63, status: 'present' },
            { lmsId: 'LMS1003', studentName: 'Kabir Nair', phoneNumber: '9000033333', attendedAt: '2026-06-06T09:10:00.000Z', durationMinutes: 37, status: 'present' }
        ],
        DEMO_SESSION_002: [
            { lmsId: 'LMS2001', studentName: 'Ishita Rao', phoneNumber: '9000044444', attendedAt: '2026-06-05T10:00:00.000Z', durationMinutes: 92, status: 'present' },
            { lmsId: 'LMS2002', studentName: 'Rohan Das', phoneNumber: '9000055555', attendedAt: '2026-06-05T10:08:00.000Z', durationMinutes: 58, status: 'present' }
        ]
    },
    roster: [
        { lmsId: 'LMS1001', name: 'Aarav Mehta', phoneNumber: '9000011111', batch: 'Batch A', course: 'UI Engineering', attendancePercentage: 100, presentSessions: 2, absentSessions: 0, lastAttendanceDate: '2026-06-06' },
        { lmsId: 'LMS1002', name: 'Diya Shah', phoneNumber: '9000022222', batch: 'Batch A', course: 'UI Engineering', attendancePercentage: 88, presentSessions: 2, absentSessions: 0, lastAttendanceDate: '2026-06-06' },
        { lmsId: 'LMS1003', name: 'Kabir Nair', phoneNumber: '9000033333', batch: 'Batch A', course: 'UI Engineering', attendancePercentage: 52, presentSessions: 1, absentSessions: 1, lastAttendanceDate: '2026-06-06' },
        { lmsId: 'LMS2001', name: 'Ishita Rao', phoneNumber: '9000044444', batch: 'Batch B', course: 'Node.js API', attendancePercentage: 100, presentSessions: 2, absentSessions: 0, lastAttendanceDate: '2026-06-05' },
        { lmsId: 'LMS2002', name: 'Rohan Das', phoneNumber: '9000055555', batch: 'Batch B', course: 'Node.js API', attendancePercentage: 45, presentSessions: 1, absentSessions: 1, lastAttendanceDate: '2026-06-05' }
    ]
};

function getSessionBatches(session) {
    if (Array.isArray(session?.batches) && session.batches.length > 0) {
        return Array.from(new Set(session.batches.map(batch => String(batch || '').trim()).filter(Boolean)));
    }

    const batch = String(session?.batch || '').trim();
    if (!batch) {
        return [];
    }

    return Array.from(new Set(
        batch
            .split(',')
            .map(item => item.trim())
            .filter(Boolean)
    ));
}

function formatSessionBatches(session) {
    const batches = getSessionBatches(session);
    return batches.length > 0 ? batches.join(', ') : '-';
}

function getStudentBatches(student) {
    if (Array.isArray(student?.batches) && student.batches.length > 0) {
        return Array.from(new Set(student.batches.map(batch => String(batch || '').trim()).filter(Boolean)));
    }

    const batch = String(student?.batch || '').trim();
    return batch ? [batch] : [];
}

function formatStudentBatches(student) {
    const batches = getStudentBatches(student);
    return batches.length > 0 ? batches.join(', ') : '-';
}

function summarizeSessionAccessList(items, maxVisible = 4) {
    const normalizedItems = Array.from(new Set(
        (Array.isArray(items) ? items : [])
            .map(item => String(item || '').trim())
            .filter(Boolean)
    ));

    if (normalizedItems.length === 0) {
        return {
            summary: '-',
            fullText: '-'
        };
    }

    if (normalizedItems.length <= maxVisible) {
        const fullText = normalizedItems.join(', ');
        return {
            summary: fullText,
            fullText
        };
    }

    const visibleItems = normalizedItems.slice(0, maxVisible).join(', ');
    return {
        summary: `${visibleItems} +${normalizedItems.length - maxVisible} more`,
        fullText: normalizedItems.join(', ')
    };
}

function renderSummaryLine(label, items, maxVisible = 4, fallback = '-') {
    const summary = summarizeSessionAccessList(items, maxVisible);
    const text = summary.fullText === '-' ? fallback : summary.summary;
    const title = summary.fullText === '-' ? fallback : summary.fullText;

    return `
        <span class="session-access-line" title="${escapeHtml(title)}">
            <strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}
        </span>
    `;
}

function buildAttendanceOccurrenceKey(sessionId, attendanceDate) {
    return `${String(sessionId || '').trim()}__${String(attendanceDate || '').trim()}`;
}

function syncAttendanceWindowInputs(session) {
    const panel = document.getElementById('attendanceWindowPanel');
    const startInput = document.getElementById('attendanceClassStartTime');
    const endInput = document.getElementById('attendanceClassEndTime');
    const saveButton = document.getElementById('saveAttendanceWindowButton');
    const resetButton = document.getElementById('resetAttendanceWindowButton');
    if (!panel || !startInput || !endInput || !saveButton || !resetButton) {
        return;
    }

    const hasSession = Boolean(session?.sessionId && session?.attendanceDate);
    panel.classList.toggle('hidden', !hasSession);

    if (!hasSession) {
        startInput.value = '';
        endInput.value = '';
        saveButton.disabled = true;
        resetButton.disabled = true;
        return;
    }

    startInput.value = session.classStartTime || '';
    endInput.value = session.classEndTime || '';
    saveButton.disabled = false;
    resetButton.disabled = !session.windowOverrideApplied;
}

function setAttendanceWindowBusy(isBusy) {
    const saveButton = document.getElementById('saveAttendanceWindowButton');
    const resetButton = document.getElementById('resetAttendanceWindowButton');
    if (!isBusy) {
        syncAttendanceWindowInputs(attendanceInsightsState.selectedSession || null);
        return;
    }
    if (saveButton) {
        saveButton.disabled = isBusy;
    }
    if (resetButton) {
        resetButton.disabled = isBusy;
    }
}

function isAllowedPosterFile(file) {
    if (!file) {
        return false;
    }

    const fileName = String(file.name || '').toLowerCase();
    return ['image/png', 'image/jpeg', 'image/jpg'].includes(file.type) || /\.(png|jpe?g)$/i.test(fileName);
}

function setPosterPreview(dataUrl) {
    const preview = document.getElementById('sessionPosterPreview');
    const image = document.getElementById('sessionPosterPreviewImage');
    const hiddenInput = document.getElementById('sessionPosterDataUrl');

    if (!preview || !image || !hiddenInput) {
        return;
    }

    hiddenInput.value = dataUrl || '';

    if (!dataUrl) {
        preview.classList.add('hidden');
        image.removeAttribute('src');
        return;
    }

    image.src = dataUrl;
    preview.classList.remove('hidden');
}

function clearSessionPosterSelection() {
    const fileInput = document.getElementById('sessionPosterFile');
    if (fileInput) {
        fileInput.value = '';
    }

    setPosterPreview('');
}

function handleSessionPosterChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
        clearSessionPosterSelection();
        return;
    }

    if (!isAllowedPosterFile(file)) {
        showToast('Poster must be in PNG, JPEG, or JPG format', 'error');
        clearSessionPosterSelection();
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        if (!result.startsWith('data:image/')) {
            showToast('Failed to read poster image', 'error');
            clearSessionPosterSelection();
            return;
        }

        setPosterPreview(result);
    };
    reader.onerror = () => {
        showToast('Failed to read poster image', 'error');
        clearSessionPosterSelection();
    };
    reader.readAsDataURL(file);
}

function formatDateTimeLocalInput(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formatSessionDateTime(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }

    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function createSessionAutomationWindowRow(window = {}, index = 0) {
    const row = document.createElement('div');
    row.className = 'session-automation-row';
    row.dataset.automationWindowRow = '';

    const startId = index === 0 ? 'sessionScheduledStartAt' : `sessionScheduledStartAt${index}`;
    const durationId = index === 0 ? 'sessionActivationDurationMinutes' : `sessionActivationDurationMinutes${index}`;

    row.innerHTML = `
        <div class="form-group">
            <label class="form-label" for="${startId}">Start Date & Time *</label>
            <input
                type="datetime-local"
                id="${startId}"
                class="form-input session-automation-start"
                value="${escapeHtml(formatDateTimeLocalInput(window.scheduledStartAt || window.startAt))}"
            >
        </div>

        <div class="form-group">
            <label class="form-label" for="${durationId}">Active Duration (Minutes) *</label>
            <input
                type="number"
                id="${durationId}"
                class="form-input session-automation-duration"
                min="1"
                max="1440"
                step="1"
                placeholder="e.g., 90"
                value="${escapeHtml(window.activationDurationMinutes || window.durationMinutes || '')}"
            >
        </div>

        ${index > 0 ? `
            <button type="button" class="btn-icon session-automation-remove" title="Remove schedule" aria-label="Remove schedule">
                &times;
            </button>
        ` : ''}
    `;

    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updateSessionAutomationPreview);
    });

    const removeButton = row.querySelector('.session-automation-remove');
    if (removeButton) {
        removeButton.addEventListener('click', () => {
            row.remove();
            refreshSessionAutomationRows();
            updateSessionAutomationPreview();
        });
    }

    return row;
}

function refreshSessionAutomationRows() {
    const rows = Array.from(document.querySelectorAll('[data-automation-window-row]'));
    rows.forEach((row, index) => {
        const startInput = row.querySelector('.session-automation-start');
        const durationInput = row.querySelector('.session-automation-duration');
        const removeButton = row.querySelector('.session-automation-remove');

        if (startInput) {
            startInput.id = index === 0 ? 'sessionScheduledStartAt' : `sessionScheduledStartAt${index}`;
            startInput.disabled = !document.getElementById('sessionAutomationEnabled')?.checked;
            const label = startInput.closest('.form-group')?.querySelector('.form-label');
            if (label) label.setAttribute('for', startInput.id);
        }

        if (durationInput) {
            durationInput.id = index === 0 ? 'sessionActivationDurationMinutes' : `sessionActivationDurationMinutes${index}`;
            durationInput.disabled = !document.getElementById('sessionAutomationEnabled')?.checked;
            const label = durationInput.closest('.form-group')?.querySelector('.form-label');
            if (label) label.setAttribute('for', durationInput.id);
        }

        if (index === 0 && removeButton) {
            removeButton.remove();
        }
    });
}

function setSessionAutomationWindows(windows = []) {
    const container = document.getElementById('sessionAutomationWindows');
    if (!container) {
        return;
    }

    const normalizedWindows = windows.length > 0 ? windows : [{}];
    container.innerHTML = '';
    normalizedWindows.forEach((window, index) => {
        container.appendChild(createSessionAutomationWindowRow(window, index));
    });
    refreshSessionAutomationRows();
    updateSessionAutomationPreview();
}

function getSessionAutomationWindows() {
    return Array.from(document.querySelectorAll('[data-automation-window-row]')).map(row => {
        const startValue = row.querySelector('.session-automation-start')?.value || '';
        const durationValue = row.querySelector('.session-automation-duration')?.value || '';

        return {
            scheduledStartAtLocal: startValue,
            activationDurationMinutesValue: durationValue,
            activationDurationMinutes: Number(durationValue)
        };
    });
}

function getExistingSessionAutomationWindows(session = {}) {
    if (Array.isArray(session.automationWindows) && session.automationWindows.length > 0) {
        return session.automationWindows.map(window => ({
            scheduledStartAt: window.scheduledStartAt,
            activationDurationMinutes: window.activationDurationMinutes
        }));
    }

    if (session.scheduledStartAt || session.activationDurationMinutes) {
        return [{
            scheduledStartAt: session.scheduledStartAt,
            activationDurationMinutes: session.activationDurationMinutes
        }];
    }

    return [{}];
}

function addSessionAutomationWindow() {
    const container = document.getElementById('sessionAutomationWindows');
    if (!container) {
        return;
    }

    const row = createSessionAutomationWindowRow({}, container.querySelectorAll('[data-automation-window-row]').length);
    container.appendChild(row);
    refreshSessionAutomationRows();
    row.querySelector('.session-automation-start')?.focus();
    updateSessionAutomationPreview();
}

function updateSessionAutomationPreview() {
    const preview = document.getElementById('sessionAutomationPreview');
    const enabled = document.getElementById('sessionAutomationEnabled')?.checked;
    const windows = getSessionAutomationWindows();

    if (!preview) {
        return;
    }

    if (!enabled) {
        preview.textContent = 'Set a start time and duration to preview the automatic activation window.';
        return;
    }

    if (windows.some(window => !window.scheduledStartAtLocal || !Number.isFinite(window.activationDurationMinutes) || window.activationDurationMinutes <= 0)) {
        preview.textContent = 'Choose a valid start time and duration to schedule the automatic join window.';
        return;
    }

    const parsedWindows = windows.map(window => ({
        startAt: new Date(window.scheduledStartAtLocal),
        durationMinutes: window.activationDurationMinutes
    }));

    if (parsedWindows.some(window => Number.isNaN(window.startAt.getTime()))) {
        preview.textContent = 'Choose a valid start time and duration to schedule the automatic join window.';
        return;
    }

    const firstWindow = parsedWindows[0];
    const firstEndAt = new Date(firstWindow.startAt.getTime() + (firstWindow.durationMinutes * 60000));
    const suffix = parsedWindows.length > 1 ? ` plus ${parsedWindows.length - 1} more schedule${parsedWindows.length > 2 ? 's' : ''}` : '';
    preview.textContent = `Students can join automatically from ${formatSessionDateTime(firstWindow.startAt)} until ${formatSessionDateTime(firstEndAt)}${suffix}.`;
}

function setSessionAutomationState(isEnabled) {
    const fields = document.getElementById('sessionAutomationFields');
    const inputs = document.querySelectorAll('.session-automation-start, .session-automation-duration');
    const addButton = document.getElementById('addSessionAutomationWindow');

    if (fields) {
        fields.classList.toggle('hidden', !isEnabled);
    }

    inputs.forEach(input => {
        input.disabled = !isEnabled;
    });

    if (addButton) {
        addButton.disabled = !isEnabled;
    }

    updateSessionAutomationPreview();
}

function handleSessionAutomationToggle() {
    const isEnabled = document.getElementById('sessionAutomationEnabled')?.checked;
    setSessionAutomationState(Boolean(isEnabled));
}

function formatSessionAutomationSummary(session) {
    if (!session?.automationEnabled) {
        return 'Manual control';
    }

    const startLabel = formatSessionDateTime(session.scheduledStartAt);
    const endLabel = formatSessionDateTime(session.scheduledEndAt);
    const durationLabel = Number(session.activationDurationMinutes || 0);

    if (!startLabel || !endLabel || durationLabel <= 0) {
        return 'Scheduled automation configured';
    }

    return `Auto window: ${startLabel} to ${endLabel} (${durationLabel} min)`;
}

// ====================================
// INITIALIZATION
// ====================================

document.addEventListener('DOMContentLoaded', async () => {
    initializeDashboardChrome();

    if (attendanceDemoMode) {
        authToken = 'attendance-demo-token';
        availableCourses = Array.from(new Set(attendanceDemoData.sessionSummaries.map(session => session.course).filter(Boolean)));
        availableBatches = Array.from(new Set(attendanceDemoData.roster.map(student => student.batch).filter(Boolean)));
        allSessions = attendanceDemoData.sessionSummaries.map(session => ({
            sessionId: session.sessionId,
            title: session.sessionName,
            batch: session.batch
        }));
        updateAdminIdentity('Attendance Demo');
        setupEventListeners();
        syncPageHeader();
        populateAttendanceFilterOptions();
        populateSessionBatchOptions();
        loadAttendanceInsights();
        loadAttendanceRoster();
        return;
    }

    const isAuthenticated = await checkAuth();
    if (!isAuthenticated) {
        return;
    }

    restorePendingToast();
    setupEventListeners();
    syncPageHeader();
    loadCourses(); // Load courses for the form
    loadClassAccessRules();
    loadSessions();
    loadSessionLogs();
    loadGuestIds(); // Load guest IDs
    loadMentorIds(); // Load mentor IDs
    loadMockInterviewIds(); // Load mock interview IDs
    loadStudents(1); // Load students (page 1)
    loadStudentBatches(); // Load student batches for selection dropdowns
    loadStudentYears(); // Load student years for filter dropdown
    loadIssues(); // Load issue reports
    loadAttendanceInsights();
    loadAttendanceRoster();
    setInterval(loadSessions, 30000); // Refresh sessions every 30 seconds
    setInterval(loadClassAccessRules, 30000); // Refresh access rules every 30 seconds
    setInterval(loadGuestIds, 30000); // Refresh guest IDs every 30 seconds
    setInterval(loadMentorIds, 30000); // Refresh mentor IDs every 30 seconds
    setInterval(loadMockInterviewIds, 30000); // Refresh mock interview IDs every 30 seconds
    setInterval(() => loadStudents(studentPageMeta.page), 30000); // Refresh current students page every 30 seconds
    setInterval(loadIssues, 30000); // Refresh issues every 30 seconds
    setInterval(loadAttendanceInsights, 30000); // Refresh attendance insights every 30 seconds
    setInterval(loadAttendanceRoster, 30000); // Refresh attendance roster every 30 seconds
});

/**
 * Check if user is authenticated
 */
async function checkAuth() {
    authToken = localStorage.getItem('adminToken');
    if (!authToken) {
        window.location.href = '/admin/login';
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/validate`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            logout();
            return false;
        }

        const data = await response.json();
        const username = data?.admin?.username || localStorage.getItem('adminUsername');
        if (username) {
            localStorage.setItem('adminUsername', username);
        }
        updateAdminIdentity(username || 'Admin');
        return true;
    } catch (error) {
        console.error('Error validating admin session:', error);
        logout();
        return false;
    }
}

function initializeDashboardChrome() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(savedTheme);
    updateAdminIdentity(localStorage.getItem('adminUsername') || 'Admin');
}

function updateAdminIdentity(username) {
    const adminUsername = document.getElementById('adminUsername');
    if (adminUsername) {
        adminUsername.textContent = username;
    }

    const roleBadge = document.getElementById('adminRoleBadge');
    if (roleBadge) {
        roleBadge.textContent = username === 'Attendance Demo' ? 'DEMO' : 'ADMIN';
    }
}

function applyTheme(theme) {
    const nextTheme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    syncThemeControls(nextTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

function syncThemeControls(theme = document.documentElement.getAttribute('data-theme')) {
    const themeToggle = document.getElementById('themeToggle');
    const themeLabel = document.getElementById('themeLabel');
    if (!themeToggle || !themeLabel) {
        return;
    }

    const isDark = theme === 'dark';
    themeToggle.dataset.theme = theme;
    themeLabel.textContent = isDark ? 'Dark' : 'Light';
}

function setUtilityMenuOpen(isOpen) {
    const menu = document.getElementById('utilityMenu');
    const button = document.getElementById('utilityMenuButton');
    if (!menu || !button) {
        return;
    }

    menu.hidden = !isOpen;
    button.setAttribute('aria-expanded', String(isOpen));
}

function setSidebarOpen(isOpen) {
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('appBackdrop');
    const navToggle = document.getElementById('navToggle');
    if (!sidebar || !backdrop || !navToggle) {
        return;
    }

    sidebar.classList.toggle('open', isOpen);
    backdrop.classList.toggle('visible', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('nav-open', isOpen);
}

function syncPageHeader() {
    const activeTab = document.querySelector('.tab-content.active');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    if (!activeTab || !pageTitle || !pageSubtitle) {
        return;
    }

    const title = activeTab.dataset.pageTitle || activeTab.querySelector('.section-title')?.textContent?.trim() || 'Admin Dashboard';
    const subtitle = activeTab.dataset.pageSubtitle || activeTab.querySelector('.section-subtitle')?.textContent?.trim() || 'Manage classroom operations and review activity.';
    pageTitle.textContent = title;
    pageSubtitle.textContent = subtitle;
}

function restorePendingToast() {
    const pendingToast = sessionStorage.getItem('adminPendingToast');
    if (!pendingToast) {
        return;
    }

    sessionStorage.removeItem('adminPendingToast');

    try {
        const { message, type } = JSON.parse(pendingToast);
        if (message) {
            showToast(message, type || 'success');
        }
    } catch (error) {
        console.warn('Unable to restore pending toast:', error);
    }
}

function triggerFullSiteRefresh(message, type = 'success') {
    sessionStorage.setItem('adminPendingToast', JSON.stringify({ message, type }));
    window.location.reload();
}

/**
 * Load available courses
 */
async function loadCourses() {
    try {
        const response = await fetch(`${API_BASE_URL}/courses`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (data.success) {
            allCourses = Array.isArray(data.courses) ? data.courses : [];
            availableCourses = Array.isArray(data.courseNames)
                ? data.courseNames
                : allCourses.map(course => course.courseName).filter(Boolean);
            availableClassNames = Array.isArray(data.classNames) ? data.classNames : [];
            renderCourseManagement();
            renderCoursesCheckboxes();
            populateSessionClassOptions();
            renderStudentCoursesCheckboxes();
            populateStudentCourseFilter();
            populateAttendanceFilterOptions();
        }
    } catch (error) {
        console.error('Error loading courses:', error);
    }
}

/**
 * Render course checkboxes in the form
 */
function renderCoursesCheckboxes(selectedCourses = []) {
    const container = document.getElementById('coursesContainer');
    
    if (availableCourses.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 12px;">No courses available</p>';
        return;
    }

    const checkboxesHtml = availableCourses.map(course => `
        <label class="course-checkbox">
            <input 
                type="checkbox" 
                name="course" 
                value="${escapeHtml(course)}"
                ${selectedCourses.includes(course) ? 'checked' : ''}
            >
            <span>${escapeHtml(course)}</span>
        </label>
    `).join('');

    container.innerHTML = `<div style="display: flex; flex-direction: column; gap: 8px;">${checkboxesHtml}</div>`;
}

/**
 * Get selected courses from checkboxes
 */
function getSelectedCourses() {
    const checkboxes = document.querySelectorAll('input[name="course"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

function populateSessionClassOptions() {
    const select = document.getElementById('sessionClassName');
    if (!select) {
        return;
    }

    const currentValue = select.value;
    select.innerHTML = '<option value="">Select a class</option>';
    availableClassNames.forEach(className => {
        const option = document.createElement('option');
        option.value = className;
        option.textContent = className;
        select.appendChild(option);
    });
    select.value = currentValue;
}

function renderStudentCoursesCheckboxes(selectedCourses = []) {
    const container = document.getElementById('studentCoursesContainer');
    if (!container) {
        return;
    }

    if (availableCourses.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 12px;">No courses available</p>';
        return;
    }

    const selectedList = Array.isArray(selectedCourses)
        ? selectedCourses
        : (typeof selectedCourses === 'string' ? selectedCourses.split(',').map(c => c.trim()).filter(Boolean) : []);

    const checkboxesHtml = availableCourses.map(course => `
        <label class="course-checkbox" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer;">
            <input 
                type="checkbox" 
                name="studentCourse" 
                value="${escapeHtml(course)}"
                ${selectedList.includes(course) ? 'checked' : ''}
                style="cursor: pointer;"
            >
            <span>${escapeHtml(course)}</span>
        </label>
    `).join('');

    container.innerHTML = `<div class="selection-list" style="display: flex; flex-direction: column; gap: 4px; padding: 8px; max-height: 180px; overflow-y: auto; border: 1px solid var(--border-color, #ccc); border-radius: 4px; background-color: var(--surface-muted, #f8f9fa);">${checkboxesHtml}</div>`;
}

function getSelectedStudentBatches() {
    return Array.from(studentBatchSelection);
}

function toggleStudentBatchSelection(input) {
    const value = input?.value?.trim();
    if (!value) {
        return;
    }

    if (input.checked) {
        studentBatchSelection.add(value);
    } else {
        studentBatchSelection.delete(value);
    }
}

function selectCustomStudentBatch(value) {
    const batch = String(value || '').trim();
    if (!batch) {
        return false;
    }

    const existingBatch = availableBatches.find(item => item.toLowerCase() === batch.toLowerCase());
    const selectedBatch = existingBatch || batch;

    if (!existingBatch) {
        availableBatches = [...availableBatches, selectedBatch].sort((left, right) => left.localeCompare(right));
    }

    studentBatchSelection.add(selectedBatch);
    return true;
}

function addCustomStudentBatch(value = null) {
    const searchInput = document.getElementById('studentBatchSearch');
    const batchValue = value !== null ? value : searchInput?.value;
    const added = selectCustomStudentBatch(batchValue);

    if (added) {
        if (searchInput) {
            searchInput.value = '';
        }
        renderStudentBatchOptions();
    }
}

function addCustomStudentBatchFromInput() {
    const customInput = document.getElementById('studentCustomBatch');
    const value = customInput?.value?.trim();
    if (!value) {
        showToast('Enter a batch name to add', 'error');
        return;
    }

    if (selectCustomStudentBatch(value)) {
        customInput.value = '';
        const searchInput = document.getElementById('studentBatchSearch');
        if (searchInput) {
            searchInput.value = '';
        }
        renderStudentBatchOptions();
        showToast('Custom batch added', 'success');
    }
}

function handleCustomStudentBatchKeydown(event) {
    if (event.key !== 'Enter') {
        return;
    }

    event.preventDefault();
    addCustomStudentBatchFromInput();
}

function renderStudentBatchOptions(selectedBatches = null) {
    const container = document.getElementById('studentBatchContainer');
    if (!container) {
        return;
    }

    const selectedSet = new Set(selectedBatches || getSelectedStudentBatches());
    studentBatchSelection = new Set(selectedSet);
    const searchTerm = (document.getElementById('studentBatchSearch')?.value || '').trim().toLowerCase();
    const batches = Array.from(new Set([...availableBatches, ...selectedSet]))
        .sort((left, right) => left.localeCompare(right))
        .filter(batch => !searchTerm || batch.toLowerCase().includes(searchTerm));

    const selectedMarkup = Array.from(selectedSet).length > 0
        ? `
            <div class="selected-batch-summary">
                ${Array.from(selectedSet).map(batch => `<span class="selected-batch-pill">${escapeHtml(batch)}</span>`).join('')}
            </div>
        `
        : '';

    if (batches.length === 0) {
        const pendingValue = (document.getElementById('studentBatchSearch')?.value || '').trim();
        container.innerHTML = pendingValue
            ? `
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${selectedMarkup}
                    <p style="color: #999; font-size: 12px;">No batches match your search.</p>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addCustomStudentBatch()">Add "${escapeHtml(pendingValue)}"</button>
                </div>
            `
            : `
                ${selectedMarkup}
                <p style="color: #999; font-size: 12px;">No batches match your search.</p>
            `;
        return;
    }

    const listMarkup = batches.map(batch => `
        <label class="course-checkbox">
            <input type="checkbox" value="${escapeHtml(batch)}" ${selectedSet.has(batch) ? 'checked' : ''} onchange="toggleStudentBatchSelection(this)">
            <span>${escapeHtml(batch)}</span>
        </label>
    `).join('');

    const pendingValue = (document.getElementById('studentBatchSearch')?.value || '').trim();
    const hasPendingCustomValue = pendingValue && !batches.some(batch => batch.toLowerCase() === pendingValue.toLowerCase());
    const addButtonMarkup = hasPendingCustomValue
        ? `<button type="button" class="btn btn-secondary btn-sm" onclick="addCustomStudentBatch()">Add "${escapeHtml(pendingValue)}"</button>`
        : '';

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
            ${selectedMarkup}
            ${addButtonMarkup}
            ${listMarkup}
        </div>
    `;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = item.dataset.tab;
            switchTab(tabName);
            setSidebarOpen(false);
        });
    });

    // ID tabs
    document.querySelectorAll('.id-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idTabName = btn.dataset.idTab;
            switchIdTab(idTabName);
        });
    });

    // Modal close on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                e.target.closest('.modal').classList.add('hidden');
            }
        });
    });

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            toggleTheme();
        });
    }

    const utilityMenuButton = document.getElementById('utilityMenuButton');
    if (utilityMenuButton) {
        utilityMenuButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const isOpen = utilityMenuButton.getAttribute('aria-expanded') === 'true';
            setUtilityMenuOpen(!isOpen);
        });
    }

    const utilityMenu = document.getElementById('utilityMenu');
    if (utilityMenu) {
        utilityMenu.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    const navToggle = document.getElementById('navToggle');
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
            setSidebarOpen(!isOpen);
        });
    }

    const appBackdrop = document.getElementById('appBackdrop');
    if (appBackdrop) {
        appBackdrop.addEventListener('click', () => {
            setSidebarOpen(false);
        });
    }

    const posterInput = document.getElementById('sessionPosterFile');
    if (posterInput) {
        posterInput.addEventListener('change', handleSessionPosterChange);
    }

    const automationToggle = document.getElementById('sessionAutomationEnabled');
    if (automationToggle) {
        automationToggle.addEventListener('change', handleSessionAutomationToggle);
    }

    const automationStartInput = document.getElementById('sessionScheduledStartAt');
    if (automationStartInput) {
        automationStartInput.addEventListener('input', updateSessionAutomationPreview);
    }

    const automationDurationInput = document.getElementById('sessionActivationDurationMinutes');
    if (automationDurationInput) {
        automationDurationInput.addEventListener('input', updateSessionAutomationPreview);
    }

    const addAutomationWindowButton = document.getElementById('addSessionAutomationWindow');
    if (addAutomationWindowButton) {
        addAutomationWindowButton.addEventListener('click', addSessionAutomationWindow);
    }

    setupClassAccessScrolling();
    setupAttendanceDetailScrolling();

    document.addEventListener('click', (event) => {
        const utilityMenu = document.getElementById('utilityMenu');
        const utilityMenuButton = document.getElementById('utilityMenuButton');
        if (!utilityMenu || !utilityMenuButton) {
            return;
        }

        if (utilityMenu.hidden) {
            return;
        }

        if (!utilityMenu.contains(event.target) && !utilityMenuButton.contains(event.target)) {
            setUtilityMenuOpen(false);
        }
    });

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setUtilityMenuOpen(false);
            setSidebarOpen(false);
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.add('hidden');
            });
        }
    });
}

function setupClassAccessScrolling() {
    const scrollRegion = document.getElementById('classAccessScrollRegion');

    if (!scrollRegion) {
        return;
    }

    const scrollByAmount = (direction) => {
        const amount = Math.max(220, Math.floor(scrollRegion.clientWidth * 0.6));
        scrollRegion.scrollBy({
            left: direction * amount,
            behavior: 'smooth'
        });
    };

    scrollRegion.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            scrollByAmount(-1);
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            scrollByAmount(1);
        }
    });
}

function setupAttendanceDetailScrolling() {
    const scrollRegion = document.getElementById('attendanceDetailScrollRegion');

    if (!scrollRegion) {
        return;
    }

    const scrollByAmount = (direction) => {
        const amount = Math.max(180, Math.floor(scrollRegion.clientWidth * 0.55));
        scrollRegion.scrollBy({
            left: direction * amount,
            behavior: 'smooth'
        });
    };

    scrollRegion.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            scrollByAmount(-1);
        }

        if (event.key === 'ArrowRight') {
            event.preventDefault();
            scrollByAmount(1);
        }

        if (event.key === 'Home') {
            event.preventDefault();
            scrollRegion.scrollTo({
                left: 0,
                behavior: 'smooth'
            });
        }

        if (event.key === 'End') {
            event.preventDefault();
            scrollRegion.scrollTo({
                left: scrollRegion.scrollWidth,
                behavior: 'smooth'
            });
        }
    });
}

/**
 * Switch between ID tabs (Guest/Mentor)
 */
function switchIdTab(tabName) {
    // Update button states
    document.querySelectorAll('.id-tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-id-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.id-tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// ====================================
// TAB NAVIGATION
// ====================================

/**
 * Switch between tabs
 */
function switchTab(tabName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    syncPageHeader();
    setUtilityMenuOpen(false);

    if (tabName === 'courses') {
        loadCourses();
    }

    if (tabName === 'class-access') {
        loadClassAccessRules();
    }

    if (tabName === 'session-logs') {
        loadSessionLogs(1);
    }
}

async function loadClassAccessRules() {
    try {
        const response = await fetch(`${API_BASE_URL}/class-access-rules`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load class access rules', 'error');
            return;
        }

        classAccessRules = Array.isArray(data.rules) ? data.rules : [];
        availableClassNames = Array.isArray(data.classNames) ? data.classNames : availableClassNames;
        renderClassAccessRules();
        populateSessionClassOptions();
    } catch (error) {
        console.error('Error loading class access rules:', error);
    }
}

function renderClassAccessRules() {
    const head = document.getElementById('classAccessHead');
    const body = document.getElementById('classAccessList');
    const meta = document.getElementById('classAccessMeta');
    if (!head || !body || !meta) {
        return;
    }

    const columns = Array.from(new Set(availableClassNames)).sort();
    head.innerHTML = `
        <tr>
            <th class="class-access-sticky class-access-sticky-left">Course</th>
            <th class="class-access-sticky class-access-sticky-left-2">Payment Status</th>
            ${columns.map(className => `
                <th class="class-access-rule-header" title="${escapeHtml(className)}">
                    <div class="class-access-header-cell">
                        <span>${escapeHtml(className)}</span>
                        <button type="button" class="class-access-remove-btn" onclick="removeClassColumn(decodeURIComponent('${encodeURIComponent(className)}'))" aria-label="Remove ${escapeHtml(className)}">Remove</button>
                    </div>
                </th>
            `).join('')}
        </tr>
    `;

    meta.textContent = `${classAccessRules.length} rule row(s) loaded. Scroll sideways to review all classes.`;

    if (classAccessRules.length === 0) {
        body.innerHTML = `
            <tr>
                <td colspan="${Math.max(columns.length + 2, 3)}" style="text-align: center; padding: 40px; color: #999;">No rules found yet.</td>
            </tr>
        `;
        return;
    }

    body.innerHTML = classAccessRules.map((rule, ruleIndex) => {
        const accessMap = rule.accessMap || {};

        return `
            <tr>
                <td class="class-access-sticky class-access-sticky-left class-access-label-cell">${escapeHtml(rule.course || '-')}</td>
                <td class="class-access-sticky class-access-sticky-left-2 class-access-label-cell">${escapeHtml(rule.paymentStatus || 'DEFAULT')}</td>
                ${columns.map((className) => {
                    const hasValue = Object.prototype.hasOwnProperty.call(accessMap, className);
                    const accessValue = accessMap[className];

                    return `
                        <td class="class-access-rule-cell">
                            <select class="form-input class-access-select" aria-label="${escapeHtml(rule.course || '')} ${escapeHtml(rule.paymentStatus || '')} ${escapeHtml(className)}" data-rule-index="${ruleIndex}" data-class-name="${escapeHtml(className)}">
                                <option value="unset" ${hasValue ? '' : 'selected'}>Not set</option>
                                <option value="false" ${hasValue && accessValue === false ? 'selected' : ''}>No</option>
                                <option value="true" ${hasValue && accessValue === true ? 'selected' : ''}>Yes</option>
                            </select>
                        </td>
                    `;
                }).join('')}
            </tr>
        `;
    }).join('');
}

function normalizeClassName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function addClassColumn() {
    const input = document.getElementById('newClassName');
    if (!input) {
        return;
    }

    const className = normalizeClassName(input.value);
    if (!className) {
        showToast('Enter a class name first', 'error');
        input.focus();
        return;
    }

    const exists = availableClassNames.some(existing => existing.toLowerCase() === className.toLowerCase());
    if (exists) {
        showToast('That class already exists in the table', 'warning');
        input.focus();
        input.select();
        return;
    }

    availableClassNames = [...availableClassNames, className].sort((left, right) => left.localeCompare(right));

    input.value = '';
    renderClassAccessRules();
    populateSessionClassOptions();
    saveClassAccessRules({
        successMessage: `Added ${className} to the access table`
    });
}

function removeClassColumn(className) {
    const normalizedClassName = normalizeClassName(className);
    if (!normalizedClassName) {
        return;
    }

    availableClassNames = availableClassNames.filter(existing => existing !== normalizedClassName);
    classAccessRules = classAccessRules.map(rule => {
        const nextAccessMap = { ...(rule.accessMap || {}) };
        delete nextAccessMap[normalizedClassName];
        return {
            ...rule,
            accessMap: nextAccessMap
        };
    });

    const sessionClassSelect = document.getElementById('sessionClassName');
    if (sessionClassSelect?.value === normalizedClassName) {
        sessionClassSelect.value = '';
    }

    renderClassAccessRules();
    populateSessionClassOptions();
    saveClassAccessRules({
        successMessage: `Removed ${normalizedClassName} from the access table`
    });
}

async function saveClassAccessRules(options = {}) {
    try {
        const payload = classAccessRules.map((rule, ruleIndex) => {
            const nextAccessMap = { ...(rule.accessMap || {}) };
            document.querySelectorAll(`[data-rule-index="${ruleIndex}"]`).forEach(input => {
                if (input.value === 'unset') {
                    delete nextAccessMap[input.dataset.className];
                    return;
                }

                nextAccessMap[input.dataset.className] = input.value === 'true';
            });

            return {
                course: rule.course,
                paymentStatus: rule.paymentStatus,
                accessMap: nextAccessMap
            };
        });

        const response = await fetch(`${API_BASE_URL}/class-access-rules`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                rules: payload,
                classNames: availableClassNames
            })
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to save class access rules');
        }

        showToast(options.successMessage || 'Class access rules updated successfully', 'success');
        await loadClassAccessRules();
    } catch (error) {
        console.error('Error saving class access rules:', error);
        showToast(error.message || 'Error saving class access rules', 'error');
    }
}

// ====================================
// SESSIONS MANAGEMENT
// ====================================

/**
 * Load all sessions
 */
async function loadSessions() {
    try {
        const response = await fetch(`${API_BASE_URL}/sessions`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load sessions', 'error');
            return;
        }

        allSessions = data.sessions;
        renderSessions();
        updateStats();
        populateAttendanceFilterOptions();
        populateSessionBatchOptions();

    } catch (error) {
        console.error('Error loading sessions:', error);
        showToast('Error loading sessions', 'error');
    }
}

/**
 * Render sessions in table
 */
function renderSessions() {
    const sessionsList = document.getElementById('sessionsList');

    if (allSessions.length === 0) {
        sessionsList.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No sessions yet. <a href="#" onclick="openCreateSessionModal(); return false;" style="color: #667eea;">Create one now</a></p>
                </td>
            </tr>
        `;
        return;
    }

    sessionsList.innerHTML = allSessions.map(session => {
        const assignedCourses = Array.isArray(session.courses) ? session.courses : [];
        const batches = getSessionBatches(session);
        const batchSummary = summarizeSessionAccessList(batches, 4);
        const courseSummary = summarizeSessionAccessList(assignedCourses, 3);
        const className = escapeHtml(session.className || '-');
        const batchSummaryText = escapeHtml(batchSummary.summary);
        const batchFullText = escapeHtml(batchSummary.fullText);
        const courseSummaryText = assignedCourses.length > 0
            ? escapeHtml(courseSummary.summary)
            : 'All Courses';
        const courseFullText = assignedCourses.length > 0
            ? escapeHtml(courseSummary.fullText)
            : 'All Courses';
        const automationSummary = escapeHtml(formatSessionAutomationSummary(session));

        return `
        <tr class="session-table-row">
            <td data-label="Title">${escapeHtml(session.title)}</td>
            <td data-label="Meeting ID">${renderCodeChip(session.meetingNumber)}</td>
            <td data-label="Class Access" class="session-access-cell">
                <div class="session-access-primary">${className}</div>
                <div class="session-access-meta">
                    <span class="session-access-line" title="${batchFullText}">
                        <strong>Batches:</strong> ${batchSummaryText}
                    </span>
                    <span class="session-access-line" title="${courseFullText}">
                        <strong>Courses:</strong> ${courseSummaryText}
                    </span>
                    <span class="session-access-line" title="${automationSummary}">
                        <strong>Window:</strong> ${automationSummary}
                    </span>
                </div>
            </td>
            <td data-label="Mentor">${escapeHtml(session.mentorName || '-')}</td>
            <td data-label="Status">
                <div class="session-status-stack">
                <button class="btn-toggle ${session.status}" onclick="toggleSessionStatus('${session._id}', '${session.status}')">
                    ${session.status === 'on' ? 'ON' : 'OFF'}
                </button>
                    <span class="session-automation-note">${automationSummary}</span>
                </div>
            </td>
            <td data-label="Created">${formatDate(session.createdAt)}</td>
            <td data-label="Actions">
                <div class="actions">
                    <button class="btn-action edit" onclick="openEditSessionModal('${session._id}')" title="Edit">Edit</button>
                    <button class="btn-action delete" onclick="openDeleteModal('${session._id}')" title="Delete">Delete</button>
                </div>
            </td>
        </tr>
    `;
    }).join('');
}

/**
 * Update statistics
 */
function updateStats() {
    const total = allSessions.length;
    const active = allSessions.filter(s => s.status === 'on').length;
    const inactive = allSessions.filter(s => s.status === 'off').length;

    document.getElementById('totalSessions').textContent = total;
    document.getElementById('activeSessions').textContent = active;
    document.getElementById('inactiveSessions').textContent = inactive;
}

/**
 * Open create session modal
 */
function openCreateSessionModal() {
    currentEditingSessionId = null;
    sessionBatchSelection = new Set();
    document.getElementById('sessionId').value = '';
    document.getElementById('sessionTitle').value = '';
    document.getElementById('meetingNumber').value = '';
    document.getElementById('passcode').value = '';
    document.getElementById('description').value = '';
    clearSessionPosterSelection();
    document.getElementById('mentorName').value = '';
    document.getElementById('sessionBatchSearch').value = '';
    renderSessionBatchOptions([]);
    populateSessionClassOptions();
    document.getElementById('sessionClassName').value = '';
    document.getElementById('sessionAutomationEnabled').checked = false;
    setSessionAutomationWindows([{}]);
    setSessionAutomationState(false);
    renderCoursesCheckboxes([]); // Clear course selection
    document.getElementById('modalTitle').textContent = 'Create Session';
    document.getElementById('saveButtonText').textContent = 'Create Session';
    document.getElementById('sessionModal').classList.remove('hidden');
    document.getElementById('sessionTitle').focus();
}

/**
 * Open edit session modal
 */
async function openEditSessionModal(sessionId) {
    currentEditingSessionId = sessionId;
    const session = allSessions.find(s => s._id === sessionId);

    if (!session) {
        showToast('Session not found', 'error');
        return;
    }

    document.getElementById('sessionId').value = session._id;
    document.getElementById('sessionTitle').value = session.title;
    document.getElementById('meetingNumber').value = session.meetingNumber;
    document.getElementById('passcode').value = session.passcode;
    document.getElementById('description').value = session.description || '';
    document.getElementById('sessionPosterFile').value = '';
    setPosterPreview(session.posterImage || '');
    document.getElementById('mentorName').value = session.mentorName || '';
    sessionBatchSelection = new Set(getSessionBatches(session));
    document.getElementById('sessionBatchSearch').value = '';
    renderSessionBatchOptions(getSessionBatches(session));
    populateSessionClassOptions();
    document.getElementById('sessionClassName').value = session.className || '';
    document.getElementById('sessionAutomationEnabled').checked = Boolean(session.automationEnabled);
    setSessionAutomationWindows(getExistingSessionAutomationWindows(session));
    setSessionAutomationState(Boolean(session.automationEnabled));
    renderCoursesCheckboxes(session.courses || []); // Pre-select session's courses
    document.getElementById('modalTitle').textContent = 'Edit Session';
    document.getElementById('saveButtonText').textContent = 'Save Changes';
    document.getElementById('sessionModal').classList.remove('hidden');
    document.getElementById('sessionTitle').focus();
}

/**
 * Close session modal
 */
function closeSessionModal() {
    document.getElementById('sessionModal').classList.add('hidden');
    currentEditingSessionId = null;
}

/**
 * Handle save session
 */
async function handleSaveSession(event) {
    event.preventDefault();

    const sessionId = document.getElementById('sessionId').value;
    const title = document.getElementById('sessionTitle').value.trim();
    const meetingNumberRaw = document.getElementById('meetingNumber').value.trim();
    const meetingNumber = meetingNumberRaw.replace(/\s+/g, '');
    const passcode = document.getElementById('passcode').value.trim();
    const description = document.getElementById('description').value.trim();
    const posterImage = document.getElementById('sessionPosterDataUrl').value.trim();
    const mentorName = document.getElementById('mentorName').value.trim();
    const className = document.getElementById('sessionClassName').value.trim();
    const batches = getSelectedSessionBatches();
    const courses = getSelectedCourses();
    const automationEnabled = document.getElementById('sessionAutomationEnabled').checked;
    const automationWindows = getSessionAutomationWindows();

    // Validation
    if (!title || !meetingNumber || !passcode || batches.length === 0 || !mentorName || !className || courses.length === 0) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    // Check meeting number format
    if (!/^\d+$/.test(meetingNumber)) {
        showToast('Meeting ID can include spaces, but it must contain only numbers', 'error');
        return;
    }

    if (automationEnabled) {
        for (const window of automationWindows) {
            const scheduledStartDate = new Date(window.scheduledStartAtLocal);
            if (!window.scheduledStartAtLocal || Number.isNaN(scheduledStartDate.getTime())) {
                showToast('Please choose a valid automation start date and time', 'error');
                return;
            }

            if (!Number.isInteger(window.activationDurationMinutes) || window.activationDurationMinutes < 1 || window.activationDurationMinutes > 1440) {
                showToast('Automation duration must be a whole number between 1 and 1440 minutes', 'error');
                return;
            }
        }
    }

    const normalizedAutomationWindows = automationEnabled
        ? automationWindows.map(window => ({
            scheduledStartAt: new Date(window.scheduledStartAtLocal).toISOString(),
            activationDurationMinutes: window.activationDurationMinutes
        }))
        : [];

    const primaryAutomationWindow = normalizedAutomationWindows[0] || null;

    const isCreate = !sessionId;
    const url = isCreate
        ? `${API_BASE_URL}/session`
        : `${API_BASE_URL}/session/${sessionId}`;

    const method = isCreate ? 'POST' : 'PUT';

    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                title,
                meetingNumber,
                passcode,
                description,
                posterImage,
                mentorName,
                className,
                batch: batches[0] || '',
                batches,
                courses,
                automationEnabled,
                automationWindows: normalizedAutomationWindows,
                scheduledStartAt: primaryAutomationWindow?.scheduledStartAt || null,
                activationDurationMinutes: primaryAutomationWindow?.activationDurationMinutes || null
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to save session');
        }

        showToast(
            isCreate ? 'Session created successfully' : 'Session updated successfully',
            'success'
        );

        closeSessionModal();
        loadSessions();

    } catch (error) {
        console.error('Error saving session:', error);
        showToast(error.message || 'Error saving session', 'error');
    }
}

/**
 * Toggle session status
 */
async function toggleSessionStatus(sessionId, currentStatus) {
    const newStatus = currentStatus === 'on' ? 'off' : 'on';

    try {
        const response = await fetch(`${API_BASE_URL}/session/${sessionId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to update status');
        }

        showToast(data.message || `Session status changed to ${newStatus.toUpperCase()}`, 'success');
        loadSessions();

    } catch (error) {
        console.error('Error toggling status:', error);
        showToast(error.message || 'Error updating status', 'error');
    }
}

/**
 * Open delete confirmation modal
 */
function openDeleteModal(sessionId) {
    deleteTargetSessionId = sessionId;
    document.getElementById('deleteModal').classList.remove('hidden');
}

/**
 * Close delete modal
 */
function closeDeleteModal() {
    document.getElementById('deleteModal').classList.add('hidden');
    deleteTargetSessionId = null;
}

/**
 * Confirm delete
 */
async function confirmDelete() {
    if (!deleteTargetSessionId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/session/${deleteTargetSessionId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to delete session');
        }

        showToast('Session deleted successfully', 'success');
        closeDeleteModal();
        loadSessions();

    } catch (error) {
        console.error('Error deleting session:', error);
        showToast(error.message || 'Error deleting session', 'error');
    }
}

// ====================================
// COURSE MANAGEMENT
// ====================================

function renderCourseManagement() {
    const coursesList = document.getElementById('coursesList');
    const totalCourses = document.getElementById('totalCourses');
    const activeCourses = document.getElementById('activeCourses');
    const inactiveCourses = document.getElementById('inactiveCourses');

    if (totalCourses) {
        totalCourses.textContent = allCourses.length;
    }

    if (activeCourses) {
        activeCourses.textContent = allCourses.filter(course => course.status === 'active').length;
    }

    if (inactiveCourses) {
        inactiveCourses.textContent = allCourses.filter(course => course.status === 'inactive').length;
    }

    if (!coursesList) {
        return;
    }

    const searchTerm = (document.getElementById('courseSearch')?.value || '').toLowerCase().trim();

    const filteredCourses = allCourses.filter(course => {
        if (!searchTerm) {
            return true;
        }

        const haystack = [course.courseName, course.description]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        return haystack.includes(searchTerm);
    });

    if (filteredCourses.length === 0) {
        coursesList.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No courses found. <a href="#" onclick="openCreateCourseModal(); return false;" style="color: #667eea;">Add one now</a></p>
                </td>
            </tr>
        `;
        return;
    }

    coursesList.innerHTML = filteredCourses.map(course => `
        <tr>
            <td><strong>${escapeHtml(course.courseName)}</strong></td>
            <td>${course.description ? escapeHtml(course.description) : '-'}</td>
            <td><span class="status-badge active">Active</span></td>
            <td>
                <div class="actions">
                    <button class="btn-action edit" onclick="openEditCourseModal('${course._id}')" title="Edit">Edit</button>
                    <button class="btn-action delete" onclick="openDeleteCourseModal('${course._id}')" title="Delete">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openCreateCourseModal() {
    currentEditingCourseId = null;
    document.getElementById('courseForm').reset();
    document.getElementById('courseId').value = '';
    document.getElementById('courseModalTitle').textContent = 'Add Course';
    document.getElementById('courseSubmitText').textContent = 'Save Course';
    document.getElementById('courseDeleteButton').style.display = 'none';
    document.getElementById('courseModal').classList.remove('hidden');
    document.getElementById('courseName').focus();
}

function openEditCourseModal(courseId) {
    const course = allCourses.find(item => item._id === courseId);
    if (!course) {
        showToast('Course not found', 'error');
        return;
    }

    currentEditingCourseId = courseId;
    document.getElementById('courseId').value = course._id;
    document.getElementById('courseName').value = course.courseName || '';
    document.getElementById('courseDescription').value = course.description || '';
    document.getElementById('courseModalTitle').textContent = 'Edit Course';
    document.getElementById('courseSubmitText').textContent = 'Update Course';
    document.getElementById('courseDeleteButton').style.display = 'inline-flex';
    document.getElementById('courseModal').classList.remove('hidden');
    document.getElementById('courseName').focus();
}

function closeCourseModal() {
    document.getElementById('courseModal').classList.add('hidden');
    currentEditingCourseId = null;
    document.getElementById('courseDeleteButton').style.display = 'none';
}

function filterAndSearchCourses() {
    renderCourseManagement();
}

function resetCourseFilters() {
    const searchInput = document.getElementById('courseSearch');
    if (searchInput) searchInput.value = '';
    renderCourseManagement();
}

async function handleSaveCourse(event) {
    event.preventDefault();

    const courseId = document.getElementById('courseId').value;
    const courseName = document.getElementById('courseName').value.trim();
    const description = document.getElementById('courseDescription').value.trim();

    if (!courseName) {
        showToast('Course Name is required', 'error');
        return;
    }

    const submitButton = document.getElementById('courseSubmitButton');
    const submitText = document.getElementById('courseSubmitText');
    const originalText = submitText.textContent;
    submitButton.disabled = true;
    submitText.textContent = 'Saving...';

    try {
        const isCreate = !courseId;
        const response = await fetch(isCreate ? `${API_BASE_URL}/courses` : `${API_BASE_URL}/courses/${courseId}`, {
            method: isCreate ? 'POST' : 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ courseName, description })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to save course');
        }

        if (isCreate) {
            triggerFullSiteRefresh('Course created successfully');
            return;
        }

        showToast('Course updated successfully', 'success');
        closeCourseModal();
        loadCourses();
    } catch (error) {
        console.error('Error saving course:', error);
        showToast(error.message || 'Error saving course', 'error');
    } finally {
        submitButton.disabled = false;
        submitText.textContent = originalText;
    }
}

function openDeleteCourseModal(courseId) {
    const course = allCourses.find(item => item._id === courseId);
    if (!course) {
        showToast('Course not found', 'error');
        return;
    }

    deleteTargetCourseId = courseId;
    document.getElementById('deleteCourseMessage').textContent = `Are you sure you want to delete ${course.courseName}? This action cannot be undone.`;
    document.getElementById('deleteCourseModal').classList.remove('hidden');
}

function closeDeleteCourseModal() {
    document.getElementById('deleteCourseModal').classList.add('hidden');
    deleteTargetCourseId = null;
}

async function confirmDeleteCourse() {
    if (!deleteTargetCourseId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/courses/${deleteTargetCourseId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to delete course');
        }

        closeDeleteCourseModal();
        triggerFullSiteRefresh('Course deleted successfully');
    } catch (error) {
        console.error('Error deleting course:', error);
        showToast(error.message || 'Error deleting course', 'error');
    }
}

// ====================================
// SESSION LOGS
// ====================================

function updateSessionLogSummary() {
    const summary = document.getElementById('sessionLogsSummary');
    if (!summary) return;

    const start = allSessionLogs.length === 0 ? 0 : ((sessionLogsMeta.page - 1) * sessionLogsMeta.limit) + 1;
    const end = allSessionLogs.length === 0 ? 0 : start + allSessionLogs.length - 1;
    summary.textContent = sessionLogsMeta.total === 0
        ? 'No session logs yet'
        : `Showing ${start}-${end} of ${sessionLogsMeta.total} logs`;
}

function renderSessionLogsPagination() {
    const container = document.getElementById('sessionLogsPagination');
    if (!container) return;

    const { page, totalPages } = sessionLogsMeta;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const windowSize = 2;
    const startPage = Math.max(page - windowSize, 1);
    const endPage = Math.min(page + windowSize, totalPages);
    const buttons = [];

    buttons.push(`<button class="pagination-btn" ${page === 1 ? 'disabled' : ''} onclick="loadSessionLogs(${page - 1})">Prev</button>`);

    for (let currentPage = startPage; currentPage <= endPage; currentPage += 1) {
        buttons.push(`<button class="pagination-btn ${currentPage === page ? 'active' : ''}" onclick="loadSessionLogs(${currentPage})">${currentPage}</button>`);
    }

    buttons.push(`<button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} onclick="loadSessionLogs(${page + 1})">Next</button>`);

    container.innerHTML = buttons.join('');
}

function renderSessionLogs() {
    const sessionLogsList = document.getElementById('sessionLogsList');
    if (!sessionLogsList) return;

    if (allSessionLogs.length === 0) {
        sessionLogsList.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No session logs found</p>
                </td>
            </tr>
        `;
        updateSessionLogSummary();
        renderSessionLogsPagination();
        return;
    }

    sessionLogsList.innerHTML = allSessionLogs.map(log => `
        <tr>
            <td><strong>${escapeHtml(log.sessionName)}</strong></td>
            <td>${escapeHtml(log.timestamp ? formatIndianSessionLogDate(log.timestamp) : log.date)}</td>
            <td>${escapeHtml(log.timestamp ? formatIndianSessionLogTime(log.timestamp) : log.time)}</td>
            <td>${escapeHtml(log.userName)}</td>
            <td>${escapeHtml(log.actionPerformed)}</td>
            <td><span class="status-badge ${escapeHtml(String(log.status || '').toLowerCase())}">${escapeHtml(log.status)}</span></td>
            <td>${log.remarks ? escapeHtml(log.remarks) : '-'}</td>
            <td>${formatDate(log.timestamp)}</td>
        </tr>
    `).join('');

    updateSessionLogSummary();
    renderSessionLogsPagination();
}

function applySessionLogFilters() {
    if (sessionLogsSearchTimer) {
        clearTimeout(sessionLogsSearchTimer);
    }

    sessionLogsSearchTimer = setTimeout(() => {
        loadSessionLogs(1);
    }, 250);
}

function resetSessionLogFilters() {
    const search = document.getElementById('sessionLogSearch');
    const status = document.getElementById('sessionLogStatusFilter');
    const action = document.getElementById('sessionLogActionFilter');
    const sortBy = document.getElementById('sessionLogSortBy');
    const sortOrder = document.getElementById('sessionLogSortOrder');
    const pageSize = document.getElementById('sessionLogPageSize');

    if (search) search.value = '';
    if (status) status.value = '';
    if (action) action.value = '';
    if (sortBy) sortBy.value = 'timestamp';
    if (sortOrder) sortOrder.value = 'desc';
    if (pageSize) pageSize.value = '10';

    sessionLogsQuery = {
        search: '',
        status: '',
        action: '',
        sortBy: 'timestamp',
        sortOrder: 'desc'
    };

    loadSessionLogs(1);
}

async function loadSessionLogs(page = 1) {
    const search = document.getElementById('sessionLogSearch')?.value.trim() || '';
    const status = document.getElementById('sessionLogStatusFilter')?.value || '';
    const action = document.getElementById('sessionLogActionFilter')?.value || '';
    const sortBy = document.getElementById('sessionLogSortBy')?.value || 'timestamp';
    const sortOrder = document.getElementById('sessionLogSortOrder')?.value || 'desc';
    const limit = parseInt(document.getElementById('sessionLogPageSize')?.value || '10', 10);

    sessionLogsQuery = { search, status, action, sortBy, sortOrder };

    const sessionLogsList = document.getElementById('sessionLogsList');
    if (sessionLogsList) {
        sessionLogsList.innerHTML = `
            <tr class="loading-row">
                <td colspan="8" style="text-align: center; padding: 40px;">
                    <div class="spinner"></div>
                    <p>Loading session logs...</p>
                </td>
            </tr>
        `;
    }

    try {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(limit),
            search,
            status,
            action,
            sortBy,
            sortOrder
        });

        const response = await fetch(`${API_BASE_URL}/session-logs?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load session logs', 'error');
            return;
        }

        allSessionLogs = data.logs || [];
        sessionLogsMeta = {
            page: data.page || page,
            limit: data.limit || limit,
            total: data.total || 0,
            totalPages: data.totalPages || 1
        };

        renderSessionLogs();
    } catch (error) {
        console.error('Error loading session logs:', error);
        showToast('Error loading session logs', 'error');
    }
}

async function clearSessionLogs() {
    if (!confirm('Are you sure you want to clear all session logs? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/session-logs`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Failed to clear session logs');
        }

        allSessionLogs = [];
        sessionLogsMeta = {
            page: 1,
            limit: parseInt(document.getElementById('sessionLogPageSize')?.value || '10', 10),
            total: 0,
            totalPages: 1
        };
        renderSessionLogs();
        showToast('Session logs cleared successfully', 'success');
    } catch (error) {
        console.error('Error clearing session logs:', error);
        showToast(error.message || 'Error clearing session logs', 'error');
    }
}

// ====================================
// EXPORT DATABASE
// ====================================

function openExportDatabaseModal(scope = 'all') {
    currentExportScope = scope;
    currentExportFormat = document.getElementById('exportFormat')?.value || 'json';
    const title = document.getElementById('exportModalTitle');
    const description = document.getElementById('exportModalDescription');

    if (scope === 'students') {
        if (title) title.textContent = 'Export Student Database';
        if (description) description.textContent = 'Choose an export format. The download will include student records only.';
    } else {
        if (title) title.textContent = 'Export Data';
        if (description) description.textContent = 'Choose an export format for this download.';
    }

    document.getElementById('exportDatabaseModal').classList.remove('hidden');
}

function closeExportDatabaseModal() {
    document.getElementById('exportDatabaseModal').classList.add('hidden');
}

async function confirmExportDatabase() {
    const exportButton = document.getElementById('exportConfirmButton');
    const exportText = document.getElementById('exportConfirmText');
    const originalText = exportText.textContent;
    const selectedFormat = document.getElementById('exportFormat').value;

    exportButton.disabled = true;
    exportText.textContent = 'Exporting...';

    try {
        const params = new URLSearchParams({
            format: selectedFormat,
            scope: currentExportScope
        });

        const response = await fetch(`${API_BASE_URL}/export-database?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to export database');
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        const filenamePrefix = currentExportScope === 'students' ? 'dv-student-database-export' : 'dv-database-export';
        downloadLink.download = `${filenamePrefix}-${Date.now()}.${selectedFormat === 'excel' ? 'xlsx' : selectedFormat}`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.URL.revokeObjectURL(downloadUrl);

        const label = currentExportScope === 'students' ? 'Student database' : 'Database';
        showToast(`${label} exported successfully as ${selectedFormat.toUpperCase()}`, 'success');
        closeExportDatabaseModal();
    } catch (error) {
        console.error('Error exporting database:', error);
        showToast(error.message || 'Error exporting database', 'error');
    } finally {
        exportButton.disabled = false;
        exportText.textContent = originalText;
    }
}

// ====================================
// ACTIVE SESSIONS
// ====================================
// Students/active-sessions functionality removed from admin dashboard

// ====================================
// GUEST/MENTOR ID MANAGEMENT
// ====================================

let allGuestIds = [];
let allMentorIds = [];
let allMockInterviewIds = [];
let revokeTargetType = null;
let revokeTargetId = null;

/**
 * Refresh all ID management data
 */
function refreshIdManagement() {
    loadGuestIds();
    loadMentorIds();
    loadMockInterviewIds();
    showToast('ID data refreshed', 'success');
}

/**
 * Load all guest IDs
 */
async function loadGuestIds() {
    try {
        const response = await fetch(`${API_BASE_URL}/guest-ids`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load guest IDs', 'error');
            return;
        }

        allGuestIds = data.ids;
        renderGuestIds();
        updateGuestStats(data);

    } catch (error) {
        console.error('Error loading guest IDs:', error);
        showToast('Error loading guest IDs', 'error');
    }
}

/**
 * Load all mentor IDs
 */
async function loadMentorIds() {
    try {
        const response = await fetch(`${API_BASE_URL}/mentor-ids`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load mentor IDs', 'error');
            return;
        }

        allMentorIds = data.ids;
        renderMentorIds();
        updateMentorStats(data);

    } catch (error) {
        console.error('Error loading mentor IDs:', error);
        showToast('Error loading mentor IDs', 'error');
    }
}

/**
 * Render guest IDs in table
 */
function renderGuestIds() {
    const guestIdsList = document.getElementById('guestIdsList');

    if (allGuestIds.length === 0) {
        guestIdsList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No guest IDs found</p>
                </td>
            </tr>
        `;
        return;
    }

    guestIdsList.innerHTML = allGuestIds.map(id => `
        <tr>
            <td>${renderCodeChip(id.id)}</td>
            <td>
                <span class="status-badge ${id.status.toLowerCase()}">
                    ${id.status}
                </span>
            </td>
            <td>${id.assignedName ? escapeHtml(id.assignedName) : '-'}</td>
            <td>${id.phoneNumber ? escapeHtml(id.phoneNumber) : '-'}</td>
            <td>${id.course ? escapeHtml(id.course) : '-'}</td>
            <td>
                <div class="actions">
                    ${id.status === 'Active' ? `
                        <button class="btn-action delete" onclick="openRevokeIdModal('guest', '${id.id}')" title="Revoke">Revoke</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Render mentor IDs in table
 */
function renderMentorIds() {
    const mentorIdsList = document.getElementById('mentorIdsList');

    if (allMentorIds.length === 0) {
        mentorIdsList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No mentor IDs found</p>
                </td>
            </tr>
        `;
        return;
    }

    mentorIdsList.innerHTML = allMentorIds.map(id => `
        <tr>
            <td>${renderCodeChip(id.id)}</td>
            <td>
                <span class="status-badge ${id.status.toLowerCase()}">
                    ${id.status}
                </span>
            </td>
            <td>${id.assignedName ? escapeHtml(id.assignedName) : '-'}</td>
            <td>${id.phoneNumber ? escapeHtml(id.phoneNumber) : '-'}</td>
            <td>${id.course ? escapeHtml(id.course) : '-'}</td>
            <td>
                <div class="actions">
                    ${id.status === 'Active' ? `
                        <button class="btn-action delete" onclick="openRevokeIdModal('mentor', '${id.id}')" title="Revoke">Revoke</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update guest ID statistics
 */
function updateGuestStats(data) {
    document.getElementById('guestTotal').textContent = data.total;
    document.getElementById('guestAvailable').textContent = data.available;
    document.getElementById('guestActive').textContent = data.active;
}

/**
 * Update mentor ID statistics
 */
function updateMentorStats(data) {
    document.getElementById('mentorTotal').textContent = data.total;
    document.getElementById('mentorAvailable').textContent = data.available;
    document.getElementById('mentorActive').textContent = data.active;
}

/**
 * Load all mock interview IDs
 */
async function loadMockInterviewIds() {
    try {
        const response = await fetch(`${API_BASE_URL}/mock-interview-ids`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load mock interview IDs', 'error');
            return;
        }

        allMockInterviewIds = data.ids;
        renderMockInterviewIds();
        updateMockInterviewStats(data);

    } catch (error) {
        console.error('Error loading mock interview IDs:', error);
        showToast('Error loading mock interview IDs', 'error');
    }
}

/**
 * Render mock interview IDs in table
 */
function renderMockInterviewIds() {
    const mockInterviewIdsList = document.getElementById('mockInterviewIdsList');

    if (allMockInterviewIds.length === 0) {
        mockInterviewIdsList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No mock interview IDs found</p>
                </td>
            </tr>
        `;
        return;
    }

    mockInterviewIdsList.innerHTML = allMockInterviewIds.map(id => `
        <tr>
            <td>${renderCodeChip(id.id)}</td>
            <td>
                <span class="status-badge ${id.status.toLowerCase()}">
                    ${id.status}
                </span>
            </td>
            <td>${id.assignedName ? escapeHtml(id.assignedName) : '-'}</td>
            <td>${id.phoneNumber ? escapeHtml(id.phoneNumber) : '-'}</td>
            <td>${id.course ? escapeHtml(id.course) : '-'}</td>
            <td>
                <div class="actions">
                    ${id.status === 'Active' ? `
                        <button class="btn-action delete" onclick="openRevokeIdModal('mock-interview', '${id.id}')" title="Revoke">Revoke</button>
                    ` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update mock interview ID statistics
 */
function updateMockInterviewStats(data) {
    document.getElementById('mockInterviewTotal').textContent = data.total;
    document.getElementById('mockInterviewAvailable').textContent = data.available;
    document.getElementById('mockInterviewActive').textContent = data.active;
}

/**
 * Open assign ID modal
 */
async function openAssignIdModal(type) {
    document.getElementById('assignIdForm').reset();
    
    // Format type name for display
    let typeDisplayName = type;
    if (type === 'mock-interview') {
        typeDisplayName = 'Mock Interview';
    } else {
        typeDisplayName = type.charAt(0).toUpperCase() + type.slice(1);
    }
    
    document.getElementById('assignIdModalTitle').textContent = `Assign ${typeDisplayName} ID`;

    // Populate available IDs dropdown
    let ids;
    if (type === 'guest') {
        ids = allGuestIds;
    } else if (type === 'mentor') {
        ids = allMentorIds;
    } else if (type === 'mock-interview') {
        ids = allMockInterviewIds;
    }
    
    const availableIds = ids.filter(id => id.status === 'Available');
    const selectElement = document.getElementById('assignIdSelect');
    
    selectElement.innerHTML = '<option value="">Select an available ID</option>';
    availableIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id.id;
        option.textContent = id.id;
        selectElement.appendChild(option);
    });

    if (availableIds.length === 0) {
        showToast(`No available ${typeDisplayName.toLowerCase()} IDs`, 'error');
        return;
    }

    // Populate courses dropdown
    const courseSelect = document.getElementById('assignCourse');
    courseSelect.innerHTML = '<option value="">Select a course</option>';
    availableCourses.forEach(course => {
        const option = document.createElement('option');
        option.value = course;
        option.textContent = course;
        courseSelect.appendChild(option);
    });

    // Store type for form submission
    document.getElementById('assignIdForm').dataset.idType = type;
    document.getElementById('assignIdModal').classList.remove('hidden');
}

/**
 * Close assign ID modal
 */
function closeAssignIdModal() {
    document.getElementById('assignIdModal').classList.add('hidden');
}

/**
 * Handle assign ID
 */
async function handleAssignId(event) {
    event.preventDefault();

    const type = document.getElementById('assignIdForm').dataset.idType;
    const idToAssign = document.getElementById('assignIdSelect').value;
    const name = document.getElementById('assignUserName').value.trim();
    const phoneNumber = document.getElementById('assignPhoneNumber').value.trim();
    const course = document.getElementById('assignCourse').value.trim();

    // Validation
    if (!idToAssign || !name || !phoneNumber || !course) {
        showToast('Please fill in all fields', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/assign-id`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                type,
                idToAssign,
                name,
                phoneNumber,
                course
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to assign ID');
        }

        showToast(`ID assigned successfully`, 'success');
        closeAssignIdModal();
        
        if (type === 'guest') {
            loadGuestIds();
        } else if (type === 'mentor') {
            loadMentorIds();
        } else if (type === 'mock-interview') {
            loadMockInterviewIds();
        }

    } catch (error) {
        console.error('Error assigning ID:', error);
        showToast(error.message || 'Error assigning ID', 'error');
    }
}

/**
 * Open revoke ID confirmation modal
 */
function openRevokeIdModal(type, idToRevoke) {
    revokeTargetType = type;
    revokeTargetId = idToRevoke;
    
    let ids;
    if (type === 'guest') {
        ids = allGuestIds;
    } else if (type === 'mentor') {
        ids = allMentorIds;
    } else if (type === 'mock-interview') {
        ids = allMockInterviewIds;
    }
    
    const id = ids.find(item => item.id === idToRevoke);
    
    if (id) {
        document.getElementById('revokeMessage').textContent = 
            `Are you sure you want to revoke ${id.id} assigned to ${id.assignedName}? This will clear all user data and reset the ID to available.`;
    }
    
    document.getElementById('revokeIdModal').classList.remove('hidden');
}

/**
 * Close revoke ID modal
 */
function closeRevokeIdModal() {
    document.getElementById('revokeIdModal').classList.add('hidden');
    revokeTargetType = null;
    revokeTargetId = null;
}

/**
 * Confirm revoke ID
 */
async function confirmRevoke() {
    if (!revokeTargetType || !revokeTargetId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/revoke-id`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                type: revokeTargetType,
                idToRevoke: revokeTargetId
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to revoke ID');
        }

        showToast('ID revoked successfully', 'success');
        closeRevokeIdModal();
        
        if (revokeTargetType === 'guest') {
            loadGuestIds();
        } else if (revokeTargetType === 'mentor') {
            loadMentorIds();
        } else if (revokeTargetType === 'mock-interview') {
            loadMockInterviewIds();
        }

    } catch (error) {
        console.error('Error revoking ID:', error);
        showToast(error.message || 'Error revoking ID', 'error');
    }
}

// ====================================
// STUDENT DATABASE MANAGEMENT
// ====================================

async function syncGoogleStudentSheet() {
    const syncButton = document.getElementById('syncGoogleSheetButton');
    const syncText = document.getElementById('syncGoogleSheetText');
    const originalText = syncText ? syncText.textContent : 'Sync Google Sheet';

    try {
        if (syncButton) syncButton.disabled = true;
        if (syncText) syncText.textContent = 'Syncing...';

        const response = await fetch(`${API_BASE_URL}/google-sheet-sync`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to sync Google Sheet');
        }

        const total = data.summary?.students?.total || 0;
        showToast(`Google Sheet synced: ${total} student(s) updated`, 'success');

        await Promise.all([
            loadCourses(),
            loadStudentBatches(),
            loadStudentYears(),
            loadStudents(studentPageMeta.page)
        ]);
    } catch (error) {
        console.error('Error syncing Google Sheet:', error);
        showToast(error.message || 'Error syncing Google Sheet', 'error');
    } finally {
        if (syncButton) syncButton.disabled = false;
        if (syncText) syncText.textContent = originalText;
    }
}

/**
 * Load students with pagination and filtering
 */
async function loadStudents(page = 1) {
    try {
        studentPageMeta.page = page;
        const searchVal = studentSearchQuery.search || '';
        const courseVal = studentSearchQuery.course || '';
        const batchVals = Array.isArray(studentSearchQuery.batches) ? studentSearchQuery.batches : [];
        const yearVal = studentSearchQuery.year || '';
        const paymentStatusVal = studentSearchQuery.paymentStatus || '';
        const feeStatusExceptionVal = studentSearchQuery.feeStatusException || '';

        const params = new URLSearchParams({
            page: String(page),
            limit: String(studentPageMeta.limit),
            search: searchVal,
            course: courseVal,
            year: yearVal,
            paymentStatus: paymentStatusVal,
            feeStatusException: feeStatusExceptionVal
        });

        if (batchVals.length > 0) {
            params.set('batches', batchVals.join(','));
        }

        const url = `${API_BASE_URL}/students?${params.toString()}`;
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load students', 'error');
            return;
        }

        allStudents = data.students || [];
        filteredStudents = [...allStudents];
        studentPageMeta.total = data.total || 0;
        studentPageMeta.totalPages = data.totalPages || 1;
        
        renderStudents();
        updateStudentStats();
        renderStudentsPagination();

    } catch (error) {
        console.error('Error loading students:', error);
        showToast('Error loading students', 'error');
    }
}

/**
 * Load student batches for selection dropdowns
 */
async function loadStudentBatches() {
    try {
        const response = await fetch(`${API_BASE_URL}/students/batches`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (data.success) {
            availableBatches = data.batches || [];
            populateStudentBatchFilter();
            populateAttendanceFilterOptions();
            populateSessionBatchOptions();
            renderStudentBatchOptions();
        }
    } catch (error) {
        console.error('Error loading student batches:', error);
    }
}

/**
 * Load student years for filter dropdown
 */
async function loadStudentYears() {
    try {
        const response = await fetch(`${API_BASE_URL}/students/years`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (data.success) {
            availableStudentYears = data.years || [];
            populateStudentYearFilter();
        }
    } catch (error) {
        console.error('Error loading student years:', error);
    }
}

/**
 * Render pagination controls for the student database table
 */
function renderStudentsPagination() {
    const container = document.getElementById('studentsPagination');
    if (!container) return;

    if (studentPageMeta.totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    
    // Prev Button
    if (studentPageMeta.page > 1) {
        html += `<button class="pagination-btn" onclick="loadStudents(${studentPageMeta.page - 1})">Previous</button>`;
    } else {
        html += `<button class="pagination-btn" disabled>Previous</button>`;
    }

    // Page buttons
    const startPage = Math.max(1, studentPageMeta.page - 2);
    const endPage = Math.min(studentPageMeta.totalPages, studentPageMeta.page + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const activeClass = i === studentPageMeta.page ? 'active' : '';
        html += `<button class="pagination-btn ${activeClass}" onclick="loadStudents(${i})">${i}</button>`;
    }

    // Next Button
    if (studentPageMeta.page < studentPageMeta.totalPages) {
        html += `<button class="pagination-btn" onclick="loadStudents(${studentPageMeta.page + 1})">Next</button>`;
    } else {
        html += `<button class="pagination-btn" disabled>Next</button>`;
    }

    container.innerHTML = html;
}

/**
 * Load all reported issues
 */
async function loadIssues() {
    try {
        const status = document.getElementById('issueStatusFilter')?.value || 'all';
        const search = document.getElementById('issueSearch')?.value.trim() || '';
        const params = new URLSearchParams({
            status,
            search
        });
        const response = await fetch(`${API_BASE_URL}/issues?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showToast(data.message || 'Failed to load issues', 'error');
            return;
        }

        allIssues = data.issues || [];
        renderIssues();
        updateIssueStats();

    } catch (error) {
        console.error('Error loading issues:', error);
        showToast('Error loading issues', 'error');
    }
}

/**
 * Render issues in table
 */
function renderIssues() {
    const issuesList = document.getElementById('issuesList');

    if (allIssues.length === 0) {
        issuesList.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No issues reported yet</p>
                </td>
            </tr>
        `;
        return;
    }

    issuesList.innerHTML = allIssues.map(issue => `
        <tr>
            <td>${renderCodeChip(issue.lmsId)}</td>
            <td>${escapeHtml(issue.name)}</td>
            <td>${issue.phoneNumber ? escapeHtml(issue.phoneNumber) : '-'}</td>
            <td><div class="issue-description">${escapeHtml(issue.description)}</div></td>
            <td><span class="issue-status-badge ${escapeHtml(getIssueStatusClass(issue.status))}">${escapeHtml(formatIssueStatus(issue.status))}</span></td>
            <td>${formatDate(issue.createdAt)}</td>
            <td>
                <div class="actions">
                    ${buildIssueActionButtons(issue)}
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update issue statistics
 */
function updateIssueStats() {
    document.getElementById('totalIssues').textContent = allIssues.length;
    document.getElementById('openIssues').textContent = allIssues.filter(issue => {
        const status = String(issue?.status || 'open').trim().toLowerCase();
        return status === 'open' || status === 'in_progress';
    }).length;
    document.getElementById('resolvedIssues').textContent = allIssues.filter(issue => {
        const status = String(issue?.status || 'open').trim().toLowerCase();
        return status === 'resolved' || status === 'closed';
    }).length;
}

function handleIssueSearch() {
    window.clearTimeout(issueSearchTimer);
    issueSearchTimer = window.setTimeout(() => {
        loadIssues();
    }, 180);
}

function formatIssueStatus(status) {
    const normalizedStatus = String(status || 'open').trim().toLowerCase();
    if (normalizedStatus === 'in_progress') {
        return 'In Progress';
    }
    return normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);
}

function getIssueStatusClass(status) {
    const normalizedStatus = String(status || 'open').trim().toLowerCase();
    if (normalizedStatus === 'in_progress') {
        return 'issue-status-in-progress';
    }
    if (normalizedStatus === 'resolved') {
        return 'issue-status-resolved';
    }
    if (normalizedStatus === 'closed') {
        return 'issue-status-closed';
    }
    return 'issue-status-open';
}

function buildIssueActionButtons(issue) {
    const normalizedStatus = String(issue?.status || 'open').trim().toLowerCase();
    const actions = [];

    if (normalizedStatus === 'open') {
        actions.push(`<button class="btn-action progress" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'in_progress')">Start</button>`);
        actions.push(`<button class="btn-action success" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'resolved')">Resolve</button>`);
    } else if (normalizedStatus === 'in_progress') {
        actions.push(`<button class="btn-action edit" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'open')">Reopen</button>`);
        actions.push(`<button class="btn-action success" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'resolved')">Resolve</button>`);
    } else if (normalizedStatus === 'resolved') {
        actions.push(`<button class="btn-action edit" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'open')">Reopen</button>`);
        actions.push(`<button class="btn-action neutral" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'closed')">Close</button>`);
    } else {
        actions.push(`<button class="btn-action edit" onclick="updateIssueStatus('${escapeHtml(issue._id)}', 'open')">Reopen</button>`);
    }

    return actions.join('');
}

async function updateIssueStatus(issueId, status) {
    try {
        const response = await fetch(`${API_BASE_URL}/issues/${issueId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to update issue');
        }

        showToast(data.message || 'Issue updated successfully', 'success');
        await loadIssues();
    } catch (error) {
        console.error('Error updating issue:', error);
        showToast(error.message || 'Error updating issue', 'error');
    }
}

async function clearResolvedIssues() {
    const confirmed = confirm('Clear all resolved and closed issues? Open and in-progress tickets will be kept.');
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/issues/resolved`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to clear resolved issues');
        }

        showToast(data.message || 'Resolved issues cleared successfully', 'success');
        await loadIssues();
    } catch (error) {
        console.error('Error clearing resolved issues:', error);
        showToast(error.message || 'Error clearing resolved issues', 'error');
    }
}

/**
 * Render students in table
 */
function renderStudents() {
    const studentsList = document.getElementById('studentsList');

    if (filteredStudents.length === 0) {
        if (allStudents.length === 0) {
            studentsList.innerHTML = `
                <tr>
                        <td colspan="10" style="text-align: center; padding: 40px;">
                        <p style="color: #999;">No students found. <a href="#" onclick="openAddStudentModal(); return false;" style="color: #667eea;">Add one now</a></p>
                    </td>
                </tr>
            `;
        } else {
            studentsList.innerHTML = `
                <tr>
                        <td colspan="10" style="text-align: center; padding: 40px;">
                        <p style="color: #999;">No matching students found. Try adjusting your search or filters.</p>
                    </td>
                </tr>
            `;
        }
        return;
    }

    studentsList.innerHTML = filteredStudents.map(student => `
        <tr>
            <td>${renderCodeChip(student.lmsId)}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(student.mobile || '-')}</td>
            <td>${escapeHtml(student.emailId || '-')}</td>
            <td>${escapeHtml(formatStudentBatches(student))}</td>
            <td>${escapeHtml(student.year || '-')}</td>
            <td>${escapeHtml(Array.isArray(student.course) ? student.course.join(', ') : (student.course || '-'))}</td>
            <td>${escapeHtml(student.paymentStatus || 'DEFAULT')}</td>
            <td>${student.feeStatusException ? 'Yes' : 'No'}</td>
            <td>
                <div class="actions">
                    <button class="btn-action edit" onclick="openEditStudentModal('${escapeHtml(student.lmsId)}')" title="Edit">Edit</button>
                    <button class="btn-action delete" onclick="openDeleteStudentModal('${escapeHtml(student.lmsId)}')" title="Delete">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update student statistics
 */
function updateStudentStats() {
    const start = studentPageMeta.total > 0 ? (studentPageMeta.page - 1) * studentPageMeta.limit + 1 : 0;
    const end = Math.min(studentPageMeta.page * studentPageMeta.limit, studentPageMeta.total);
    document.getElementById('totalStudents').textContent = studentPageMeta.total > 0 
        ? `${start}-${end} of ${studentPageMeta.total}`
        : '0';
}

/**
 * Populate course filter dropdown
 */
function populateStudentCourseFilter() {
    const filterSelect = document.getElementById('studentCourseFilter');

    const courses = Array.from(new Set(availableCourses)).sort();
    
    filterSelect.innerHTML = '<option value="">All Courses</option>';
    courses.forEach(course => {
        const option = document.createElement('option');
        option.value = course;
        option.textContent = course;
        filterSelect.appendChild(option);
    });
}

/**
 * Populate batch filter dropdown
 */
function populateStudentBatchFilter() {
    const selectedBatches = new Set(studentSearchQuery.batches || []);
    const batches = Array.from(new Set(availableBatches)).sort((left, right) => left.localeCompare(right));
    const optionsList = document.getElementById('studentBatchOptionsList');
    if (!optionsList) return;

    if (batches.length === 0) {
        optionsList.innerHTML = '<p style="padding: 8px 12px; color: #999; font-size: 12px;">No batches available</p>';
        updateStudentBatchFilterLabel();
        return;
    }

    const filtered = batches.filter(batch =>
        !studentBatchFilterSearchTerm || batch.toLowerCase().includes(studentBatchFilterSearchTerm.toLowerCase())
    );

    if (filtered.length === 0) {
        optionsList.innerHTML = '<p style="padding: 8px 12px; color: #999; font-size: 12px;">No batches found</p>';
        updateStudentBatchFilterLabel();
        return;
    }

    optionsList.innerHTML = filtered.map(batch => `
        <label class="multiselect-dropdown-option" onclick="event.stopPropagation();">
            <input type="checkbox" value="${escapeHtml(batch)}" ${selectedBatches.has(batch) ? 'checked' : ''} onchange="toggleStudentBatchFilterSelection(this)">
            <span>${escapeHtml(batch)}</span>
        </label>
    `).join('');

    updateStudentBatchFilterLabel();
}

/**
 * Populate year filter dropdown
 */
function populateStudentYearFilter() {
    const filterSelect = document.getElementById('studentYearFilter');
    if (!filterSelect) return;

    filterSelect.innerHTML = '<option value="">All Years</option>';
    availableStudentYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        filterSelect.appendChild(option);
    });

    filterSelect.value = studentSearchQuery.year || '';
}

/**
 * Filter and search students
 */
function filterAndSearchStudents() {
    if (studentSearchTimer) {
        clearTimeout(studentSearchTimer);
    }

    studentSearchTimer = setTimeout(() => {
        const searchTerm = document.getElementById('studentSearch').value.trim();
        const selectedCourse = document.getElementById('studentCourseFilter').value;
        const selectedBatches = Array.isArray(studentSearchQuery.batches) ? studentSearchQuery.batches : [];
        const selectedYear = document.getElementById('studentYearFilter').value;
        const selectedPaymentStatus = document.getElementById('studentPaymentFilter').value;
        const selectedFeeStatusException = document.getElementById('studentFeeExceptionFilter').value;

        studentSearchQuery.search = searchTerm;
        studentSearchQuery.course = selectedCourse;
        studentSearchQuery.batches = selectedBatches;
        studentSearchQuery.year = selectedYear;
        studentSearchQuery.paymentStatus = selectedPaymentStatus;
        studentSearchQuery.feeStatusException = selectedFeeStatusException;

        loadStudents(1);
    }, 250);
}

/**
 * Reset student search and filters
 */
function resetStudentFilters() {
    document.getElementById('studentSearch').value = '';
    document.getElementById('studentCourseFilter').value = '';
    studentBatchFilterSearchTerm = '';
    const batchSearchInput = document.querySelector('#studentBatchFilterDropdown .multiselect-dropdown-search');
    if (batchSearchInput) {
        batchSearchInput.value = '';
    }
    document.getElementById('studentYearFilter').value = '';
    document.getElementById('studentPaymentFilter').value = '';
    document.getElementById('studentFeeExceptionFilter').value = '';
    studentSearchQuery.search = '';
    studentSearchQuery.course = '';
    studentSearchQuery.batches = [];
    studentSearchQuery.year = '';
    studentSearchQuery.paymentStatus = '';
    studentSearchQuery.feeStatusException = '';
    populateStudentBatchFilter();
    loadStudents(1);
}

function toggleStudentBatchFilterDropdown() {
    const dropdown = document.getElementById('studentBatchFilterDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');
}

function toggleStudentBatchFilterSelection(checkbox) {
    const value = checkbox?.value?.trim();
    if (!value) {
        return;
    }

    const current = new Set(studentSearchQuery.batches || []);
    if (checkbox.checked) {
        current.add(value);
    } else {
        current.delete(value);
    }

    studentSearchQuery.batches = Array.from(current).sort((left, right) => left.localeCompare(right));
    updateStudentBatchFilterLabel();
    filterAndSearchStudents();
}

function updateStudentBatchFilterLabel() {
    const label = document.querySelector('#studentBatchFilterDropdown .multiselect-dropdown-label');
    if (!label) return;

    const selectedBatches = Array.isArray(studentSearchQuery.batches) ? studentSearchQuery.batches : [];
    if (selectedBatches.length === 0) {
        label.textContent = 'All Batches';
    } else if (selectedBatches.length === 1) {
        label.textContent = selectedBatches[0];
    } else {
        label.textContent = `${selectedBatches.length} Batches Selected`;
    }
}

function filterStudentBatchOptions(value) {
    studentBatchFilterSearchTerm = value.trim();
    populateStudentBatchFilter();
}

/**
 * Open add student modal
 */
function openAddStudentModal() {
    document.getElementById('studentEditMode').value = 'false';
    document.getElementById('studentOriginalLmsId').value = '';
    document.getElementById('studentLmsId').value = '';
    document.getElementById('studentMobile').value = '';
    const studentBatchSearch = document.getElementById('studentBatchSearch');
    if (studentBatchSearch) {
        studentBatchSearch.value = '';
    }
    const studentCustomBatch = document.getElementById('studentCustomBatch');
    if (studentCustomBatch) {
        studentCustomBatch.value = '';
    }
    document.getElementById('studentName').value = '';
    document.getElementById('studentEmailId').value = '';
    document.getElementById('studentYear').value = '';
    document.getElementById('studentPaymentStatus').value = 'DEFAULT';
    document.getElementById('studentFeeStatusException').value = 'false';
    document.getElementById('studentModalTitle').textContent = 'Add New Student';
    document.getElementById('studentSubmitText').textContent = 'Add Student';
    document.getElementById('studentLmsId').disabled = false;
    renderStudentCoursesCheckboxes([]);
    renderStudentBatchOptions([]);
    
    document.getElementById('studentModal').classList.remove('hidden');
}

/**
 * Open edit student modal
 */
function openEditStudentModal(lmsId) {
    const student = allStudents.find(s => s.lmsId === lmsId);
    if (!student) return;

    document.getElementById('studentEditMode').value = 'true';
    document.getElementById('studentOriginalLmsId').value = lmsId;
    document.getElementById('studentLmsId').value = student.lmsId;
    document.getElementById('studentMobile').value = student.mobile || '';
    const studentBatchSearch = document.getElementById('studentBatchSearch');
    if (studentBatchSearch) {
        studentBatchSearch.value = '';
    }
    const studentCustomBatch = document.getElementById('studentCustomBatch');
    if (studentCustomBatch) {
        studentCustomBatch.value = '';
    }
    document.getElementById('studentName').value = student.name;
    document.getElementById('studentEmailId').value = student.emailId || '';
    document.getElementById('studentYear').value = student.year || '';
    document.getElementById('studentPaymentStatus').value = student.paymentStatus || 'DEFAULT';
    document.getElementById('studentFeeStatusException').value = student.feeStatusException ? 'true' : 'false';
    document.getElementById('studentModalTitle').textContent = 'Edit Student';
    document.getElementById('studentSubmitText').textContent = 'Save Changes';
    document.getElementById('studentLmsId').disabled = true;  // Cannot change LMS ID
    renderStudentCoursesCheckboxes(student.course || []);
    renderStudentBatchOptions(getStudentBatches(student));
    
    document.getElementById('studentModal').classList.remove('hidden');
}

/**
 * Close student modal
 */
function closeStudentModal() {
    document.getElementById('studentModal').classList.add('hidden');
}

/**
 * Handle save student (add or update)
 */
async function handleSaveStudent(event) {
    event.preventDefault();

    const editMode = document.getElementById('studentEditMode').value === 'true';
    const lmsId = document.getElementById('studentLmsId').value.trim();
    const mobile = document.getElementById('studentMobile').value.trim();
    const batches = getSelectedStudentBatches();
    const name = document.getElementById('studentName').value.trim();
    const emailId = document.getElementById('studentEmailId').value.trim();
    const year = document.getElementById('studentYear').value.trim();
    
    const checkboxes = document.querySelectorAll('input[name="studentCourse"]:checked');
    const courses = Array.from(checkboxes).map(cb => cb.value);
    
    const paymentStatus = document.getElementById('studentPaymentStatus').value;
    const feeStatusException = document.getElementById('studentFeeStatusException').value === 'true';

    if (!lmsId || batches.length === 0 || !name || courses.length === 0) {
        showToast('Please fill in LMS ID, Name, select at least one Batch, and select at least one Course', 'error');
        return;
    }

    try {
        let response;
        if (editMode) {
            // Update student
            response = await fetch(`${API_BASE_URL}/students/${encodeURIComponent(lmsId)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ name, mobile, emailId, batch: batches[0], batches, course: courses, year, paymentStatus, feeStatusException })
            });
        } else {
            // Add new student
            response = await fetch(`${API_BASE_URL}/students`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ lmsId, name, mobile, emailId, batch: batches[0], batches, course: courses, year, paymentStatus, feeStatusException })
            });
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to save student');
        }

        showToast(editMode ? 'Student updated successfully' : 'Student added successfully', 'success');
        closeStudentModal();
        loadStudents(editMode ? studentPageMeta.page : 1);
        loadStudentBatches();

    } catch (error) {
        console.error('Error saving student:', error);
        showToast(error.message || 'Error saving student', 'error');
    }
}

/**
 * Open delete student confirmation modal
 */
function openDeleteStudentModal(lmsId) {
    const student = allStudents.find(s => s.lmsId === lmsId);
    if (!student) return;

    deleteTargetLmsId = lmsId;
    document.getElementById('deleteStudentMessage').textContent = `Are you sure you want to delete ${escapeHtml(student.name)} (${escapeHtml(lmsId)})? This action cannot be undone.`;
    document.getElementById('deleteStudentModal').classList.remove('hidden');
}

/**
 * Close delete student modal
 */
function closeDeleteStudentModal() {
    document.getElementById('deleteStudentModal').classList.add('hidden');
    deleteTargetLmsId = null;
}

/**
 * Confirm delete student
 */
async function confirmDeleteStudent() {
    if (!deleteTargetLmsId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/students/${encodeURIComponent(deleteTargetLmsId)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to delete student');
        }

        showToast('Student deleted successfully', 'success');
        closeDeleteStudentModal();
        loadStudents(studentPageMeta.page);
        loadStudentBatches();

    } catch (error) {
        console.error('Error deleting student:', error);
        showToast(error.message || 'Error deleting student', 'error');
    }
}

function toggleAttendanceBatchFilterDropdown() {
    const dropdown = document.getElementById('attendanceBatchFilterDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('active');
}

function toggleAttendanceBatchFilterSelection(checkbox) {
    const value = checkbox.value;
    if (checkbox.checked) {
        if (!selectedAttendanceBatches.includes(value)) {
            selectedAttendanceBatches.push(value);
        }
    } else {
        selectedAttendanceBatches = selectedAttendanceBatches.filter(item => item !== value);
    }
    updateAttendanceBatchFilterLabel();
    applyAttendanceFilters();
}

function updateAttendanceBatchFilterLabel() {
    const label = document.querySelector('#attendanceBatchFilterDropdown .multiselect-dropdown-label');
    if (!label) return;
    if (selectedAttendanceBatches.length === 0) {
        label.textContent = 'All Batches';
    } else if (selectedAttendanceBatches.length === 1) {
        label.textContent = selectedAttendanceBatches[0];
    } else {
        label.textContent = `${selectedAttendanceBatches.length} Batches Selected`;
    }
}

function filterAttendanceBatchOptions(val) {
    attendanceBatchFilterSearchTerm = val.trim();
    populateAttendanceFilterOptions();
}

function populateAttendanceFilterOptions() {
    const optionsList = document.getElementById('attendanceBatchOptionsList');
    const courseSelect = document.getElementById('attendanceCourseFilter');
    const mentorSelect = document.getElementById('attendanceMentorFilter');
    const sessionSelect = document.getElementById('attendanceSessionFilter');
    availableMentors = Array.from(new Set(allSessions.map(session => session.mentorName).filter(Boolean))).sort();

    if (optionsList) {
        const sortedBatches = Array.from(new Set(availableBatches)).sort();
        const filtered = sortedBatches.filter(batch => 
            !attendanceBatchFilterSearchTerm || batch.toLowerCase().includes(attendanceBatchFilterSearchTerm.toLowerCase())
        );

        if (filtered.length === 0) {
            optionsList.innerHTML = '<p style="padding: 8px 12px; color: #999; font-size: 12px;">No batches found</p>';
        } else {
            optionsList.innerHTML = filtered.map(batch => {
                const isChecked = selectedAttendanceBatches.includes(batch);
                return `
                    <label class="multiselect-dropdown-option" onclick="event.stopPropagation();">
                        <input type="checkbox" value="${escapeHtml(batch)}" ${isChecked ? 'checked' : ''} onchange="toggleAttendanceBatchFilterSelection(this)">
                        <span>${escapeHtml(batch)}</span>
                    </label>
                `;
            }).join('');
        }
        updateAttendanceBatchFilterLabel();
    }

    if (courseSelect) {
        const currentValue = courseSelect.value;
        courseSelect.innerHTML = '<option value="">All Courses</option>';
        Array.from(new Set(availableCourses)).sort().forEach(course => {
            const option = document.createElement('option');
            option.value = course;
            option.textContent = course;
            courseSelect.appendChild(option);
        });
        courseSelect.value = currentValue;
    }

    if (mentorSelect) {
        const currentValue = mentorSelect.value;
        mentorSelect.innerHTML = '<option value="">All Mentors</option>';
        availableMentors.forEach(mentorName => {
            const option = document.createElement('option');
            option.value = mentorName;
            option.textContent = mentorName;
            mentorSelect.appendChild(option);
        });
        mentorSelect.value = currentValue;
    }

    if (sessionSelect) {
        const currentValue = sessionSelect.value;
        sessionSelect.innerHTML = '<option value="">All Sessions</option>';
        allSessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.sessionId;
            option.textContent = session.title;
            sessionSelect.appendChild(option);
        });
        sessionSelect.value = currentValue;
    }
}

function getSelectedSessionBatches() {
    return Array.from(sessionBatchSelection);
}

// Global click event to close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const attendanceDropdown = document.getElementById('attendanceBatchFilterDropdown');
    if (attendanceDropdown && !attendanceDropdown.contains(event.target)) {
        attendanceDropdown.classList.remove('active');
    }

    const studentDropdown = document.getElementById('studentBatchFilterDropdown');
    if (studentDropdown && !studentDropdown.contains(event.target)) {
        studentDropdown.classList.remove('active');
    }
});

function toggleSessionBatchSelection(input) {
    const value = input?.value?.trim();
    if (!value) {
        return;
    }

    if (input.checked) {
        sessionBatchSelection.add(value);
    } else {
        sessionBatchSelection.delete(value);
    }
}

function populateSessionBatchOptions() {
    renderSessionBatchOptions();
}

// Existing renderSessionBatchOptions function
function renderSessionBatchOptions(selectedBatches = null) {
    const container = document.getElementById('sessionBatchContainer');
    if (!container) {
        return;
    }

    const selectedSet = new Set(selectedBatches || getSelectedSessionBatches());
    sessionBatchSelection = new Set(selectedSet);
    const searchTerm = (document.getElementById('sessionBatchSearch')?.value || '').trim().toLowerCase();
    const batches = Array.from(new Set(availableBatches))
        .sort((left, right) => left.localeCompare(right))
        .filter(batch => !searchTerm || batch.toLowerCase().includes(searchTerm));

    if (batches.length === 0) {
        container.innerHTML = '<p style="color: #999; font-size: 12px;">No batches match your search.</p>';
        return;
    }

    container.innerHTML = batches.map(batch => `
        <label class="course-checkbox">
            <input type="checkbox" value="${escapeHtml(batch)}" ${selectedSet.has(batch) ? 'checked' : ''} onchange="toggleSessionBatchSelection(this)">
            <span>${escapeHtml(batch)}</span>
        </label>
    `).join('');
}

function collectAttendanceFilters() {
    return {
        timeframe: document.getElementById('attendanceTimeframe')?.value || 'monthly',
        from: document.getElementById('attendanceFromDate')?.value || '',
        to: document.getElementById('attendanceToDate')?.value || '',
        batch: selectedAttendanceBatches.join(','),
        course: document.getElementById('attendanceCourseFilter')?.value || '',
        mentorName: document.getElementById('attendanceMentorFilter')?.value || '',
        sessionId: document.getElementById('attendanceSessionFilter')?.value || '',
        search: document.getElementById('attendanceSearch')?.value.trim() || ''
    };
}

function getAttendanceRosterSearchValue() {
    return document.getElementById('attendanceRosterSearch')?.value.trim() || '';
}

function handleAttendanceRosterSearch() {
    window.clearTimeout(attendanceRosterSearchTimer);
    attendanceRosterSearchTimer = window.setTimeout(() => {
        loadAttendanceRoster(1);
    }, 180);
}

function applyAttendanceFilters() {
    const timeframe = document.getElementById('attendanceTimeframe')?.value || 'monthly';
    const fromDate = document.getElementById('attendanceFromDate');
    const toDate = document.getElementById('attendanceToDate');
    if (fromDate) fromDate.disabled = timeframe !== 'custom';
    if (toDate) toDate.disabled = timeframe !== 'custom';
    loadAttendanceInsights(1);
    loadAttendanceRoster(1);
}

function resetAttendanceFilters() {
    const timeframe = document.getElementById('attendanceTimeframe');
    const fromDate = document.getElementById('attendanceFromDate');
    const toDate = document.getElementById('attendanceToDate');
    const course = document.getElementById('attendanceCourseFilter');
    const mentor = document.getElementById('attendanceMentorFilter');
    const session = document.getElementById('attendanceSessionFilter');
    const search = document.getElementById('attendanceSearch');
    const rosterSearch = document.getElementById('attendanceRosterSearch');
    const rosterBand = document.getElementById('attendanceRosterBand');
    const rosterSort = document.getElementById('attendanceRosterSort');

    if (timeframe) timeframe.value = 'monthly';
    if (fromDate) { fromDate.value = ''; fromDate.disabled = true; }
    if (toDate) { toDate.value = ''; toDate.disabled = true; }
    
    // Clear custom multiselect dropdown batches
    selectedAttendanceBatches = [];
    attendanceBatchFilterSearchTerm = '';
    const searchInput = document.querySelector('#attendanceBatchFilterDropdown .multiselect-dropdown-search');
    if (searchInput) searchInput.value = '';
    updateAttendanceBatchFilterLabel();
    populateAttendanceFilterOptions();

    if (course) course.value = '';
    if (mentor) mentor.value = '';
    if (session) session.value = '';
    if (search) search.value = '';
    if (rosterSearch) rosterSearch.value = '';
    if (rosterBand) rosterBand.value = 'all';
    if (rosterSort) rosterSort.value = 'attendance-desc';

    loadAttendanceInsights(1);
    loadAttendanceRoster(1);
}

function getAttendanceDemoSessions(filters) {
    const search = (filters.search || '').toLowerCase();

    return attendanceDemoData.sessionSummaries.filter(session => {
        if (filters.batch) {
            const queryBatches = filters.batch.split(',').map(b => b.trim()).filter(Boolean);
            if (queryBatches.length > 0 && !queryBatches.includes(session.batch)) {
                return false;
            }
        }
        if (filters.course && session.course !== filters.course) {
            return false;
        }
        if (filters.mentorName && session.mentorName !== filters.mentorName) {
            return false;
        }
        if (filters.sessionId && session.sessionId !== filters.sessionId) {
            return false;
        }
        if (search) {
            const haystack = [session.sessionId, session.sessionName, session.course, session.className, session.mentorName].join(' ').toLowerCase();
            if (!haystack.includes(search)) {
                return false;
            }
        }
        return true;
    });
}

function getAttendanceDemoRoster(filters) {
    const search = getAttendanceRosterSearchValue().toLowerCase();
    const attendanceBand = document.getElementById('attendanceRosterBand')?.value || 'all';
    const sortBy = document.getElementById('attendanceRosterSort')?.value || 'attendance-desc';

    let records = attendanceDemoData.roster.filter(student => {
        if (filters.batch) {
            const queryBatches = filters.batch.split(',').map(b => b.trim()).filter(Boolean);
            if (queryBatches.length > 0 && !queryBatches.includes(student.batch)) {
                return false;
            }
        }
        if (filters.course && student.course !== filters.course) {
            return false;
        }
        if (filters.mentorName && student.mentorName !== filters.mentorName) {
            return false;
        }
        if (search) {
            const haystack = [student.lmsId, student.name, student.mobile || student.phoneNumber, student.batch, student.course, student.mentorName].join(' ').toLowerCase();
            if (!haystack.includes(search)) {
                return false;
            }
        }
        return true;
    });

    if (attendanceBand === 'perfect') {
        records = records.filter(student => student.attendancePercentage === 100);
    } else if (attendanceBand === 'above75') {
        records = records.filter(student => student.attendancePercentage >= 75);
    } else if (attendanceBand === 'below75') {
        records = records.filter(student => student.attendancePercentage < 75);
    } else if (attendanceBand === 'below50') {
        records = records.filter(student => student.attendancePercentage < 50);
    }

    if (sortBy === 'attendance-asc') {
        records.sort((left, right) => left.attendancePercentage - right.attendancePercentage || left.name.localeCompare(right.name));
    } else if (sortBy === 'name-asc') {
        records.sort((left, right) => left.name.localeCompare(right.name));
    } else if (sortBy === 'name-desc') {
        records.sort((left, right) => right.name.localeCompare(left.name));
    } else {
        records.sort((left, right) => right.attendancePercentage - left.attendancePercentage || left.name.localeCompare(right.name));
    }

    return records;
}

async function loadAttendanceInsights(page = 1) {
    if (attendanceInsightsLoading) {
        return;
    }

    attendanceInsightsLoading = true;
    const riskMeta = document.getElementById('attendanceRiskMeta');
    if (riskMeta) {
        riskMeta.textContent = 'Loading attendance insights...';
    }

    try {
        if (attendanceDemoMode) {
            const filters = collectAttendanceFilters();
            const sessions = getAttendanceDemoSessions(filters);
            const roster = getAttendanceDemoRoster(filters);
            const limit = 10;
            const total = sessions.length;
            const totalPages = Math.max(Math.ceil(total / limit), 1);
            const pageItems = sessions
                .slice((page - 1) * limit, page * limit)
                .map(session => ({
                    ...session,
                    occurrenceKey: buildAttendanceOccurrenceKey(session.sessionId, session.attendanceDate || '')
                }));

            attendanceInsightsState = {
                metrics: {
                    totalStudents: roster.length,
                    totalSessionsConducted: sessions.length
                },
                sessionSummaries: pageItems,
                sessionAttendance: attendanceInsightsState.sessionAttendance || [],
                selectedSession: attendanceInsightsState.selectedSession || null,
                pagination: { page, limit, total, totalPages },
                detailPagination: attendanceInsightsState.detailPagination || { page: 1, limit: 30, total: 0, totalPages: 1 },
                roster: attendanceInsightsState.roster || [],
                rosterPagination: attendanceInsightsState.rosterPagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
                filters
            };

            renderAttendanceInsights();
            if (filters.sessionId && pageItems.length === 1) {
                await viewAttendance(pageItems[0].sessionId, false, 1, pageItems[0].attendanceDate || '');
            }
            return;
        }

        populateAttendanceFilterOptions();
        const filters = collectAttendanceFilters();
        const params = new URLSearchParams({
            page: String(page),
            limit: '10',
            timeframe: filters.timeframe,
            from: filters.from,
            to: filters.to,
            batch: filters.batch,
            course: filters.course,
            mentorName: filters.mentorName,
            sessionId: filters.sessionId,
            search: filters.search
        });

        const response = await fetch(`${API_BASE_URL}/attendance/insights?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.message || 'Failed to load attendance insights');
        }

        attendanceInsightsState = {
            metrics: data.metrics || {},
            sessionSummaries: data.sessionSummaries || [],
            sessionAttendance: attendanceInsightsState.sessionAttendance || [],
            selectedSession: attendanceInsightsState.selectedSession || null,
            pagination: data.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 },
            detailPagination: attendanceInsightsState.detailPagination || { page: 1, limit: 30, total: 0, totalPages: 1 },
            roster: attendanceInsightsState.roster || [],
            rosterPagination: attendanceInsightsState.rosterPagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
            filters: data.filters || {}
        };

        renderAttendanceInsights();

        if (filters.sessionId && attendanceInsightsState.sessionSummaries.length === 1) {
            const [onlySession] = attendanceInsightsState.sessionSummaries;
            await viewAttendance(onlySession.sessionId, false, 1, onlySession.attendanceDate || '');
        } else if (attendanceInsightsState.selectedSession?.occurrenceKey) {
            const stillVisible = (attendanceInsightsState.sessionSummaries || []).some(
                session => session.occurrenceKey === attendanceInsightsState.selectedSession.occurrenceKey
            );
            if (!stillVisible) {
                clearAttendanceDetailState();
            }
        }
    } catch (error) {
        console.error('Error loading attendance insights:', error);
        if (riskMeta) {
            riskMeta.textContent = 'Unable to load attendance insights right now.';
        }
        const riskList = document.getElementById('attendanceRiskList');
        if (riskList) {
            riskList.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #999;">${escapeHtml(error.message || 'Failed to load attendance insights')}</td>
                </tr>
            `;
        }
    } finally {
        attendanceInsightsLoading = false;
    }
}

function renderAttendanceInsights() {
    const metrics = attendanceInsightsState.metrics || {};
    document.getElementById('attendanceTotalStudents').textContent = metrics.totalStudents ?? 0;
    document.getElementById('attendanceTotalSessions').textContent = metrics.totalSessionsConducted ?? 0;
    const openRecordsCard = document.getElementById('attendanceOpenRecords');
    const anomalousRecordsCard = document.getElementById('attendanceAnomalousRecords');
    if (openRecordsCard) {
        openRecordsCard.textContent = metrics.openAttendanceRecords ?? 0;
    }
    if (anomalousRecordsCard) {
        anomalousRecordsCard.textContent = metrics.anomalousRecords ?? 0;
    }
    renderAttendanceRiskTable();
    renderAttendancePagination();
    renderAttendanceDetailTable();

    const riskMeta = document.getElementById('attendanceRiskMeta');
    if (riskMeta) {
        const pagination = attendanceInsightsState.pagination || {};
        riskMeta.textContent = `${pagination.total || 0} session(s) matching the current filters`;
    }
}

function renderAttendanceRiskTable() {
    const riskList = document.getElementById('attendanceRiskList');
    if (!riskList) return;

    const records = [...(attendanceInsightsState.sessionSummaries || [])].sort((left, right) => {
        const leftDate = String(left?.attendanceDate || '');
        const rightDate = String(right?.attendanceDate || '');

        if (leftDate !== rightDate) {
            return rightDate.localeCompare(leftDate);
        }

        return String(left?.sessionName || left?.sessionId || '').localeCompare(
            String(right?.sessionName || right?.sessionId || '')
        );
    });
    if (records.length === 0) {
        riskList.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: #999;">No sessions found for the selected filters.</td>
            </tr>
        `;
        return;
    }

    riskList.innerHTML = records.map(session => `
        <tr class="attendance-session-row" onclick="viewAttendance('${escapeHtml(session.sessionId)}', true, 1, '${escapeHtml(session.attendanceDate || '')}')" role="button" tabindex="0" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); viewAttendance('${escapeHtml(session.sessionId)}', true, 1, '${escapeHtml(session.attendanceDate || '')}'); }">
            <td class="attendance-session-cell">
                <div class="attendance-session-date">${escapeHtml(formatAttendanceDay(session.attendanceDate))}</div>
                <div class="attendance-session-title">${escapeHtml(session.sessionName || session.sessionId)}</div>
                <div class="attendance-session-meta">${escapeHtml(session.sessionId)}</div>
                <div class="attendance-session-meta">${escapeHtml(formatAttendanceHealthSummary(session))}</div>
                <div class="attendance-session-meta">${escapeHtml(session.className || '-')} • ${escapeHtml(session.mentorName || '-')}</div>
            </td>
            <td class="session-access-cell">
                ${renderSummaryLine('Batches', getSessionBatches(session), 3)}
                ${renderSummaryLine('Courses', String(session.course || '').split(',').map(item => item.trim()).filter(Boolean), 2, '-')}
            </td>
            <td class="attendance-date-cell">${escapeHtml(formatAttendanceDay(session.attendanceDate))}</td>
            <td><strong>${escapeHtml(String(session.uniqueStudents ?? session.presentCount ?? 0))}</strong></td>
            <td class="attendance-session-actions">
                <button class="btn btn-secondary" onclick="event.stopPropagation(); viewAttendance('${escapeHtml(session.sessionId)}', true, 1, '${escapeHtml(session.attendanceDate || '')}')">View Attendance</button>
            </td>
        </tr>
    `).join('');
}

async function viewAttendance(sessionId, showLoadingState = true, page = 1, attendanceDate = '') {
    if (!sessionId) {
        return;
    }

    const detailMeta = document.getElementById('attendanceDetailMeta');
    const detailList = document.getElementById('attendanceDetailList');
    const detailPagination = document.getElementById('attendanceDetailPagination');
    const sessionFilter = document.getElementById('attendanceSessionFilter');
    const filters = collectAttendanceFilters();

    if (sessionFilter) {
        sessionFilter.value = sessionId;
    }

    if (showLoadingState && detailMeta) {
        detailMeta.textContent = 'Loading session attendance...';
    }

    if (showLoadingState && detailList) {
        detailList.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: #999;">Loading session attendance...</td>
            </tr>
        `;
    }

    if (showLoadingState && detailPagination) {
        detailPagination.innerHTML = '';
    }

    try {
        if (attendanceDemoMode) {
            const session = attendanceDemoData.sessionSummaries.find(item => item.sessionId === sessionId && (!attendanceDate || item.attendanceDate === attendanceDate))
                || attendanceDemoData.sessionSummaries.find(item => item.sessionId === sessionId)
                || { sessionId, sessionName: sessionId, attendanceDate };
            const allRecords = attendanceDemoData.sessionAttendance[sessionId] || [];
            const limit = 30;
            const total = allRecords.length;
            const totalPages = Math.max(Math.ceil(total / limit), 1);
            const safePage = Math.min(Math.max(page, 1), totalPages);

            attendanceInsightsState.selectedSession = {
                ...session,
                occurrenceKey: buildAttendanceOccurrenceKey(session.sessionId, session.attendanceDate || attendanceDate || '')
            };
            attendanceInsightsState.sessionAttendance = allRecords.slice((safePage - 1) * limit, safePage * limit);
            attendanceInsightsState.detailPagination = { page: safePage, limit, total, totalPages };
            renderAttendanceDetailTable();
            return;
        }

        const params = new URLSearchParams({
            page: String(page),
            limit: '30',
            timeframe: filters.timeframe,
            from: filters.from,
            to: filters.to,
            batch: filters.batch,
            course: filters.course,
            mentorName: filters.mentorName,
            attendanceDate
        });

        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to load session attendance');
        }

        attendanceInsightsState.selectedSession = data.session || { sessionId };
        attendanceInsightsState.sessionAttendance = data.records || [];
        attendanceInsightsState.detailPagination = data.pagination || { page: 1, limit: 30, total: 0, totalPages: 1 };
        renderAttendanceDetailTable();
    } catch (error) {
        console.error('Error loading session attendance:', error);
        if (detailMeta) {
            detailMeta.textContent = 'Unable to load session attendance right now.';
        }
        if (detailList) {
            detailList.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; padding: 40px; color: #999;">${escapeHtml(error.message || 'Failed to load session attendance')}</td>
                </tr>
            `;
        }
    }
}

function clearAttendanceDetailState() {
    attendanceInsightsState.selectedSession = null;
    attendanceInsightsState.sessionAttendance = [];
    attendanceInsightsState.detailPagination = { page: 1, limit: 30, total: 0, totalPages: 1 };
    renderAttendanceDetailTable();
}

async function clearSelectedAttendanceOccurrence() {
    const session = attendanceInsightsState.selectedSession;
    const attendanceDate = session?.attendanceDate || '';
    const sessionId = session?.sessionId || '';

    if (!sessionId || !attendanceDate) {
        showToast('Select a dated session occurrence first', 'error');
        return;
    }

    const confirmed = confirm(`Clear attendance for "${session.sessionName || sessionId}" on ${attendanceDate}? This will remove all student attendance records for that date.`);
    if (!confirmed) {
        return;
    }

    try {
        const params = new URLSearchParams({ attendanceDate });
        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}/occurrence?${params.toString()}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to clear attendance');
        }

        showToast(data.message || 'Attendance cleared successfully', 'success');
        clearAttendanceDetailState();
        await loadAttendanceInsights(1);
        await loadAttendanceRoster(1);
    } catch (error) {
        console.error('Error clearing attendance occurrence:', error);
        showToast(error.message || 'Failed to clear attendance', 'error');
    }
}

async function closeSelectedAttendanceOccurrence() {
    const session = attendanceInsightsState.selectedSession;
    const attendanceDate = session?.attendanceDate || '';
    const sessionId = session?.sessionId || '';

    if (!sessionId || !attendanceDate) {
        showToast('Select a dated session occurrence first', 'error');
        return;
    }

    const confirmed = confirm(`Close all open attendance for "${session.sessionName || sessionId}" on ${attendanceDate}?`);
    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}/close`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ attendanceDate })
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to close attendance');
        }

        showToast(data.message || 'Attendance closed successfully', 'success');
        await viewAttendance(sessionId, false, attendanceInsightsState.detailPagination?.page || 1, attendanceDate);
        await loadAttendanceInsights(attendanceInsightsState.pagination?.page || 1);
        await loadAttendanceRoster(attendanceInsightsState.rosterPagination?.page || 1);
    } catch (error) {
        console.error('Error closing attendance occurrence:', error);
        showToast(error.message || 'Failed to close attendance', 'error');
    }
}

async function reconcileAttendanceRecordsNow() {
    try {
        const response = await fetch(`${API_BASE_URL}/attendance/reconcile`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to reconcile attendance');
        }

        const result = data.result || {};
        showToast(`Reconciled attendance: ${result.closedAttendanceRecords || 0} orphaned record(s) closed, ${result.endedPortalSessions || 0} portal session(s) ended`, 'success');
        await loadAttendanceInsights(attendanceInsightsState.pagination?.page || 1);
        if (attendanceInsightsState.selectedSession?.sessionId) {
            await viewAttendance(
                attendanceInsightsState.selectedSession.sessionId,
                false,
                attendanceInsightsState.detailPagination?.page || 1,
                attendanceInsightsState.selectedSession.attendanceDate || ''
            );
        }
        await loadAttendanceRoster(attendanceInsightsState.rosterPagination?.page || 1);
    } catch (error) {
        console.error('Error reconciling attendance:', error);
        showToast(error.message || 'Failed to reconcile attendance', 'error');
    }
}

async function openAttendanceRecordReview(recordId) {
    const record = (attendanceInsightsState.sessionAttendance || []).find(item => item.id === recordId);
    if (!record) {
        showToast('Attendance record not found', 'error');
        return;
    }

    const durationInput = prompt('Update duration in minutes (leave blank to keep current value):', String(record.durationMinutes ?? ''));
    if (durationInput === null) {
        return;
    }

    const noteInput = prompt('Add a short review note (optional):', record.adminReviewNote || '');
    if (noteInput === null) {
        return;
    }

    const reviewStatus = confirm('Mark this record as reviewed? Click Cancel to keep it flagged/clean.') ? 'reviewed' : (record.reviewStatus || 'flagged');
    const payload = {
        reviewStatus,
        adminReviewNote: noteInput
    };

    if (durationInput.trim() !== '') {
        payload.durationMinutes = Number(durationInput);
    }

    try {
        const response = await fetch(`${API_BASE_URL}/attendance/record/${encodeURIComponent(recordId)}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to update attendance record');
        }

        showToast(data.message || 'Attendance record updated successfully', 'success');
        if (attendanceInsightsState.selectedSession?.sessionId) {
            await viewAttendance(
                attendanceInsightsState.selectedSession.sessionId,
                false,
                attendanceInsightsState.detailPagination?.page || 1,
                attendanceInsightsState.selectedSession.attendanceDate || ''
            );
        }
        await loadAttendanceInsights(attendanceInsightsState.pagination?.page || 1);
    } catch (error) {
        console.error('Error updating attendance record:', error);
        showToast(error.message || 'Failed to update attendance record', 'error');
    }
}

async function exportSelectedAttendanceOccurrence() {
    const session = attendanceInsightsState.selectedSession;
    const sessionId = session?.sessionId || '';
    const attendanceDate = session?.attendanceDate || '';

    if (!sessionId || !attendanceDate) {
        showToast('Select a dated session occurrence first', 'error');
        return;
    }

    try {
        const filters = collectAttendanceFilters();
        const params = new URLSearchParams({
            timeframe: filters.timeframe,
            from: filters.from,
            to: filters.to,
            batch: filters.batch,
            course: filters.course,
            mentorName: filters.mentorName,
            attendanceDate
        });

        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}/export?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || 'Failed to export attendance');
        }

        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const contentDisposition = response.headers.get('Content-Disposition') || '';
        const fileNameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
        link.href = downloadUrl;
        link.download = fileNameMatch?.[1] || `${sessionId}-${attendanceDate}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(downloadUrl);
        showToast('Attendance export started', 'success');
    } catch (error) {
        console.error('Error exporting attendance occurrence:', error);
        showToast(error.message || 'Failed to export attendance', 'error');
    }
}

async function saveSelectedAttendanceWindow() {
    const session = attendanceInsightsState.selectedSession;
    const sessionId = session?.sessionId || '';
    const attendanceDate = session?.attendanceDate || '';
    const startInput = document.getElementById('attendanceClassStartTime');
    const endInput = document.getElementById('attendanceClassEndTime');
    const classStartTime = startInput?.value || '';
    const classEndTime = endInput?.value || '';

    if (!sessionId || !attendanceDate) {
        showToast('Select a dated session occurrence first', 'error');
        return;
    }

    if (!classStartTime || !classEndTime) {
        showToast('Enter both class start and end time', 'error');
        return;
    }

    setAttendanceWindowBusy(true);

    try {
        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}/window`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                attendanceDate,
                classStartTime,
                classEndTime
            })
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to update attendance timing');
        }

        showToast(data.message || 'Attendance timing updated successfully', 'success');
        await viewAttendance(sessionId, false, attendanceInsightsState.detailPagination?.page || 1, attendanceDate);
        await loadAttendanceInsights(attendanceInsightsState.pagination?.page || 1);
        await loadAttendanceRoster(attendanceInsightsState.rosterPagination?.page || 1);
    } catch (error) {
        console.error('Error updating attendance timing:', error);
        showToast(error.message || 'Failed to update attendance timing', 'error');
    } finally {
        setAttendanceWindowBusy(false);
    }
}

async function resetSelectedAttendanceWindow() {
    const session = attendanceInsightsState.selectedSession;
    const sessionId = session?.sessionId || '';
    const attendanceDate = session?.attendanceDate || '';

    if (!sessionId || !attendanceDate) {
        showToast('Select a dated session occurrence first', 'error');
        return;
    }

    const confirmed = confirm(`Reset attendance timing for "${session.sessionName || sessionId}" on ${attendanceDate}?`);
    if (!confirmed) {
        return;
    }

    setAttendanceWindowBusy(true);

    try {
        const params = new URLSearchParams({ attendanceDate });
        const response = await fetch(`${API_BASE_URL}/attendance/session/${encodeURIComponent(sessionId)}/window?${params.toString()}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to reset attendance timing');
        }

        showToast(data.message || 'Attendance timing reset successfully', 'success');
        await viewAttendance(sessionId, false, attendanceInsightsState.detailPagination?.page || 1, attendanceDate);
        await loadAttendanceInsights(attendanceInsightsState.pagination?.page || 1);
        await loadAttendanceRoster(attendanceInsightsState.rosterPagination?.page || 1);
    } catch (error) {
        console.error('Error resetting attendance timing:', error);
        showToast(error.message || 'Failed to reset attendance timing', 'error');
    } finally {
        setAttendanceWindowBusy(false);
    }
}

function renderAttendanceDetailTable() {
    const detailMeta = document.getElementById('attendanceDetailMeta');
    const detailList = document.getElementById('attendanceDetailList');
    const detailPagination = document.getElementById('attendanceDetailPagination');
    const clearButton = document.getElementById('clearAttendanceOccurrenceButton');
    const exportButton = document.getElementById('exportAttendanceOccurrenceButton');
    const closeButton = document.getElementById('closeAttendanceOccurrenceButton');
    const sessionActionGroup = document.getElementById('attendanceSessionActionGroup');
    const dangerActionGroup = document.getElementById('attendanceDangerActionGroup');
    if (!detailMeta || !detailList) return;

    const session = attendanceInsightsState.selectedSession;
    const records = attendanceInsightsState.sessionAttendance || [];
    const pagination = attendanceInsightsState.detailPagination || { page: 1, limit: 30, total: records.length, totalPages: 1 };

    if (!session) {
        syncAttendanceWindowInputs(null);
        detailMeta.textContent = 'Choose a session to view attendance.';
        detailList.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: #999;">No session selected.</td>
            </tr>
        `;
        if (clearButton) {
            clearButton.classList.add('hidden');
        }
        if (exportButton) {
            exportButton.classList.add('hidden');
        }
        if (closeButton) {
            closeButton.classList.add('hidden');
        }
        if (sessionActionGroup) {
            sessionActionGroup.classList.add('hidden');
        }
        if (dangerActionGroup) {
            dangerActionGroup.classList.add('hidden');
        }
        if (detailPagination) {
            detailPagination.innerHTML = '';
        }
        return;
    }

    if (clearButton) {
        clearButton.classList.toggle('hidden', !session.attendanceDate);
    }
    if (exportButton) {
        exportButton.classList.toggle('hidden', !session.attendanceDate);
    }
    if (closeButton) {
        closeButton.classList.toggle('hidden', !session.attendanceDate);
    }
    if (sessionActionGroup) {
        sessionActionGroup.classList.toggle('hidden', !session.attendanceDate);
    }
    if (dangerActionGroup) {
        dangerActionGroup.classList.toggle('hidden', !session.attendanceDate);
    }
    syncAttendanceWindowInputs(session);

    const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
    const end = pagination.total === 0 ? 0 : Math.min(start + records.length - 1, pagination.total);
    const attendanceDateLabel = session.attendanceDate ? ` • ${escapeHtml(session.attendanceDate)}` : '';
    const windowLabel = session.classStartTime && session.classEndTime
        ? ` • Class window ${escapeHtml(session.classStartTime)}-${escapeHtml(session.classEndTime)}${session.windowOverrideApplied ? ' (manual)' : ' (inferred)'}`
        : '';
    const thresholdLabel = session.thresholdMinutes > 0
        ? ` • Present if >= ${escapeHtml(formatDuration(session.thresholdMinutes))} • Partial if >= ${escapeHtml(formatDuration(session.partialThresholdMinutes || 0))}`
        : ' • Present if >= 80% • Partial if >= 30% • Low present below 30%';
    detailMeta.textContent = `${session.sessionName || session.sessionId}${attendanceDateLabel}${windowLabel} • ${pagination.total || 0} student(s) joined${thresholdLabel}${pagination.total > pagination.limit ? ` • Showing ${start}-${end}` : ''}`;

    if (records.length === 0) {
        detailList.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: #999;">No attendance records found for this session.</td>
            </tr>
        `;
        if (detailPagination) {
            detailPagination.innerHTML = '';
        }
        return;
    }

    detailList.innerHTML = records.map(record => `
        <tr>
            <td>${renderCodeChip(record.lmsId)}</td>
            <td>${escapeHtml(record.studentName || '-')}</td>
            <td>${escapeHtml(record.mobile || record.phoneNumber || '-')}</td>
            <td>${escapeHtml(record.mentorName || session.mentorName || '-')}</td>
            <td>${record.attendedAt ? escapeHtml(formatAttendanceDateTime(record.attendedAt)) : '-'}</td>
            <td>${escapeHtml(formatDuration(record.durationMinutes))}</td>
            <td><span class="risk-pill" style="${getAttendanceStatusPillStyle(record.status)}">${escapeHtml(formatAttendanceStatusLabel(record.status || 'low present'))}</span></td>
            <td>${escapeHtml(formatAttendanceEndReason(record.attendanceEndReason, record.finalizedBy))}</td>
            <td>${escapeHtml(formatAnomalySummary(record.anomalyFlags))}</td>
            <td><button class="btn btn-secondary" onclick="openAttendanceRecordReview('${escapeHtml(record.id)}')">Review</button></td>
        </tr>
    `).join('');

    renderAttendanceDetailPagination();
}

function renderAttendanceDetailPagination() {
    const container = document.getElementById('attendanceDetailPagination');
    const sessionId = attendanceInsightsState.selectedSession?.sessionId;
    const attendanceDate = attendanceInsightsState.selectedSession?.attendanceDate || '';
    const pagination = attendanceInsightsState.detailPagination || { page: 1, totalPages: 1 };

    if (!container || !sessionId) return;

    const totalPages = Math.max(pagination.totalPages || 1, 1);
    const currentPage = Math.max(pagination.page || 1, 1);

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const buttons = [];
    buttons.push(`<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="viewAttendance('${escapeHtml(sessionId)}', false, ${currentPage - 1}, '${escapeHtml(attendanceDate)}')">Prev</button>`);

    for (let page = 1; page <= totalPages; page++) {
        if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
            buttons.push(`<button class="pagination-btn ${page === currentPage ? 'active' : ''}" onclick="viewAttendance('${escapeHtml(sessionId)}', false, ${page}, '${escapeHtml(attendanceDate)}')">${page}</button>`);
        } else if (page === currentPage - 2 || page === currentPage + 2) {
            buttons.push('<span style="padding: 8px 4px; color: #999;">...</span>');
        }
    }

    buttons.push(`<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="viewAttendance('${escapeHtml(sessionId)}', false, ${currentPage + 1}, '${escapeHtml(attendanceDate)}')">Next</button>`);
    container.innerHTML = buttons.join('');
}

async function loadAttendanceRoster(page = 1) {
    const rosterMeta = document.getElementById('attendanceRosterMeta');
    const rosterList = document.getElementById('attendanceRosterList');
    const filters = collectAttendanceFilters();
    const rosterSearch = getAttendanceRosterSearchValue();
    const attendanceBand = document.getElementById('attendanceRosterBand')?.value || 'all';
    const sortBy = document.getElementById('attendanceRosterSort')?.value || 'attendance-desc';

    if (rosterMeta) {
        rosterMeta.textContent = 'Loading roster...';
    }

    if (rosterList) {
        rosterList.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #999;">Loading roster...</td>
            </tr>
        `;
    }

    try {
        if (attendanceDemoMode) {
            const filters = collectAttendanceFilters();
            const records = getAttendanceDemoRoster(filters);
            const limit = 20;
            const total = records.length;
            const totalPages = Math.max(Math.ceil(total / limit), 1);
            attendanceInsightsState.roster = records.slice((page - 1) * limit, page * limit);
            attendanceInsightsState.rosterPagination = { page, limit, total, totalPages };
            renderAttendanceRoster();
            return;
        }

        const params = new URLSearchParams({
            page: String(page),
            limit: '20',
            timeframe: filters.timeframe,
            from: filters.from,
            to: filters.to,
            batch: filters.batch,
            course: filters.course,
            mentorName: filters.mentorName,
            sessionId: filters.sessionId,
            search: rosterSearch,
            attendanceBand,
            sortBy
        });

        const response = await fetch(`${API_BASE_URL}/attendance/roster?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Failed to load attendance roster');
        }

        attendanceInsightsState.roster = data.students || [];
        attendanceInsightsState.rosterPagination = data.pagination || { page: 1, limit: 20, total: 0, totalPages: 1 };
        renderAttendanceRoster();
    } catch (error) {
        console.error('Error loading attendance roster:', error);
        if (rosterMeta) {
            rosterMeta.textContent = 'Unable to load roster right now.';
        }
        if (rosterList) {
            rosterList.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #999;">${escapeHtml(error.message || 'Failed to load attendance roster')}</td>
                </tr>
            `;
        }
    }
}

function renderAttendanceRoster() {
    const rosterMeta = document.getElementById('attendanceRosterMeta');
    const rosterList = document.getElementById('attendanceRosterList');
    const rosterPagination = document.getElementById('attendanceRosterPagination');

    if (!rosterMeta || !rosterList || !rosterPagination) {
        return;
    }

    const records = attendanceInsightsState.roster || [];
    const pagination = attendanceInsightsState.rosterPagination || { page: 1, totalPages: 1, total: 0 };
    rosterMeta.textContent = `${pagination.total || 0} student(s) matching the current roster filters`;

    if (records.length === 0) {
        rosterList.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #999;">No students found for the selected filters.</td>
            </tr>
        `;
    } else {
        rosterList.innerHTML = records.map(student => `
            <tr>
                <td>${renderCodeChip(student.lmsId)}</td>
                <td>${escapeHtml(student.name || '-')}</td>
                <td>${escapeHtml(student.mobile || student.phoneNumber || '-')}</td>
                <td>${escapeHtml(student.course || '-')}</td>
                <td><strong>${escapeHtml(String(student.attendancePercentage ?? 0))}%</strong></td>
                <td>${escapeHtml(String(student.presentSessions ?? 0))}</td>
                <td>${escapeHtml(String(student.absentSessions ?? 0))}</td>
                <td>${student.lastAttendanceDate ? escapeHtml(student.lastAttendanceDate) : '-'}</td>
            </tr>
        `).join('');
    }

    const totalPages = Math.max(pagination.totalPages || 1, 1);
    const currentPage = Math.max(pagination.page || 1, 1);
    if (totalPages <= 1) {
        rosterPagination.innerHTML = '';
        return;
    }

    const buttons = [];
    buttons.push(`<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="loadAttendanceRoster(${currentPage - 1})">Prev</button>`);
    for (let page = 1; page <= totalPages; page++) {
        if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
            buttons.push(`<button class="pagination-btn ${page === currentPage ? 'active' : ''}" onclick="loadAttendanceRoster(${page})">${page}</button>`);
        } else if (page === currentPage - 2 || page === currentPage + 2) {
            buttons.push('<span style="padding: 8px 4px; color: #999;">...</span>');
        }
    }
    buttons.push(`<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadAttendanceRoster(${currentPage + 1})">Next</button>`);
    rosterPagination.innerHTML = buttons.join('');
}

function renderAttendancePagination() {
    const pagination = attendanceInsightsState.pagination || { page: 1, totalPages: 1 };
    const container = document.getElementById('attendanceRiskPagination');
    if (!container) return;

    const totalPages = Math.max(pagination.totalPages || 1, 1);
    const currentPage = Math.max(pagination.page || 1, 1);

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const buttons = [];
    buttons.push(`<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="loadAttendanceInsights(${currentPage - 1})">Prev</button>`);

    for (let page = 1; page <= totalPages; page++) {
        if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
            buttons.push(`<button class="pagination-btn ${page === currentPage ? 'active' : ''}" onclick="loadAttendanceInsights(${page})">${page}</button>`);
        } else if (page === currentPage - 2 || page === currentPage + 2) {
            buttons.push('<span style="padding: 8px 4px; color: #999;">...</span>');
        }
    }

    buttons.push(`<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="loadAttendanceInsights(${currentPage + 1})">Next</button>`);
    container.innerHTML = buttons.join('');
}

// ====================================
// AUTHENTICATION
// ====================================

/**
 * Handle logout
 */
function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        logout();
    }
}

/**
 * Logout
 */
function logout() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUsername');
    window.location.href = '/admin/login';
}

// ====================================
// UTILITIES
// ====================================

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

/**
 * Format date
 */
function formatAttendanceDateTime(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    return date.toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatAttendanceDay(dateString) {
    if (!dateString) {
        return '-';
    }

    const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(dateString).trim())
        ? `${String(dateString).trim()}T00:00:00`
        : dateString;
    const date = new Date(normalizedValue);

    if (Number.isNaN(date.getTime())) {
        return String(dateString);
    }

    return date.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function formatDuration(durationMinutes) {
    const minutesValue = Number(durationMinutes || 0);
    if (!Number.isFinite(minutesValue) || minutesValue <= 0) {
        return '0m';
    }

    if (minutesValue > 0 && minutesValue < 1) {
        return '<1m';
    }

    const roundedMinutes = Math.round(minutesValue);
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;

    if (hours <= 0) {
        return `${minutes}m`;
    }

    if (minutes === 0) {
        return `${hours}h`;
    }

    return `${hours}h ${minutes}m`;
}

function getAttendanceStatusPillStyle(status) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'present') {
        return 'background: rgba(72, 187, 120, 0.12); color: #276749;';
    }

    if (normalizedStatus === 'partial present') {
        return 'background: rgba(237, 137, 54, 0.14); color: #9c4221;';
    }

    return 'background: rgba(245, 101, 101, 0.12); color: #9b2c2c;';
}

function formatAttendanceStatusLabel(status) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'present') {
        return 'Present';
    }
    if (normalizedStatus === 'partial present') {
        return 'Partial Present';
    }
    return 'Low Present';
}

function formatAttendanceHealthSummary(item) {
    const openCount = Number(item?.openAttendanceCount || 0);
    const anomalousCount = Number(item?.anomalousCount || 0);
    const parts = [];

    if (openCount > 0) {
        parts.push(`${openCount} open`);
    }
    if (anomalousCount > 0) {
        parts.push(`${anomalousCount} flagged`);
    }

    return parts.length > 0 ? parts.join(' | ') : 'Healthy';
}

function formatAttendanceEndReason(reason, finalizedBy) {
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
        return finalizedBy ? `Open | ${finalizedBy}` : 'Open';
    }

    const label = normalizedReason
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    return finalizedBy ? `${label} | ${finalizedBy}` : label;
}

function formatAnomalySummary(flags) {
    const normalizedFlags = Array.isArray(flags)
        ? flags.map(flag => String(flag || '').trim()).filter(Boolean)
        : [];

    if (normalizedFlags.length === 0) {
        return 'Clean';
    }

    return normalizedFlags
        .map(flag => flag.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '))
        .join(', ');
}

function formatIndianSessionLogDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${valueByType.year}-${valueByType.month}-${valueByType.day}`;
}

function formatIndianSessionLogTime(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }

    const parts = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    }).formatToParts(date);
    const valueByType = Object.fromEntries(parts.map(part => [part.type, part.value]));

    return `${valueByType.hour}:${valueByType.minute}:${valueByType.second} ${String(valueByType.dayPeriod || '').toUpperCase()}`.trim();
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;

    // If less than 1 minute
    if (diff < 60000) {
        return 'just now';
    }

    // If less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }

    // If less than 1 day
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }

    // If less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }

    // Otherwise show full date
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    if (!text) return '';
    if (Array.isArray(text)) text = text.join(', ');
    if (typeof text !== 'string') text = String(text);
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function renderCodeChip(value) {
    return `<code class="data-chip">${escapeHtml(value || '-')}</code>`;
}
