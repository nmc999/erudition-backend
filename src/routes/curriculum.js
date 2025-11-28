// Curriculum Routes
// Handles lesson plans and teaching materials

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// =====================
// LESSON PLANS
// =====================

/**
 * GET /api/curriculum/lessons
 * Get lesson plans with optional filters
 */
router.get('/lessons', authenticate, asyncHandler(async (req, res) => {
  const { classId, startDate, endDate, status, page = 1, limit = 20 } = req.query;
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {};

  // Filter by teacher's classes if not admin
  if (req.user.role === 'TEACHER') {
    where.class = {
      teacherId: req.user.id
    };
  }

  if (classId) {
    where.classId = classId;
  }

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  if (status) {
    where.status = status;
  }

  const [lessons, total] = await Promise.all([
    prisma.lessonPlan.findMany({
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
        }
      },
      orderBy: { date: 'desc' },
      skip,
      take
    }),
    prisma.lessonPlan.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      lessons,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * POST /api/curriculum/lessons
 * Create a new lesson plan
 */
router.post('/lessons', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), asyncHandler(async (req, res) => {
  const {
    title,
    classId,
    date,
    duration,
    objectives,
    content,
    materials,
    homework,
    notes
  } = req.body;

  if (!title || !classId) {
    return res.status(400).json({
      success: false,
      message: 'Title and class are required'
    });
  }

  const lesson = await prisma.lessonPlan.create({
    data: {
      title,
      classId,
      date: date ? new Date(date) : new Date(),
      duration: duration || 90,
      objectives: objectives || null,
      content: content || null,
      materials: materials || null,
      homework: homework || null,
      notes: notes || null,
      status: 'SCHEDULED',
      createdById: req.user.id
    },
    include: {
      class: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Lesson plan created',
    data: { lesson }
  });
}));

/**
 * GET /api/curriculum/lessons/:id
 * Get a specific lesson plan
 */
router.get('/lessons/:id', authenticate, asyncHandler(async (req, res) => {
  const lesson = await prisma.lessonPlan.findUnique({
    where: { id: req.params.id },
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
      }
    }
  });

  if (!lesson) {
    return res.status(404).json({
      success: false,
      message: 'Lesson plan not found'
    });
  }

  res.json({
    success: true,
    data: { lesson }
  });
}));

/**
 * PUT /api/curriculum/lessons/:id
 * Update a lesson plan
 */
router.put('/lessons/:id', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), asyncHandler(async (req, res) => {
  const {
    title,
    classId,
    date,
    duration,
    objectives,
    content,
    materials,
    homework,
    notes,
    status
  } = req.body;

  const lesson = await prisma.lessonPlan.update({
    where: { id: req.params.id },
    data: {
      title,
      classId,
      date: date ? new Date(date) : undefined,
      duration,
      objectives,
      content,
      materials,
      homework,
      notes,
      status
    },
    include: {
      class: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  res.json({
    success: true,
    message: 'Lesson plan updated',
    data: { lesson }
  });
}));

/**
 * DELETE /api/curriculum/lessons/:id
 * Delete a lesson plan
 */
router.delete('/lessons/:id', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), asyncHandler(async (req, res) => {
  await prisma.lessonPlan.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Lesson plan deleted'
  });
}));

// =====================
// TEACHING MATERIALS
// =====================

/**
 * GET /api/curriculum/materials
 * Get teaching materials with optional filters
 */
router.get('/materials', authenticate, asyncHandler(async (req, res) => {
  const { classId, type, search, page = 1, limit = 20 } = req.query;
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {};

  if (classId) {
    where.classId = classId;
  }

  if (type) {
    where.type = type;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } }
    ];
  }

  const [materials, total] = await Promise.all([
    prisma.teachingMaterial.findMany({
      where,
      include: {
        class: {
          select: {
            id: true,
            name: true
          }
        },
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.teachingMaterial.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      materials,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * POST /api/curriculum/materials
 * Upload a new teaching material
 */
router.post('/materials', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), asyncHandler(async (req, res) => {
  const {
    title,
    classId,
    type,
    description,
    url,
    fileSize
  } = req.body;

  if (!title || !classId) {
    return res.status(400).json({
      success: false,
      message: 'Title and class are required'
    });
  }

  const material = await prisma.teachingMaterial.create({
    data: {
      title,
      classId,
      type: type || 'document',
      description: description || null,
      url: url || null,
      fileSize: fileSize || null,
      uploadedById: req.user.id
    },
    include: {
      class: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  res.status(201).json({
    success: true,
    message: 'Material uploaded',
    data: { material }
  });
}));

/**
 * DELETE /api/curriculum/materials/:id
 * Delete a teaching material
 */
router.delete('/materials/:id', authenticate, authorize('ADMIN', 'MANAGER', 'TEACHER'), asyncHandler(async (req, res) => {
  await prisma.teachingMaterial.delete({
    where: { id: req.params.id }
  });

  res.json({
    success: true,
    message: 'Material deleted'
  });
}));

export default router;
