// src/routes/points.js
// Points system API routes

import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import debug from '../utils/debug.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ======================
// POINT TYPES (Admin/Manager)
// ======================

// GET /api/points/types - Get all point types for school
router.get('/types', async (req, res) => {
  debug.api(req, { action: 'getPointTypes' });
  
  try {
    const types = await prisma.pointType.findMany({
      where: {
        schoolId: req.user.schoolId,
        isActive: true
      },
      orderBy: { name: 'asc' }
    });

    debug.log('Found point types:', types.length);
    res.json({ success: true, data: types });
  } catch (error) {
    debug.error('getPointTypes', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/points/types - Create point type
router.post('/types', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  debug.api(req, { action: 'createPointType', body: req.body });
  
  try {
    const { name, nameChinese, defaultPoints, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_NAME', message: 'Name is required' }
      });
    }

    const type = await prisma.pointType.create({
      data: {
        name,
        nameChinese,
        defaultPoints: defaultPoints || 1,
        icon,
        color,
        schoolId: req.user.schoolId
      }
    });

    debug.log('Created point type:', type.id);
    res.status(201).json({ success: true, data: type });
  } catch (error) {
    debug.error('createPointType', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// PUT /api/points/types/:id - Update point type
router.put('/types/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'updatePointType', id });
  
  try {
    // Verify ownership
    const existing = await prisma.pointType.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Point type not found' }
      });
    }

    const { name, nameChinese, defaultPoints, icon, color, isActive } = req.body;

    const type = await prisma.pointType.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameChinese !== undefined && { nameChinese }),
        ...(defaultPoints !== undefined && { defaultPoints }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(isActive !== undefined && { isActive })
      }
    });

    debug.log('Updated point type:', id);
    res.json({ success: true, data: type });
  } catch (error) {
    debug.error('updatePointType', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// DELETE /api/points/types/:id - Soft delete point type
router.delete('/types/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'deletePointType', id });
  
  try {
    const existing = await prisma.pointType.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Point type not found' }
      });
    }

    await prisma.pointType.update({
      where: { id },
      data: { isActive: false }
    });

    debug.log('Soft deleted point type:', id);
    res.json({ success: true, message: 'Point type deleted' });
  } catch (error) {
    debug.error('deletePointType', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// POINT RECORDS (Teachers)
// ======================

// GET /api/points/records - Get point records with filters
router.get('/records', async (req, res) => {
  const { studentId, classId, startDate, endDate } = req.query;
  debug.api(req, { action: 'getPointRecords', studentId, classId });
  
  try {
    const where = {
      student: { schoolId: req.user.schoolId }
    };

    if (studentId) where.studentId = studentId;
    if (classId) where.classId = classId;
    
    if (startDate || endDate) {
      where.awardedAt = {};
      if (startDate) where.awardedAt.gte = new Date(startDate);
      if (endDate) where.awardedAt.lte = new Date(endDate);
    }

    const records = await prisma.pointRecord.findMany({
      where,
      include: {
        pointType: true,
        student: {
          select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
        },
        class: { select: { id: true, name: true } },
        awardedBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: { awardedAt: 'desc' },
      take: 100
    });

    debug.log('Found point records:', records.length);
    res.json({ success: true, data: records });
  } catch (error) {
    debug.error('getPointRecords', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// GET /api/points/student/:studentId - Get points summary for a student
router.get('/student/:studentId', async (req, res) => {
  const { studentId } = req.params;
  debug.api(req, { action: 'getStudentPoints', studentId });
  
  try {
    // Verify student is in same school
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Student not found' }
      });
    }

    const records = await prisma.pointRecord.findMany({
      where: { studentId },
      include: {
        pointType: true,
        class: { select: { id: true, name: true } },
        awardedBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: { awardedAt: 'desc' }
    });

    const totalPoints = records.reduce((sum, r) => sum + r.points, 0);

    // Group by type
    const byType = {};
    records.forEach(r => {
      if (!byType[r.pointTypeId]) {
        byType[r.pointTypeId] = { type: r.pointType, total: 0, count: 0 };
      }
      byType[r.pointTypeId].total += r.points;
      byType[r.pointTypeId].count += 1;
    });

    debug.log('Student total points:', totalPoints);

    res.json({
      success: true,
      data: {
        student,
        totalPoints,
        byType: Object.values(byType),
        recentRecords: records.slice(0, 20)
      }
    });
  } catch (error) {
    debug.error('getStudentPoints', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// GET /api/points/class/:classId/leaderboard - Get class leaderboard
router.get('/class/:classId/leaderboard', async (req, res) => {
  const { classId } = req.params;
  debug.api(req, { action: 'getClassLeaderboard', classId });
  
  try {
    // Get all students in class with their points
    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'ACTIVE' },
      include: {
        student: {
          include: {
            pointRecords: {
              include: { pointType: true }
            }
          }
        }
      }
    });

    const leaderboard = enrollments.map(e => {
      const totalPoints = e.student.pointRecords.reduce((sum, r) => sum + r.points, 0);
      return {
        student: {
          id: e.student.id,
          firstName: e.student.firstName,
          lastName: e.student.lastName,
          englishName: e.student.englishName,
          photoUrl: e.student.photoUrl
        },
        totalPoints
      };
    }).sort((a, b) => b.totalPoints - a.totalPoints);

    debug.log('Leaderboard entries:', leaderboard.length);

    res.json({ success: true, data: leaderboard });
  } catch (error) {
    debug.error('getClassLeaderboard', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/points/award - Award points to a student
router.post('/award', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  debug.api(req, { action: 'awardPoints', body: req.body });
  
  try {
    const { studentId, pointTypeId, points, reason, reasonChinese, classId } = req.body;

    if (!studentId || !pointTypeId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'studentId and pointTypeId are required' }
      });
    }

    // Verify student is in same school
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'STUDENT_NOT_FOUND', message: 'Student not found' }
      });
    }

    // Verify point type
    const pointType = await prisma.pointType.findFirst({
      where: { id: pointTypeId, schoolId: req.user.schoolId, isActive: true }
    });

    if (!pointType) {
      return res.status(404).json({
        success: false,
        error: { code: 'TYPE_NOT_FOUND', message: 'Point type not found' }
      });
    }

    // Use provided points or default
    const pointValue = points !== undefined ? points : pointType.defaultPoints;

    const record = await prisma.pointRecord.create({
      data: {
        points: pointValue,
        reason,
        reasonChinese,
        pointTypeId,
        studentId,
        classId: classId || null,
        awardedById: req.user.id
      },
      include: {
        pointType: true,
        student: { select: { firstName: true, lastName: true } }
      }
    });

    debug.log('Awarded points:', { studentId, points: pointValue, typeId: pointTypeId });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    debug.error('awardPoints', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/points/award/bulk - Award points to multiple students
router.post('/award/bulk', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  debug.api(req, { action: 'awardPointsBulk' });
  
  try {
    const { awards } = req.body; // Array of { studentId, pointTypeId, points?, reason?, classId? }

    if (!Array.isArray(awards) || awards.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'awards array is required' }
      });
    }

    // Get point types for defaults
    const typeIds = [...new Set(awards.map(a => a.pointTypeId))];
    const pointTypes = await prisma.pointType.findMany({
      where: { id: { in: typeIds }, schoolId: req.user.schoolId }
    });
    const typeMap = Object.fromEntries(pointTypes.map(t => [t.id, t]));

    // Create all records
    const records = await prisma.pointRecord.createMany({
      data: awards.map(a => ({
        points: a.points !== undefined ? a.points : (typeMap[a.pointTypeId]?.defaultPoints || 1),
        reason: a.reason,
        reasonChinese: a.reasonChinese,
        pointTypeId: a.pointTypeId,
        studentId: a.studentId,
        classId: a.classId || null,
        awardedById: req.user.id
      }))
    });

    debug.log('Bulk awarded points:', records.count);

    res.status(201).json({
      success: true,
      data: { created: records.count }
    });
  } catch (error) {
    debug.error('awardPointsBulk', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// DELETE /api/points/records/:id - Delete a point record
router.delete('/records/:id', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'deletePointRecord', id });
  
  try {
    const record = await prisma.pointRecord.findFirst({
      where: { id },
      include: { student: { select: { schoolId: true } } }
    });

    if (!record || record.student.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found' }
      });
    }

    // Teachers can only delete their own records
    if (req.user.role === 'TEACHER' && record.awardedById !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only delete your own records' }
      });
    }

    await prisma.pointRecord.delete({ where: { id } });

    debug.log('Deleted point record:', id);
    res.json({ success: true, message: 'Record deleted' });
  } catch (error) {
    debug.error('deletePointRecord', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

export default router;