const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const mongoose = require('mongoose');
const { ensureMongoConnection, isMongoConnected } = require('./utils/mongoConnection');
const { autoFinalizeStaleSessions } = require('./utils/attendanceTracker');

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const issueRoutes = require('./routes/issueRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Enable gzip/deflate response compression
app.use(compression());

// ====================================
// MONGODB CONNECTION
// ====================================

async function cleanupLegacyAttendanceIndexes() {
  try {
    const attendanceCollection = mongoose.connection.collection('attendance_records');
    const attendanceIndexes = await attendanceCollection.indexes();

    for (const index of attendanceIndexes) {
      if (!index?.name || index.name === '_id_' || !index.key) {
        continue;
      }

      const indexKeys = Object.keys(index.key);
      const isLegacySessionIndex = index.unique
        && indexKeys.length === 2
        && index.key.lmsId === 1
        && index.key.sessionId === 1
        && !Object.prototype.hasOwnProperty.call(index.key, 'attendanceDate');

      if (!isLegacySessionIndex) {
        continue;
      }

      await attendanceCollection.dropIndex(index.name);
      console.log(`Dropped legacy attendance index ${index.name}`);
    }
  } catch (err) {
    // Ignore legacy index cleanup issues so the app can still boot on fresh databases.
  }
}

/**
 * Initialize MongoDB connection
 * MongoDB is used for:
 * - Class sessions management
 * - Active session tracking
 * - Student authentication and profile data
 */
const initializeDatabase = async () => {
  try {
    const connected = await ensureMongoConnection();

    if (!connected) {
      console.warn('⚠️  MONGODB_URI not configured. MongoDB features will be unavailable.');
      console.warn('    Student login, attendance, and admin features will not work until MongoDB is available.');
      return;
    }

    console.log('✓ MongoDB connected successfully');
    await cleanupLegacyAttendanceIndexes();

    // Attempt to drop the old unique index on attendance_records if it exists
    try {
      await mongoose.connection.collection('attendance_records').dropIndex('lmsId_1_sessionId_1');
      console.log('✓ Dropped old index lmsId_1_sessionId_1 successfully');
    } catch (err) {
      // index not found or couldn't be dropped, which is fine
    }

    try {
      const studentCollection = mongoose.connection.collection('students');
      const studentIndexes = await studentCollection.indexes();
      for (const index of studentIndexes) {
        if (index.name !== '_id_' && index.key && Object.prototype.hasOwnProperty.call(index.key, 'phoneNumber')) {
          await studentCollection.dropIndex(index.name);
        }
      }
    } catch (err) {
      // ignore legacy phone index cleanup issues on fresh databases
    }

    // Migrate student course field from String to [String]
    try {
      const studentCollection = mongoose.connection.collection('students');
      const cursor = studentCollection.find({ course: { $type: 'string' } });
      let migratedCount = 0;
      for await (const student of cursor) {
        if (typeof student.course !== 'string') {
          continue;
        }
        const courseName = student.course || '';
        const coursesArray = courseName.split(',').map(c => c.trim()).filter(Boolean);
        await studentCollection.updateOne(
          { _id: student._id },
          { $set: { course: coursesArray } }
        );
        migratedCount++;
      }
      if (migratedCount > 0) {
        console.log(`✓ Migrated ${migratedCount} student(s) to multiple course arrays`);
      }
    } catch (err) {
      console.error('Error migrating student course fields:', err.message);
    }

    // Start background finalizer to run every 1 minute.
    // The timeout inside autoFinalizeStaleSessions is intentionally long so
    // an in-progress Zoom session is not ended after a brief heartbeat gap.
    setInterval(async () => {
      try {
        if (mongoose.connection.readyState === 1) {
          await autoFinalizeStaleSessions();
        }
      } catch (error) {
        console.error('Error in stale session auto-finalizer interval:', error.message);
      }
    }, 60000);
    
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    console.warn('  Continuing in offline mode - MongoDB features unavailable');
  }
};

// Initialize database on startup
initializeDatabase();

// ====================================
// MIDDLEWARE
// ====================================

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Zoom Meeting SDK A/V reliability: enable cross-origin isolation (SharedArrayBuffer)
// Mirrors Zoom's official sample setup (COOP/COEP) so camera/mic can start reliably.
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Static file serving
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache static CSS, JS, etc. for 1 day
  etag: true
}));
// Serve branding/logo assets from project Logos folder
app.use('/Logos', express.static(path.join(__dirname, 'Logos'), {
  maxAge: '7d', // Cache logos for 7 days
  etag: true
}));

// Serve favicon from Logos (use DV-Logo.png as favicon placeholder)
app.get('/favicon.ico', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'Logos', 'DV-Logo.png'), {
      maxAge: '7d',
      headers: {
        'Cache-Control': 'public, max-age=604800'
      }
    });
  } catch (err) {
    res.status(404).end();
  }
});

// ====================================
// REQUEST LOGGING MIDDLEWARE
// ====================================

app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ====================================
// DATABASE CONNECTION MIDDLEWARE
// ====================================
// Ensures DB is connected before handling API requests (prevents cold-start 500 errors)
app.use('/api', async (req, res, next) => {
  try {
    await ensureMongoConnection();
    next();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] DB Connection Error during request to ${req.path}:`, error.message);
    res.status(500).json({ success: false, message: 'Database connection error. Please try again.' });
  }
});

// ====================================
// ROUTES
// ====================================

// Student API Routes
app.use('/api', authRoutes);

// Session API Routes (for fetching and joining sessions)
app.use('/api', sessionRoutes);

// Public issue reporting routes
app.use('/api', issueRoutes);

// Admin API Routes (with authentication)
app.use('/api/admin', adminRoutes);
app.use('/api/admin/attendance', attendanceRoutes);

// Serve admin dashboard
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    port: PORT,
    mongooseConnected: isMongoConnected()
  });
});

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ====================================
// ERROR HANDLING MIDDLEWARE
// ====================================

// 404 Not Found
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err })
  });
});

// ====================================
// START SERVER
// ====================================

const server = app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║   DV Classroom Landing Page Server        ║
  ║   Status: Running ✓                        ║
  ║   Port: ${PORT}                                ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}             ║
  ║   MongoDB: ${isMongoConnected() ? '✓ Connected' : '✗ Offline'}            ║
  ╚════════════════════════════════════════════╝
  `);
  console.log(`Student Portal: http://localhost:${PORT}`);
  console.log(`Admin Login: http://localhost:${PORT}/admin/login`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = app;

