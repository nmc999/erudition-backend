// Student Routes
// Handles student management

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /api/students
 * Get all students in current school
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { search, status = 'ACTIVE', classId, page = 1, limit = 100 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    schoolId: req.user.schoolId,
    ...(status && { status }),
    ...(search && {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { englishName: { contains: search, mode: 'insensitive' } }
      ]
    }),
    ...(classId && {
      enrollments: {
        some: {
          classId,
          status: 'ACTIVE'
        }
      }
    })
  };

  const [students, total] = await Promise.all([
    prisma.student.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        englishName: true,
        dateOfBirth: true,
        phone: true,
        email: true,
        status: true,
        photoUrl: true,
        medicalInfo: true,
        allergies: true,
        emergencyContactName: true,
        emergencyContactPhone: true,
        enrollments: {
          where: { status: 'ACTIVE' },
          select: {
            class: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      },
      orderBy: [
        { lastName: 'asc' },
        { firstName: 'asc' }
      ],
      skip,
      take
    }),
    prisma.student.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      students,
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
 * GET /api/students/:id
 * Get student details
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const student = await prisma.student.findFirst({
    where: {
      id,
      schoolId: req.user.schoolId
    },
    include: {
      enrollments: {
        where: { status: 'ACTIVE' },
        include: {
          class: {
            select: {
              id: true,
              name: true,
              teacher: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      },
      parentRelations: {
        include: {
          parent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              lineUserId: true
            }
          }
        }
      }
    }
  });

  if (!student) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'STUDENT_NOT_FOUND',
        message: 'Student not found',
        messageZh: '找不到學生'
      }
    });
  }

  res.json({
    success: true,
    data: { student }
  });
}));

/**
 * POST /api/students
 * Create new student
 */
router.post('/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const {
      firstName,
      lastName,
      englishName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      medicalInfo,
      allergies,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation
    } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NAME_REQUIRED',
          message: 'First name and last name are required',
          messageZh: '需要姓名'
        }
      });
    }

    const student = await prisma.student.create({
      data: {
        firstName,
        lastName,
        englishName,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender,
        phone,
        email,
        address,
        medicalInfo,
        allergies,
        emergencyContactName,
        emergencyContactPhone,
        emergencyContactRelation,
        status: 'ACTIVE',
        schoolId: req.user.schoolId
      }
    });

    res.status(201).json({
      success: true,
      data: { student }
    });
  })
);

/**
 * PUT /api/students/:id
 * Update student
 */
router.put('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
      firstName,
      lastName,
      englishName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      medicalInfo,
      allergies,
      emergencyContactName,
      emergencyContactPhone,
      emergencyContactRelation,
      status
    } = req.body;

    // Verify student belongs to school
    const existingStudent = await prisma.student.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found',
          messageZh: '找不到學生'
        }
      });
    }

    const student = await prisma.student.update({
      where: { id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(englishName !== undefined && { englishName }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
        ...(gender !== undefined && { gender }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(address !== undefined && { address }),
        ...(medicalInfo !== undefined && { medicalInfo }),
        ...(allergies !== undefined && { allergies }),
        ...(emergencyContactName !== undefined && { emergencyContactName }),
        ...(emergencyContactPhone !== undefined && { emergencyContactPhone }),
        ...(emergencyContactRelation !== undefined && { emergencyContactRelation }),
        ...(status && { status })
      }
    });

    res.json({
      success: true,
      data: { student }
    });
  })
);

/**
 * DELETE /api/students/:id
 * Delete student (soft delete - set status to INACTIVE)
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify student belongs to school
    const existingStudent = await prisma.student.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'STUDENT_NOT_FOUND',
          message: 'Student not found',
          messageZh: '找不到學生'
        }
      });
    }

    // Soft delete - set status to INACTIVE
    await prisma.student.update({
      where: { id },
      data: { status: 'INACTIVE' }
    });

    res.json({
      success: true,
      data: {
        message: 'Student deactivated successfully',
        messageZh: '學生已成功停用'
      }
    });
  })
);

export default router;
