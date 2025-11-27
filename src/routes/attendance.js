// Attendance Routes
// Handles attendance marking with automatic LINE notifications

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import lineService from '../services/lineService.js';

const router = Router();

/**
 * GET /api/attendance
 * Get attendance records with filters
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { classId, studentId, date, startDate, endDate, status, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Build date filter
  let dateFilter = {};
  if (date) {
    dateFilter = { date: new Date(date) };
  } else if (startDate && endDate) {
    dateFilter = {
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    };
  }

  const where = {
    class: { schoolId: req.user.schoolId },
    ...(classId && { classId }),
    ...(studentId && { studentId }),
    ...(status && { status }),
    ...dateFilter
  };

  // If teacher, only show their classes
  if (req.user.role === 'TEACHER') {
    where.class = {
      ...where.class,
      teacherId: req.user.id
    };
  }

  // If parent, only show their children
  if (req.user.role === 'PARENT') {
    const parentStudents = await prisma.parentStudent.findMany({
      where: { parentId: req.user.id },
      select: { studentId: true }
    });
    where.studentId = { in: parentStudents.map(ps => ps.studentId) };
  }

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            englishName: true
          }
        },
        class: {
          select: {
            id: true,
            name: true
          }
        },
        markedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' }
      ],
      skip,
      take
    }),
    prisma.attendance.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      records,
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
 * GET /api/attendance/class/:classId/date/:date
 * Get attendance for a specific class and date
 */
router.get('/class/:classId/date/:date', authenticate, asyncHandler(async (req, res) => {
  const { classId, date } = req.params;

  // Verify class exists and user has access
  const classData = await prisma.class.findFirst({
    where: {
      id: classId,
      schoolId: req.user.schoolId,
      ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
    },
    include: {
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

  // Get existing attendance records for this date
  const attendanceRecords = await prisma.attendance.findMany({
    where: {
      classId,
      date: new Date(date)
    }
  });

  // Create a map for quick lookup
  const attendanceMap = new Map(
    attendanceRecords.map(r => [r.studentId, r])
  );

  // Combine students with their attendance status
  const students = classData.enrollments.map(e => ({
    ...e.student,
    attendance: attendanceMap.get(e.student.id) || null
  }));

  res.json({
    success: true,
    data: {
      class: {
        id: classData.id,
        name: classData.name
      },
      date,
      students
    }
  });
}));

/**
 * POST /api/attendance
 * Mark attendance for a single student
 */
router.post('/',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { classId, studentId, date, status, reason, notes, notifyParent = true } = req.body;

    // Validate required fields
    if (!classId || !studentId || !date || !status) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'classId, studentId, date, and status are required',
          messageZh: '需要班級 ID、學生 ID、日期和狀態'
        }
      });
    }

    // Validate status
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'EARLY_LEAVE'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Invalid attendance status',
          messageZh: '無效的出席狀態'
        }
      });
    }

    // Verify class and student exist in school
    const [classData, student] = await Promise.all([
      prisma.class.findFirst({
        where: { id: classId, schoolId: req.user.schoolId }
      }),
      prisma.student.findFirst({
        where: { id: studentId, schoolId: req.user.schoolId },
        include: {
          parentRelations: {
            where: { isPrimary: true },
            include: {
              parent: {
                select: {
                  id: true,
                  lineUserId: true,
                  preferredLang: true
                }
              }
            }
          }
        }
      })
    ]);

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

    // Upsert attendance record
    const attendance = await prisma.attendance.upsert({
      where: {
        classId_studentId_date: {
          classId,
          studentId,
          date: new Date(date)
        }
      },
      update: {
        status,
        reason,
        notes,
        markedById: req.user.id,
        markedAt: new Date()
      },
      create: {
        classId,
        studentId,
        date: new Date(date),
        status,
        reason,
        notes,
        markedById: req.user.id
      }
    });

    // Send LINE notification for absences
    if (notifyParent && status !== 'PRESENT') {
      const primaryParent = student.parentRelations[0]?.parent;
      
      if (primaryParent?.lineUserId) {
        try {
          const studentName = `${student.firstName} ${student.lastName}`;
          const message = lineService.createAttendanceNotification(
            studentName,
            classData.name,
            date,
            status,
            reason
          );

          await lineService.sendPushMessage(primaryParent.lineUserId, message);

          // Update notification status
          await prisma.attendance.update({
            where: { id: attendance.id },
            data: {
              parentNotified: true,
              parentNotifiedAt: new Date()
            }
          });
        } catch (lineError) {
          console.error('Failed to send LINE notification:', lineError);
          // Continue without failing the request
        }
      }
    }

    res.status(201).json({
      success: true,
      data: { attendance }
    });
  })
);

/**
 * POST /api/attendance/bulk
 * Mark attendance for multiple students at once
 */
router.post('/bulk',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { classId, date, records, notifyParents = true } = req.body;

    // records should be array of { studentId, status, reason?, notes? }
    if (!classId || !date || !records || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'classId, date, and records array are required',
          messageZh: '需要班級 ID、日期和記錄陣列'
        }
      });
    }

    // Verify class exists
    const classData = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId }
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

    // Process each attendance record
    const results = [];
    const notificationsToSend = [];

    for (const record of records) {
      const { studentId, status, reason, notes } = record;

      if (!studentId || !status) continue;

      try {
        const attendance = await prisma.attendance.upsert({
          where: {
            classId_studentId_date: {
              classId,
              studentId,
              date: new Date(date)
            }
          },
          update: {
            status,
            reason,
            notes,
            markedById: req.user.id,
            markedAt: new Date()
          },
          create: {
            classId,
            studentId,
            date: new Date(date),
            status,
            reason,
            notes,
            markedById: req.user.id
          }
        });

        results.push({ studentId, success: true, attendance });

        // Queue notifications for non-present statuses
        if (notifyParents && status !== 'PRESENT') {
          notificationsToSend.push({ studentId, status, reason, attendanceId: attendance.id });
        }
      } catch (error) {
        results.push({ studentId, success: false, error: error.message });
      }
    }

    // Send notifications in background
    if (notificationsToSend.length > 0) {
      sendBulkNotifications(classData, date, notificationsToSend);
    }

    res.json({
      success: true,
      data: {
        message: `Processed ${results.length} attendance records`,
        messageZh: `已處理 ${results.length} 筆出席記錄`,
        results,
        notificationsPending: notificationsToSend.length
      }
    });
  })
);

// Helper function to send bulk notifications
async function sendBulkNotifications(classData, date, notifications) {
  for (const { studentId, status, reason, attendanceId } of notifications) {
    try {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: {
          parentRelations: {
            where: { isPrimary: true },
            include: {
              parent: {
                select: { lineUserId: true }
              }
            }
          }
        }
      });

      const primaryParent = student?.parentRelations[0]?.parent;
      
      if (primaryParent?.lineUserId) {
        const studentName = `${student.firstName} ${student.lastName}`;
        const message = lineService.createAttendanceNotification(
          studentName,
          classData.name,
          date,
          status,
          reason
        );

        await lineService.sendPushMessage(primaryParent.lineUserId, message);

        await prisma.attendance.update({
          where: { id: attendanceId },
          data: {
            parentNotified: true,
            parentNotifiedAt: new Date()
          }
        });
      }
    } catch (error) {
      console.error(`Failed to send notification for student ${studentId}:`, error);
    }
  }
}

/**
 * PUT /api/attendance/:id
 * Update attendance record
 */
router.put('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, reason, notes, notifyParent } = req.body;

    // Verify attendance record exists and belongs to school
    const existingRecord = await prisma.attendance.findFirst({
      where: {
        id,
        class: { schoolId: req.user.schoolId }
      },
      include: {
        class: true,
        student: {
          include: {
            parentRelations: {
              where: { isPrimary: true },
              include: {
                parent: { select: { lineUserId: true } }
              }
            }
          }
        }
      }
    });

    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: 'Attendance record not found',
          messageZh: '找不到出席記錄'
        }
      });
    }

    const attendance = await prisma.attendance.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(reason !== undefined && { reason }),
        ...(notes !== undefined && { notes }),
        markedById: req.user.id,
        markedAt: new Date()
      }
    });

    // Send notification if status changed to non-present
    if (notifyParent && status && status !== 'PRESENT' && status !== existingRecord.status) {
      const primaryParent = existingRecord.student.parentRelations[0]?.parent;
      
      if (primaryParent?.lineUserId) {
        try {
          const studentName = `${existingRecord.student.firstName} ${existingRecord.student.lastName}`;
          const message = lineService.createAttendanceNotification(
            studentName,
            existingRecord.class.name,
            existingRecord.date,
            status,
            reason
          );

          await lineService.sendPushMessage(primaryParent.lineUserId, message);

          await prisma.attendance.update({
            where: { id },
            data: {
              parentNotified: true,
              parentNotifiedAt: new Date()
            }
          });
        } catch (error) {
          console.error('Failed to send LINE notification:', error);
        }
      }
    }

    res.json({
      success: true,
      data: { attendance }
    });
  })
);

/**
 * GET /api/attendance/stats
 * Get attendance statistics
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const { classId, studentId, startDate, endDate } = req.query;

  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    };
  } else {
    // Default to last 30 days
    dateFilter = {
      date: {
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    };
  }

  const where = {
    class: { schoolId: req.user.schoolId },
    ...(classId && { classId }),
    ...(studentId && { studentId }),
    ...dateFilter
  };

  const stats = await prisma.attendance.groupBy({
    by: ['status'],
    where,
    _count: true
  });

  const total = stats.reduce((sum, s) => sum + s._count, 0);
  const presentCount = stats.find(s => s.status === 'PRESENT')?._count || 0;
  const attendanceRate = total > 0 ? ((presentCount / total) * 100).toFixed(1) : 0;

  res.json({
    success: true,
    data: {
      stats: {
        total,
        breakdown: stats.map(s => ({
          status: s.status,
          count: s._count,
          percentage: ((s._count / total) * 100).toFixed(1)
        })),
        attendanceRate: parseFloat(attendanceRate)
      }
    }
  });
}));

export default router;
