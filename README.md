# DV Classroom Landing Page

A professional, secure web-based classroom joining system that integrates with the Zoom Meeting SDK. Students authenticate with their LMS credentials, browse available class sessions created by an admin, and join live Zoom meetings — all from a single, responsive interface.

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Database](#database)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [License](#license)

---

## ✨ Features

### Student Portal
- **Persistent Sessions** — Once logged in, students remain authenticated across page refreshes and browser restarts until they explicitly log out or are cleared from another device
- **Session Auto-Restore** — On page load, existing sessions are validated against the server and the sessions screen is shown automatically, skipping the login step
- **Flexible Name Matching** — Name verification is case-insensitive and whitespace-normalized (`"rahul  kumar"`, `"RAHUL KUMAR"`, `"Rahul Kumar"` all match the same record)
- **Device Lock** — Only one device can be active per student at a time; logging in from a second device prompts to clear the previous session
- **Dynamic Session Browsing** — Students see all available class sessions with live status (Active / Inactive)
- **Zoom Integration** — Joins Zoom meetings directly in the browser via the Zoom Meeting SDK (CDN-loaded)
- **Locked Zoom Identity** — Each student's LMS ID is automatically set as their Zoom display name and cannot be changed, preventing identity spoofing

### Admin Dashboard
- **JWT-protected** — All admin actions require a valid JWT token (24-hour expiry)
- **Session CRUD** — Create, edit, toggle (on/off), and delete class sessions stored in MongoDB
- **Student & Guest Management** — Manage student accounts and guest/mentor IDs directly
- **Live Stats** — At-a-glance counts of total, active, and inactive sessions
- **Active Students** — View which students are currently logged in and which session they have joined

### Backend
- **MongoDB-backed** — MongoDB Atlas is used as the single source of truth for all student credentials, sessions, and logs. This enables serverless deployments without read-only filesystem errors.
- **Cross-Origin Isolation** — Sets `COOP` / `COEP` / `CORP` headers required by the Zoom SDK's SharedArrayBuffer usage (camera/mic)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, CSS3, Vanilla JS (ES6+) |
| Backend | Node.js, Express.js 5.x |
| Database | MongoDB Atlas via Mongoose 7 |
| Auth — Admin | JWT (`jsonwebtoken`) |
| Auth — Zoom | HS256 JWT via `jsrsasign` |
| Zoom SDK | `@zoom/meetingsdk` 6.0.0 (served via CDN) |
| Environment | `dotenv` |

---

## 📁 Project Structure

```
DV Classroom Landing Page/
│
├── Logos/
│   └── DV-Logo.png               # Brand logo (also served as favicon)
│
├── public/                       # Static files served by Express
│   ├── index.html                # Student portal
│   ├── style.css                 # All styles
│   ├── script.js                 # Student portal frontend logic
│   └── admin/
│       ├── login.html            # Admin login page
│       ├── dashboard.html        # Admin dashboard
│       ├── dashboard.js          # Admin dashboard logic
│       └── dashboard.css         # Admin dashboard styles
│
├── routes/
│   ├── authRoutes.js             # Student auth endpoints (verify, logout, session)
│   ├── sessionRoutes.js          # Class session browsing & join-session endpoint
│   └── adminRoutes.js            # Admin CRUD endpoints (JWT-protected)
│
├── models/
│   ├── ClassSession.js           # Mongoose schema for class sessions
│   ├── ActiveSession.js          # Mongoose schema for active student logins
│   ├── Student.js                # Mongoose schema for LMS students
│   └── GuestMentorId.js          # Mongoose schema for Guest/Mentor IDs
│
├── middleware/
│   └── authMiddleware.js         # JWT verification middleware (admin routes)
│
├── utils/
│   ├── zoomSignature.js          # Zoom Meeting SDK JWT generation
│   ├── jwtUtils.js               # Admin JWT generate/verify helpers
│   └── mongoConnection.js        # Singleton MongoDB connection manager
│
├── scripts/
│   └── sync-zoom-sdk.js          # Postinstall: copies Zoom SDK dist to public/
│
├── server.js                     # Express app entry point
├── package.json
├── .env                          # Environment variables (gitignored)
├── .gitignore
└── README.md
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18.x or higher
- npm 9.x or higher
- MongoDB Atlas account (required)
- Zoom SDK credentials from [Zoom App Marketplace](https://marketplace.zoom.us)

### Step 1: Install Dependencies

```bash
npm install
```

This also runs the `postinstall` script which copies the Zoom SDK dist files into `public/zoom-sdk/dist/`.

### Step 2: Configure Environment Variables

Copy or edit `.env`:

```env
# Server
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:3000

# Zoom Meeting SDK
ZOOM_SDK_KEY=your_sdk_key
ZOOM_SDK_SECRET=your_sdk_secret

# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true

# JWT (Admin dashboard)
JWT_SECRET=change_this_to_a_long_random_string

# Admin credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_in_production

# Session config
SESSION_TIMEOUT_MINUTES=480
SESSION_CHECK_INTERVAL_MINUTES=30
```

### Step 3: Start the Server

```bash
npm start
```

```
╔════════════════════════════════════════════╗
║   DV Classroom Landing Page Server        ║
║   Status: Running ✓                        ║
║   Port: 3000                               ║
║   Environment: development                 ║
║   MongoDB: ✓ Connected                     ║
╚════════════════════════════════════════════╝

Student Portal: http://localhost:3000
Admin Login:    http://localhost:3000/admin/login
```

---

## ⚙️ Configuration

### Zoom SDK Setup

1. Go to [Zoom App Marketplace](https://marketplace.zoom.us) → **Build App** → **Meeting SDK**
2. Copy **SDK Key** and **SDK Secret** into `.env`
3. The Zoom SDK is loaded via CDN — no local build step required
4. Meeting numbers and passcodes are managed per-session by the admin, not hardcoded in `.env`

### MongoDB Setup

The server requires `MONGODB_URI` to be set. It acts as the single source of truth for all application data, making it fully compatible with serverless environments (like Vercel or AWS Lambda) that have read-only filesystems.

### Adding Students

Admins can add students and manage guest/mentor IDs directly through the Admin Dashboard interface, or via the exposed API endpoints.

---

## 📖 Usage

### Students

1. Open `http://localhost:3000`
2. Click **Join Class** and enter your LMS ID and name
3. After login, available class sessions are shown — click **Join Now** on an active session
4. The Zoom meeting launches directly in the browser
5. Your session persists across page refreshes — you will be returned to the sessions screen automatically on next visit
6. Click **Logout** to end your session

### Admins

1. Open `http://localhost:3000/admin/login`
2. Enter admin credentials (set in `.env`)
3. Use the dashboard to:
   - **Create** a new class session (title, Zoom meeting number, passcode, description)
   - **Toggle** sessions on/off to control student access
   - **Edit** or **Delete** sessions
   - **View** active students and which session they have joined
   - **Manage** student accounts and guest IDs

---

## 🔌 API Endpoints

### Student Endpoints

#### `POST /api/verify-student`
Verify credentials and create a login session.

**Request:**
```json
{
  "lmsId": "LMS1001",
  "name": "Rahul Kumar",
  "deviceToken": "DEVICE_1234567890_abcdef",
  "forceLogin": false
}
```

#### `GET /api/session/:lmsId`
Validate an existing session (used on page load to restore sessions).

#### `POST /api/logout`
End a student's active session.

#### `POST /api/force-logout`
Clear an existing session (used when student wants to log in from a new device).

#### `GET /api/class-sessions`
Fetch all class sessions (both on and off) for display in the student portal.

#### `POST /api/join-session`
Generate a Zoom JWT signature for a specific session.

---

### Admin Endpoints (all require `Authorization: Bearer <token>`)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/admin/login` | Login and receive JWT |
| `GET` | `/api/admin/sessions` | List all class sessions |
| `POST` | `/api/admin/session` | Create a new session |
| `GET` | `/api/admin/session/:id` | Get a single session |
| `PUT` | `/api/admin/session/:id` | Update session details |
| `PATCH` | `/api/admin/session/:id/status` | Toggle session `on`/`off` |
| `DELETE` | `/api/admin/session/:id` | Delete a session |
| `GET` | `/api/admin/active-sessions` | List currently logged-in students |
| `GET` | `/api/admin/students` | List all LMS students |
| `POST` | `/api/admin/students` | Add a new student |
| `PUT` | `/api/admin/students/:lmsId` | Update a student |
| `DELETE` | `/api/admin/students/:lmsId` | Delete a student |

---

### Health Check

#### `GET /health`
```json
{
  "status": "Server is running",
  "timestamp": "2026-05-10T17:30:00.000Z",
  "port": 3000,
  "mongooseConnected": true
}
```

---

## 💾 Database

### MongoDB Collections

1. **`class_sessions`** (ClassSession)
   - Stores all class sessions created by the admin.
2. **`active_sessions`** (ActiveSession)
   - Tracks which students are currently logged in.
3. **`students`** (Student)
   - Stores LMS student credentials (LMS ID, Name, Course).
4. **`guest_mentor_ids`** (GuestMentorId)
   - Tracks IDs available for guests, mentors, and mock interviews.

---

## 🔧 Troubleshooting

### "Invalid LMS ID or Student Name"
- Confirm the student exists in the database.
- Name matching is case-insensitive — casing or extra spaces are not the issue.
- Double-check the LMS ID exactly (e.g. `LMS1001` not `lms1001`).

### "Already Logged In On Another Device"
- Click **Clear Active Session** in the dialog to force-logout the previous device and continue on the current one.

### Zoom camera/mic not working
- Camera and mic require a **secure context** — use `https://` or `http://localhost`.
- Access over a LAN IP (`http://192.168.x.x`) will block media devices.
- The server sets COOP/COEP headers automatically to enable SharedArrayBuffer.

### "Database unavailable"
- Ensure `MONGODB_URI` is set in `.env` and the IP/network can reach Atlas.

---

## 🔐 Security Notes

1. **Never commit `.env`** — it is already gitignored
2. **Zoom SDK Secret** is only used server-side for JWT signing; it is never sent to the browser
3. **Zoom display name is locked** to the student's LMS ID — students cannot change it, ensuring classroom accountability
4. **One active session per student** — the device token system prevents shared logins
5. **Input sanitization** — all user inputs are trimmed and validated server-side before use
6. **Admin routes are JWT-protected** — tokens expire after 24 hours
7. **Change default admin credentials** in `.env` before any public deployment

---

## 📄 License

ISC License — DV Analytics
