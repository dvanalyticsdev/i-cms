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

## Google Sheet student sync
The CMS can sync student data from the configured Google Sheet on startup, every 60 seconds, and manually from the Student Database admin tab.

Default synced tabs:
- `Gen AI & Adv AI`
- `Data Scienece` / `Data Science`
- `Cyber Security`

Each imported row uses the CMS course name from the sheet's `COURSE` column. Batch values are normalized by removing `DV`, splitting comma-separated batches, and deriving `year` from the first four digits of the primary batch.

Optional environment variables:
- `GOOGLE_STUDENT_SHEET_URL` or `GOOGLE_STUDENT_SHEET_ID` to point at a different spreadsheet
- `STUDENT_SHEET_MAPPINGS` to override mappings, either as JSON or `Sheet=Course;Sheet 2=Course 2`
- `GOOGLE_STUDENT_SHEET_SYNC_INTERVAL_MS` to change the polling interval, minimum 30000
- `GOOGLE_STUDENT_SHEET_SYNC_ENABLED=false` to disable automatic polling

## Project structure
- `server.js` - Express entry point
- `routes/` - route modules
- `models/` - data models
- `middleware/` - shared middleware
- `utils/` - helper utilities
- `scripts/` - maintenance scripts

## Notes
- The current application extends beyond classroom join flows and now includes attendance operations and issue-management tooling, which are reflected here.
