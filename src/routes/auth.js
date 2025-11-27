// Authentication Routes
// Handles LINE Login OAuth flow and local authentication

import { Router } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken, authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import lineService from '../services/lineService.js';

const router = Router();

// Store state tokens temporarily (in production, use Redis)
const stateTokens = new Map();

// ======================
// LINE LOGIN
// ======================

/**
 * GET /api/auth/line/login
 * Initiate LINE Login flow
 */
router.get('/line/login', (req, res) => {
  // Generate state token for CSRF protection
  const state = crypto.randomBytes(32).toString('hex');
  
  // Store state with timestamp (expires in 10 minutes)
  stateTokens.set(state, {
    createdAt: Date.now(),
    schoolId: req.query.schoolId // Optional: for new user registration
  });

  // Clean up old states
  for (const [key, value] of stateTokens.entries()) {
    if (Date.now() - value.createdAt > 600000) {
      stateTokens.delete(key);
    }
  }

  const loginUrl = lineService.getLineLoginUrl(state);
  
  res.json({
    success: true,
    data: {
      loginUrl,
      state
    }
  });
});

/**
 * POST /api/auth/line/callback
 * Handle LINE Login callback
 */
router.post('/line/callback', asyncHandler(async (req, res) => {
  const { code, state, schoolId } = req.body;

  // Validate state token
  const storedState = stateTokens.get(state);
  if (!storedState) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATE',
        message: 'Invalid or expired state token',
        messageZh: '無效或過期的狀態碼'
      }
    });
  }

  // Remove used state
  stateTokens.delete(state);

  // Exchange code for tokens
  const tokens = await lineService.exchangeCodeForToken(code);
  
  // Get LINE profile
  const lineProfile = await lineService.getLineProfile(tokens.access_token);

  // Check if user exists
  let user = await prisma.user.findUnique({
    where: { lineUserId: lineProfile.userId }
  });

  if (user) {
    // Update LINE profile info
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        lineDisplayName: lineProfile.displayName,
        lineProfileUrl: lineProfile.pictureUrl,
        lineAccessToken: tokens.access_token,
        lastLoginAt: new Date()
      }
    });
  } else {
    // New user - requires schoolId
    const targetSchoolId = schoolId || storedState.schoolId;
    
    if (!targetSchoolId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SCHOOL_REQUIRED',
          message: 'School ID required for new user registration',
          messageZh: '新使用者註冊需要學校 ID'
        },
        data: {
          lineProfile: {
            lineUserId: lineProfile.userId,
            displayName: lineProfile.displayName,
            pictureUrl: lineProfile.pictureUrl
          },
          requiresRegistration: true
        }
      });
    }

    // Verify school exists
    const school = await prisma.school.findUnique({
      where: { id: targetSchoolId }
    });

    if (!school) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SCHOOL_NOT_FOUND',
          message: 'School not found',
          messageZh: '找不到學校'
        }
      });
    }

    // Create new user with LINE profile
    user = await prisma.user.create({
      data: {
        lineUserId: lineProfile.userId,
        lineDisplayName: lineProfile.displayName,
        lineProfileUrl: lineProfile.pictureUrl,
        lineAccessToken: tokens.access_token,
        firstName: lineProfile.displayName.split(' ')[0] || lineProfile.displayName,
        lastName: lineProfile.displayName.split(' ').slice(1).join(' ') || '',
        role: 'PARENT', // Default role for LINE login
        schoolId: targetSchoolId,
        lastLoginAt: new Date()
      }
    });
  }

  // Generate JWT token
  const accessToken = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        schoolId: user.schoolId,
        preferredLang: user.preferredLang,
        lineDisplayName: user.lineDisplayName,
        lineProfileUrl: user.lineProfileUrl
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '7d'
      }
    }
  });
}));

// ======================
// LOCAL AUTHENTICATION
// ======================

/**
 * POST /api/auth/register
 * Register new user with email/password
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName, schoolId, role } = req.body;

  // Validate required fields
  if (!email || !password || !firstName || !lastName || !schoolId) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELDS',
        message: 'Email, password, firstName, lastName, and schoolId are required',
        messageZh: '需要電子郵件、密碼、名字、姓氏和學校 ID'
      }
    });
  }

  // Verify school exists
  const school = await prisma.school.findUnique({
    where: { id: schoolId }
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'SCHOOL_NOT_FOUND',
        message: 'School not found',
        messageZh: '找不到學校'
      }
    });
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'EMAIL_EXISTS',
        message: 'Email already registered',
        messageZh: '電子郵件已被註冊'
      }
    });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 12);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName,
      lastName,
      schoolId,
      role: role || 'PARENT',
      lastLoginAt: new Date()
    }
  });

  // Generate tokens
  const accessToken = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.status(201).json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        schoolId: user.schoolId,
        preferredLang: user.preferredLang
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '7d'
      }
    }
  });
}));

/**
 * POST /api/auth/login
 * Login with email/password
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_CREDENTIALS',
        message: 'Email and password are required',
        messageZh: '需要電子郵件和密碼'
      }
    });
  }

  // Find user
  const user = await prisma.user.findUnique({
    where: { email }
  });

  if (!user || !user.passwordHash) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        messageZh: '電子郵件或密碼錯誤'
      }
    });
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        messageZh: '電子郵件或密碼錯誤'
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

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  // Generate tokens
  const accessToken = generateToken(user.id);
  const refreshToken = generateRefreshToken(user.id);

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        schoolId: user.schoolId,
        preferredLang: user.preferredLang,
        lineDisplayName: user.lineDisplayName,
        lineProfileUrl: user.lineProfileUrl
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: '7d'
      }
    }
  });
}));

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'Refresh token required',
        messageZh: '需要刷新權杖'
      }
    });
  }

  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_INVALID',
          message: 'User not found or disabled',
          messageZh: '找不到使用者或已停用'
        }
      });
    }

    // Generate new tokens
    const accessToken = generateToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    res.json({
      success: true,
      data: {
        tokens: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn: '7d'
        }
      }
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired refresh token',
        messageZh: '無效或過期的刷新權杖'
      }
    });
  }
}));

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      school: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        preferredLang: user.preferredLang,
        lineDisplayName: user.lineDisplayName,
        lineProfileUrl: user.lineProfileUrl,
        school: user.school
      }
    }
  });
}));

/**
 * PUT /api/auth/me
 * Update current user profile
 */
router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const { firstName, lastName, preferredLang, phone } = req.body;

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(preferredLang && { preferredLang }),
      ...(phone && { phone })
    }
  });

  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        preferredLang: user.preferredLang,
        phone: user.phone
      }
    }
  });
}));

/**
 * POST /api/auth/link-line
 * Link LINE account to existing user
 */
router.post('/link-line', authenticate, asyncHandler(async (req, res) => {
  const { code, state } = req.body;

  // Exchange code for tokens
  const tokens = await lineService.exchangeCodeForToken(code);
  
  // Get LINE profile
  const lineProfile = await lineService.getLineProfile(tokens.access_token);

  // Check if LINE account already linked to another user
  const existingUser = await prisma.user.findUnique({
    where: { lineUserId: lineProfile.userId }
  });

  if (existingUser && existingUser.id !== req.user.id) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'LINE_ALREADY_LINKED',
        message: 'This LINE account is already linked to another user',
        messageZh: '此 LINE 帳戶已連結到其他使用者'
      }
    });
  }

  // Update user with LINE info
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      lineUserId: lineProfile.userId,
      lineDisplayName: lineProfile.displayName,
      lineProfileUrl: lineProfile.pictureUrl,
      lineAccessToken: tokens.access_token
    }
  });

  res.json({
    success: true,
    data: {
      message: 'LINE account linked successfully',
      messageZh: 'LINE 帳戶已成功連結',
      lineDisplayName: user.lineDisplayName
    }
  });
}));

export default router;
