// Erudition Backend Server
// Main entry point for Express application

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Load environment variables FIRST
dotenv.config();

// Log environment check (without sensitive data)
console.log('🔧 Environment Check:');
console.log('  - NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('  - PORT:', process.env.PORT || '3001 (default)');
console.log('  - DATABASE_URL:', process.env.DATABASE_URL ? `Set (${process.env.DATABASE_URL.length} chars)` : '❌ NOT SET');
console.log('  - CLIENT_URL:', process.env.CLIENT_URL || 'not set');

// Import routes
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import userRoutes from './routes/users.js';
import classRoutes from './routes/classes.js';
import attendanceRoutes from './routes/attendance.js';
import homeworkRoutes from './routes/homework.js';
import messageRoutes from './routes/messages.js';
import lineWebhook from './routes/lineWebhook.js';
import reportsRoutes from './routes/reports.js';
import invoicesRoutes from './routes/invoices.js';
import parentRoutes from './routes/parent.js';
import studentRoutes from './routes/students.js';
import publicRoutes from './routes/publicRoutes.js';
import curriculumRoutes from './routes/curriculum.js';
import paymentRoutes from './routes/payments.js';
import schoolSettingsRoutes from './routes/schoolSettings.js';
import onboardingRoutes from './routes/onboarding.js';
import superadminRoutes from './routes/superadmin.js';
import prisma from './config/database.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ======================
// MIDDLEWARE
// ======================

// Security headers
app.use(helmet());

// CORS configuration - allow frontend origins and subdomains
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:5174'
].filter(Boolean)

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)
    
    // Allow main domain and all subdomains of erudition.tw
    if (origin.match(/^https?:\/\/([a-z0-9-]+\.)?erudition\.tw$/)) {
      return callback(null, true)
    }
    
    if (allowedOrigins.some(allowed => origin.startsWith(allowed.replace(/\/$/, '')))) {
      return callback(null, true)
    }
    
    // In development, allow any localhost
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) {
      return callback(null, true)
    }
    
    callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Request logging
app.use(morgan('dev'));

// Body parsing - Note: LINE webhook needs raw body, so we handle it specially
app.use('/api/webhook/line', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// ROUTES
// ======================

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Erudition API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Database health check endpoint
app.get('/api/health/db', async (req, res) => {
  try {
    // Try a simple query
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    res.status(500).json({ 
      status: 'error', 
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/invoices', invoicesRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/curriculum', curriculumRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/school', schoolSettingsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/superadmin', superadminRoutes);

// LINE Webhook (separate path for raw body handling)
app.use('/api/webhook/line', lineWebhook);

// ======================
// ERROR HANDLING
// ======================

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ======================
// START SERVER
// ======================

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   🎓 Erudition Server Running                     ║
  ║                                                   ║
  ║   Port: ${PORT}                                      ║
  ║   Mode: ${process.env.NODE_ENV || 'development'}                            ║
  ║   Time: ${new Date().toLocaleTimeString()}                              ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `);
});

export default app;
