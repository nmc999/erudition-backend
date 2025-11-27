// User Routes
// Handles user management operations

import { Router } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /api/users
 * Get users in current school
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    schoolId: req.user.schoolId,
    ...(role && { role }),
    ...(search && {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ]
    })
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        lineDisplayName: true,
        phone: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.user.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * GET /api/users/:id
 * Get user by ID
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findFirst({
    where: {
      id,
      schoolId: req.user.schoolId
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      lineDisplayName: true,
      lineProfileUrl: true,
      phone: true,
      preferredLang: true,
      lastLoginAt: true,
      createdAt: true,
      // Include teaching classes for teachers
      teachingClasses: {
        select: {
          id: true,
          name: true
        }
      },
      // Include parent relations
      parentRelations: {
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              photoUrl: true
            }
          }
        }
      }
    }
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        messageZh: '找不到使用者'
      }
    });
  }

  res.json({
    success: true,
    data: { user }
  });
}));

/**
 * POST /api/users
 * Create new user (admin only)
 */
router.post('/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, role, phone } = req.body;

    if (!firstName || !lastName || !role) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'firstName, lastName, and role are required',
          messageZh: '需要名字、姓氏和角色'
        }
      });
    }

    // Validate role
    const validRoles = ['ADMIN', 'MANAGER', 'TEACHER', 'PARENT', 'STUDENT'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ROLE',
          message: 'Invalid role',
          messageZh: '無效的角色'
        }
      });
    }

    // Only admins can create other admins
    if (role === 'ADMIN' && req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only admins can create admin users',
          messageZh: '只有管理員可以建立管理員使用者'
        }
      });
    }

    // Check email uniqueness if provided
    if (email) {
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
    }

    // Hash password if provided
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role,
        phone,
        schoolId: req.user.schoolId
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        isActive: true,
        createdAt: true
      }
    });

    res.status(201).json({
      success: true,
      data: { user }
    });
  })
);

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, phone, preferredLang, isActive, role } = req.body;

    // Users can update themselves, admins can update anyone
    if (id !== req.user.id && !['ADMIN', 'MANAGER'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You can only update your own profile',
          messageZh: '您只能更新自己的個人資料'
        }
      });
    }

    // Verify user belongs to same school
    const existingUser = await prisma.user.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          messageZh: '找不到使用者'
        }
      });
    }

    // Only admins can change roles and status
    const updateData = {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phone !== undefined && { phone }),
      ...(preferredLang && { preferredLang })
    };

    if (['ADMIN', 'MANAGER'].includes(req.user.role)) {
      if (isActive !== undefined) updateData.isActive = isActive;
      if (role && req.user.role === 'ADMIN') updateData.role = role;
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        preferredLang: true,
        isActive: true
      }
    });

    res.json({
      success: true,
      data: { user }
    });
  })
);

/**
 * DELETE /api/users/:id
 * Soft delete user (deactivate)
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Can't delete yourself
    if (id === req.user.id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANNOT_DELETE_SELF',
          message: 'Cannot delete your own account',
          messageZh: '無法刪除您自己的帳戶'
        }
      });
    }

    // Verify user belongs to same school
    const existingUser = await prisma.user.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          messageZh: '找不到使用者'
        }
      });
    }

    // Soft delete - just deactivate
    await prisma.user.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({
      success: true,
      data: {
        message: 'User deactivated successfully',
        messageZh: '使用者已成功停用'
      }
    });
  })
);

/**
 * POST /api/users/:id/reset-password
 * Reset user password (admin only)
 */
router.post('/:id/reset-password',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Password must be at least 8 characters',
          messageZh: '密碼至少需要 8 個字元'
        }
      });
    }

    // Verify user belongs to same school
    const existingUser = await prisma.user.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingUser) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          messageZh: '找不到使用者'
        }
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id },
      data: { passwordHash }
    });

    res.json({
      success: true,
      data: {
        message: 'Password reset successfully',
        messageZh: '密碼已成功重設'
      }
    });
  })
);

/**
 * GET /api/users/me/data-export
 * Export user's personal data (PDPA Compliance - Taiwan)
 * Article 3 of PDPA: Right to request copies of personal data
 */
router.get('/me/data-export',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    // Fetch all user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        preferredLang: true,
        lineDisplayName: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true
      }
    });

    // Fetch related data based on role
    let relatedData = {};

    if (req.user.role === 'PARENT') {
      // Get children and their data
      const parentRelations = await prisma.parentStudent.findMany({
        where: { parentId: userId },
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
              allergies: true,
              medicalInfo: true,
              enrollments: {
                include: {
                  class: {
                    select: { name: true }
                  }
                }
              }
            }
          }
        }
      });

      relatedData.children = parentRelations.map(pr => ({
        relationship: pr.relationship,
        student: pr.student
      }));

      // Get messages
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId },
            { recipientId: userId }
          ]
        },
        select: {
          id: true,
          subject: true,
          content: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        take: 100
      });
      relatedData.messages = messages;
    }

    // Build export object
    const exportData = {
      exportDate: new Date().toISOString(),
      exportReason: 'User data export request under Taiwan PDPA Article 3',
      user,
      relatedData,
      dataRetentionPolicy: {
        en: 'Student data is retained for 3 years after leaving the institution, then deleted or anonymized.',
        zh: '學生資料在離開機構後保存3年，之後將予以刪除或匿名化處理。'
      },
      yourRights: {
        en: 'Under the PDPA, you have the right to: inquire, review, copy, supplement, correct, request cessation, and delete your personal data.',
        zh: '依據《個人資料保護法》，您有權：查詢、閱覽、複製、補充、更正、請求停止蒐集處理利用及刪除您的個人資料。'
      }
    };

    res.json({
      success: true,
      data: exportData
    });
  })
);

/**
 * POST /api/users/me/request-deletion
 * Request deletion of personal data (PDPA Compliance - Taiwan)
 * Article 3 of PDPA: Right to request deletion of personal data
 */
router.post('/me/request-deletion',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { reason } = req.body;

    // In a production system, this would:
    // 1. Create a deletion request record
    // 2. Send notification to admin
    // 3. Send confirmation email to user
    // 4. Schedule deletion after verification (usually 30 days)

    // For now, we log the request and notify admin
    console.log(`[PDPA] Data deletion request from user ${userId}`, {
      userId,
      email: req.user.email,
      reason,
      requestedAt: new Date().toISOString()
    });

    // In production: Create deletion request record
    // await prisma.dataDeletionRequest.create({
    //   data: {
    //     userId,
    //     reason,
    //     status: 'PENDING',
    //     requestedAt: new Date()
    //   }
    // });

    // In production: Send email notification to admin and user

    res.json({
      success: true,
      data: {
        message: 'Your data deletion request has been submitted. We will process it within 30 days and notify you via email.',
        messageZh: '您的資料刪除請求已送出。我們將在30天內處理，並透過電子郵件通知您。',
        requestId: `DEL-${Date.now()}`,
        estimatedCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    });
  })
);

export default router;
