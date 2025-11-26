import express from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, authorize } from '../middleware/auth.js'
import { format, startOfMonth, endOfMonth, subMonths, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isFuture } from 'date-fns'

const router = express.Router()
const prisma = new PrismaClient()

// All routes require authentication and PARENT role
router.use(authenticate)
router.use(authorize('PARENT'))

// ============================================
// PARENT DASHBOARD
// ============================================

// GET /api/parent/dashboard - Main parent dashboard data
router.get('/dashboard', async (req, res, next) => {
  try {
    const parentId = req.user.id

    // Get all children
    const parentRelations = await prisma.parentStudent.findMany({
      where: { parentId },
      include: {
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: { class: { include: { teacher: { select: { firstName: true, lastName: true } } } } }
            }
          }
        }
      }
    })

    const children = parentRelations.map(r => r.student)
    const childIds = children.map(c => c.id)

    if (childIds.length === 0) {
      return res.json({
        success: true,
        data: {
          children: [],
          todayAttendance: [],
          upcomingHomework: [],
          pendingInvoices: [],
          unreadMessages: 0
        }
      })
    }

    // Today's attendance
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const todayAttendance = await prisma.attendance.findMany({
      where: {
        studentId: { in: childIds },
        date: { gte: today }
      },
      include: {
        student: { select: { firstName: true, lastName: true } },
        class: { select: { name: true } }
      }
    })

    // Upcoming homework (due in next 7 days)
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)

    const upcomingHomework = await prisma.homework.findMany({
      where: {
        class: {
          enrollments: {
            some: {
              studentId: { in: childIds },
              status: 'ACTIVE'
            }
          }
        },
        dueDate: {
          gte: new Date(),
          lte: nextWeek
        }
      },
      include: {
        class: { select: { name: true } },
        submissions: {
          where: { studentId: { in: childIds } }
        }
      },
      orderBy: { dueDate: 'asc' }
    })

    // Add submission status for each child
    const homeworkWithStatus = upcomingHomework.map(hw => ({
      ...hw,
      submissionStatus: childIds.map(childId => ({
        studentId: childId,
        submitted: hw.submissions.some(s => s.studentId === childId)
      }))
    }))

    // Pending invoices
    const pendingInvoices = await prisma.invoice.findMany({
      where: {
        studentId: { in: childIds },
        status: { in: ['PENDING', 'OVERDUE'] }
      },
      include: {
        student: { select: { firstName: true, lastName: true } }
      },
      orderBy: { dueDate: 'asc' }
    })

    // Unread messages
    const unreadMessages = await prisma.message.count({
      where: {
        recipientId: parentId,
        readAt: null
      }
    })

    // This week's attendance summary per child
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })

    const weekAttendance = await prisma.attendance.findMany({
      where: {
        studentId: { in: childIds },
        date: { gte: weekStart, lte: weekEnd }
      }
    })

    const childSummaries = children.map(child => {
      const childAttendance = weekAttendance.filter(a => a.studentId === child.id)
      return {
        ...child,
        weeklyStats: {
          total: childAttendance.length,
          present: childAttendance.filter(a => a.status === 'PRESENT').length,
          absent: childAttendance.filter(a => a.status === 'ABSENT').length,
          late: childAttendance.filter(a => a.status === 'LATE').length
        }
      }
    })

    res.json({
      success: true,
      data: {
        children: childSummaries,
        todayAttendance,
        upcomingHomework: homeworkWithStatus,
        pendingInvoices,
        unreadMessages
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/children - Get all children with detailed info
router.get('/children', async (req, res, next) => {
  try {
    const parentId = req.user.id

    const relations = await prisma.parentStudent.findMany({
      where: { parentId },
      include: {
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
                class: {
                  include: {
                    teacher: { select: { firstName: true, lastName: true, email: true } }
                  }
                }
              }
            }
          }
        }
      }
    })

    const children = relations.map(r => ({
      ...r.student,
      relationship: r.relationship,
      isPrimary: r.isPrimary
    }))

    res.json({ success: true, data: { children } })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/children/:id - Get single child details
router.get('/children/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const parentId = req.user.id

    // Verify parent-child relationship
    const relation = await prisma.parentStudent.findFirst({
      where: { parentId, studentId: id }
    })

    if (!relation) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied / 無權限查看' }
      })
    }

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            class: {
              include: {
                teacher: { select: { firstName: true, lastName: true, email: true, phone: true } }
              }
            }
          }
        }
      }
    })

    res.json({ success: true, data: { student } })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/children/:id/attendance - Get child's attendance calendar
router.get('/children/:id/attendance', async (req, res, next) => {
  try {
    const { id } = req.params
    const { month } = req.query
    const parentId = req.user.id

    // Verify parent-child relationship
    const relation = await prisma.parentStudent.findFirst({
      where: { parentId, studentId: id }
    })

    if (!relation) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied / 無權限查看' }
      })
    }

    // Get month range
    const targetMonth = month ? new Date(month) : new Date()
    const monthStart = startOfMonth(targetMonth)
    const monthEnd = endOfMonth(targetMonth)

    // Get attendance records
    const attendance = await prisma.attendance.findMany({
      where: {
        studentId: id,
        date: { gte: monthStart, lte: monthEnd }
      },
      include: {
        class: { select: { name: true } }
      },
      orderBy: { date: 'asc' }
    })

    // Build calendar data
    const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
    const calendarData = days.map(day => {
      const dayRecords = attendance.filter(a => 
        format(a.date, 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
      )
      return {
        date: format(day, 'yyyy-MM-dd'),
        dayOfWeek: format(day, 'EEEE'),
        isToday: isToday(day),
        isFuture: isFuture(day),
        records: dayRecords.map(r => ({
          className: r.class.name,
          status: r.status,
          reason: r.reason,
          notes: r.notes
        }))
      }
    })

    // Calculate monthly stats
    const stats = {
      total: attendance.length,
      present: attendance.filter(a => a.status === 'PRESENT').length,
      absent: attendance.filter(a => a.status === 'ABSENT').length,
      late: attendance.filter(a => a.status === 'LATE').length,
      excused: attendance.filter(a => a.status === 'EXCUSED').length
    }
    stats.attendanceRate = stats.total > 0 
      ? ((stats.present / stats.total) * 100).toFixed(1)
      : 0

    res.json({
      success: true,
      data: {
        month: format(targetMonth, 'yyyy-MM'),
        monthDisplay: format(targetMonth, 'yyyy年MM月'),
        stats,
        calendar: calendarData
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/children/:id/homework - Get child's homework
router.get('/children/:id/homework', async (req, res, next) => {
  try {
    const { id } = req.params
    const { status } = req.query // pending, submitted, graded
    const parentId = req.user.id

    // Verify parent-child relationship
    const relation = await prisma.parentStudent.findFirst({
      where: { parentId, studentId: id }
    })

    if (!relation) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied / 無權限查看' }
      })
    }

    // Get student's classes
    const enrollments = await prisma.classEnrollment.findMany({
      where: { studentId: id, status: 'ACTIVE' },
      select: { classId: true }
    })
    const classIds = enrollments.map(e => e.classId)

    // Get homework for those classes
    const homework = await prisma.homework.findMany({
      where: {
        classId: { in: classIds }
      },
      include: {
        class: { select: { name: true } },
        submissions: {
          where: { studentId: id }
        }
      },
      orderBy: { dueDate: 'desc' },
      take: 50
    })

    // Add submission status
    const homeworkWithStatus = homework.map(hw => {
      const submission = hw.submissions[0]
      const isOverdue = new Date(hw.dueDate) < new Date() && !submission

      let homeworkStatus = 'pending'
      if (submission) {
        homeworkStatus = submission.status.toLowerCase()
      } else if (isOverdue) {
        homeworkStatus = 'overdue'
      }

      return {
        id: hw.id,
        title: hw.title,
        description: hw.description,
        className: hw.class.name,
        dueDate: hw.dueDate,
        maxScore: hw.maxScore,
        status: homeworkStatus,
        submission: submission ? {
          submittedAt: submission.submittedAt,
          score: submission.score,
          feedback: submission.feedback,
          gradedAt: submission.gradedAt
        } : null
      }
    })

    // Filter by status if provided
    let filtered = homeworkWithStatus
    if (status === 'pending') {
      filtered = homeworkWithStatus.filter(h => h.status === 'pending')
    } else if (status === 'submitted') {
      filtered = homeworkWithStatus.filter(h => ['submitted', 'late'].includes(h.status))
    } else if (status === 'graded') {
      filtered = homeworkWithStatus.filter(h => h.status === 'graded')
    }

    // Stats
    const stats = {
      total: homeworkWithStatus.length,
      pending: homeworkWithStatus.filter(h => h.status === 'pending').length,
      overdue: homeworkWithStatus.filter(h => h.status === 'overdue').length,
      submitted: homeworkWithStatus.filter(h => ['submitted', 'late', 'graded'].includes(h.status)).length,
      graded: homeworkWithStatus.filter(h => h.status === 'graded').length
    }

    // Calculate average score
    const gradedHomework = homeworkWithStatus.filter(h => h.submission?.score !== null && h.maxScore)
    if (gradedHomework.length > 0) {
      const avgPercentage = gradedHomework.reduce((sum, h) => 
        sum + (h.submission.score / h.maxScore * 100), 0
      ) / gradedHomework.length
      stats.averageScore = avgPercentage.toFixed(1)
    } else {
      stats.averageScore = null
    }

    res.json({
      success: true,
      data: {
        stats,
        homework: filtered
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/children/:id/invoices - Get child's invoices
router.get('/children/:id/invoices', async (req, res, next) => {
  try {
    const { id } = req.params
    const parentId = req.user.id

    // Verify parent-child relationship
    const relation = await prisma.parentStudent.findFirst({
      where: { parentId, studentId: id }
    })

    if (!relation) {
      return res.status(403).json({
        success: false,
        error: { message: 'Access denied / 無權限查看' }
      })
    }

    const invoices = await prisma.invoice.findMany({
      where: { studentId: id },
      include: { items: true },
      orderBy: { issueDate: 'desc' }
    })

    // Stats
    const stats = {
      total: invoices.reduce((sum, i) => sum + i.amount, 0),
      paid: invoices.filter(i => i.status === 'PAID').reduce((sum, i) => sum + i.paidAmount, 0),
      pending: invoices.filter(i => i.status === 'PENDING').reduce((sum, i) => sum + i.amount, 0),
      overdue: invoices.filter(i => i.status === 'OVERDUE').reduce((sum, i) => sum + i.amount, 0)
    }

    res.json({
      success: true,
      data: {
        stats,
        invoices
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/parent/messages - Get messages for parent
router.get('/messages', async (req, res, next) => {
  try {
    const parentId = req.user.id
    const { unreadOnly } = req.query

    const where = {
      OR: [
        { senderId: parentId },
        { recipientId: parentId }
      ]
    }

    if (unreadOnly === 'true') {
      where.recipientId = parentId
      where.readAt = null
    }

    const messages = await prisma.message.findMany({
      where,
      include: {
        sender: { select: { firstName: true, lastName: true, role: true } },
        recipient: { select: { firstName: true, lastName: true, role: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    res.json({ success: true, data: { messages } })
  } catch (error) {
    next(error)
  }
})

export default router
