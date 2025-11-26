import express from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, authorize } from '../middleware/auth.js'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths, eachDayOfInterval, parseISO } from 'date-fns'

const router = express.Router()
const prisma = new PrismaClient()

// All routes require authentication
router.use(authenticate)

// ============================================
// ATTENDANCE REPORTS
// ============================================

// GET /api/reports/attendance - Attendance summary report
router.get('/attendance', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res, next) => {
  try {
    const { classId, startDate, endDate, groupBy = 'day' } = req.query
    const schoolId = req.user.schoolId

    // Default to current month
    const start = startDate ? parseISO(startDate) : startOfMonth(new Date())
    const end = endDate ? parseISO(endDate) : endOfMonth(new Date())

    // Build where clause
    const where = {
      student: { schoolId },
      date: {
        gte: start,
        lte: end
      }
    }

    if (classId) {
      where.classId = classId
    }

    // For teachers, only show their classes
    if (req.user.role === 'TEACHER') {
      const teacherClasses = await prisma.class.findMany({
        where: { teacherId: req.user.id },
        select: { id: true }
      })
      where.classId = { in: teacherClasses.map(c => c.id) }
    }

    // Get all attendance records
    const attendance = await prisma.attendance.findMany({
      where,
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, englishName: true }
        },
        class: {
          select: { id: true, name: true }
        }
      },
      orderBy: { date: 'asc' }
    })

    // Calculate summary statistics
    const total = attendance.length
    const byStatus = {
      PRESENT: attendance.filter(a => a.status === 'PRESENT').length,
      ABSENT: attendance.filter(a => a.status === 'ABSENT').length,
      LATE: attendance.filter(a => a.status === 'LATE').length,
      EXCUSED: attendance.filter(a => a.status === 'EXCUSED').length,
      EARLY_LEAVE: attendance.filter(a => a.status === 'EARLY_LEAVE').length
    }

    const attendanceRate = total > 0 
      ? ((byStatus.PRESENT / total) * 100).toFixed(1)
      : 0

    // Group data based on groupBy parameter
    let groupedData = []
    
    if (groupBy === 'day') {
      // Group by date
      const dateMap = new Map()
      attendance.forEach(record => {
        const dateKey = format(record.date, 'yyyy-MM-dd')
        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, { date: dateKey, PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, EARLY_LEAVE: 0, total: 0 })
        }
        const day = dateMap.get(dateKey)
        day[record.status]++
        day.total++
      })
      groupedData = Array.from(dateMap.values())
    } else if (groupBy === 'student') {
      // Group by student
      const studentMap = new Map()
      attendance.forEach(record => {
        const studentId = record.student.id
        if (!studentMap.has(studentId)) {
          studentMap.set(studentId, {
            student: record.student,
            PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, EARLY_LEAVE: 0, total: 0
          })
        }
        const student = studentMap.get(studentId)
        student[record.status]++
        student.total++
      })
      groupedData = Array.from(studentMap.values()).map(s => ({
        ...s,
        attendanceRate: s.total > 0 ? ((s.PRESENT / s.total) * 100).toFixed(1) : 0
      }))
    } else if (groupBy === 'class') {
      // Group by class
      const classMap = new Map()
      attendance.forEach(record => {
        const classId = record.class.id
        if (!classMap.has(classId)) {
          classMap.set(classId, {
            class: record.class,
            PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0, EARLY_LEAVE: 0, total: 0
          })
        }
        const cls = classMap.get(classId)
        cls[record.status]++
        cls.total++
      })
      groupedData = Array.from(classMap.values()).map(c => ({
        ...c,
        attendanceRate: c.total > 0 ? ((c.PRESENT / c.total) * 100).toFixed(1) : 0
      }))
    }

    res.json({
      success: true,
      data: {
        summary: {
          total,
          byStatus,
          attendanceRate: parseFloat(attendanceRate),
          dateRange: {
            start: format(start, 'yyyy-MM-dd'),
            end: format(end, 'yyyy-MM-dd')
          }
        },
        groupedData,
        records: attendance
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/reports/attendance/export - Export to CSV/Excel format
router.get('/attendance/export', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res, next) => {
  try {
    const { classId, startDate, endDate, format: exportFormat = 'csv' } = req.query
    const schoolId = req.user.schoolId

    const start = startDate ? parseISO(startDate) : startOfMonth(new Date())
    const end = endDate ? parseISO(endDate) : endOfMonth(new Date())

    const where = {
      student: { schoolId },
      date: { gte: start, lte: end }
    }

    if (classId) where.classId = classId

    if (req.user.role === 'TEACHER') {
      const teacherClasses = await prisma.class.findMany({
        where: { teacherId: req.user.id },
        select: { id: true }
      })
      where.classId = { in: teacherClasses.map(c => c.id) }
    }

    const attendance = await prisma.attendance.findMany({
      where,
      include: {
        student: { select: { firstName: true, lastName: true, englishName: true } },
        class: { select: { name: true } }
      },
      orderBy: [{ date: 'asc' }, { class: { name: 'asc' } }]
    })

    // Generate CSV
    const headers = ['日期 Date', '班級 Class', '姓名 Name', '英文名 English Name', '狀態 Status', '原因 Reason', '備註 Notes']
    const statusMap = {
      PRESENT: '出席',
      ABSENT: '缺席',
      LATE: '遲到',
      EXCUSED: '請假',
      EARLY_LEAVE: '早退'
    }

    const rows = attendance.map(record => [
      format(record.date, 'yyyy-MM-dd'),
      record.class.name,
      `${record.student.lastName}${record.student.firstName}`,
      record.student.englishName || '',
      statusMap[record.status] || record.status,
      record.reason || '',
      record.notes || ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')

    // Add BOM for Excel to recognize UTF-8
    const BOM = '\uFEFF'
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="attendance-report-${format(new Date(), 'yyyyMMdd')}.csv"`)
    res.send(BOM + csvContent)
  } catch (error) {
    next(error)
  }
})

// GET /api/reports/students/:id - Individual student report
router.get('/students/:id', authorize('ADMIN', 'MANAGER', 'TEACHER', 'PARENT'), async (req, res, next) => {
  try {
    const { id } = req.params
    const { months = 3 } = req.query

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: { class: true }
        },
        parents: {
          include: {
            parent: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } }
          }
        }
      }
    })

    if (!student) {
      return res.status(404).json({ success: false, error: { message: 'Student not found' } })
    }

    // Parents can only view their own children
    if (req.user.role === 'PARENT') {
      const isParent = await prisma.parentStudent.findFirst({
        where: { parentId: req.user.id, studentId: id }
      })
      if (!isParent) {
        return res.status(403).json({ success: false, error: { message: 'Access denied' } })
      }
    }

    // Get attendance for last N months
    const startDate = startOfMonth(subMonths(new Date(), parseInt(months) - 1))
    const endDate = endOfMonth(new Date())

    const attendance = await prisma.attendance.findMany({
      where: {
        studentId: id,
        date: { gte: startDate, lte: endDate }
      },
      include: { class: { select: { name: true } } },
      orderBy: { date: 'desc' }
    })

    // Calculate attendance stats
    const attendanceStats = {
      total: attendance.length,
      present: attendance.filter(a => a.status === 'PRESENT').length,
      absent: attendance.filter(a => a.status === 'ABSENT').length,
      late: attendance.filter(a => a.status === 'LATE').length,
      excused: attendance.filter(a => a.status === 'EXCUSED').length
    }
    attendanceStats.rate = attendanceStats.total > 0
      ? ((attendanceStats.present / attendanceStats.total) * 100).toFixed(1)
      : 0

    // Get homework submissions
    const submissions = await prisma.homeworkSubmission.findMany({
      where: { studentId: id },
      include: {
        homework: {
          select: { title: true, maxScore: true, dueDate: true, class: { select: { name: true } } }
        }
      },
      orderBy: { submittedAt: 'desc' },
      take: 20
    })

    // Calculate homework stats
    const homeworkStats = {
      total: submissions.length,
      graded: submissions.filter(s => s.status === 'GRADED').length,
      pending: submissions.filter(s => s.status === 'PENDING' || s.status === 'SUBMITTED').length,
      late: submissions.filter(s => s.status === 'LATE').length,
      averageScore: 0
    }

    const gradedWithScores = submissions.filter(s => s.score !== null && s.homework.maxScore)
    if (gradedWithScores.length > 0) {
      const totalPercentage = gradedWithScores.reduce((sum, s) => 
        sum + (s.score / s.homework.maxScore * 100), 0
      )
      homeworkStats.averageScore = (totalPercentage / gradedWithScores.length).toFixed(1)
    }

    res.json({
      success: true,
      data: {
        student,
        attendanceStats,
        attendanceRecords: attendance.slice(0, 50),
        homeworkStats,
        recentSubmissions: submissions
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/reports/classes/:id - Class performance report
router.get('/classes/:id', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res, next) => {
  try {
    const { id } = req.params
    const { startDate, endDate } = req.query

    const start = startDate ? parseISO(startDate) : startOfMonth(new Date())
    const end = endDate ? parseISO(endDate) : endOfMonth(new Date())

    const classData = await prisma.class.findUnique({
      where: { id },
      include: {
        teacher: { select: { firstName: true, lastName: true } },
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: { select: { id: true, firstName: true, lastName: true, englishName: true } }
          }
        }
      }
    })

    if (!classData) {
      return res.status(404).json({ success: false, error: { message: 'Class not found' } })
    }

    // Get attendance for all students in class
    const studentIds = classData.enrollments.map(e => e.student.id)
    
    const attendance = await prisma.attendance.findMany({
      where: {
        classId: id,
        studentId: { in: studentIds },
        date: { gte: start, lte: end }
      }
    })

    // Calculate per-student stats
    const studentStats = classData.enrollments.map(enrollment => {
      const studentAttendance = attendance.filter(a => a.studentId === enrollment.student.id)
      const total = studentAttendance.length
      const present = studentAttendance.filter(a => a.status === 'PRESENT').length

      return {
        student: enrollment.student,
        total,
        present,
        absent: studentAttendance.filter(a => a.status === 'ABSENT').length,
        late: studentAttendance.filter(a => a.status === 'LATE').length,
        excused: studentAttendance.filter(a => a.status === 'EXCUSED').length,
        attendanceRate: total > 0 ? ((present / total) * 100).toFixed(1) : 0
      }
    })

    // Overall class stats
    const totalRecords = attendance.length
    const classStats = {
      totalStudents: studentIds.length,
      totalRecords,
      averageAttendanceRate: studentStats.length > 0
        ? (studentStats.reduce((sum, s) => sum + parseFloat(s.attendanceRate), 0) / studentStats.length).toFixed(1)
        : 0,
      byStatus: {
        PRESENT: attendance.filter(a => a.status === 'PRESENT').length,
        ABSENT: attendance.filter(a => a.status === 'ABSENT').length,
        LATE: attendance.filter(a => a.status === 'LATE').length,
        EXCUSED: attendance.filter(a => a.status === 'EXCUSED').length
      }
    }

    // Get homework completion stats
    const homework = await prisma.homework.findMany({
      where: { classId: id, dueDate: { gte: start, lte: end } },
      include: {
        submissions: { where: { studentId: { in: studentIds } } }
      }
    })

    const homeworkStats = homework.map(hw => ({
      id: hw.id,
      title: hw.title,
      dueDate: hw.dueDate,
      totalStudents: studentIds.length,
      submitted: hw.submissions.length,
      graded: hw.submissions.filter(s => s.status === 'GRADED').length,
      completionRate: ((hw.submissions.length / studentIds.length) * 100).toFixed(1)
    }))

    res.json({
      success: true,
      data: {
        class: classData,
        dateRange: { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') },
        classStats,
        studentStats,
        homeworkStats
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/reports/overview - School-wide overview for dashboard
router.get('/overview', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId
    
    // Get counts
    const [totalStudents, totalClasses, totalTeachers, totalParents] = await Promise.all([
      prisma.student.count({ where: { schoolId, status: 'ACTIVE' } }),
      prisma.class.count({ where: { schoolId } }),
      prisma.user.count({ where: { schoolId, role: 'TEACHER', isActive: true } }),
      prisma.user.count({ where: { schoolId, role: 'PARENT', isActive: true } })
    ])

    // This week's attendance
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 })

    const weekAttendance = await prisma.attendance.findMany({
      where: {
        student: { schoolId },
        date: { gte: weekStart, lte: weekEnd }
      }
    })

    const weekStats = {
      total: weekAttendance.length,
      present: weekAttendance.filter(a => a.status === 'PRESENT').length,
      absent: weekAttendance.filter(a => a.status === 'ABSENT').length,
      late: weekAttendance.filter(a => a.status === 'LATE').length
    }
    weekStats.rate = weekStats.total > 0
      ? ((weekStats.present / weekStats.total) * 100).toFixed(1)
      : 0

    // Pending invoices
    const pendingInvoices = await prisma.invoice.count({
      where: { 
        student: { schoolId },
        status: { in: ['PENDING', 'OVERDUE'] }
      }
    })

    // Recent activity
    const recentAttendance = await prisma.attendance.findMany({
      where: { student: { schoolId } },
      include: {
        student: { select: { firstName: true, lastName: true } },
        class: { select: { name: true } }
      },
      orderBy: { markedAt: 'desc' },
      take: 10
    })

    res.json({
      success: true,
      data: {
        counts: { totalStudents, totalClasses, totalTeachers, totalParents },
        weeklyAttendance: weekStats,
        pendingInvoices,
        recentActivity: recentAttendance
      }
    })
  } catch (error) {
    next(error)
  }
})

export default router
