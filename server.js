const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { ensureMongoConnection, isMongoConnected } = require('./utils/mongoConnection');

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const issueRoutes = require('./routes/issueRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// ====================================
// MONGODB CONNECTION
// ====================================

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
app.use(express.static(path.join(__dirname, 'public')));
// Serve branding/logo assets from project Logos folder
app.use('/Logos', express.static(path.join(__dirname, 'Logos')));

// Serve favicon from Logos (use DV-Logo.png as favicon placeholder)
app.get('/favicon.ico', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'Logos', 'DV-Logo.png'));
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

