# i-CMS

Last updated: 2026-06-24

`i-CMS` is the current classroom management system in this folder. It handles student verification, live class-session access, attendance operations, issue reporting, and admin-side management workflows around classroom delivery.

## Current functionality
- Student verification and session restore flows
- Force logout and normal logout support
- Class-session browsing and join-session flow
- Attendance session start and attendance window management
- Attendance insights and per-session exports
- Attendance record reconciliation and record patching
- Public issue submission flow
- Admin login and protected admin session handling
- Admin issue review, issue update, and resolved-issue cleanup
- Session-log viewing and cleanup

## Current route groups
- `routes/authRoutes.js` - student auth/session routes
- `routes/sessionRoutes.js` - class-session and join-session flows
- `routes/attendanceRoutes.js` - attendance analytics and admin attendance controls
- `routes/issueRoutes.js` - issue submission
- `routes/adminRoutes.js` - admin login, session, issue, and session-log workflows

## Notable endpoints in the current build
- `POST /api/verify-student`
- `POST /api/force-logout`
- `POST /api/logout`
- `GET /api/session/:lmsId`
- `GET /api/class-sessions`
- `POST /api/join-session`
- `POST /api/attendance/start`
- `GET /api/attendance/insights`
- `GET /api/attendance/session/:sessionId`
- `POST /api/attendance/session/:sessionId/close`
- `PUT /api/attendance/session/:sessionId/window`
- `DELETE /api/attendance/session/:sessionId/window`
- `GET /api/attendance/session/:sessionId/export`
- `POST /api/attendance/reconcile`
- `PATCH /api/attendance/record/:recordId`
- `POST /api/issues`
- `POST /api/admin/login`
- `POST /api/admin/session`
- `GET /api/admin/sessions`
- `GET /api/admin/issues`
- `PATCH /api/admin/issues/:id`
- `DELETE /api/admin/issues/resolved`
- `GET /api/admin/session-logs`
- `DELETE /api/admin/session-logs`

## Local development
Prerequisites:
- Node.js
- `.env` configured for the current environment

Install dependencies:
```bash
npm install
```

Start the server:
```bash
npm start
```

## Project structure
- `server.js` - Express entry point
- `routes/` - route modules
- `models/` - data models
- `middleware/` - shared middleware
- `utils/` - helper utilities
- `scripts/` - maintenance scripts

## Notes
- The current application extends beyond classroom join flows and now includes attendance operations and issue-management tooling, which are reflected here.
