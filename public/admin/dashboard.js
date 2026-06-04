/**
 * Admin Dashboard JavaScript
 * Handles session management and monitoring
 */

const API_BASE_URL = '/api/admin';
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
let deleteTargetLmsId = null;
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

// ====================================
// INITIALIZATION
// ====================================

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    loadCourses(); // Load courses for the form
    loadSessions();
    loadSessionLogs();
    loadGuestIds(); // Load guest IDs
    loadMentorIds(); // Load mentor IDs
    loadMockInterviewIds(); // Load mock interview IDs
    loadStudents(); // Load students
    loadIssues(); // Load issue reports
    setInterval(loadSessions, 30000); // Refresh sessions every 30 seconds
    setInterval(loadGuestIds, 30000); // Refresh guest IDs every 30 seconds
    setInterval(loadMentorIds, 30000); // Refresh mentor IDs every 30 seconds
    setInterval(loadMockInterviewIds, 30000); // Refresh mock interview IDs every 30 seconds
    setInterval(loadStudents, 30000); // Refresh students every 30 seconds
    setInterval(loadIssues, 30000); // Refresh issues every 30 seconds
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

        return `
        <tr>
            <td>${escapeHtml(session.title)}</td>
            <td><code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${session.meetingNumber}</code></td>
            <td>${courseDisplay}</td>
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
    const courses = getSelectedCourses();

    // Validation
    if (!title || !meetingNumber || !passcode) {
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
                <td colspan="3" style="text-align: center; padding: 40px;">
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

        showToast(isCreate ? 'Course created successfully' : 'Course updated successfully', 'success');
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

        showToast('Course deleted successfully', 'success');
        closeDeleteCourseModal();
        loadCourses();
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

// ====================================
// EXPORT DATABASE
// ====================================

function openExportDatabaseModal() {
    currentExportFormat = document.getElementById('exportFormat')?.value || 'json';
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
        const response = await fetch(`${API_BASE_URL}/export-database?format=${encodeURIComponent(selectedFormat)}`, {
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
        downloadLink.download = `dv-database-export-${Date.now()}.${selectedFormat === 'excel' ? 'xlsx' : selectedFormat}`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        window.URL.revokeObjectURL(downloadUrl);

        showToast(`Database exported successfully as ${selectedFormat.toUpperCase()}`, 'success');
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
 * Load all students
 */
async function loadStudents() {
    try {
        const response = await fetch(`${API_BASE_URL}/students`, {
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
        filteredStudents = [...allStudents];  // Initialize filtered list
        
        // Merge any legacy student course names into the shared course list
        const allCoursesSet = new Set(availableCourses);
        allStudents.forEach(s => {
            if (Array.isArray(s.course)) {
                s.course.forEach(c => allCoursesSet.add(c));
            } else if (s.course) {
                allCoursesSet.add(s.course);
            }
        });
        availableCourses = Array.from(allCoursesSet).sort();
        
        populateStudentCourseFilter();  // Populate course filter dropdown
        renderStudents();
        updateStudentStats();

    } catch (error) {
        console.error('Error loading students:', error);
        showToast('Error loading students', 'error');
    }
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
                    <td colspan="4" style="text-align: center; padding: 40px;">
                        <p style="color: #999;">No students found. <a href="#" onclick="openAddStudentModal(); return false;" style="color: #667eea;">Add one now</a></p>
                    </td>
                </tr>
            `;
        } else {
            studentsList.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 40px;">
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
            <td>${escapeHtml(student.name)}</td>
            <td>${escapeHtml(student.course)}</td>
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
    document.getElementById('totalStudents').textContent = filteredStudents.length + ' of ' + allStudents.length;
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
    const searchTerm = document.getElementById('studentSearch').value.toLowerCase().trim();
    const selectedCourse = document.getElementById('studentCourseFilter').value;

    filteredStudents = allStudents.filter(student => {
        // Apply course filter - handle both single course (string) and multiple courses (array)
        if (selectedCourse) {
            const studentCourses = Array.isArray(student.course) ? student.course : [student.course];
            if (!studentCourses.includes(selectedCourse)) {
                return false;
            }
        }

        // Apply search filter (search both LMS ID and Name)
        if (searchTerm) {
            const lmsIdMatch = student.lmsId.toLowerCase().includes(searchTerm);
            const nameMatch = student.name.toLowerCase().includes(searchTerm);
            return lmsIdMatch || nameMatch;
        }

        return true;
    });

    renderStudents();
    updateStudentStats();
}

/**
 * Reset student search and filters
 */
function resetStudentFilters() {
    document.getElementById('studentSearch').value = '';
    document.getElementById('studentCourseFilter').value = '';
    filteredStudents = [...allStudents];
    renderStudents();
    updateStudentStats();
}

/**
 * Open add student modal
 */
function openAddStudentModal() {
    document.getElementById('studentEditMode').value = 'false';
    document.getElementById('studentOriginalLmsId').value = '';
    document.getElementById('studentLmsId').value = '';
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
    const name = document.getElementById('studentName').value.trim();
    
    // Get selected courses from checkboxes
    const courseCheckboxes = document.querySelectorAll('.studentCourseCheckbox:checked');
    const courses = Array.from(courseCheckboxes).map(cb => cb.value);

    if (!lmsId || !name || courses.length === 0) {
        showToast('Please fill in all fields and select at least one course', 'error');
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
                body: JSON.stringify({ name, courses })
            });
        } else {
            // Add new student
            response = await fetch(`${API_BASE_URL}/students`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ lmsId, name, courses })
            });
        }

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'Failed to save student');
        }

        showToast(editMode ? 'Student updated successfully' : 'Student added successfully', 'success');
        closeStudentModal();
        loadStudents();

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
        loadStudents();

    } catch (error) {
        console.error('Error deleting student:', error);
        showToast(error.message || 'Error deleting student', 'error');
    }
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
