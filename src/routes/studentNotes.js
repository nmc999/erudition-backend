// src/routes/studentNotes.js
// Student Notes routes - Persistent categorical notes

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/student-notes/student/:studentId
 * Get all notes for a student
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { category, includePrivate } = req.query;

    // Verify student belongs to school
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { message: 'Student not found', messageZh: '找不到學生' }
      });
    }

    const where = { studentId };

    if (category) where.category = category;

    // Teachers can only see non-private notes unless admin/manager
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(req.user.role);
    if (!isAdminOrManager && includePrivate !== 'true') {
      where.isPrivate = false;
    }

    const notes = await prisma.studentNote.findMany({
      where,
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } }
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({ success: true, data: { notes } });
  } catch (error) {
    console.error('[ERROR] GET /student-notes/student/:studentId:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch notes', messageZh: '無法取得備註' }
    });
  }
});

/**
 * GET /api/student-notes/:id
 * Get single note
 */
router.get('/:id', async (req, res) => {
  try {
    const note = await prisma.studentNote.findFirst({
      where: { id: req.params.id },
      include: {
        student: { select: { id: true, firstName: true, lastName: true, schoolId: true } },
        author: { select: { id: true, firstName: true, lastName: true, role: true } }
      }
    });

    if (!note || note.student.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Note not found', messageZh: '找不到備註' }
      });
    }

    // Check private note access
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(req.user.role);
    if (note.isPrivate && !isAdminOrManager && note.authorId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied to private note', messageZh: '無權查看私人備註' }
      });
    }

    res.json({ success: true, data: note });
  } catch (error) {
    console.error('[ERROR] GET /student-notes/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch note', messageZh: '無法取得備註' }
    });
  }
});

/**
 * POST /api/student-notes
 * Create a new student note
 */
router.post('/', async (req, res) => {
  try {
    const { studentId, category, title, content, contentChinese, isPrivate, isPinned } = req.body;

    if (!studentId || !category || !content) {
      return res.status(400).json({
        success: false,
        error: { message: 'studentId, category, and content are required', messageZh: '學生、類別和內容為必填' }
      });
    }

    // Verify student belongs to school
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: req.user.schoolId }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        error: { message: 'Student not found', messageZh: '找不到學生' }
      });
    }

    // Only Admin/Manager can create private or pinned notes
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(req.user.role);
    const actualIsPrivate = isAdminOrManager ? (isPrivate ?? false) : false;
    const actualIsPinned = isAdminOrManager ? (isPinned ?? false) : false;

    const note = await prisma.studentNote.create({
      data: {
        studentId,
        authorId: req.user.id,
        category,
        title,
        content,
        contentChinese,
        isPrivate: actualIsPrivate,
        isPinned: actualIsPinned
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } }
      }
    });

    res.status(201).json({ success: true, data: note });
  } catch (error) {
    console.error('[ERROR] POST /student-notes:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create note', messageZh: '無法建立備註' }
    });
  }
});

/**
 * PUT /api/student-notes/:id
 * Update a student note
 */
router.put('/:id', async (req, res) => {
  try {
    const note = await prisma.studentNote.findFirst({
      where: { id: req.params.id },
      include: { student: { select: { schoolId: true } } }
    });

    if (!note || note.student.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Note not found', messageZh: '找不到備註' }
      });
    }

    // Check edit permission
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(req.user.role);
    const isAuthor = note.authorId === req.user.id;

    if (!isAdminOrManager && !isAuthor) {
      return res.status(403).json({
        success: false,
        error: { message: 'Cannot edit notes by other users', messageZh: '無權編輯他人的備註' }
      });
    }

    const { category, title, content, contentChinese, isPrivate, isPinned } = req.body;

    const updateData = { category, title, content, contentChinese };

    // Only admin/manager can change privacy/pinned status
    if (isAdminOrManager) {
      if (isPrivate !== undefined) updateData.isPrivate = isPrivate;
      if (isPinned !== undefined) updateData.isPinned = isPinned;
    }

    const updatedNote = await prisma.studentNote.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } }
      }
    });

    res.json({ success: true, data: updatedNote });
  } catch (error) {
    console.error('[ERROR] PUT /student-notes/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update note', messageZh: '無法更新備註' }
    });
  }
});

/**
 * DELETE /api/student-notes/:id
 * Delete a student note
 */
router.delete('/:id', async (req, res) => {
  try {
    const note = await prisma.studentNote.findFirst({
      where: { id: req.params.id },
      include: { student: { select: { schoolId: true } } }
    });

    if (!note || note.student.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Note not found', messageZh: '找不到備註' }
      });
    }

    // Check delete permission
    const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(req.user.role);
    const isAuthor = note.authorId === req.user.id;

    if (!isAdminOrManager && !isAuthor) {
      return res.status(403).json({
        success: false,
        error: { message: 'Cannot delete notes by other users', messageZh: '無權刪除他人的備註' }
      });
    }

    await prisma.studentNote.delete({ where: { id: req.params.id } });

    res.json({ success: true, data: { message: 'Note deleted', messageZh: '備註已刪除' } });
  } catch (error) {
    console.error('[ERROR] DELETE /student-notes/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete note', messageZh: '無法刪除備註' }
    });
  }
});

/**
 * POST /api/student-notes/:id/pin
 * Toggle pin status (Admin/Manager only)
 */
router.post('/:id/pin', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const note = await prisma.studentNote.findFirst({
      where: { id: req.params.id },
      include: { student: { select: { schoolId: true } } }
    });

    if (!note || note.student.schoolId !== req.user.schoolId) {
      return res.status(404).json({
        success: false,
        error: { message: 'Note not found', messageZh: '找不到備註' }
      });
    }

    const updatedNote = await prisma.studentNote.update({
      where: { id: req.params.id },
      data: { isPinned: !note.isPinned }
    });

    res.json({ success: true, data: updatedNote });
  } catch (error) {
    console.error('[ERROR] POST /student-notes/:id/pin:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to toggle pin', messageZh: '無法切換釘選狀態' }
    });
  }
});

/**
 * GET /api/student-notes/search
 * Search notes across students (Admin/Manager only)
 */
router.get('/search', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { query, category, startDate, endDate } = req.query;

    if (!query && !category) {
      return res.status(400).json({
        success: false,
        error: { message: 'Search query or category required', messageZh: '需要搜尋關鍵字或類別' }
      });
    }

    const where = {
      student: { schoolId: req.user.schoolId }
    };

    if (query) {
      where.OR = [
        { content: { contains: query, mode: 'insensitive' } },
        { contentChinese: { contains: query, mode: 'insensitive' } },
        { title: { contains: query, mode: 'insensitive' } }
      ];
    }

    if (category) where.category = category;

    if (startDate && endDate) {
      where.createdAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }

    const notes = await prisma.studentNote.findMany({
      where,
      include: {
        student: { select: { id: true, firstName: true, lastName: true, englishName: true } },
        author: { select: { id: true, firstName: true, lastName: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({ success: true, data: { notes } });
  } catch (error) {
    console.error('[ERROR] GET /student-notes/search:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to search notes', messageZh: '無法搜尋備註' }
    });
  }
});

export default router;