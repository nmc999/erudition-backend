// routes/behavior.js
// Behavior tracking routes for Erudition

import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// ======================
// BEHAVIOR SCALES
// ======================

// GET /api/behavior/scales - Get all scales for school
router.get('/scales', authenticate, async (req, res) => {
  try {
    const scales = await prisma.behaviorScale.findMany({
      where: {
        schoolId: req.user.schoolId,
        isActive: true
      },
      orderBy: { createdAt: 'asc' }
    })

    res.json({ success: true, data: scales })
  } catch (error) {
    console.error('Error fetching behavior scales:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch behavior scales' })
  }
})

// GET /api/behavior/scales/:id - Get single scale
router.get('/scales/:id', authenticate, async (req, res) => {
  try {
    const scale = await prisma.behaviorScale.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId
      },
      include: {
        categories: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' }
        }
      }
    })

    if (!scale) {
      return res.status(404).json({ success: false, error: 'Scale not found' })
    }

    res.json({ success: true, data: scale })
  } catch (error) {
    console.error('Error fetching behavior scale:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch behavior scale' })
  }
})

// POST /api/behavior/scales - Create new scale (Admin only)
router.post('/scales', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, nameChinese, minValue, maxValue, labels, labelsChinese, colors, isDefault } = req.body

    // Validation
    if (!name) {
      return res.status(400).json({ success: false, error: 'Scale name is required' })
    }
    if (minValue >= maxValue) {
      return res.status(400).json({ success: false, error: 'Min value must be less than max value' })
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.behaviorScale.updateMany({
        where: { schoolId: req.user.schoolId, isDefault: true },
        data: { isDefault: false }
      })
    }

    const scale = await prisma.behaviorScale.create({
      data: {
        name,
        nameChinese,
        minValue: minValue || 1,
        maxValue: maxValue || 5,
        labels: labels || {},
        labelsChinese: labelsChinese || {},
        colors: colors || {},
        isDefault: isDefault || false,
        schoolId: req.user.schoolId
      }
    })

    res.status(201).json({ success: true, data: scale })
  } catch (error) {
    console.error('Error creating behavior scale:', error)
    res.status(500).json({ success: false, error: 'Failed to create behavior scale' })
  }
})

// PUT /api/behavior/scales/:id - Update scale (Admin only)
router.put('/scales/:id', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, nameChinese, minValue, maxValue, labels, labelsChinese, colors, isDefault, isActive } = req.body

    // Verify scale belongs to school
    const existing = await prisma.behaviorScale.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Scale not found' })
    }

    // If setting as default, unset other defaults
    if (isDefault) {
      await prisma.behaviorScale.updateMany({
        where: { schoolId: req.user.schoolId, isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false }
      })
    }

    const scale = await prisma.behaviorScale.update({
      where: { id: req.params.id },
      data: {
        name,
        nameChinese,
        minValue,
        maxValue,
        labels,
        labelsChinese,
        colors,
        isDefault,
        isActive
      }
    })

    res.json({ success: true, data: scale })
  } catch (error) {
    console.error('Error updating behavior scale:', error)
    res.status(500).json({ success: false, error: 'Failed to update behavior scale' })
  }
})

// DELETE /api/behavior/scales/:id - Delete scale (Admin only)
router.delete('/scales/:id', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // Verify scale belongs to school
    const existing = await prisma.behaviorScale.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Scale not found' })
    }

    // Soft delete by setting isActive to false
    await prisma.behaviorScale.update({
      where: { id: req.params.id },
      data: { isActive: false }
    })

    res.json({ success: true, message: 'Scale deleted successfully' })
  } catch (error) {
    console.error('Error deleting behavior scale:', error)
    res.status(500).json({ success: false, error: 'Failed to delete behavior scale' })
  }
})

// ======================
// BEHAVIOR CATEGORIES
// ======================

// GET /api/behavior/categories - Get all categories for school
router.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await prisma.behaviorCategory.findMany({
      where: {
        schoolId: req.user.schoolId,
        isActive: true
      },
      include: {
        scale: true
      },
      orderBy: { sortOrder: 'asc' }
    })

    res.json({ success: true, data: categories })
  } catch (error) {
    console.error('Error fetching behavior categories:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch behavior categories' })
  }
})

// POST /api/behavior/categories - Create new category (Admin only)
router.post('/categories', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, nameChinese, description, descriptionChinese, icon, color, scaleId, sortOrder } = req.body

    // Validation
    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required' })
    }
    if (!scaleId) {
      return res.status(400).json({ success: false, error: 'Scale ID is required' })
    }

    // Verify scale belongs to school
    const scale = await prisma.behaviorScale.findFirst({
      where: { id: scaleId, schoolId: req.user.schoolId }
    })

    if (!scale) {
      return res.status(404).json({ success: false, error: 'Scale not found' })
    }

    const category = await prisma.behaviorCategory.create({
      data: {
        name,
        nameChinese,
        description,
        descriptionChinese,
        icon,
        color,
        scaleId,
        sortOrder: sortOrder || 0,
        schoolId: req.user.schoolId
      },
      include: {
        scale: true
      }
    })

    res.status(201).json({ success: true, data: category })
  } catch (error) {
    console.error('Error creating behavior category:', error)
    res.status(500).json({ success: false, error: 'Failed to create behavior category' })
  }
})

// PUT /api/behavior/categories/:id - Update category (Admin only)
router.put('/categories/:id', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, nameChinese, description, descriptionChinese, icon, color, scaleId, sortOrder, isActive } = req.body

    // Verify category belongs to school
    const existing = await prisma.behaviorCategory.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // If changing scale, verify new scale belongs to school
    if (scaleId && scaleId !== existing.scaleId) {
      const scale = await prisma.behaviorScale.findFirst({
        where: { id: scaleId, schoolId: req.user.schoolId }
      })
      if (!scale) {
        return res.status(404).json({ success: false, error: 'Scale not found' })
      }
    }

    const category = await prisma.behaviorCategory.update({
      where: { id: req.params.id },
      data: {
        name,
        nameChinese,
        description,
        descriptionChinese,
        icon,
        color,
        scaleId,
        sortOrder,
        isActive
      },
      include: {
        scale: true
      }
    })

    res.json({ success: true, data: category })
  } catch (error) {
    console.error('Error updating behavior category:', error)
    res.status(500).json({ success: false, error: 'Failed to update behavior category' })
  }
})

// DELETE /api/behavior/categories/:id - Delete category (Admin only)
router.delete('/categories/:id', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const existing = await prisma.behaviorCategory.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    })

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // Soft delete
    await prisma.behaviorCategory.update({
      where: { id: req.params.id },
      data: { isActive: false }
    })

    res.json({ success: true, message: 'Category deleted successfully' })
  } catch (error) {
    console.error('Error deleting behavior category:', error)
    res.status(500).json({ success: false, error: 'Failed to delete behavior category' })
  }
})

// ======================
// BEHAVIOR RECORDS
// ======================

// GET /api/behavior/records - Get records with filters
router.get('/records', authenticate, async (req, res) => {
  try {
    const { classId, studentId, date, startDate, endDate, categoryId } = req.query

    const where = {
      class: { schoolId: req.user.schoolId }
    }

    if (classId) where.classId = classId
    if (studentId) where.studentId = studentId
    if (categoryId) where.categoryId = categoryId
    
    if (date) {
      where.date = new Date(date)
    } else if (startDate || endDate) {
      where.date = {}
      if (startDate) where.date.gte = new Date(startDate)
      if (endDate) where.date.lte = new Date(endDate)
    }

    const records = await prisma.behaviorRecord.findMany({
      where,
      include: {
        category: {
          include: { scale: true }
        },
        student: {
          select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
        },
        recordedBy: {
          select: { id: true, firstName: true, lastName: true }
        }
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
    })

    res.json({ success: true, data: records })
  } catch (error) {
    console.error('Error fetching behavior records:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch behavior records' })
  }
})

// GET /api/behavior/records/class/:classId/date/:date - Get records for class on date
router.get('/records/class/:classId/date/:date', authenticate, async (req, res) => {
  try {
    const { classId, date } = req.params

    // Verify class belongs to school
    const classObj = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId }
    })

    if (!classObj) {
      return res.status(404).json({ success: false, error: 'Class not found' })
    }

    // Get all enrolled students
    const enrollments = await prisma.classEnrollment.findMany({
      where: { classId, status: 'ACTIVE' },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, englishName: true, photoUrl: true }
        }
      }
    })

    // Get all categories for this school
    const categories = await prisma.behaviorCategory.findMany({
      where: { schoolId: req.user.schoolId, isActive: true },
      include: { scale: true },
      orderBy: { sortOrder: 'asc' }
    })

    // Get existing records for this class and date
    const records = await prisma.behaviorRecord.findMany({
      where: {
        classId,
        date: new Date(date)
      },
      include: {
        category: { include: { scale: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } }
      }
    })

    // Organize by student
    const studentRecords = enrollments.map(enrollment => ({
      student: enrollment.student,
      records: categories.map(category => {
        const existing = records.find(
          r => r.studentId === enrollment.student.id && r.categoryId === category.id
        )
        return {
          categoryId: category.id,
          category,
          score: existing?.score || null,
          notes: existing?.notes || null,
          recordId: existing?.id || null,
          recordedBy: existing?.recordedBy || null
        }
      })
    }))

    res.json({
      success: true,
      data: {
        class: classObj,
        date,
        categories,
        studentRecords
      }
    })
  } catch (error) {
    console.error('Error fetching class behavior records:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch class behavior records' })
  }
})

// POST /api/behavior/records - Create or update behavior record
router.post('/records', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  try {
    const { categoryId, classId, studentId, date, score, notes } = req.body

    // Validation
    if (!categoryId || !classId || !studentId || !date || score === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields' })
    }

    // Verify category belongs to school and get scale
    const category = await prisma.behaviorCategory.findFirst({
      where: { id: categoryId, schoolId: req.user.schoolId },
      include: { scale: true }
    })

    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' })
    }

    // Validate score is within scale range
    if (score < category.scale.minValue || score > category.scale.maxValue) {
      return res.status(400).json({
        success: false,
        error: `Score must be between ${category.scale.minValue} and ${category.scale.maxValue}`
      })
    }

    // Verify class belongs to school
    const classObj = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId }
    })

    if (!classObj) {
      return res.status(404).json({ success: false, error: 'Class not found' })
    }

    // Verify student is enrolled in class
    const enrollment = await prisma.classEnrollment.findFirst({
      where: { classId, studentId, status: 'ACTIVE' }
    })

    if (!enrollment) {
      return res.status(400).json({ success: false, error: 'Student is not enrolled in this class' })
    }

    // Upsert the record
    const record = await prisma.behaviorRecord.upsert({
      where: {
        categoryId_classId_studentId_date: {
          categoryId,
          classId,
          studentId,
          date: new Date(date)
        }
      },
      update: {
        score,
        notes,
        recordedById: req.user.id,
        recordedAt: new Date()
      },
      create: {
        categoryId,
        classId,
        studentId,
        date: new Date(date),
        score,
        notes,
        recordedById: req.user.id
      },
      include: {
        category: { include: { scale: true } },
        student: { select: { id: true, firstName: true, lastName: true, englishName: true } },
        recordedBy: { select: { id: true, firstName: true, lastName: true } }
      }
    })

    res.status(201).json({ success: true, data: record })
  } catch (error) {
    console.error('Error creating behavior record:', error)
    res.status(500).json({ success: false, error: 'Failed to create behavior record' })
  }
})

// POST /api/behavior/records/bulk - Bulk create/update records
router.post('/records/bulk', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  try {
    const { classId, date, records } = req.body
    // records: [{ studentId, categoryId, score, notes }, ...]

    if (!classId || !date || !records || !Array.isArray(records)) {
      return res.status(400).json({ success: false, error: 'Missing required fields' })
    }

    // Verify class belongs to school
    const classObj = await prisma.class.findFirst({
      where: { id: classId, schoolId: req.user.schoolId }
    })

    if (!classObj) {
      return res.status(404).json({ success: false, error: 'Class not found' })
    }

    // Get all valid categories
    const categories = await prisma.behaviorCategory.findMany({
      where: { schoolId: req.user.schoolId, isActive: true },
      include: { scale: true }
    })
    const categoryMap = new Map(categories.map(c => [c.id, c]))

    // Process each record
    const results = []
    const errors = []

    for (const record of records) {
      const { studentId, categoryId, score, notes } = record

      // Skip if no score provided
      if (score === undefined || score === null) continue

      const category = categoryMap.get(categoryId)
      if (!category) {
        errors.push({ studentId, categoryId, error: 'Invalid category' })
        continue
      }

      // Validate score range
      if (score < category.scale.minValue || score > category.scale.maxValue) {
        errors.push({ studentId, categoryId, error: 'Score out of range' })
        continue
      }

      try {
        const result = await prisma.behaviorRecord.upsert({
          where: {
            categoryId_classId_studentId_date: {
              categoryId,
              classId,
              studentId,
              date: new Date(date)
            }
          },
          update: {
            score,
            notes,
            recordedById: req.user.id,
            recordedAt: new Date()
          },
          create: {
            categoryId,
            classId,
            studentId,
            date: new Date(date),
            score,
            notes,
            recordedById: req.user.id
          }
        })
        results.push(result)
      } catch (err) {
        errors.push({ studentId, categoryId, error: err.message })
      }
    }

    res.json({
      success: true,
      data: {
        saved: results.length,
        errors: errors.length > 0 ? errors : undefined
      }
    })
  } catch (error) {
    console.error('Error bulk saving behavior records:', error)
    res.status(500).json({ success: false, error: 'Failed to save behavior records' })
  }
})

// GET /api/behavior/student/:studentId/summary - Get behavior summary for student
router.get('/student/:studentId/summary', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params
    const { startDate, endDate, classId } = req.query

    // Build where clause
    const where = {
      studentId,
      student: { schoolId: req.user.schoolId }
    }

    if (classId) where.classId = classId
    if (startDate || endDate) {
      where.date = {}
      if (startDate) where.date.gte = new Date(startDate)
      if (endDate) where.date.lte = new Date(endDate)
    }

    // Get all records
    const records = await prisma.behaviorRecord.findMany({
      where,
      include: {
        category: { include: { scale: true } },
        class: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    })

    // Calculate averages per category
    const categoryStats = {}
    for (const record of records) {
      if (!categoryStats[record.categoryId]) {
        categoryStats[record.categoryId] = {
          category: record.category,
          totalScore: 0,
          count: 0,
          records: []
        }
      }
      categoryStats[record.categoryId].totalScore += record.score
      categoryStats[record.categoryId].count++
      categoryStats[record.categoryId].records.push(record)
    }

    // Calculate averages
    const summary = Object.values(categoryStats).map(stat => ({
      category: stat.category,
      averageScore: stat.count > 0 ? (stat.totalScore / stat.count).toFixed(2) : null,
      totalRecords: stat.count,
      recentRecords: stat.records.slice(0, 5) // Last 5 records
    }))

    res.json({ success: true, data: summary })
  } catch (error) {
    console.error('Error fetching student behavior summary:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch behavior summary' })
  }
})

export default router;