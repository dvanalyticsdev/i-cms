/**
 * Admin Dashboard JavaScript
 * Handles session management and monitoring
 */

const API_BASE_URL = '/api/admin';
const attendanceDemoMode = new URLSearchParams(window.location.search).get('attendanceDemo') === '1';
let authToken = null;
let currentEditingSessionId = null;
let deleteTargetSessionId = null;
let allSessions = [];
let availableCourses = [];
let allCourses = [];
let currentEditingCourseId = null;
let deleteTargetCourseId = null;
let allStudents = [];
let filteredStudents = [];
let studentPageMeta = { page: 1, limit: 20, total: 0, totalPages: 1 };
let studentSearchQuery = { search: '', course: '' };
let studentSearchTimer = null;
let deleteTargetLmsId = null;
let availableBatches = [];
let allIssues = [];
let deleteTargetIssueId = null;
let allSessionLogs = [];
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
    roster: [],
    rosterPagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    filters: {}
};
let attendanceInsightsLoading = false;
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

// ====================================
// INITIALIZATION
// ====================================

document.addEventListener('DOMContentLoaded', () => {
    if (attendanceDemoMode) {
        authToken = 'attendance-demo-token';
        availableCourses = Array.from(new Set(attendanceDemoData.sessionSummaries.map(session => session.course).filter(Boolean)));
        availableBatches = Array.from(new Set(attendanceDemoData.roster.map(student => student.batch).filter(Boolean)));
        allSessions = attendanceDemoData.sessionSummaries.map(session => ({
            sessionId: session.sessionId,
            title: session.sessionName,
            batch: session.batch
        }));
        const username = document.getElementById('adminUsername');
        if (username) {
            username.textContent = 'Attendance Demo';
        }
        setupEventListeners();
        populateAttendanceFilterOptions();
        populateSessionBatchOptions();
        loadAttendanceInsights();
        loadAttendanceRoster();
        return;
    }

    checkAuth();
    restorePendingToast();
    setupEventListeners();
    loadCourses(); // Load courses for the form
    loadSessions();
    loadSessionLogs();
    loadGuestIds(); // Load guest IDs
    loadMentorIds(); // Load mentor IDs
    loadMockInterviewIds(); // Load mock interview IDs
    loadStudents(1); // Load students (page 1)
    loadStudentBatches(); // Load student batches for selection dropdowns
    loadIssues(); // Load issue reports
    loadAttendanceInsights();
    loadAttendanceRoster();
    setInterval(loadSessions, 30000); // Refresh sessions every 30 seconds
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
function checkAuth() {
    authToken = localStorage.getItem('adminToken');
    if (!authToken) {
        window.location.href = '/admin/login';
        return;
    }

    const username = localStorage.getItem('adminUsername');
    document.getElementById('adminUsername').textContent = username || 'Admin';
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
            renderCourseManagement();
            renderCoursesCheckboxes();
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

    // Escape key to close modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                modal.classList.add('hidden');
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

    if (tabName === 'courses') {
        loadCourses();
    }

    if (tabName === 'session-logs') {
        loadSessionLogs(1);
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
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No sessions yet. <a href="#" onclick="openCreateSessionModal(); return false;" style="color: #667eea;">Create one now</a></p>
                </td>
            </tr>
        `;
        return;
    }

    sessionsList.innerHTML = allSessions.map(session => {
        const assignedCourses = Array.isArray(session.courses) ? session.courses : [];
        const courseDisplay = assignedCourses.length > 0
            ? assignedCourses.map(course => escapeHtml(course)).join(', ')
            : 'All Courses';
        const batchDisplay = session.batch ? escapeHtml(session.batch) : '-';

        return `
        <tr>
            <td>${escapeHtml(session.title)}</td>
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${session.meetingNumber}</code></td>
            <td>${batchDisplay}<br><span style="color: #999; font-size: 12px;">${courseDisplay}</span></td>
            <td>
                <button class="btn-toggle ${session.status}" onclick="toggleSessionStatus('${session._id}', '${session.status}')">
                    ${session.status === 'on' ? 'ON' : 'OFF'}
                </button>
            </td>
            <td>${formatDate(session.createdAt)}</td>
            <td>
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
    document.getElementById('sessionId').value = '';
    document.getElementById('sessionTitle').value = '';
    document.getElementById('meetingNumber').value = '';
    document.getElementById('passcode').value = '';
    document.getElementById('description').value = '';
    populateSessionBatchOptions();
    document.getElementById('sessionBatch').value = '';
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
    populateSessionBatchOptions();
    document.getElementById('sessionBatch').value = session.batch || '';
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
    const batch = document.getElementById('sessionBatch').value.trim();
    const courses = getSelectedCourses();

    // Validation
    if (!title || !meetingNumber || !passcode || !batch) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    // Check meeting number format
    if (!/^\d+$/.test(meetingNumber)) {
        showToast('Meeting ID can include spaces, but it must contain only numbers', 'error');
        return;
    }

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
                batch,
                courses
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

        showToast(`Session status changed to ${newStatus.toUpperCase()}`, 'success');
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
            <td>${escapeHtml(log.date)}</td>
            <td>${escapeHtml(log.time)}</td>
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
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${id.id}</code></td>
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
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${id.id}</code></td>
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
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${id.id}</code></td>
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

/**
 * Load students with pagination and filtering
 */
async function loadStudents(page = 1) {
    try {
        studentPageMeta.page = page;
        const searchVal = studentSearchQuery.search || '';
        const courseVal = studentSearchQuery.course || '';
        
        const url = `${API_BASE_URL}/students?page=${page}&limit=${studentPageMeta.limit}&search=${encodeURIComponent(searchVal)}&course=${encodeURIComponent(courseVal)}`;
        
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
            populateAttendanceFilterOptions();
            populateSessionBatchOptions();
        }
    } catch (error) {
        console.error('Error loading student batches:', error);
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
        const response = await fetch(`${API_BASE_URL}/issues`, {
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
                <td colspan="6" style="text-align: center; padding: 40px;">
                    <p style="color: #999;">No issues reported yet</p>
                </td>
            </tr>
        `;
        return;
    }

    issuesList.innerHTML = allIssues.map(issue => `
        <tr>
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(issue.lmsId)}</code></td>
            <td>${escapeHtml(issue.name)}</td>
            <td>${issue.phoneNumber ? escapeHtml(issue.phoneNumber) : '-'}</td>
            <td><div class="issue-description">${escapeHtml(issue.description)}</div></td>
            <td>${formatDate(issue.createdAt)}</td>
            <td>
                <div class="actions">
                    <button class="btn-action delete" onclick="openDeleteIssueModal('${issue._id}')" title="Delete">Delete</button>
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
}

/**
 * Open delete issue confirmation modal
 */
function openDeleteIssueModal(issueId) {
    deleteTargetIssueId = issueId;
    const issue = allIssues.find(item => item._id === issueId);
    const issueName = issue ? issue.name : 'this user';
    document.getElementById('deleteIssueMessage').textContent = `Are you sure you want to delete the issue reported by ${issueName}? This action cannot be undone.`;
    document.getElementById('deleteIssueModal').classList.remove('hidden');
}

/**
 * Close delete issue modal
 */
function closeDeleteIssueModal() {
    document.getElementById('deleteIssueModal').classList.add('hidden');
    deleteTargetIssueId = null;
}

/**
 * Confirm delete issue
 */
async function confirmDeleteIssue() {
    if (!deleteTargetIssueId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/issues/${deleteTargetIssueId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || 'Failed to delete issue');
        }

        showToast('Issue deleted successfully', 'success');
        closeDeleteIssueModal();
        loadIssues();

    } catch (error) {
        console.error('Error deleting issue:', error);
        showToast(error.message || 'Error deleting issue', 'error');
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
                        <td colspan="6" style="text-align: center; padding: 40px;">
                        <p style="color: #999;">No students found. <a href="#" onclick="openAddStudentModal(); return false;" style="color: #667eea;">Add one now</a></p>
                    </td>
                </tr>
            `;
        } else {
            studentsList.innerHTML = `
                <tr>
                        <td colspan="6" style="text-align: center; padding: 40px;">
                        <p style="color: #999;">No matching students found. Try adjusting your search or filters.</p>
                    </td>
                </tr>
            `;
        }
        return;
    }

    studentsList.innerHTML = filteredStudents.map(student => `
        <tr>
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(student.lmsId)}</code></td>
            <td>${escapeHtml(student.phoneNumber || '-')}</td>
            <td>${escapeHtml(student.batch || '-')}</td>
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(Array.isArray(student.course) ? student.course.join(', ') : (student.course || '-'))}</td>
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
 * Filter and search students
 */
function filterAndSearchStudents() {
    if (studentSearchTimer) {
        clearTimeout(studentSearchTimer);
    }

    studentSearchTimer = setTimeout(() => {
        const searchTerm = document.getElementById('studentSearch').value.trim();
        const selectedCourse = document.getElementById('studentCourseFilter').value;

        studentSearchQuery.search = searchTerm;
        studentSearchQuery.course = selectedCourse;

        loadStudents(1);
    }, 250);
}

/**
 * Reset student search and filters
 */
function resetStudentFilters() {
    document.getElementById('studentSearch').value = '';
    document.getElementById('studentCourseFilter').value = '';
    studentSearchQuery.search = '';
    studentSearchQuery.course = '';
    loadStudents(1);
}

/**
 * Open add student modal
 */
function openAddStudentModal() {
    document.getElementById('studentEditMode').value = 'false';
    document.getElementById('studentOriginalLmsId').value = '';
    document.getElementById('studentLmsId').value = '';
    document.getElementById('studentPhoneNumber').value = '';
    document.getElementById('studentBatch').value = '';
    document.getElementById('studentName').value = '';
    document.getElementById('studentModalTitle').textContent = 'Add New Student';
    document.getElementById('studentSubmitText').textContent = 'Add Student';
    document.getElementById('studentLmsId').disabled = false;
    
    // Populate courses with checkboxes
    const checkboxesContainer = document.getElementById('studentCoursesCheckboxes');
    checkboxesContainer.innerHTML = '';
    availableCourses.forEach(course => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '8px';
        label.style.cursor = 'pointer';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = course;
        checkbox.style.marginRight = '8px';
        checkbox.className = 'studentCourseCheckbox';
        
        const span = document.createElement('span');
        span.textContent = course;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        checkboxesContainer.appendChild(label);
    });
    
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
    document.getElementById('studentPhoneNumber').value = student.phoneNumber || '';
    document.getElementById('studentBatch').value = student.batch || '';
    document.getElementById('studentName').value = student.name;
    document.getElementById('studentModalTitle').textContent = 'Edit Student';
    document.getElementById('studentSubmitText').textContent = 'Save Changes';
    document.getElementById('studentLmsId').disabled = true;  // Cannot change LMS ID
    
    // Populate courses - normalize student.course to array
    const studentCourses = Array.isArray(student.course) ? student.course : [student.course];
    const checkboxesContainer = document.getElementById('studentCoursesCheckboxes');
    checkboxesContainer.innerHTML = '';
    availableCourses.forEach(course => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '8px';
        label.style.cursor = 'pointer';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = course;
        checkbox.checked = studentCourses.includes(course);
        checkbox.style.marginRight = '8px';
        checkbox.className = 'studentCourseCheckbox';
        
        const span = document.createElement('span');
        span.textContent = course;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        checkboxesContainer.appendChild(label);
    });
    
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
    const phoneNumber = document.getElementById('studentPhoneNumber').value.trim();
    const batch = document.getElementById('studentBatch').value.trim();
    const name = document.getElementById('studentName').value.trim();
    
    // Get selected courses from checkboxes
    const courseCheckboxes = document.querySelectorAll('.studentCourseCheckbox:checked');
    const courses = Array.from(courseCheckboxes).map(cb => cb.value);

    if (!lmsId || !phoneNumber || !batch || !name || courses.length === 0) {
        showToast('Please fill in all fields and select at least one course', 'error');
        return;
    }

    const normalizedPhoneNumber = phoneNumber.replace(/\D/g, '');
    if (normalizedPhoneNumber.length < 10 || normalizedPhoneNumber.length > 15) {
        showToast('Enter a valid phone number with 10 to 15 digits', 'error');
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
                body: JSON.stringify({ name, phoneNumber, batch, courses })
            });
        } else {
            // Add new student
            response = await fetch(`${API_BASE_URL}/students`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ lmsId, name, phoneNumber, batch, courses })
            });
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to save student');
        }

        showToast(editMode ? 'Student updated successfully' : 'Student added successfully', 'success');
        closeStudentModal();
        loadStudents(editMode ? studentPageMeta.page : 1);

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

    } catch (error) {
        console.error('Error deleting student:', error);
        showToast(error.message || 'Error deleting student', 'error');
    }
}

function populateAttendanceFilterOptions() {
    const batchSelect = document.getElementById('attendanceBatchFilter');
    const courseSelect = document.getElementById('attendanceCourseFilter');
    const sessionSelect = document.getElementById('attendanceSessionFilter');

    if (batchSelect) {
        const currentValue = batchSelect.value;
        batchSelect.innerHTML = '<option value="">All Batches</option>';
        Array.from(new Set(availableBatches)).sort().forEach(batch => {
            const option = document.createElement('option');
            option.value = batch;
            option.textContent = batch;
            batchSelect.appendChild(option);
        });
        batchSelect.value = currentValue;
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

function populateSessionBatchOptions() {
    const select = document.getElementById('sessionBatch');
    if (!select) {
        return;
    }

    const currentValue = select.value;
    select.innerHTML = '<option value="">Select a batch</option>';
    Array.from(new Set(availableBatches)).sort().forEach(batch => {
        const option = document.createElement('option');
        option.value = batch;
        option.textContent = batch;
        select.appendChild(option);
    });
    select.value = currentValue;
}

function collectAttendanceFilters() {
    return {
        timeframe: document.getElementById('attendanceTimeframe')?.value || 'monthly',
        from: document.getElementById('attendanceFromDate')?.value || '',
        to: document.getElementById('attendanceToDate')?.value || '',
        batch: document.getElementById('attendanceBatchFilter')?.value || '',
        course: document.getElementById('attendanceCourseFilter')?.value || '',
        sessionId: document.getElementById('attendanceSessionFilter')?.value || '',
        search: document.getElementById('attendanceSearch')?.value.trim() || ''
    };
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
    const batch = document.getElementById('attendanceBatchFilter');
    const course = document.getElementById('attendanceCourseFilter');
    const session = document.getElementById('attendanceSessionFilter');
    const search = document.getElementById('attendanceSearch');
    const rosterBand = document.getElementById('attendanceRosterBand');
    const rosterSort = document.getElementById('attendanceRosterSort');

    if (timeframe) timeframe.value = 'monthly';
    if (fromDate) { fromDate.value = ''; fromDate.disabled = true; }
    if (toDate) { toDate.value = ''; toDate.disabled = true; }
    if (batch) batch.value = '';
    if (course) course.value = '';
    if (session) session.value = '';
    if (search) search.value = '';
    if (rosterBand) rosterBand.value = 'all';
    if (rosterSort) rosterSort.value = 'attendance-desc';

    loadAttendanceInsights(1);
    loadAttendanceRoster(1);
}

function getAttendanceDemoSessions(filters) {
    const search = (filters.search || '').toLowerCase();

    return attendanceDemoData.sessionSummaries.filter(session => {
        if (filters.batch && session.batch !== filters.batch) {
            return false;
        }
        if (filters.course && session.course !== filters.course) {
            return false;
        }
        if (filters.sessionId && session.sessionId !== filters.sessionId) {
            return false;
        }
        if (search) {
            const haystack = [session.sessionId, session.sessionName, session.course].join(' ').toLowerCase();
            if (!haystack.includes(search)) {
                return false;
            }
        }
        return true;
    });
}

function getAttendanceDemoRoster(filters) {
    const search = (filters.search || '').toLowerCase();
    const attendanceBand = document.getElementById('attendanceRosterBand')?.value || 'all';
    const sortBy = document.getElementById('attendanceRosterSort')?.value || 'attendance-desc';

    let records = attendanceDemoData.roster.filter(student => {
        if (filters.batch && student.batch !== filters.batch) {
            return false;
        }
        if (filters.course && student.course !== filters.course) {
            return false;
        }
        if (search) {
            const haystack = [student.lmsId, student.name, student.phoneNumber, student.batch, student.course].join(' ').toLowerCase();
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
            const pageItems = sessions.slice((page - 1) * limit, page * limit);

            attendanceInsightsState = {
                metrics: {
                    totalStudents: roster.length,
                    totalSessionsConducted: sessions.length
                },
                sessionSummaries: pageItems,
                sessionAttendance: attendanceInsightsState.sessionAttendance || [],
                selectedSession: attendanceInsightsState.selectedSession || null,
                pagination: { page, limit, total, totalPages },
                roster: attendanceInsightsState.roster || [],
                rosterPagination: attendanceInsightsState.rosterPagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
                filters
            };

            renderAttendanceInsights();
            if (filters.sessionId) {
                await viewAttendance(filters.sessionId, false);
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
            roster: attendanceInsightsState.roster || [],
            rosterPagination: attendanceInsightsState.rosterPagination || { page: 1, limit: 20, total: 0, totalPages: 1 },
            filters: data.filters || {}
        };

        renderAttendanceInsights();

        if (filters.sessionId) {
            await viewAttendance(filters.sessionId, false);
        } else if (attendanceInsightsState.selectedSession?.sessionId) {
            const stillVisible = (attendanceInsightsState.sessionSummaries || []).some(
                session => session.sessionId === attendanceInsightsState.selectedSession.sessionId
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
                    <td colspan="6" style="text-align: center; padding: 40px; color: #999;">${escapeHtml(error.message || 'Failed to load attendance insights')}</td>
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

    const records = attendanceInsightsState.sessionSummaries || [];
    if (records.length === 0) {
        riskList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">No sessions found for the selected filters.</td>
            </tr>
        `;
        return;
    }

    riskList.innerHTML = records.map(session => `
        <tr>
            <td>
                <div style="font-weight: 600;">${escapeHtml(session.sessionName || session.sessionId)}</div>
                <div style="color: #999; font-size: 12px;">${escapeHtml(session.sessionId)}</div>
            </td>
            <td>${escapeHtml(session.batch || '-')}</td>
            <td>${escapeHtml(session.course || '-')}</td>
            <td>${session.attendanceDate ? escapeHtml(session.attendanceDate) : '-'}</td>
            <td><strong>${escapeHtml(String(session.uniqueStudents ?? session.presentCount ?? 0))}</strong></td>
            <td>
                <button class="btn btn-secondary" onclick="viewAttendance('${escapeHtml(session.sessionId)}')">View Attendance</button>
            </td>
        </tr>
    `).join('');
}

async function viewAttendance(sessionId, showLoadingState = true) {
    if (!sessionId) {
        return;
    }

    const detailMeta = document.getElementById('attendanceDetailMeta');
    const detailList = document.getElementById('attendanceDetailList');
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
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">Loading session attendance...</td>
            </tr>
        `;
    }

    try {
        if (attendanceDemoMode) {
            const session = attendanceDemoData.sessionSummaries.find(item => item.sessionId === sessionId) || { sessionId, sessionName: sessionId };
            attendanceInsightsState.selectedSession = session;
            attendanceInsightsState.sessionAttendance = attendanceDemoData.sessionAttendance[sessionId] || [];
            renderAttendanceDetailTable();
            return;
        }

        const params = new URLSearchParams({
            timeframe: filters.timeframe,
            from: filters.from,
            to: filters.to,
            batch: filters.batch,
            course: filters.course
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
        renderAttendanceDetailTable();
    } catch (error) {
        console.error('Error loading session attendance:', error);
        if (detailMeta) {
            detailMeta.textContent = 'Unable to load session attendance right now.';
        }
        if (detailList) {
            detailList.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 40px; color: #999;">${escapeHtml(error.message || 'Failed to load session attendance')}</td>
                </tr>
            `;
        }
    }
}

function clearAttendanceDetailState() {
    attendanceInsightsState.selectedSession = null;
    attendanceInsightsState.sessionAttendance = [];
    renderAttendanceDetailTable();
}

function renderAttendanceDetailTable() {
    const detailMeta = document.getElementById('attendanceDetailMeta');
    const detailList = document.getElementById('attendanceDetailList');
    if (!detailMeta || !detailList) return;

    const session = attendanceInsightsState.selectedSession;
    const records = attendanceInsightsState.sessionAttendance || [];

    if (!session) {
        detailMeta.textContent = 'Choose a session to view attendance.';
        detailList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">No session selected.</td>
            </tr>
        `;
        return;
    }

    detailMeta.textContent = `${session.sessionName || session.sessionId} • ${records.length} student(s) joined`;

    if (records.length === 0) {
        detailList.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px; color: #999;">No attendance records found for this session.</td>
            </tr>
        `;
        return;
    }

    detailList.innerHTML = records.map(record => `
        <tr>
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(record.lmsId)}</code></td>
            <td>${escapeHtml(record.studentName || '-')}</td>
            <td>${escapeHtml(record.phoneNumber || '-')}</td>
            <td>${record.attendedAt ? escapeHtml(formatAttendanceDateTime(record.attendedAt)) : '-'}</td>
            <td>${escapeHtml(formatDuration(record.durationMinutes))}</td>
            <td><span class="risk-pill" style="background: rgba(72, 187, 120, 0.12); color: #276749;">${escapeHtml(record.status || 'present')}</span></td>
        </tr>
    `).join('');
}

async function loadAttendanceRoster(page = 1) {
    const rosterMeta = document.getElementById('attendanceRosterMeta');
    const rosterList = document.getElementById('attendanceRosterList');
    const filters = collectAttendanceFilters();
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
            sessionId: filters.sessionId,
            search: filters.search,
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
                <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(student.lmsId)}</code></td>
                <td>${escapeHtml(student.name || '-')}</td>
                <td>${escapeHtml(student.phoneNumber || '-')}</td>
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
