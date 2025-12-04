// src/routes/assessments.js
// Assessments (tests, quizzes) API routes

import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import debug from '../utils/debug.js';

const router = express.Router();

// File size limit (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// All routes require authentication
router.use(authenticate);

// ======================
// ASSESSMENTS (CRUD)
// ======================

// GET /api/assessments - Get all assessments with filters
router.get('/', async (req, res) => {
  const { classId, type, startDate, endDate } = req.query;
  debug.api(req, { action: 'getAssessments', classId, type });
  
  try {
    const where = { schoolId: req.user.schoolId };

    if (classId) where.classId = classId;
    if (type) where.type = type;
    
    if (startDate || endDate) {
      where.assessmentDate = {};
      if (startDate) where.assessmentDate.gte = new Date(startDate);
      if (endDate) where.assessmentDate.lte = new Date(endDate);
    }

    // Teachers can only see assessments for their classes
    if (req.user.role === 'TEACHER') {
      const teacherClasses = await prisma.class.findMany({
        where: { teacherId: req.user.id },
        select: { id: true }
      });
      where.classId = { in: teacherClasses.map(c => c.id) };
    }

    const assessments = await prisma.assessment.findMany({
      where,
      include: {
        class: { select: { id: true, name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { scores: true } }
      },
      orderBy: { assessmentDate: 'desc' }
    });

    debug.log('Found assessments:', assessments.length);
    res.json({ success: true, data: assessments });
  } catch (error) {
    debug.error('getAssessments', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// GET /api/assessments/:id - Get single assessment with scores
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'getAssessment', id });
  
  try {
    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
                student: {
                  select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
                }
              }
            }
          }
        },
        createdBy: { select: { firstName: true, lastName: true } },
        scores: {
          include: {
            student: {
              select: { id: true, firstName: true, lastName: true, englishName: true }
            },
            gradedBy: { select: { firstName: true, lastName: true } }
          }
        }
      }
    });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    debug.log('Found assessment:', id);
    res.json({ success: true, data: assessment });
  } catch (error) {
    debug.error('getAssessment', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/assessments - Create assessment
router.post('/', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  debug.api(req, { action: 'createAssessment', body: req.body });
  
  try {
    const {
      name,
      nameChinese,
      description,
      type,
      maxScore,
      passingScore,
      weight,
      assessmentDate,
      classId,
      isPublished
    } = req.body;

    if (!name || !classId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'name and classId are required' }
      });
    }

    // Verify class belongs to school
    const cls = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId }
    });

    if (!cls) {
      return res.status(404).json({
        success: false,
        error: { code: 'CLASS_NOT_FOUND', message: 'Class not found' }
      });
    }

    // Teachers can only create for their own classes
    if (req.user.role === 'TEACHER' && cls.teacherId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only create assessments for your classes' }
      });
    }

    const assessment = await prisma.assessment.create({
      data: {
        name,
        nameChinese,
        description,
        type: type || 'TEST',
        maxScore: maxScore || 100,
        passingScore,
        weight: weight ? parseFloat(weight) : null,
        assessmentDate: assessmentDate ? new Date(assessmentDate) : null,
        classId,
        createdById: req.user.id,
        schoolId: req.user.schoolId,
        isPublished: isPublished || false
      },
      include: {
        class: { select: { id: true, name: true } }
      }
    });

    debug.log('Created assessment:', assessment.id);
    res.status(201).json({ success: true, data: assessment });
  } catch (error) {
    debug.error('createAssessment', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// PUT /api/assessments/:id - Update assessment
router.put('/:id', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'updateAssessment', id });
  
  try {
    const existing = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId },
      include: { class: true }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    // Teachers can only update their own assessments
    if (req.user.role === 'TEACHER' && existing.createdById !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only update your own assessments' }
      });
    }

    const {
      name,
      nameChinese,
      description,
      type,
      maxScore,
      passingScore,
      weight,
      assessmentDate,
      isPublished
    } = req.body;

    const assessment = await prisma.assessment.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(nameChinese !== undefined && { nameChinese }),
        ...(description !== undefined && { description }),
        ...(type !== undefined && { type }),
        ...(maxScore !== undefined && { maxScore }),
        ...(passingScore !== undefined && { passingScore }),
        ...(weight !== undefined && { weight: weight ? parseFloat(weight) : null }),
        ...(assessmentDate !== undefined && { assessmentDate: assessmentDate ? new Date(assessmentDate) : null }),
        ...(isPublished !== undefined && { isPublished })
      }
    });

    debug.log('Updated assessment:', id);
    res.json({ success: true, data: assessment });
  } catch (error) {
    debug.error('updateAssessment', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// DELETE /api/assessments/:id - Delete assessment
router.delete('/:id', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'deleteAssessment', id });
  
  try {
    const existing = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    // Teachers can only delete their own assessments
    if (req.user.role === 'TEACHER' && existing.createdById !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only delete your own assessments' }
      });
    }

    await prisma.assessment.delete({ where: { id } });

    debug.log('Deleted assessment:', id);
    res.json({ success: true, message: 'Assessment deleted' });
  } catch (error) {
    debug.error('deleteAssessment', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// SCORES
// ======================

// GET /api/assessments/:id/scores - Get all scores for an assessment
router.get('/:id/scores', async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'getAssessmentScores', assessmentId: id });
  
  try {
    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId },
      include: {
        class: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
                student: {
                  select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
                }
              }
            }
          }
        }
      }
    });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    const scores = await prisma.assessmentScore.findMany({
      where: { assessmentId: id },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
        },
        gradedBy: { select: { firstName: true, lastName: true } }
      }
    });

    // Map scores to students
    const scoreMap = Object.fromEntries(scores.map(s => [s.studentId, s]));

    const studentsWithScores = assessment.class.enrollments.map(e => ({
      student: e.student,
      score: scoreMap[e.student.id] || null
    }));

    // Calculate stats
    const scoredStudents = scores.filter(s => s.score !== null);
    const stats = {
      total: studentsWithScores.length,
      graded: scoredStudents.length,
      average: scoredStudents.length > 0
        ? (scoredStudents.reduce((sum, s) => sum + parseFloat(s.percentage || 0), 0) / scoredStudents.length).toFixed(1)
        : null,
      highest: scoredStudents.length > 0
        ? Math.max(...scoredStudents.map(s => parseFloat(s.score)))
        : null,
      lowest: scoredStudents.length > 0
        ? Math.min(...scoredStudents.map(s => parseFloat(s.score)))
        : null,
      passing: assessment.passingScore
        ? scoredStudents.filter(s => parseFloat(s.score) >= assessment.passingScore).length
        : null
    };

    debug.log('Assessment scores:', { total: stats.total, graded: stats.graded });

    res.json({
      success: true,
      data: {
        assessment,
        students: studentsWithScores,
        stats
      }
    });
  } catch (error) {
    debug.error('getAssessmentScores', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/assessments/:id/scores - Save score for a student
router.post('/:id/scores', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'saveScore', assessmentId: id, body: req.body });
  
  try {
    const { studentId, score, feedback, feedbackChinese, fileUrl, fileName, fileSize } = req.body;

    if (!studentId || score === undefined) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'studentId and score are required' }
      });
    }

    // Verify assessment
    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    // Verify student is enrolled in the class
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId: assessment.classId, studentId, status: 'ACTIVE' }
    });

    if (!enrollment) {
      return res.status(400).json({
        success: false,
        error: { code: 'NOT_ENROLLED', message: 'Student is not enrolled in this class' }
      });
    }

    // Check file size
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        error: { code: 'FILE_TOO_LARGE', message: 'File size exceeds 5MB limit' }
      });
    }

    // Calculate percentage
    const percentage = (parseFloat(score) / assessment.maxScore * 100).toFixed(2);

    // Upsert score
    const assessmentScore = await prisma.assessmentScore.upsert({
      where: {
        assessmentId_studentId: { assessmentId: id, studentId }
      },
      update: {
        score: parseFloat(score),
        maxScore: assessment.maxScore,
        percentage: parseFloat(percentage),
        feedback,
        feedbackChinese,
        fileUrl,
        fileName,
        fileSize,
        gradedById: req.user.id,
        gradedAt: new Date()
      },
      create: {
        assessmentId: id,
        studentId,
        score: parseFloat(score),
        maxScore: assessment.maxScore,
        percentage: parseFloat(percentage),
        feedback,
        feedbackChinese,
        fileUrl,
        fileName,
        fileSize,
        gradedById: req.user.id
      },
      include: {
        student: { select: { firstName: true, lastName: true } }
      }
    });

    debug.log('Saved score:', { assessmentId: id, studentId, score });
    res.json({ success: true, data: assessmentScore });
  } catch (error) {
    debug.error('saveScore', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// POST /api/assessments/:id/scores/bulk - Save multiple scores
router.post('/:id/scores/bulk', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { id } = req.params;
  debug.api(req, { action: 'saveScoresBulk', assessmentId: id });
  
  try {
    const { scores } = req.body; // Array of { studentId, score, feedback? }

    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_DATA', message: 'scores array is required' }
      });
    }

    const assessment = await prisma.assessment.findFirst({
      where: { id, schoolId: req.user.schoolId }
    });

    if (!assessment) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Assessment not found' }
      });
    }

    // Process each score
    const results = await Promise.all(
      scores.map(async (s) => {
        const percentage = (parseFloat(s.score) / assessment.maxScore * 100).toFixed(2);
        
        return prisma.assessmentScore.upsert({
          where: {
            assessmentId_studentId: { assessmentId: id, studentId: s.studentId }
          },
          update: {
            score: parseFloat(s.score),
            maxScore: assessment.maxScore,
            percentage: parseFloat(percentage),
            feedback: s.feedback,
            feedbackChinese: s.feedbackChinese,
            gradedById: req.user.id,
            gradedAt: new Date()
          },
          create: {
            assessmentId: id,
            studentId: s.studentId,
            score: parseFloat(s.score),
            maxScore: assessment.maxScore,
            percentage: parseFloat(percentage),
            feedback: s.feedback,
            feedbackChinese: s.feedbackChinese,
            gradedById: req.user.id
          }
        });
      })
    );

    debug.log('Bulk saved scores:', results.length);

    res.json({
      success: true,
      data: { saved: results.length }
    });
  } catch (error) {
    debug.error('saveScoresBulk', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// DELETE /api/assessments/scores/:scoreId - Delete a score
router.delete('/scores/:scoreId', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  const { scoreId } = req.params;
  debug.api(req, { action: 'deleteScore', scoreId });
  
  try {
    const score = await prisma.assessmentScore.findFirst({
      where: { id: scoreId },
      include: { assessment: { select: { schoolId: true, createdById: true } } }
    });

    if (!score || score.assessment.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Score not found' }
      });
    }

    // Teachers can only delete scores they graded
    if (req.user.role === 'TEACHER' && score.gradedById !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You can only delete scores you graded' }
      });
    }

    await prisma.assessmentScore.delete({ where: { id: scoreId } });

    debug.log('Deleted score:', scoreId);
    res.json({ success: true, message: 'Score deleted' });
  } catch (error) {
    debug.error('deleteScore', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

// ======================
// STUDENT GRADES OVERVIEW
// ======================

// GET /api/assessments/student/:studentId - Get all assessment scores for a student
router.get('/student/:studentId', async (req, res) => {
  const { studentId } = req.params;
  debug.api(req, { action: 'getStudentAssessments', studentId });
  
  try {
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Student not found' }
      });
    }

    const scores = await prisma.assessmentScore.findMany({
      where: { studentId },
      include: {
        assessment: {
          include: {
            class: { select: { id: true, name: true } }
          }
        },
        gradedBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: { assessment: { assessmentDate: 'desc' } }
    });

    // Group by class
    const byClass = {};
    scores.forEach(s => {
      const classId = s.assessment.classId;
      if (!byClass[classId]) {
        byClass[classId] = {
          class: s.assessment.class,
          scores: [],
          average: 0
        };
      }
      byClass[classId].scores.push(s);
    });

    // Calculate averages
    Object.values(byClass).forEach(c => {
      c.average = c.scores.length > 0
        ? (c.scores.reduce((sum, s) => sum + parseFloat(s.percentage || 0), 0) / c.scores.length).toFixed(1)
        : 0;
    });

    debug.log('Found student scores:', scores.length);

    res.json({
      success: true,
      data: {
        student,
        scores,
        byClass: Object.values(byClass)
      }
    });
  } catch (error) {
    debug.error('getStudentAssessments', error);
    res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: error.message }
    });
  }
});

export default router;