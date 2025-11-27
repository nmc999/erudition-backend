// Class Routes
// Handles class management and student enrollment

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /api/classes
 * Get all classes in current school
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { teacherId, search, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Teachers can only see their own classes unless admin/manager
  let teacherFilter = {};
  if (req.user.role === 'TEACHER') {
    teacherFilter = { teacherId: req.user.id };
  } else if (teacherId) {
    teacherFilter = { teacherId };
  }

  const where = {
    schoolId: req.user.schoolId,
    ...teacherFilter,
    ...(search && {
      name: { contains: search, mode: 'insensitive' }
    })
  };

  const [classes, total] = await Promise.all([
    prisma.class.findMany({
      where,
      include: {
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        _count: {
          select: {
            enrollments: {
              where: { status: 'ACTIVE' }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.class.count({ where })
  ]);

  // Transform _count to studentCount
  const transformedClasses = classes.map(c => ({
    ...c,
    studentCount: c._count.enrollments,
    _count: undefined
  }));

  res.json({
    success: true,
    data: {
      classes: transformedClasses,
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
 * GET /api/classes/:id
 * Get class details with enrolled students
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const classData = await prisma.class.findFirst({
    where: {
      id,
      schoolId: req.user.schoolId
    },
    include: {
      teacher: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true
        }
      },
      enrollments: {
        where: { status: 'ACTIVE' },
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              englishName: true,
              photoUrl: true
            }
          }
        },
        orderBy: {
          student: { firstName: 'asc' }
        }
      }
    }
  });

  if (!classData) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'CLASS_NOT_FOUND',
        message: 'Class not found',
        messageZh: '找不到班級'
      }
    });
  }

  // Transform enrollments to students array
  const students = classData.enrollments.map(e => e.student);

  res.json({
    success: true,
    data: {
      class: {
        ...classData,
        enrollments: undefined,
        students
      }
    }
  });
}));

/**
 * POST /api/classes
 * Create new class
 */
router.post('/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { 
      name, 
      description, 
      teacherId, 
      dayOfWeek, 
      startTime, 
      endTime, 
      maxStudents,
      academicYear,
      term
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NAME_REQUIRED',
          message: 'Class name is required',
          messageZh: '需要班級名稱'
        }
      });
    }

    // Verify teacher belongs to same school if provided
    if (teacherId) {
      const teacher = await prisma.user.findFirst({
        where: {
          id: teacherId,
          schoolId: req.user.schoolId,
          role: 'TEACHER'
        }
      });

      if (!teacher) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TEACHER',
            message: 'Teacher not found or not a teacher role',
            messageZh: '找不到老師或不是老師角色'
          }
        });
      }
    }

    const classData = await prisma.class.create({
      data: {
        name,
        description,
        teacherId,
        dayOfWeek,
        startTime,
        endTime,
        maxStudents: maxStudents || 20,
        academicYear,
        term,
        schoolId: req.user.schoolId
      },
      include: {
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.status(201).json({
      success: true,
      data: { class: classData }
    });
  })
);

/**
 * PUT /api/classes/:id
 * Update class
 */
router.put('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { 
      name, 
      description, 
      teacherId, 
      dayOfWeek, 
      startTime, 
      endTime, 
      maxStudents,
      academicYear,
      term
    } = req.body;

    // Verify class belongs to school
    const existingClass = await prisma.class.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingClass) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Class not found',
          messageZh: '找不到班級'
        }
      });
    }

    // Teachers can only update their own classes
    if (req.user.role === 'TEACHER' && existingClass.teacherId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You can only update your own classes',
          messageZh: '您只能更新自己的班級'
        }
      });
    }

    const classData = await prisma.class.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(teacherId !== undefined && { teacherId }),
        ...(dayOfWeek !== undefined && { dayOfWeek }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(maxStudents && { maxStudents }),
        ...(academicYear && { academicYear }),
        ...(term && { term })
      },
      include: {
        teacher: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: { class: classData }
    });
  })
);

/**
 * DELETE /api/classes/:id
 * Delete class
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify class belongs to school
    const existingClass = await prisma.class.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existingClass) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Class not found',
          messageZh: '找不到班級'
        }
      });
    }

    await prisma.class.delete({
      where: { id }
    });

    res.json({
      success: true,
      data: {
        message: 'Class deleted successfully',
        messageZh: '班級已成功刪除'
      }
    });
  })
);

/**
 * POST /api/classes/:id/enroll
 * Enroll student(s) in class
 */
router.post('/:id/enroll',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'STUDENTS_REQUIRED',
          message: 'Student IDs array is required',
          messageZh: '需要學生 ID 陣列'
        }
      });
    }

    // Verify class exists and belongs to school
    const classData = await prisma.class.findFirst({
      where: { id, schoolId: req.user.schoolId },
      include: {
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } }
          }
        }
      }
    });

    if (!classData) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Class not found',
          messageZh: '找不到班級'
        }
      });
    }

    // Check capacity
    const currentCount = classData._count.enrollments;
    if (currentCount + studentIds.length > classData.maxStudents) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CLASS_FULL',
          message: `Class would exceed maximum capacity of ${classData.maxStudents}`,
          messageZh: `班級將超過最大容量 ${classData.maxStudents}`
        }
      });
    }

    // Create enrollments (upsert to handle re-enrollment)
    const enrollments = await Promise.all(
      studentIds.map(studentId =>
        prisma.classEnrollment.upsert({
          where: {
            classId_studentId: { classId: id, studentId }
          },
          update: { status: 'ACTIVE' },
          create: {
            classId: id,
            studentId,
            status: 'ACTIVE'
          }
        })
      )
    );

    res.status(201).json({
      success: true,
      data: {
        message: `${enrollments.length} student(s) enrolled successfully`,
        messageZh: `${enrollments.length} 位學生已成功加入`,
        enrollments
      }
    });
  })
);

/**
 * POST /api/classes/:id/unenroll
 * Remove student(s) from class
 */
router.post('/:id/unenroll',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'STUDENTS_REQUIRED',
          message: 'Student IDs array is required',
          messageZh: '需要學生 ID 陣列'
        }
      });
    }

    // Update enrollments to DROPPED status
    await prisma.classEnrollment.updateMany({
      where: {
        classId: id,
        studentId: { in: studentIds }
      },
      data: { status: 'DROPPED' }
    });

    res.json({
      success: true,
      data: {
        message: `${studentIds.length} student(s) removed from class`,
        messageZh: `${studentIds.length} 位學生已從班級移除`
      }
    });
  })
);

/**
 * GET /api/classes/:id/students
 * Get students in a class
 */
router.get('/:id/students', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status = 'ACTIVE' } = req.query;

  // Verify class belongs to school
  const classData = await prisma.class.findFirst({
    where: { id, schoolId: req.user.schoolId }
  });

  if (!classData) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'CLASS_NOT_FOUND',
        message: 'Class not found',
        messageZh: '找不到班級'
      }
    });
  }

  const enrollments = await prisma.classEnrollment.findMany({
    where: {
      classId: id,
      status
    },
    include: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          englishName: true,
          photoUrl: true,
          status: true,
          parentRelations: {
            include: {
              parent: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  lineUserId: true,
                  phone: true
                }
              }
            }
          }
        }
      }
    },
    orderBy: {
      student: { firstName: 'asc' }
    }
  });

  const students = enrollments.map(e => ({
    ...e.student,
    enrollmentDate: e.enrollmentDate,
    enrollmentStatus: e.status
  }));

  res.json({
    success: true,
    data: { students }
  });
}));

export default router;
