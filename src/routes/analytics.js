import express from 'express'
import prisma from '../config/database.js'
import { authenticate, authorize } from '../middleware/auth.js'

const router = express.Router()

// ======================
// CLASS ANALYTICS
// ======================

// GET /analytics/classes - Get analytics for all classes
router.get('/classes', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.school?.id
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'School context required' })
    }

    const classes = await prisma.class.findMany({
      where: { schoolId },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: { student: true }
        },
        teacher: {
          select: { id: true, firstName: true, lastName: true }
        },
        _count: {
          select: {
            enrollments: { where: { status: 'ACTIVE' } }
          }
        }
      }
    })

    // Calculate analytics for each class
    const classAnalytics = await Promise.all(classes.map(async (cls) => {
      const studentIds = cls.enrollments.map(e => e.studentId)
      
      // Get attendance data for this class (last 90 days)
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
      
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          classId: cls.id,
          date: { gte: ninetyDaysAgo }
        }
      })
      
      // Calculate average attendance rate
      const totalAttendance = attendanceRecords.length
      const presentCount = attendanceRecords.filter(a => 
        a.status === 'PRESENT' || a.status === 'LATE'
      ).length
      const avgAttendance = totalAttendance > 0 
        ? Math.round((presentCount / totalAttendance) * 100) 
        : 0

      // Get homework submissions for this class
      const homeworks = await prisma.homework.findMany({
        where: { classId: cls.id },
        include: {
          submissions: {
            where: { status: 'GRADED' }
          }
        }
      })
      
      // Calculate average grade
      let totalScore = 0
      let gradedCount = 0
      homeworks.forEach(hw => {
        hw.submissions.forEach(sub => {
          if (sub.score !== null && hw.maxScore) {
            totalScore += (sub.score / hw.maxScore) * 100
            gradedCount++
          }
        })
      })
      const avgGrade = gradedCount > 0 ? Math.round(totalScore / gradedCount) : 0

      // Calculate behavior score (derived from attendance patterns)
      const lateCount = attendanceRecords.filter(a => a.status === 'LATE').length
      const absentCount = attendanceRecords.filter(a => a.status === 'ABSENT').length
      const behaviorDeductions = (lateCount * 2) + (absentCount * 5) // -2 for late, -5 for absent
      const avgBehavior = Math.max(0, Math.min(100, 100 - behaviorDeductions))

      // Calculate revenue (from pricing rules)
      const pricingRule = await prisma.pricingRule.findFirst({
        where: {
          schoolId,
          OR: [
            { classId: cls.id },
            { classId: null } // Default rule
          ],
          isActive: true
        },
        orderBy: { classId: 'desc' } // Prefer class-specific rule
      })
      
      const monthlyPricePerStudent = pricingRule 
        ? Number(pricingRule.amount) 
        : 3000 // Default fallback
      const revenue = studentIds.length * monthlyPricePerStudent

      return {
        classId: cls.id,
        className: cls.name,
        teacher: cls.teacher,
        studentCount: cls._count.enrollments,
        maxStudents: cls.maxStudents,
        analytics: {
          avgGrade,
          avgAttendance,
          avgBehavior,
          revenue,
          totalHomeworks: homeworks.length,
          totalAttendanceRecords: totalAttendance
        }
      }
    }))

    res.json({
      success: true,
      data: classAnalytics
    })
  } catch (error) {
    console.error('Error fetching class analytics:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch class analytics' })
  }
})

// GET /analytics/classes/:id - Get detailed analytics for a specific class
router.get('/classes/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const schoolId = req.user.school?.id
    
    const cls = await prisma.class.findFirst({
      where: { id, schoolId },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: { 
            student: {
              select: { id: true, firstName: true, lastName: true, englishName: true }
            }
          }
        },
        teacher: {
          select: { id: true, firstName: true, lastName: true }
        }
      }
    })

    if (!cls) {
      return res.status(404).json({ success: false, error: 'Class not found' })
    }

    const studentIds = cls.enrollments.map(e => e.studentId)
    
    // Get attendance data (last 90 days)
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        classId: id,
        date: { gte: ninetyDaysAgo }
      }
    })

    // Attendance by status
    const attendanceBreakdown = {
      present: attendanceRecords.filter(a => a.status === 'PRESENT').length,
      absent: attendanceRecords.filter(a => a.status === 'ABSENT').length,
      late: attendanceRecords.filter(a => a.status === 'LATE').length,
      excused: attendanceRecords.filter(a => a.status === 'EXCUSED').length,
      total: attendanceRecords.length
    }

    // Get homework data
    const homeworks = await prisma.homework.findMany({
      where: { classId: id },
      include: {
        submissions: true
      },
      orderBy: { dueDate: 'desc' }
    })

    // Homework analytics
    const homeworkAnalytics = homeworks.map(hw => {
      const totalStudents = studentIds.length
      const submittedCount = hw.submissions.length
      const gradedSubmissions = hw.submissions.filter(s => s.status === 'GRADED')
      const avgScore = gradedSubmissions.length > 0
        ? Math.round(gradedSubmissions.reduce((sum, s) => sum + ((s.score || 0) / (hw.maxScore || 100) * 100), 0) / gradedSubmissions.length)
        : null
      
      return {
        id: hw.id,
        title: hw.title,
        dueDate: hw.dueDate,
        completionRate: totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0,
        avgScore,
        submittedCount,
        gradedCount: gradedSubmissions.length
      }
    })

    // Student performance in this class
    const studentPerformance = await Promise.all(cls.enrollments.map(async (enrollment) => {
      const student = enrollment.student
      
      // Student's attendance in this class
      const studentAttendance = attendanceRecords.filter(a => a.studentId === student.id)
      const presentCount = studentAttendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length
      const attendanceRate = studentAttendance.length > 0 
        ? Math.round((presentCount / studentAttendance.length) * 100) 
        : 0

      // Student's homework in this class
      const studentSubmissions = await prisma.homeworkSubmission.findMany({
        where: {
          studentId: student.id,
          homework: { classId: id }
        },
        include: { homework: true }
      })
      
      const hwCompletionRate = homeworks.length > 0
        ? Math.round((studentSubmissions.length / homeworks.length) * 100)
        : 0
      
      const gradedSubmissions = studentSubmissions.filter(s => s.status === 'GRADED' && s.score !== null)
      const avgGrade = gradedSubmissions.length > 0
        ? Math.round(gradedSubmissions.reduce((sum, s) => sum + ((s.score || 0) / (s.homework.maxScore || 100) * 100), 0) / gradedSubmissions.length)
        : 0

      return {
        student: {
          id: student.id,
          name: `${student.lastName}${student.firstName}`,
          englishName: student.englishName
        },
        attendanceRate,
        hwCompletionRate,
        avgGrade
      }
    }))

    // Calculate revenue
    const pricingRule = await prisma.pricingRule.findFirst({
      where: {
        schoolId,
        OR: [{ classId: id }, { classId: null }],
        isActive: true
      },
      orderBy: { classId: 'desc' }
    })
    const monthlyPricePerStudent = pricingRule ? Number(pricingRule.amount) : 3000
    const monthlyRevenue = studentIds.length * monthlyPricePerStudent

    res.json({
      success: true,
      data: {
        class: {
          id: cls.id,
          name: cls.name,
          teacher: cls.teacher,
          studentCount: studentIds.length,
          maxStudents: cls.maxStudents
        },
        attendance: {
          ...attendanceBreakdown,
          rate: attendanceBreakdown.total > 0 
            ? Math.round(((attendanceBreakdown.present + attendanceBreakdown.late) / attendanceBreakdown.total) * 100)
            : 0
        },
        homework: {
          totalAssignments: homeworks.length,
          recentAssignments: homeworkAnalytics.slice(0, 5)
        },
        students: studentPerformance,
        revenue: {
          monthlyPerStudent: monthlyPricePerStudent,
          monthlyTotal: monthlyRevenue,
          annualEstimate: monthlyRevenue * 12
        }
      }
    })
  } catch (error) {
    console.error('Error fetching class analytics:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch class analytics' })
  }
})

// ======================
// STUDENT ANALYTICS
// ======================

// GET /analytics/students - Get analytics for all students
router.get('/students', authenticate, async (req, res) => {
  try {
    const schoolId = req.user.school?.id
    if (!schoolId) {
      return res.status(400).json({ success: false, error: 'School context required' })
    }

    const students = await prisma.student.findMany({
      where: { schoolId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, englishName: true }
    })

    // Calculate analytics for each student
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const studentAnalytics = await Promise.all(students.map(async (student) => {
      // Attendance
      const attendanceRecords = await prisma.attendance.findMany({
        where: {
          studentId: student.id,
          date: { gte: ninetyDaysAgo }
        }
      })
      
      const totalAttendance = attendanceRecords.length
      const presentCount = attendanceRecords.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length
      const lateCount = attendanceRecords.filter(a => a.status === 'LATE').length
      const absentCount = attendanceRecords.filter(a => a.status === 'ABSENT').length
      const attendanceRate = totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0

      // Homework
      const enrollments = await prisma.classEnrollment.findMany({
        where: { studentId: student.id, status: 'ACTIVE' },
        select: { classId: true }
      })
      const classIds = enrollments.map(e => e.classId)
      
      const totalHomework = await prisma.homework.count({
        where: { classId: { in: classIds } }
      })
      
      const submissions = await prisma.homeworkSubmission.findMany({
        where: { studentId: student.id },
        include: { homework: true }
      })
      
      const homeworkCompletion = totalHomework > 0 
        ? Math.round((submissions.length / totalHomework) * 100) 
        : 0

      const gradedSubmissions = submissions.filter(s => s.status === 'GRADED' && s.score !== null)
      const homeworkGrade = gradedSubmissions.length > 0
        ? Math.round(gradedSubmissions.reduce((sum, s) => 
            sum + ((s.score || 0) / (s.homework.maxScore || 100) * 100), 0) / gradedSubmissions.length)
        : 0

      // Behavior score (derived from attendance patterns)
      const behaviorDeductions = (lateCount * 2) + (absentCount * 5)
      const behaviorScore = Math.max(0, Math.min(100, 100 - behaviorDeductions))

      // Test average (using homework scores as proxy)
      const testAverage = homeworkGrade // Could be refined if we had separate test tracking

      return {
        studentId: student.id,
        studentName: `${student.lastName}${student.firstName}`,
        englishName: student.englishName,
        analytics: {
          homeworkCompletion,
          homeworkGrade,
          behaviorScore,
          attendanceRate,
          testAverage
        }
      }
    }))

    res.json({
      success: true,
      data: studentAnalytics
    })
  } catch (error) {
    console.error('Error fetching student analytics:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch student analytics' })
  }
})

// GET /analytics/students/:id - Get detailed analytics for a specific student
router.get('/students/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const schoolId = req.user.school?.id
    
    const student = await prisma.student.findFirst({
      where: { id, schoolId },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            class: {
              select: { id: true, name: true }
            }
          }
        }
      }
    })

    if (!student) {
      return res.status(404).json({ success: false, error: 'Student not found' })
    }

    const classIds = student.enrollments.map(e => e.classId)
    
    // Attendance data (last 90 days)
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
    
    const attendanceRecords = await prisma.attendance.findMany({
      where: {
        studentId: id,
        date: { gte: ninetyDaysAgo }
      },
      include: {
        class: { select: { id: true, name: true } }
      },
      orderBy: { date: 'desc' }
    })

    // Attendance breakdown
    const attendanceBreakdown = {
      present: attendanceRecords.filter(a => a.status === 'PRESENT').length,
      absent: attendanceRecords.filter(a => a.status === 'ABSENT').length,
      late: attendanceRecords.filter(a => a.status === 'LATE').length,
      excused: attendanceRecords.filter(a => a.status === 'EXCUSED').length,
      total: attendanceRecords.length
    }
    
    const attendanceRate = attendanceBreakdown.total > 0 
      ? Math.round(((attendanceBreakdown.present + attendanceBreakdown.late) / attendanceBreakdown.total) * 100)
      : 0

    // Homework data
    const totalHomework = await prisma.homework.count({
      where: { classId: { in: classIds } }
    })
    
    const submissions = await prisma.homeworkSubmission.findMany({
      where: { studentId: id },
      include: {
        homework: {
          select: { id: true, title: true, dueDate: true, maxScore: true, classId: true }
        }
      },
      orderBy: { submittedAt: 'desc' }
    })

    const homeworkCompletion = totalHomework > 0 
      ? Math.round((submissions.length / totalHomework) * 100) 
      : 0

    // Homework by class
    const homeworkByClass = student.enrollments.map(enrollment => {
      const classHomework = submissions.filter(s => s.homework.classId === enrollment.classId)
      const gradedInClass = classHomework.filter(s => s.status === 'GRADED' && s.score !== null)
      const avgGrade = gradedInClass.length > 0
        ? Math.round(gradedInClass.reduce((sum, s) => 
            sum + ((s.score || 0) / (s.homework.maxScore || 100) * 100), 0) / gradedInClass.length)
        : null

      return {
        classId: enrollment.classId,
        className: enrollment.class.name,
        submittedCount: classHomework.length,
        avgGrade
      }
    })

    // Recent grades
    const recentGrades = submissions
      .filter(s => s.status === 'GRADED' && s.score !== null)
      .slice(0, 10)
      .map(s => ({
        homeworkId: s.homeworkId,
        title: s.homework.title,
        score: s.score,
        maxScore: s.homework.maxScore,
        percentage: Math.round(((s.score || 0) / (s.homework.maxScore || 100)) * 100),
        gradedAt: s.gradedAt
      }))

    // Overall homework grade
    const allGraded = submissions.filter(s => s.status === 'GRADED' && s.score !== null)
    const homeworkGrade = allGraded.length > 0
      ? Math.round(allGraded.reduce((sum, s) => 
          sum + ((s.score || 0) / (s.homework.maxScore || 100) * 100), 0) / allGraded.length)
      : 0

    // Behavior score
    const behaviorDeductions = (attendanceBreakdown.late * 2) + (attendanceBreakdown.absent * 5)
    const behaviorScore = Math.max(0, Math.min(100, 100 - behaviorDeductions))

    // Attendance trend (weekly for last 12 weeks)
    const attendanceTrend = []
    for (let i = 0; i < 12; i++) {
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - (i * 7) - 7)
      const weekEnd = new Date()
      weekEnd.setDate(weekEnd.getDate() - (i * 7))
      
      const weekRecords = attendanceRecords.filter(a => {
        const date = new Date(a.date)
        return date >= weekStart && date < weekEnd
      })
      
      const weekPresent = weekRecords.filter(a => a.status === 'PRESENT' || a.status === 'LATE').length
      const weekRate = weekRecords.length > 0 ? Math.round((weekPresent / weekRecords.length) * 100) : null
      
      attendanceTrend.unshift({
        week: 12 - i,
        rate: weekRate,
        total: weekRecords.length
      })
    }

    res.json({
      success: true,
      data: {
        student: {
          id: student.id,
          name: `${student.lastName}${student.firstName}`,
          englishName: student.englishName,
          classes: student.enrollments.map(e => e.class)
        },
        summary: {
          homeworkCompletion,
          homeworkGrade,
          behaviorScore,
          attendanceRate,
          testAverage: homeworkGrade // Using homework grade as proxy
        },
        attendance: {
          ...attendanceBreakdown,
          rate: attendanceRate,
          trend: attendanceTrend,
          recent: attendanceRecords.slice(0, 10).map(a => ({
            date: a.date,
            status: a.status,
            className: a.class.name
          }))
        },
        homework: {
          totalAssigned: totalHomework,
          submitted: submissions.length,
          completionRate: homeworkCompletion,
          byClass: homeworkByClass,
          recentGrades
        }
      }
    })
  } catch (error) {
    console.error('Error fetching student analytics:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch student analytics' })
  }
})

export default router
