// src/routes/calendar.js
// Academic Calendar routes - Events, Schedule Overrides, Tours

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================
// CALENDAR EVENTS
// ============================================

/**
 * GET /api/calendar/events
 * List calendar events with optional filters
 */
router.get('/events', async (req, res) => {
  try {
    const { startDate, endDate, type, month, year } = req.query;
    
    const where = {
      schoolId: req.user.schoolId
    };

    // Date range filter
    if (startDate && endDate) {
      where.OR = [
        { startDate: { gte: new Date(startDate), lte: new Date(endDate) } },
        { endDate: { gte: new Date(startDate), lte: new Date(endDate) } },
        { AND: [
          { startDate: { lte: new Date(startDate) } },
          { endDate: { gte: new Date(endDate) } }
        ]}
      ];
    } else if (month && year) {
      const monthStart = new Date(Number(year), Number(month) - 1, 1);
      const monthEnd = new Date(Number(year), Number(month), 0, 23, 59, 59);
      where.OR = [
        { startDate: { gte: monthStart, lte: monthEnd } },
        { endDate: { gte: monthStart, lte: monthEnd } },
        { AND: [
          { startDate: { lte: monthStart } },
          { endDate: { gte: monthEnd } }
        ]}
      ];
    }

    if (type) {
      where.type = type;
    }

    const events = await prisma.calendarEvent.findMany({
      where,
      include: {
        createdBy: {
          select: { id: true, firstName: true, lastName: true }
        },
        classImpacts: {
          include: {
            class: { select: { id: true, name: true } }
          }
        },
        _count: { select: { tours: true } }
      },
      orderBy: { startDate: 'asc' }
    });

    res.json({ success: true, data: { events } });
  } catch (error) {
    console.error('[ERROR] GET /calendar/events:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch events', messageZh: '無法取得活動' }
    });
  }
});

/**
 * GET /api/calendar/events/:id
 */
router.get('/events/:id', async (req, res) => {
  try {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        classImpacts: {
          include: {
            class: { select: { id: true, name: true, dayOfWeek: true, startTime: true, endTime: true } }
          }
        },
        tours: {
          include: {
            assignedTo: { select: { id: true, firstName: true, lastName: true } }
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        error: { message: 'Event not found', messageZh: '找不到活動' }
      });
    }

    res.json({ success: true, data: event });
  } catch (error) {
    console.error('[ERROR] GET /calendar/events/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch event', messageZh: '無法取得活動' }
    });
  }
});

/**
 * POST /api/calendar/events
 */
router.post('/events', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      name, nameChinese, type, description, descriptionChinese,
      startDate, endDate, isAllDay, affectsAll, notifyParents, classImpacts
    } = req.body;

    if (!name || !type || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'Name, type, startDate, and endDate are required', messageZh: '名稱、類型、開始日期和結束日期為必填' }
      });
    }

    const event = await prisma.calendarEvent.create({
      data: {
        schoolId: req.user.schoolId,
        name,
        nameChinese,
        type,
        description,
        descriptionChinese,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        isAllDay: isAllDay ?? true,
        affectsAll: affectsAll ?? false,
        notifyParents: notifyParents ?? false,
        createdById: req.user.id,
        classImpacts: classImpacts?.length > 0 ? {
          create: classImpacts.map(ci => ({
            classId: ci.classId,
            impact: ci.impact,
            newTime: ci.newTime,
            notes: ci.notes,
            notesChinese: ci.notesChinese
          }))
        } : undefined
      },
      include: {
        classImpacts: {
          include: { class: { select: { id: true, name: true } } }
        }
      }
    });

    res.status(201).json({ success: true, data: event });
  } catch (error) {
    console.error('[ERROR] POST /calendar/events:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create event', messageZh: '無法建立活動' }
    });
  }
});

/**
 * PUT /api/calendar/events/:id
 */
router.put('/events/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      name, nameChinese, type, description, descriptionChinese,
      startDate, endDate, isAllDay, affectsAll, notifyParents, classImpacts
    } = req.body;

    const existing = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Event not found', messageZh: '找不到活動' }
      });
    }

    const event = await prisma.$transaction(async (tx) => {
      if (classImpacts !== undefined) {
        await tx.eventClassImpact.deleteMany({ where: { eventId: req.params.id } });
      }

      return tx.calendarEvent.update({
        where: { id: req.params.id },
        data: {
          name,
          nameChinese,
          type,
          description,
          descriptionChinese,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          isAllDay,
          affectsAll,
          notifyParents,
          classImpacts: classImpacts?.length > 0 ? {
            create: classImpacts.map(ci => ({
              classId: ci.classId,
              impact: ci.impact,
              newTime: ci.newTime,
              notes: ci.notes,
              notesChinese: ci.notesChinese
            }))
          } : undefined
        },
        include: {
          classImpacts: {
            include: { class: { select: { id: true, name: true } } }
          }
        }
      });
    });

    res.json({ success: true, data: event });
  } catch (error) {
    console.error('[ERROR] PUT /calendar/events/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update event', messageZh: '無法更新活動' }
    });
  }
});

/**
 * DELETE /api/calendar/events/:id
 */
router.delete('/events/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const existing = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Event not found', messageZh: '找不到活動' }
      });
    }

    await prisma.calendarEvent.delete({ where: { id: req.params.id } });

    res.json({ success: true, data: { message: 'Event deleted', messageZh: '活動已刪除' } });
  } catch (error) {
    console.error('[ERROR] DELETE /calendar/events/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete event', messageZh: '無法刪除活動' }
    });
  }
});

/**
 * POST /api/calendar/events/:id/notify
 */
router.post('/events/:id/notify', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const event = await prisma.calendarEvent.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId },
      include: {
        classImpacts: {
          include: {
            class: {
              include: {
                enrollments: {
                  where: { status: 'ACTIVE' },
                  include: {
                    student: {
                      include: {
                        parentRelations: { include: { parent: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        error: { message: 'Event not found', messageZh: '找不到活動' }
      });
    }

    await prisma.calendarEvent.update({
      where: { id: req.params.id },
      data: { notifySent: true, notifySentAt: new Date() }
    });

    const parentIds = new Set();
    event.classImpacts.forEach(impact => {
      impact.class.enrollments.forEach(enrollment => {
        enrollment.student.parentRelations.forEach(ps => {
          parentIds.add(ps.parent.id);
        });
      });
    });

    res.json({
      success: true,
      data: {
        message: `Notification sent to ${parentIds.size} parents`,
        messageZh: `已發送通知給 ${parentIds.size} 位家長`,
        parentCount: parentIds.size
      }
    });
  } catch (error) {
    console.error('[ERROR] POST /calendar/events/:id/notify:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to send notifications', messageZh: '無法發送通知' }
    });
  }
});

// ============================================
// TOUR BOOKINGS
// ============================================

/**
 * GET /api/calendar/tours
 */
router.get('/tours', async (req, res) => {
  try {
    const { status, startDate, endDate, assignedToId } = req.query;

    const where = { schoolId: req.user.schoolId };

    if (status) where.status = status;
    if (startDate && endDate) {
      where.scheduledAt = { gte: new Date(startDate), lte: new Date(endDate) };
    }
    if (assignedToId) where.assignedToId = assignedToId;

    const tours = await prisma.tourBooking.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        event: { select: { id: true, name: true, nameChinese: true } },
        enrolledStudent: { select: { id: true, firstName: true, lastName: true } }
      },
      orderBy: { scheduledAt: 'asc' }
    });

    res.json({ success: true, data: { tours } });
  } catch (error) {
    console.error('[ERROR] GET /calendar/tours:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch tours', messageZh: '無法取得參觀預約' }
    });
  }
});

/**
 * GET /api/calendar/tours/:id
 */
router.get('/tours/:id', async (req, res) => {
  try {
    const tour = await prisma.tourBooking.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        event: true,
        enrolledStudent: true
      }
    });

    if (!tour) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tour booking not found', messageZh: '找不到參觀預約' }
      });
    }

    res.json({ success: true, data: tour });
  } catch (error) {
    console.error('[ERROR] GET /calendar/tours/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch tour', messageZh: '無法取得參觀預約' }
    });
  }
});

/**
 * POST /api/calendar/tours
 */
router.post('/tours', async (req, res) => {
  try {
    const {
      eventId, prospectName, prospectNameChinese, prospectPhone, prospectEmail,
      childName, childNameChinese, childAge, currentSchool,
      interestedLevel, interestedProgram, scheduledAt, assignedToId, notes
    } = req.body;

    if (!prospectName || !scheduledAt) {
      return res.status(400).json({
        success: false,
        error: { message: 'Prospect name and scheduled time are required', messageZh: '家長姓名和預約時間為必填' }
      });
    }

    const tour = await prisma.tourBooking.create({
      data: {
        schoolId: req.user.schoolId,
        eventId,
        prospectName,
        prospectNameChinese,
        prospectPhone,
        prospectEmail,
        childName,
        childNameChinese,
        childAge: childAge ? parseInt(childAge) : null,
        currentSchool,
        interestedLevel,
        interestedProgram,
        scheduledAt: new Date(scheduledAt),
        assignedToId,
        notes,
        status: 'SCHEDULED'
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.status(201).json({ success: true, data: tour });
  } catch (error) {
    console.error('[ERROR] POST /calendar/tours:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to create tour booking', messageZh: '無法建立參觀預約' }
    });
  }
});

/**
 * PUT /api/calendar/tours/:id
 */
router.put('/tours/:id', async (req, res) => {
  try {
    const existing = await prisma.tourBooking.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tour booking not found', messageZh: '找不到參觀預約' }
      });
    }

    const {
      prospectName, prospectNameChinese, prospectPhone, prospectEmail,
      childName, childNameChinese, childAge, currentSchool,
      interestedLevel, interestedProgram, scheduledAt, assignedToId,
      status, notes, followUpDate, enrolledStudentId
    } = req.body;

    const tour = await prisma.tourBooking.update({
      where: { id: req.params.id },
      data: {
        prospectName,
        prospectNameChinese,
        prospectPhone,
        prospectEmail,
        childName,
        childNameChinese,
        childAge: childAge ? parseInt(childAge) : undefined,
        currentSchool,
        interestedLevel,
        interestedProgram,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        assignedToId,
        status,
        notes,
        followUpDate: followUpDate ? new Date(followUpDate) : undefined,
        enrolledStudentId
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        enrolledStudent: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.json({ success: true, data: tour });
  } catch (error) {
    console.error('[ERROR] PUT /calendar/tours/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update tour booking', messageZh: '無法更新參觀預約' }
    });
  }
});

/**
 * DELETE /api/calendar/tours/:id
 */
router.delete('/tours/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const existing = await prisma.tourBooking.findFirst({
      where: { id: req.params.id, schoolId: req.user.schoolId }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { message: 'Tour booking not found', messageZh: '找不到參觀預約' }
      });
    }

    await prisma.tourBooking.delete({ where: { id: req.params.id } });

    res.json({ success: true, data: { message: 'Tour booking deleted', messageZh: '參觀預約已刪除' } });
  } catch (error) {
    console.error('[ERROR] DELETE /calendar/tours/:id:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to delete tour', messageZh: '無法刪除參觀預約' }
    });
  }
});

// ============================================
// SCHEDULE HELPERS
// ============================================

/**
 * GET /api/calendar/schedule
 */
router.get('/schedule', async (req, res) => {
  try {
    const { startDate, endDate, classId } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: { message: 'startDate and endDate are required', messageZh: '開始日期和結束日期為必填' }
      });
    }

    const classWhere = { schoolId: req.user.schoolId };
    if (classId) classWhere.id = classId;
    if (req.user.role === 'TEACHER') classWhere.teacherId = req.user.id;

    const classes = await prisma.class.findMany({
      where: classWhere,
      include: { teacher: { select: { id: true, firstName: true, lastName: true } } }
    });

    const events = await prisma.calendarEvent.findMany({
      where: {
        schoolId: req.user.schoolId,
        OR: [
          { startDate: { gte: new Date(startDate), lte: new Date(endDate) } },
          { endDate: { gte: new Date(startDate), lte: new Date(endDate) } },
          { AND: [
            { startDate: { lte: new Date(startDate) } },
            { endDate: { gte: new Date(endDate) } }
          ]}
        ]
      },
      include: { classImpacts: true }
    });

    const classIds = classes.map(c => c.id);
    const impacts = await prisma.eventClassImpact.findMany({
      where: {
        classId: { in: classIds },
        event: {
          startDate: { lte: new Date(endDate) },
          endDate: { gte: new Date(startDate) }
        }
      },
      include: {
        event: { select: { id: true, name: true, nameChinese: true, type: true, startDate: true, endDate: true } }
      }
    });

    const impactsByClass = {};
    impacts.forEach(impact => {
      if (!impactsByClass[impact.classId]) {
        impactsByClass[impact.classId] = [];
      }
      impactsByClass[impact.classId].push(impact);
    });

    res.json({
      success: true,
      data: {
        classes: classes.map(c => ({ ...c, impacts: impactsByClass[c.id] || [] })),
        events
      }
    });
  } catch (error) {
    console.error('[ERROR] GET /calendar/schedule:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to fetch schedule', messageZh: '無法取得課程表' }
    });
  }
});

export default router;