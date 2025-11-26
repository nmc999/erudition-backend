// Erudition Backend Server
// Main entry point for Express application

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Import routes
import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import userRoutes from './routes/users.js';
import classRoutes from './routes/classes.js';
import attendanceRoutes from './routes/attendance.js';
import homeworkRoutes from './routes/homework.js';
import messageRoutes from './routes/messages.js';
import lineWebhook from './routes/lineWebhook.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ======================
// MIDDLEWARE
// ======================

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
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

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/schools', schoolRoutes);
app.use('/api/users', userRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/homework', homeworkRoutes);
app.use('/api/messages', messageRoutes);

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
