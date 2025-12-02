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
        },
        parentRelations: {
          select: {
            relationship: true,
            isPrimary: true,
            parent: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true
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

/**
 * POST /api/students/:id/link-parent
 * Link a parent to a student
 */
router.post('/:id/link-parent',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { parentId, relationship = 'parent', isPrimary = false } = req.body;

    // Verify student belongs to school
    const student = await prisma.student.findFirst({
      where: {
        id,
        schoolId: req.user.schoolId
      }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Student not found',
          messageZh: '找不到學生'
        }
      });
    }

    // Verify parent exists and is in the same school
    const parent = await prisma.user.findFirst({
      where: {
        id: parentId,
        schoolId: req.user.schoolId,
        role: 'PARENT'
      }
    });

    if (!parent) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Parent not found',
          messageZh: '找不到家長'
        }
      });
    }

    // Check if relationship already exists
    const existingRelation = await prisma.parentStudent.findFirst({
      where: {
        parentId,
        studentId: id
      }
    });

    if (existingRelation) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Parent is already linked to this student',
          messageZh: '家長已連結此學生'
        }
      });
    }

    // If isPrimary, unset other primary relations for this student
    if (isPrimary) {
      await prisma.parentStudent.updateMany({
        where: { studentId: id },
        data: { isPrimary: false }
      });
    }

    // Create the relationship
    const relation = await prisma.parentStudent.create({
      data: {
        parentId,
        studentId: id,
        relationship,
        isPrimary
      },
      include: {
        parent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: {
        relation,
        message: 'Parent linked successfully',
        messageZh: '家長已成功連結'
      }
    });
  })
);

/**
 * DELETE /api/students/:id/unlink-parent/:parentId
 * Unlink a parent from a student
 */
router.delete('/:id/unlink-parent/:parentId',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { id, parentId } = req.params;

    // Verify student belongs to school
    const student = await prisma.student.findFirst({
      where: {
        id,
        schoolId: req.user.schoolId
      }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Student not found',
          messageZh: '找不到學生'
        }
      });
    }

    // Delete the relationship
    await prisma.parentStudent.deleteMany({
      where: {
        parentId,
        studentId: id
      }
    });

    res.json({
      success: true,
      data: {
        message: 'Parent unlinked successfully',
        messageZh: '家長已成功取消連結'
      }
    });
  })
);

export default router;
