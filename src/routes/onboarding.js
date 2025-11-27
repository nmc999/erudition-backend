// School Onboarding Routes
// Handles new school registration and setup

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * POST /api/onboarding/register
 * Register a new school (creates school + admin user)
 */
router.post('/register', asyncHandler(async (req, res) => {
  const {
    // School info
    schoolName,
    subdomain,
    address,
    phone,
    email,
    
    // Admin user info
    adminFirstName,
    adminLastName,
    adminEmail,
    adminPassword,
    adminPhone
  } = req.body;

  // Validate required fields
  if (!schoolName || !subdomain || !adminFirstName || !adminLastName || !adminEmail || !adminPassword) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELDS',
        message: 'Missing required fields',
        messageZh: '缺少必填欄位'
      }
    });
  }

  // Validate subdomain format (lowercase, alphanumeric, hyphens, 3-30 chars)
  const subdomainRegex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  if (!subdomainRegex.test(subdomain)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_SUBDOMAIN',
        message: 'Subdomain must be 3-30 characters, lowercase letters, numbers, and hyphens only',
        messageZh: '子網域必須為3-30個字元，僅限小寫字母、數字和連字號'
      }
    });
  }

  // Reserved subdomains
  const reserved = ['www', 'api', 'app', 'admin', 'mail', 'ftp', 'test', 'demo', 'staging', 'dev'];
  if (reserved.includes(subdomain)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'RESERVED_SUBDOMAIN',
        message: 'This subdomain is reserved',
        messageZh: '此子網域已被保留'
      }
    });
  }

  // Check subdomain availability
  const existingSchool = await prisma.school.findUnique({
    where: { subdomain }
  });

  if (existingSchool) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'SUBDOMAIN_TAKEN',
        message: 'This subdomain is already in use',
        messageZh: '此子網域已被使用'
      }
    });
  }

  // Check admin email availability
  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (existingUser) {
    return res.status(409).json({
      success: false,
      error: {
        code: 'EMAIL_EXISTS',
        message: 'This email is already registered',
        messageZh: '此電子郵件已被註冊'
      }
    });
  }

  // Validate password strength
  if (adminPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters',
        messageZh: '密碼至少需要8個字元'
      }
    });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  // Create school and admin user in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Create school
    const school = await tx.school.create({
      data: {
        name: schoolName,
        subdomain,
        address: address || null,
        phone: phone || null,
        email: email || null,
        billingEmail: adminEmail,
        subscriptionStatus: 'ACTIVE',
        pricePerStudent: 50
      }
    });

    // Create admin user
    const admin = await tx.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        firstName: adminFirstName,
        lastName: adminLastName,
        phone: adminPhone || null,
        role: 'ADMIN',
        schoolId: school.id,
        isActive: true
      }
    });

    return { school, admin };
  });

  // In production: 
  // 1. Send welcome email with setup guide
  // 2. Create Stripe customer for billing
  // 3. Log onboarding event

  res.status(201).json({
    success: true,
    message: 'School registered successfully',
    messageZh: '學校註冊成功',
    data: {
      school: {
        id: result.school.id,
        name: result.school.name,
        subdomain: result.school.subdomain
      },
      admin: {
        id: result.admin.id,
        email: result.admin.email,
        firstName: result.admin.firstName,
        lastName: result.admin.lastName
      },
      loginUrl: `https://${subdomain}.erudition.tw/login`
    }
  });
}));

/**
 * GET /api/onboarding/check-subdomain/:subdomain
 * Check if subdomain is available
 */
router.get('/check-subdomain/:subdomain', asyncHandler(async (req, res) => {
  const { subdomain } = req.params;

  // Validate format
  const subdomainRegex = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  if (!subdomainRegex.test(subdomain)) {
    return res.json({
      success: true,
      data: {
        available: false,
        reason: 'invalid_format'
      }
    });
  }

  // Check reserved
  const reserved = ['www', 'api', 'app', 'admin', 'mail', 'ftp', 'test', 'demo', 'staging', 'dev'];
  if (reserved.includes(subdomain)) {
    return res.json({
      success: true,
      data: {
        available: false,
        reason: 'reserved'
      }
    });
  }

  // Check database
  const existing = await prisma.school.findUnique({
    where: { subdomain },
    select: { id: true }
  });

  res.json({
    success: true,
    data: {
      available: !existing,
      reason: existing ? 'taken' : null
    }
  });
}));

/**
 * GET /api/onboarding/pricing
 * Get current pricing info
 */
router.get('/pricing', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      pricePerStudent: 50,
      currency: 'TWD',
      billingCycle: 'monthly',
      features: [
        'Unlimited classes',
        'Attendance tracking',
        'Homework management',
        'Parent communication',
        'Invoice management',
        'LINE integration',
        'Custom branding',
        'Configurable permissions'
      ],
      featuresZh: [
        '無限班級數',
        '出席追蹤',
        '作業管理',
        '家長溝通',
        '帳單管理',
        'LINE 整合',
        '自訂品牌',
        '可設定權限'
      ]
    }
  });
}));

export default router;
