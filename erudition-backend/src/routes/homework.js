// Homework Routes
// Handles homework assignments, submissions, and grading

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import lineService from '../services/lineService.js';

const router = Router();

/**
 * GET /api/homework
 * Get homework assignments with filters
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { classId, studentId, upcoming, overdue, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const now = new Date();
  let dateFilter = {};
  
  if (upcoming === 'true') {
    dateFilter = { dueDate: { gte: now } };
  } else if (overdue === 'true') {
    dateFilter = { dueDate: { lt: now } };
  }

  const where = {
    class: { schoolId: req.user.schoolId },
    ...(classId && { classId }),
    ...dateFilter
  };

  // Teachers see their own classes
  if (req.user.role === 'TEACHER') {
    where.class = {
      ...where.class,
      teacherId: req.user.id
    };
  }

  // Parents and students see their enrolled classes
  if (['PARENT', 'STUDENT'].includes(req.user.role)) {
    let studentIds = [];
    
    if (req.user.role === 'PARENT') {
      const parentStudents = await prisma.parentStudent.findMany({
        where: { parentId: req.user.id },
        select: { studentId: true }
      });
      studentIds = parentStudents.map(ps => ps.studentId);
    } else {
      // For STUDENT role, we'd need a studentId linked to user
      // For now, skip this filter
    }

    if (studentIds.length > 0) {
      const enrollments = await prisma.classEnrollment.findMany({
        where: { 
          studentId: { in: studentIds },
          status: 'ACTIVE'
        },
        select: { classId: true }
      });
      where.classId = { in: enrollments.map(e => e.classId) };
    }
  }

  const [homework, total] = await Promise.all([
    prisma.homework.findMany({
      where,
      include: {
        class: {
          select: {
            id: true,
            name: true
          }
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        _count: {
          select: { submissions: true }
        }
      },
      orderBy: { dueDate: 'asc' },
      skip,
      take
    }),
    prisma.homework.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      homework: homework.map(h => ({
        ...h,
        submissionCount: h._count.submissions,
        _count: undefined
      })),
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
 * GET /api/homework/:id
 * Get homework details with submissions
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const homework = await prisma.homework.findFirst({
    where: {
      id,
      class: { schoolId: req.user.schoolId }
    },
    include: {
      class: {
        select: {
          id: true,
          name: true
        }
      },
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      },
      submissions: {
        include: {
          student: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              englishName: true
            }
          },
          gradedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { submittedAt: 'desc' }
      }
    }
  });

  if (!homework) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'HOMEWORK_NOT_FOUND',
        message: 'Homework not found',
        messageZh: '找不到作業'
      }
    });
  }

  res.json({
    success: true,
    data: { homework }
  });
}));

/**
 * POST /api/homework
 * Create new homework assignment
 */
router.post('/',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { 
      classId, 
      title, 
      description, 
      dueDate, 
      attachments,
      maxScore,
      allowLateSubmission,
      notifyStudents = true
    } = req.body;

    if (!classId || !title || !dueDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'classId, title, and dueDate are required',
          messageZh: '需要班級 ID、標題和截止日期'
        }
      });
    }

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
        }
      }
    });

    if (!classData) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Class not found or access denied',
          messageZh: '找不到班級或拒絕存取'
        }
      });
    }

    const homework = await prisma.homework.create({
      data: {
        classId,
        title,
        description,
        dueDate: new Date(dueDate),
        attachments: attachments || [],
        maxScore,
        allowLateSubmission: allowLateSubmission !== false,
        createdById: req.user.id
      },
      include: {
        class: {
          select: { id: true, name: true }
        }
      }
    });

    // Send notifications to parents
    if (notifyStudents) {
      sendHomeworkNotifications(classData, homework);
    }

    res.status(201).json({
      success: true,
      data: { homework }
    });
  })
);

// Helper to send homework notifications
async function sendHomeworkNotifications(classData, homework) {
  for (const enrollment of classData.enrollments) {
    const student = enrollment.student;
    const primaryParent = student.parentRelations[0]?.parent;
    
    if (primaryParent?.lineUserId) {
      try {
        const studentName = `${student.firstName} ${student.lastName}`;
        const message = `【新作業通知】\n` +
          `學生：${studentName}\n` +
          `班級：${classData.name}\n` +
          `作業：${homework.title}\n` +
          `截止日期：${new Date(homework.dueDate).toLocaleDateString('zh-TW')}\n` +
          `${homework.description ? `說明：${homework.description}` : ''}`;

        await lineService.sendPushMessage(primaryParent.lineUserId, message);
      } catch (error) {
        console.error(`Failed to send homework notification to parent of ${student.firstName}:`, error);
      }
    }
  }
}

/**
 * PUT /api/homework/:id
 * Update homework assignment
 */
router.put('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, description, dueDate, attachments, maxScore, allowLateSubmission } = req.body;

    // Verify homework exists and user has access
    const existingHomework = await prisma.homework.findFirst({
      where: {
        id,
        class: {
          schoolId: req.user.schoolId,
          ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
        }
      }
    });

    if (!existingHomework) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'HOMEWORK_NOT_FOUND',
          message: 'Homework not found or access denied',
          messageZh: '找不到作業或拒絕存取'
        }
      });
    }

    const homework = await prisma.homework.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(dueDate && { dueDate: new Date(dueDate) }),
        ...(attachments && { attachments }),
        ...(maxScore !== undefined && { maxScore }),
        ...(allowLateSubmission !== undefined && { allowLateSubmission })
      }
    });

    res.json({
      success: true,
      data: { homework }
    });
  })
);

/**
 * DELETE /api/homework/:id
 * Delete homework assignment
 */
router.delete('/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Verify homework exists and user has access
    const existingHomework = await prisma.homework.findFirst({
      where: {
        id,
        class: {
          schoolId: req.user.schoolId,
          ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
        }
      }
    });

    if (!existingHomework) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'HOMEWORK_NOT_FOUND',
          message: 'Homework not found',
          messageZh: '找不到作業'
        }
      });
    }

    await prisma.homework.delete({
      where: { id }
    });

    res.json({
      success: true,
      data: {
        message: 'Homework deleted successfully',
        messageZh: '作業已成功刪除'
      }
    });
  })
);

// ======================
// SUBMISSIONS
// ======================

/**
 * POST /api/homework/:id/submit
 * Submit homework
 */
router.post('/:id/submit',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { studentId, content, attachments } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'STUDENT_REQUIRED',
          message: 'studentId is required',
          messageZh: '需要學生 ID'
        }
      });
    }

    // Verify homework exists
    const homework = await prisma.homework.findFirst({
      where: {
        id,
        class: { schoolId: req.user.schoolId }
      }
    });

    if (!homework) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'HOMEWORK_NOT_FOUND',
          message: 'Homework not found',
          messageZh: '找不到作業'
        }
      });
    }

    // Check if late
    const now = new Date();
    const isLate = now > homework.dueDate;

    if (isLate && !homework.allowLateSubmission) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'LATE_NOT_ALLOWED',
          message: 'Late submissions are not allowed for this homework',
          messageZh: '此作業不允許遲交'
        }
      });
    }

    // Create or update submission
    const submission = await prisma.homeworkSubmission.upsert({
      where: {
        homeworkId_studentId: {
          homeworkId: id,
          studentId
        }
      },
      update: {
        content,
        attachments: attachments || [],
        submittedAt: new Date(),
        status: isLate ? 'LATE' : 'SUBMITTED'
      },
      create: {
        homeworkId: id,
        studentId,
        content,
        attachments: attachments || [],
        status: isLate ? 'LATE' : 'SUBMITTED'
      },
      include: {
        student: {
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
      data: { 
        submission,
        isLate
      }
    });
  })
);

/**
 * PUT /api/homework/:id/submissions/:submissionId/grade
 * Grade a submission
 */
router.put('/:id/submissions/:submissionId/grade',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id, submissionId } = req.params;
    const { score, feedback } = req.body;

    // Verify submission exists and belongs to this homework
    const submission = await prisma.homeworkSubmission.findFirst({
      where: {
        id: submissionId,
        homeworkId: id,
        homework: {
          class: {
            schoolId: req.user.schoolId,
            ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
          }
        }
      },
      include: {
        homework: true,
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

    if (!submission) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SUBMISSION_NOT_FOUND',
          message: 'Submission not found',
          messageZh: '找不到提交記錄'
        }
      });
    }

    // Validate score if maxScore is set
    if (score !== undefined && submission.homework.maxScore !== null) {
      if (score < 0 || score > submission.homework.maxScore) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SCORE',
            message: `Score must be between 0 and ${submission.homework.maxScore}`,
            messageZh: `分數必須介於 0 和 ${submission.homework.maxScore} 之間`
          }
        });
      }
    }

    const updatedSubmission = await prisma.homeworkSubmission.update({
      where: { id: submissionId },
      data: {
        score,
        feedback,
        gradedById: req.user.id,
        gradedAt: new Date(),
        status: 'GRADED'
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        gradedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // Notify parent of grading
    const primaryParent = submission.student.parentRelations[0]?.parent;
    if (primaryParent?.lineUserId) {
      try {
        const studentName = `${submission.student.firstName} ${submission.student.lastName}`;
        let message = `【作業批改通知】\n`;
        message += `學生：${studentName}\n`;
        message += `作業：${submission.homework.title}\n`;
        if (score !== undefined) {
          message += `分數：${score}`;
          if (submission.homework.maxScore) {
            message += `/${submission.homework.maxScore}`;
          }
          message += '\n';
        }
        if (feedback) {
          message += `評語：${feedback}`;
        }

        await lineService.sendPushMessage(primaryParent.lineUserId, message);
      } catch (error) {
        console.error('Failed to send grading notification:', error);
      }
    }

    res.json({
      success: true,
      data: { submission: updatedSubmission }
    });
  })
);

/**
 * GET /api/homework/:id/submissions
 * Get all submissions for a homework
 */
router.get('/:id/submissions',
  authenticate,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.query;

    // Verify homework exists
    const homework = await prisma.homework.findFirst({
      where: {
        id,
        class: { schoolId: req.user.schoolId }
      }
    });

    if (!homework) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'HOMEWORK_NOT_FOUND',
          message: 'Homework not found',
          messageZh: '找不到作業'
        }
      });
    }

    const submissions = await prisma.homeworkSubmission.findMany({
      where: {
        homeworkId: id,
        ...(status && { status })
      },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            englishName: true,
            photoUrl: true
          }
        },
        gradedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { submittedAt: 'desc' }
    });

    res.json({
      success: true,
      data: { submissions }
    });
  })
);

/**
 * POST /api/homework/:id/remind
 * Send reminder to students who haven't submitted
 */
router.post('/:id/remind',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'TEACHER'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Get homework with class and enrolled students
    const homework = await prisma.homework.findFirst({
      where: {
        id,
        class: {
          schoolId: req.user.schoolId,
          ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
        }
      },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
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
            }
          }
        },
        submissions: {
          select: { studentId: true }
        }
      }
    });

    if (!homework) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'HOMEWORK_NOT_FOUND',
          message: 'Homework not found',
          messageZh: '找不到作業'
        }
      });
    }

    // Find students who haven't submitted
    const submittedStudentIds = new Set(homework.submissions.map(s => s.studentId));
    const studentsToRemind = homework.class.enrollments
      .filter(e => !submittedStudentIds.has(e.studentId))
      .map(e => e.student);

    let sentCount = 0;
    
    for (const student of studentsToRemind) {
      const primaryParent = student.parentRelations[0]?.parent;
      
      if (primaryParent?.lineUserId) {
        try {
          const studentName = `${student.firstName} ${student.lastName}`;
          const message = lineService.createHomeworkReminder(
            studentName,
            homework.title,
            homework.dueDate,
            homework.class.name
          );

          await lineService.sendPushMessage(primaryParent.lineUserId, message);
          sentCount++;
        } catch (error) {
          console.error(`Failed to send reminder to parent of ${student.firstName}:`, error);
        }
      }
    }

    res.json({
      success: true,
      data: {
        message: `Reminders sent to ${sentCount} parents`,
        messageZh: `已發送提醒給 ${sentCount} 位家長`,
        totalPending: studentsToRemind.length,
        sentCount
      }
    });
  })
);

export default router;
