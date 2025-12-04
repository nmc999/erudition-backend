// src/utils/debug.js
// Debug utility - toggle with DEBUG=true environment variable

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';

/**
 * Debug logger that only logs when DEBUG is enabled
 * In production, set DEBUG=true in Railway to enable
 */
export const debug = {
  log: (...args) => {
    if (DEBUG) console.log('[DEBUG]', ...args);
  },
  
  auth: (...args) => {
    if (DEBUG) console.log('[AUTH]', ...args);
  },
  
  db: (...args) => {
    if (DEBUG) console.log('[DB]', ...args);
  },
  
  api: (req, extra = {}) => {
    if (DEBUG) {
      console.log('[API]', {
        method: req.method,
        path: req.path,
        userId: req.user?.id,
        schoolId: req.user?.schoolId,
        role: req.user?.role,
        ...extra
      });
    }
  },
  
  error: (context, error) => {
    // Always log errors, but with more detail in debug mode
    if (DEBUG) {
      console.error(`[ERROR:${context}]`, {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    } else {
      console.error(`[ERROR:${context}]`, error.message);
    }
  }
};

export default debug;