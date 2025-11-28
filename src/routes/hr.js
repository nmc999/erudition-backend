// Teacher HR Routes
// Handles teacher profiles, documents, and timesheets

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// =====================
// TEACHER PROFILES
// =====================

/**
 * GET /api/hr/teachers
 * Get all teachers with HR profiles
 */
router.get('/teachers', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { status, employmentType, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Get teachers
  const teachers = await prisma.user.findMany({
    where: {
      schoolId,
      role: 'TEACHER',
      isActive: true
    },
    include: {
      teacherProfile: true,
      teachingClasses: {
        select: { id: true, name: true }
      }
    },
    skip,
    take,
    orderBy: { lastName: 'asc' }
  });

  const total = await prisma.user.count({
    where: { schoolId, role: 'TEACHER', isActive: true }
  });

  // Calculate summary stats
  const profiles = teachers.filter(t => t.teacherProfile);
  const totalHourlyRate = profiles
    .filter(p => p.teacherProfile?.payType === 'HOURLY')
    .reduce((sum, p) => sum + Number(p.teacherProfile.hourlyRate || 0), 0);
  const hourlyTeachers = profiles.filter(p => p.teacherProfile?.payType === 'HOURLY').length;

  res.json({
    success: true,
    data: {
      teachers: teachers.map(t => ({
        id: t.id,
        email: t.email,
        firstName: t.firstName,
        lastName: t.lastName,
        phone: t.phone,
        classes: t.teachingClasses,
        profile: t.teacherProfile ? {
          id: t.teacherProfile.id,
          employeeId: t.teacherProfile.employeeId,
          hireDate: t.teacherProfile.hireDate,
          employmentType: t.teacherProfile.employmentType,
          status: t.teacherProfile.status,
          payType: t.teacherProfile.payType,
          hourlyRate: t.teacherProfile.hourlyRate,
          monthlySalary: t.teacherProfile.monthlySalary
        } : null
      })),
      summary: {
        totalTeachers: total,
        withProfiles: profiles.length,
        avgHourlyRate: hourlyTeachers > 0 ? Math.round(totalHourlyRate / hourlyTeachers) : 0
      },
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
 * GET /api/hr/teachers/:userId
 * Get teacher profile details
 */
router.get('/teachers/:userId', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const schoolId = req.user.schoolId;

  const teacher = await prisma.user.findFirst({
    where: {
      id: userId,
      schoolId,
      role: 'TEACHER'
    },
    include: {
      teacherProfile: {
        include: {
          documents: {
            orderBy: { createdAt: 'desc' }
          },
          timesheets: {
            orderBy: { date: 'desc' },
            take: 30
          }
        }
      },
      teachingClasses: {
        select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true }
      }
    }
  });

  if (!teacher) {
    return res.status(404).json({
      success: false,
      error: { message: 'Teacher not found', messageZh: '找不到教師' }
    });
  }

  // Calculate hours worked this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  let hoursThisMonth = 0;
  let scheduledHoursThisMonth = 0;

  if (teacher.teacherProfile) {
    const monthTimesheets = await prisma.timesheet.findMany({
      where: {
        teacherProfileId: teacher.teacherProfile.id,
        date: { gte: startOfMonth }
      }
    });

    hoursThisMonth = monthTimesheets.reduce((sum, t) => sum + Number(t.actualHours || 0), 0);
    scheduledHoursThisMonth = monthTimesheets.reduce((sum, t) => sum + Number(t.scheduledHours || 0), 0);
  }

  res.json({
    success: true,
    data: {
      teacher: {
        id: teacher.id,
        email: teacher.email,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        phone: teacher.phone,
        createdAt: teacher.createdAt
      },
      profile: teacher.teacherProfile,
      classes: teacher.teachingClasses,
      stats: {
        hoursThisMonth,
        scheduledHoursThisMonth,
        classCount: teacher.teachingClasses.length
      }
    }
  });
}));

/**
 * POST /api/hr/teachers/:userId/profile
 * Create or update teacher HR profile
 */
router.post('/teachers/:userId/profile', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const schoolId = req.user.schoolId;
  const {
    employeeId,
    hireDate,
    employmentType,
    status,
    payType,
    hourlyRate,
    monthlySalary,
    bankName,
    bankAccount,
    emergencyName,
    emergencyPhone,
    emergencyRelation,
    notes
  } = req.body;

  // Verify teacher exists in school
  const teacher = await prisma.user.findFirst({
    where: { id: userId, schoolId, role: 'TEACHER' }
  });

  if (!teacher) {
    return res.status(404).json({
      success: false,
      error: { message: 'Teacher not found', messageZh: '找不到教師' }
    });
  }

  // Upsert profile
  const profile = await prisma.teacherProfile.upsert({
    where: { userId },
    create: {
      userId,
      schoolId,
      employeeId,
      hireDate: hireDate ? new Date(hireDate) : null,
      employmentType: employmentType || 'FULL_TIME',
      status: status || 'ACTIVE',
      payType: payType || 'HOURLY',
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : null,
      monthlySalary: monthlySalary ? parseFloat(monthlySalary) : null,
      bankName,
      bankAccount,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
      notes
    },
    update: {
      employeeId,
      hireDate: hireDate ? new Date(hireDate) : undefined,
      employmentType,
      status,
      payType,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
      monthlySalary: monthlySalary ? parseFloat(monthlySalary) : undefined,
      bankName,
      bankAccount,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
      notes
    }
  });

  res.json({
    success: true,
    data: { profile }
  });
}));

// =====================
// DOCUMENTS
// =====================

/**
 * GET /api/hr/teachers/:userId/documents
 * Get teacher documents
 */
router.get('/teachers/:userId/documents', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const schoolId = req.user.schoolId;

  const profile = await prisma.teacherProfile.findFirst({
    where: { userId, schoolId },
    include: {
      documents: {
        orderBy: { createdAt: 'desc' }
      }
    }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      error: { message: 'Teacher profile not found', messageZh: '找不到教師檔案' }
    });
  }

  res.json({
    success: true,
    data: { documents: profile.documents }
  });
}));

/**
 * POST /api/hr/teachers/:userId/documents
 * Add document to teacher profile
 */
router.post('/teachers/:userId/documents', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const schoolId = req.user.schoolId;
  const {
    name,
    type,
    description,
    fileUrl,
    fileName,
    fileSize,
    mimeType,
    expiresAt
  } = req.body;

  // Validate required fields
  if (!name || !type || !fileUrl || !fileName) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing required fields', messageZh: '缺少必填欄位' }
    });
  }

  // Get or create profile
  let profile = await prisma.teacherProfile.findFirst({
    where: { userId, schoolId }
  });

  if (!profile) {
    // Create minimal profile if doesn't exist
    profile = await prisma.teacherProfile.create({
      data: {
        userId,
        schoolId
      }
    });
  }

  const document = await prisma.document.create({
    data: {
      name,
      type,
      description,
      fileUrl,
      fileName,
      fileSize: fileSize || 0,
      mimeType: mimeType || 'application/octet-stream',
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      teacherProfileId: profile.id,
      uploadedById: req.user.id,
      schoolId
    }
  });

  res.status(201).json({
    success: true,
    data: { document }
  });
}));

/**
 * DELETE /api/hr/documents/:id
 * Delete a document
 */
router.delete('/documents/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;

  const document = await prisma.document.findFirst({
    where: { id, schoolId }
  });

  if (!document) {
    return res.status(404).json({
      success: false,
      error: { message: 'Document not found', messageZh: '找不到文件' }
    });
  }

  // In production: also delete from storage (S3, etc.)

  await prisma.document.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Document deleted'
  });
}));

// =====================
// TIMESHEETS
// =====================

/**
 * GET /api/hr/timesheets
 * Get timesheets for all teachers or specific teacher
 */
router.get('/timesheets', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { userId, startDate, endDate, status, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    schoolId,
    ...(userId && { teacherProfile: { userId } }),
    ...(status && { status }),
    ...(startDate && endDate && {
      date: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    })
  };

  const [timesheets, total] = await Promise.all([
    prisma.timesheet.findMany({
      where,
      include: {
        teacherProfile: {
          include: {
            user: {
              select: { firstName: true, lastName: true }
            }
          }
        },
        class: {
          select: { id: true, name: true }
        }
      },
      orderBy: { date: 'desc' },
      skip,
      take
    }),
    prisma.timesheet.count({ where })
  ]);

  // Calculate totals
  const totals = await prisma.timesheet.aggregate({
    where,
    _sum: {
      scheduledHours: true,
      actualHours: true
    }
  });

  res.json({
    success: true,
    data: {
      timesheets: timesheets.map(t => ({
        id: t.id,
        date: t.date,
        teacherName: `${t.teacherProfile.user.lastName}${t.teacherProfile.user.firstName}`,
        className: t.class?.name,
        scheduledStart: t.scheduledStart,
        scheduledEnd: t.scheduledEnd,
        actualStart: t.actualStart,
        actualEnd: t.actualEnd,
        scheduledHours: t.scheduledHours,
        actualHours: t.actualHours,
        status: t.status,
        notes: t.notes
      })),
      totals: {
        scheduledHours: Number(totals._sum.scheduledHours || 0),
        actualHours: Number(totals._sum.actualHours || 0)
      },
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
 * POST /api/hr/timesheets
 * Create timesheet entry
 */
router.post('/timesheets', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const {
    userId,
    date,
    classId,
    scheduledStart,
    scheduledEnd,
    scheduledHours,
    notes
  } = req.body;

  // Get teacher profile
  const profile = await prisma.teacherProfile.findFirst({
    where: { userId, schoolId }
  });

  if (!profile) {
    return res.status(404).json({
      success: false,
      error: { message: 'Teacher profile not found. Create HR profile first.', messageZh: '找不到教師檔案，請先建立人事檔案' }
    });
  }

  const timesheet = await prisma.timesheet.create({
    data: {
      teacherProfileId: profile.id,
      schoolId,
      date: new Date(date),
      classId: classId || null,
      scheduledStart,
      scheduledEnd,
      scheduledHours: parseFloat(scheduledHours),
      status: 'SCHEDULED',
      notes
    }
  });

  res.status(201).json({
    success: true,
    data: { timesheet }
  });
}));

/**
 * PUT /api/hr/timesheets/:id
 * Update timesheet (record actual hours)
 */
router.put('/timesheets/:id', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;
  const {
    actualStart,
    actualEnd,
    actualHours,
    status,
    notes
  } = req.body;

  const existing = await prisma.timesheet.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Timesheet not found', messageZh: '找不到工時記錄' }
    });
  }

  const timesheet = await prisma.timesheet.update({
    where: { id },
    data: {
      actualStart,
      actualEnd,
      actualHours: actualHours ? parseFloat(actualHours) : undefined,
      status,
      notes
    }
  });

  res.json({
    success: true,
    data: { timesheet }
  });
}));

/**
 * DELETE /api/hr/timesheets/:id
 * Delete timesheet
 */
router.delete('/timesheets/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;

  const existing = await prisma.timesheet.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Timesheet not found', messageZh: '找不到工時記錄' }
    });
  }

  await prisma.timesheet.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Timesheet deleted'
  });
}));

/**
 * POST /api/hr/timesheets/generate
 * Auto-generate timesheets from class schedules
 */
router.post('/timesheets/generate', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: { message: 'Start and end date required', messageZh: '需要開始和結束日期' }
    });
  }

  // Get all classes with teachers
  const classes = await prisma.class.findMany({
    where: {
      schoolId,
      teacherId: { not: null }
    },
    include: {
      teacher: {
        include: { teacherProfile: true }
      }
    }
  });

  const start = new Date(startDate);
  const end = new Date(endDate);
  const created = [];

  // Day mapping
  const dayMap = {
    'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
    'Thursday': 4, 'Friday': 5, 'Saturday': 6
  };

  for (const cls of classes) {
    if (!cls.teacher?.teacherProfile || !cls.dayOfWeek || !cls.startTime || !cls.endTime) continue;

    const classDays = cls.dayOfWeek.split(',').map(d => dayMap[d.trim()]);
    
    // Calculate hours per class
    const [startH, startM] = cls.startTime.split(':').map(Number);
    const [endH, endM] = cls.endTime.split(':').map(Number);
    const hours = (endH + endM/60) - (startH + startM/60);

    // Loop through date range
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (classDays.includes(d.getDay())) {
        // Check if timesheet already exists
        const existing = await prisma.timesheet.findFirst({
          where: {
            teacherProfileId: cls.teacher.teacherProfile.id,
            date: new Date(d),
            classId: cls.id
          }
        });

        if (!existing) {
          const ts = await prisma.timesheet.create({
            data: {
              teacherProfileId: cls.teacher.teacherProfile.id,
              schoolId,
              classId: cls.id,
              date: new Date(d),
              scheduledStart: cls.startTime,
              scheduledEnd: cls.endTime,
              scheduledHours: hours,
              status: 'SCHEDULED'
            }
          });
          created.push(ts);
        }
      }
    }
  }

  res.json({
    success: true,
    message: `Generated ${created.length} timesheets`,
    data: { count: created.length }
  });
}));

export default router;
