// src/routes/parentPortal.js
// Parent Portal API routes - parents can view their children's data

import express from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import debug from '../utils/debug.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Middleware: Ensure user is a parent
const requireParent = (req, res, next) => {
  debug.api(req, { check: 'requireParent' });
  
  if (req.user.role !== 'PARENT') {
    debug.log('Parent check failed - role:', req.user.role);
    return res.status(403).json({
      success: false,
      error: {
        code: 'NOT_A_PARENT',
        message: 'This endpoint is only for parents',
        messageZh: '此端點僅供家長使用'
      }
    });
  }
  next();
};

router.use(requireParent);

// ======================
// GET CHILDREN
// ======================

// GET /api/parent/children - Get all children linked to this parent
router.get('/children', async (req, res) => {
  debug.api(req, { action: 'getChildren' });
  
  try {
    const children = await prisma.parentStudent.findMany({
      where: { parentId: req.user.id },
      include: {
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
                class: {
                  select: {
                    id: true,
                    name: true,
                    dayOfWeek: true,
                    startTime: true,
                    endTime: true,
                    teacher: {
                      select: { firstName: true, lastName: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    debug.log('Found children:', children.length);

    const result = children.map(ps => ({
      relationship: ps.relationship,
      isPrimary: ps.isPrimary,
      student: {
        id: ps.student.id,
        firstName: ps.student.firstName,
        lastName: ps.student.lastName,
        englishName: ps.student.englishName,
        photoUrl: ps.student.photoUrl,
        status: ps.student.status,
        classes: ps.student.enrollments.map(e => e.class)
      }
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    debug.error('getChildren', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// BEHAVIOR RECORDS
// ======================

// GET /api/parent/children/:studentId/behavior - Get behavior records for a child
router.get('/children/:studentId/behavior', async (req, res) => {
  const { studentId } = req.params;
  const { startDate, endDate, classId } = req.query;
  
  debug.api(req, { action: 'getChildBehavior', studentId, startDate, endDate });

  try {
    // Verify parent has access to this student
    const relationship = await prisma.parentStudent.findUnique({
      where: {
        parentId_studentId: {
          parentId: req.user.id,
          studentId
        }
      }
    });

    if (!relationship) {
      debug.log('Parent access denied for student:', studentId);
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this student',
          messageZh: '您無權訪問此學生'
        }
      });
    }

    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const records = await prisma.behaviorRecord.findMany({
      where: {
        studentId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        ...(classId ? { classId } : {})
      },
      include: {
        category: {
          include: {
            scale: true
          }
        },
        class: {
          select: { id: true, name: true }
        }
      },
      orderBy: { date: 'desc' }
    });

    debug.log('Found behavior records:', records.length);

    // Calculate summary by category
    const summary = {};
    records.forEach(record => {
      const catId = record.categoryId;
      if (!summary[catId]) {
        summary[catId] = {
          category: record.category,
          totalScore: 0,
          count: 0,
          average: 0
        };
      }
      summary[catId].totalScore += record.score;
      summary[catId].count += 1;
    });

    // Calculate averages
    Object.values(summary).forEach(s => {
      s.average = s.count > 0 ? (s.totalScore / s.count).toFixed(2) : 0;
    });

    res.json({
      success: true,
      data: {
        records,
        summary: Object.values(summary)
      }
    });
  } catch (error) {
    debug.error('getChildBehavior', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// ATTENDANCE
// ======================

// GET /api/parent/children/:studentId/attendance - Get attendance for a child
router.get('/children/:studentId/attendance', async (req, res) => {
  const { studentId } = req.params;
  const { startDate, endDate, classId } = req.query;
  
  debug.api(req, { action: 'getChildAttendance', studentId });

  try {
    // Verify parent has access
    const relationship = await prisma.parentStudent.findUnique({
      where: {
        parentId_studentId: { parentId: req.user.id, studentId }
      }
    });

    if (!relationship) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Access denied' }
      });
    }

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId,
        ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
        ...(classId ? { classId } : {})
      },
      include: {
        class: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    });

    // Calculate summary
    const summary = {
      total: attendance.length,
      present: attendance.filter(a => a.status === 'PRESENT').length,
      absent: attendance.filter(a => a.status === 'ABSENT').length,
      late: attendance.filter(a => a.status === 'LATE').length,
      excused: attendance.filter(a => a.status === 'EXCUSED').length
    };
    summary.attendanceRate = summary.total > 0 
      ? ((summary.present + summary.late) / summary.total * 100).toFixed(1)
      : 0;

    debug.log('Attendance summary:', summary);

    res.json({
      success: true,
      data: { records: attendance, summary }
    });
  } catch (error) {
    debug.error('getChildAttendance', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// POINTS
// ======================

// GET /api/parent/children/:studentId/points - Get points for a child
router.get('/children/:studentId/points', async (req, res) => {
  const { studentId } = req.params;
  const { startDate, endDate } = req.query;
  
  debug.api(req, { action: 'getChildPoints', studentId });

  try {
    // Verify parent has access
    const relationship = await prisma.parentStudent.findUnique({
      where: {
        parentId_studentId: { parentId: req.user.id, studentId }
      }
    });

    if (!relationship) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Access denied' }
      });
    }

    const dateFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lte = new Date(endDate);

    const records = await prisma.pointRecord.findMany({
      where: {
        studentId,
        ...(Object.keys(dateFilter).length > 0 ? { awardedAt: dateFilter } : {})
      },
      include: {
        pointType: true,
        class: { select: { id: true, name: true } },
        awardedBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: { awardedAt: 'desc' }
    });

    // Calculate total points
    const totalPoints = records.reduce((sum, r) => sum + r.points, 0);

    // Points by type
    const byType = {};
    records.forEach(r => {
      if (!byType[r.pointTypeId]) {
        byType[r.pointTypeId] = {
          type: r.pointType,
          total: 0,
          count: 0
        };
      }
      byType[r.pointTypeId].total += r.points;
      byType[r.pointTypeId].count += 1;
    });

    debug.log('Points total:', totalPoints);

    res.json({
      success: true,
      data: {
        records,
        totalPoints,
        byType: Object.values(byType)
      }
    });
  } catch (error) {
    debug.error('getChildPoints', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// ASSESSMENTS
// ======================

// GET /api/parent/children/:studentId/assessments - Get assessment scores for a child
router.get('/children/:studentId/assessments', async (req, res) => {
  const { studentId } = req.params;
  const { classId } = req.query;
  
  debug.api(req, { action: 'getChildAssessments', studentId });

  try {
    // Verify parent has access
    const relationship = await prisma.parentStudent.findUnique({
      where: {
        parentId_studentId: { parentId: req.user.id, studentId }
      }
    });

    if (!relationship) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'Access denied' }
      });
    }

    const scores = await prisma.assessmentScore.findMany({
      where: {
        studentId,
        assessment: {
          isPublished: true, // Only show published assessments to parents
          ...(classId ? { classId } : {})
        }
      },
      include: {
        assessment: {
          include: {
            class: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { assessment: { assessmentDate: 'desc' } }
    });

    // Calculate averages by class
    const byClass = {};
    scores.forEach(s => {
      const cId = s.assessment.classId;
      if (!byClass[cId]) {
        byClass[cId] = {
          class: s.assessment.class,
          scores: [],
          average: 0
        };
      }
      byClass[cId].scores.push(s);
    });

    Object.values(byClass).forEach(c => {
      const total = c.scores.reduce((sum, s) => sum + parseFloat(s.percentage || 0), 0);
      c.average = c.scores.length > 0 ? (total / c.scores.length).toFixed(1) : 0;
    });

    debug.log('Found assessment scores:', scores.length);

    res.json({
      success: true,
      data: {
        scores,
        byClass: Object.values(byClass)
      }
    });
  } catch (error) {
    debug.error('getChildAssessments', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// DASHBOARD SUMMARY
// ======================

// GET /api/parent/dashboard - Get summary for all children
router.get('/dashboard', async (req, res) => {
  debug.api(req, { action: 'getParentDashboard' });

  try {
    const children = await prisma.parentStudent.findMany({
      where: { parentId: req.user.id },
      include: {
        student: {
          include: {
            // Recent behavior (last 7 days)
            behaviorRecords: {
              where: {
                date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
              },
              include: { category: true },
              orderBy: { date: 'desc' },
              take: 10
            },
            // Recent attendance (last 7 days)
            attendance: {
              where: {
                date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
              },
              orderBy: { date: 'desc' },
              take: 10
            },
            // Points balance
            pointRecords: true,
            // Recent assessments
            assessmentScores: {
              where: {
                assessment: { isPublished: true }
              },
              include: { assessment: true },
              orderBy: { gradedAt: 'desc' },
              take: 5
            },
            // Classes
            enrollments: {
              where: { status: 'ACTIVE' },
              include: { class: true }
            }
          }
        }
      }
    });

    const dashboard = children.map(ps => {
      const student = ps.student;
      
      // Calculate points total
      const totalPoints = student.pointRecords.reduce((sum, r) => sum + r.points, 0);
      
      // Calculate behavior average
      const behaviorAvg = student.behaviorRecords.length > 0
        ? (student.behaviorRecords.reduce((sum, r) => sum + r.score, 0) / student.behaviorRecords.length).toFixed(1)
        : null;

      // Attendance stats
      const attendanceCount = student.attendance.length;
      const presentCount = student.attendance.filter(a => ['PRESENT', 'LATE'].includes(a.status)).length;

      return {
        student: {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          englishName: student.englishName,
          photoUrl: student.photoUrl
        },
        relationship: ps.relationship,
        summary: {
          totalPoints,
          behaviorAverage: behaviorAvg,
          recentAttendance: attendanceCount > 0 ? `${presentCount}/${attendanceCount}` : 'N/A',
          classCount: student.enrollments.length,
          recentAssessments: student.assessmentScores.slice(0, 3).map(s => ({
            name: s.assessment.name,
            score: s.score,
            maxScore: s.maxScore,
            percentage: s.percentage
          }))
        },
        classes: student.enrollments.map(e => ({
          id: e.class.id,
          name: e.class.name
        }))
      };
    });

    debug.log('Dashboard built for children:', dashboard.length);

    res.json({ success: true, data: dashboard });
  } catch (error) {
    debug.error('getParentDashboard', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

export default router;