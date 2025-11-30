// Authentication Middleware
// Verifies JWT tokens and attaches user info to request

import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Verify JWT token and attach user to request
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required',
          messageZh: '需要存取權杖'
        }
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        schoolId: true,
        preferredLang: true,
        isActive: true,
        lineUserId: true,
        isSuperAdmin: true
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          messageZh: '找不到使用者'
        }
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Account is disabled',
          messageZh: '帳戶已停用'
        }
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
          messageZh: '無效的存取權杖'
        }
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
          messageZh: '存取權杖已過期'
        }
      });
    }

    next(error);
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        schoolId: true,
        preferredLang: true,
        isActive: true,
        isSuperAdmin: true
      }
    });

    if (user && user.isActive) {
      req.user = user;
    }

    next();
  } catch (error) {
    // Silently continue without user
    next();
  }
};

/**
 * Role-based access control middleware
 * @param  {...string} roles - Allowed roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          messageZh: '需要驗證'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          messageZh: '權限不足'
        }
      });
    }

    next();
  };
};

/**
 * Verify user belongs to the same school as the resource
 */
export const verifySchoolAccess = (req, res, next) => {
  const schoolId = req.params.schoolId || req.body.schoolId || req.query.schoolId;
  
  if (!schoolId) {
    return next();
  }

  // Admins can only access their own school
  if (req.user.schoolId !== schoolId) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'SCHOOL_ACCESS_DENIED',
        message: 'You do not have access to this school',
        messageZh: '您沒有此學校的存取權限'
      }
    });
  }

  next();
};

/**
 * Generate JWT token for user
 */
export const generateToken = (userId, expiresIn = '7d') => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn });
};

/**
 * Generate refresh token
 */
export const generateRefreshToken = (userId) => {
  return jwt.sign({ userId, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
};

export default { 
  authenticate, 
  optionalAuth, 
  authorize, 
  verifySchoolAccess,
  generateToken,
  generateRefreshToken
};
