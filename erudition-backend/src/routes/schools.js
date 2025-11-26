// School Routes
// Handles school CRUD operations and settings

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize, verifySchoolAccess } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

/**
 * POST /api/schools
 * Create a new school (typically done during onboarding)
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name, address, phone, email } = req.body;

  if (!name) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NAME_REQUIRED',
        message: 'School name is required',
        messageZh: '需要學校名稱'
      }
    });
  }

  const school = await prisma.school.create({
    data: {
      name,
      address,
      phone,
      email,
      settings: {
        timezone: 'Asia/Taipei',
        currency: 'TWD',
        language: 'zh-TW'
      }
    }
  });

  res.status(201).json({
    success: true,
    data: { school }
  });
}));

/**
 * GET /api/schools/:id
 * Get school details
 */
router.get('/:id', authenticate, verifySchoolAccess, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const school = await prisma.school.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          users: true,
          classes: true,
          students: true
        }
      }
    }
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

  res.json({
    success: true,
    data: { school }
  });
}));

/**
 * PUT /api/schools/:id
 * Update school details
 */
router.put('/:id', 
  authenticate, 
  authorize('ADMIN', 'MANAGER'), 
  verifySchoolAccess,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, email, settings } = req.body;

    const school = await prisma.school.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(address && { address }),
        ...(phone && { phone }),
        ...(email && { email }),
        ...(settings && { settings })
      }
    });

    res.json({
      success: true,
      data: { school }
    });
  })
);

/**
 * PUT /api/schools/:id/line-config
 * Update LINE integration settings
 */
router.put('/:id/line-config',
  authenticate,
  authorize('ADMIN'),
  verifySchoolAccess,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { lineChannelId, lineChannelSecret, lineAccessToken } = req.body;

    const school = await prisma.school.update({
      where: { id },
      data: {
        lineChannelId,
        lineChannelSecret,
        lineAccessToken
      }
    });

    res.json({
      success: true,
      data: {
        message: 'LINE configuration updated',
        messageZh: 'LINE 設定已更新'
      }
    });
  })
);

/**
 * GET /api/schools/:id/stats
 * Get school statistics
 */
router.get('/:id/stats',
  authenticate,
  verifySchoolAccess,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get counts
    const [
      totalStudents,
      activeStudents,
      totalClasses,
      totalTeachers,
      totalParents,
      recentAttendance
    ] = await Promise.all([
      prisma.student.count({ where: { schoolId: id } }),
      prisma.student.count({ where: { schoolId: id, status: 'ACTIVE' } }),
      prisma.class.count({ where: { schoolId: id } }),
      prisma.user.count({ where: { schoolId: id, role: 'TEACHER', isActive: true } }),
      prisma.user.count({ where: { schoolId: id, role: 'PARENT', isActive: true } }),
      // Get attendance for last 7 days
      prisma.attendance.groupBy({
        by: ['status'],
        where: {
          class: { schoolId: id },
          date: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        _count: true
      })
    ]);

    // Calculate attendance rate
    const attendanceTotal = recentAttendance.reduce((sum, r) => sum + r._count, 0);
    const presentCount = recentAttendance.find(r => r.status === 'PRESENT')?._count || 0;
    const attendanceRate = attendanceTotal > 0 ? (presentCount / attendanceTotal * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        stats: {
          students: {
            total: totalStudents,
            active: activeStudents
          },
          classes: totalClasses,
          teachers: totalTeachers,
          parents: totalParents,
          attendance: {
            rate: parseFloat(attendanceRate),
            breakdown: recentAttendance
          }
        }
      }
    });
  })
);

/**
 * GET /api/schools/:id/users
 * Get all users in a school
 */
router.get('/:id/users',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  verifySchoolAccess,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role, page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      schoolId: id,
      ...(role && { role })
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
  })
);

export default router;
