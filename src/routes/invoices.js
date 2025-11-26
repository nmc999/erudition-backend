import express from 'express'
import { PrismaClient } from '@prisma/client'
import { authenticate, authorize } from '../middleware/auth.js'
import { sendPushMessage, createPaymentReminder } from '../services/lineService.js'
import { format, addMonths, startOfMonth, endOfMonth } from 'date-fns'

const router = express.Router()
const prisma = new PrismaClient()

router.use(authenticate)

// ============================================
// INVOICE MANAGEMENT
// ============================================

// GET /api/invoices - List invoices with filters
router.get('/', authorize('ADMIN', 'MANAGER', 'PARENT'), async (req, res, next) => {
  try {
    const { status, studentId, startDate, endDate, page = 1, limit = 20 } = req.query
    const schoolId = req.user.schoolId

    const where = { student: { schoolId } }

    // Parents can only see their children's invoices
    if (req.user.role === 'PARENT') {
      const children = await prisma.parentStudent.findMany({
        where: { parentId: req.user.id },
        select: { studentId: true }
      })
      where.studentId = { in: children.map(c => c.studentId) }
    }

    if (status) where.status = status
    if (studentId && req.user.role !== 'PARENT') where.studentId = studentId
    if (startDate) where.issueDate = { ...where.issueDate, gte: new Date(startDate) }
    if (endDate) where.issueDate = { ...where.issueDate, lte: new Date(endDate) }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          student: {
            select: { id: true, firstName: true, lastName: true, englishName: true }
          },
          items: true
        },
        orderBy: { issueDate: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.invoice.count({ where })
    ])

    res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/invoices/stats - Invoice statistics
router.get('/stats', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId
    const currentMonth = startOfMonth(new Date())

    const where = { student: { schoolId } }

    // Get counts by status
    const [pending, paid, overdue, thisMonth] = await Promise.all([
      prisma.invoice.aggregate({
        where: { ...where, status: 'PENDING' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { ...where, status: 'OVERDUE' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.invoice.aggregate({
        where: { 
          ...where, 
          status: 'PAID',
          paidAt: { gte: currentMonth }
        },
        _sum: { paidAmount: true },
        _count: true
      })
    ])

    res.json({
      success: true,
      data: {
        pending: {
          count: pending._count,
          amount: pending._sum.amount || 0
        },
        paid: {
          count: paid._count,
          amount: paid._sum.amount || 0
        },
        overdue: {
          count: overdue._count,
          amount: overdue._sum.amount || 0
        },
        thisMonthCollection: {
          count: thisMonth._count,
          amount: thisMonth._sum.paidAmount || 0
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/invoices/:id - Get single invoice
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            parents: {
              include: {
                parent: { select: { firstName: true, lastName: true, email: true, phone: true } }
              }
            }
          }
        },
        items: true
      }
    })

    if (!invoice) {
      return res.status(404).json({ success: false, error: { message: 'Invoice not found' } })
    }

    // Parents can only view their children's invoices
    if (req.user.role === 'PARENT') {
      const isParent = await prisma.parentStudent.findFirst({
        where: { parentId: req.user.id, studentId: invoice.studentId }
      })
      if (!isParent) {
        return res.status(403).json({ success: false, error: { message: 'Access denied' } })
      }
    }

    res.json({ success: true, data: { invoice } })
  } catch (error) {
    next(error)
  }
})

// POST /api/invoices - Create single invoice
router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { studentId, items, dueDate, notes } = req.body

    // Validate student exists
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { school: true }
    })

    if (!student) {
      return res.status(404).json({ success: false, error: { message: 'Student not found' } })
    }

    // Calculate total
    const total = items.reduce((sum, item) => sum + (item.amount * (item.quantity || 1)), 0)

    // Generate invoice number
    const invoiceCount = await prisma.invoice.count({
      where: { student: { schoolId: student.schoolId } }
    })
    const invoiceNumber = `INV-${format(new Date(), 'yyyyMM')}-${String(invoiceCount + 1).padStart(4, '0')}`

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        studentId,
        amount: total,
        currency: 'TWD',
        issueDate: new Date(),
        dueDate: dueDate ? new Date(dueDate) : addMonths(new Date(), 1),
        status: 'PENDING',
        notes,
        items: {
          create: items.map(item => ({
            description: item.description,
            amount: item.amount,
            quantity: item.quantity || 1
          }))
        }
      },
      include: { items: true, student: true }
    })

    res.status(201).json({ success: true, data: { invoice } })
  } catch (error) {
    next(error)
  }
})

// POST /api/invoices/generate - Bulk generate monthly invoices
router.post('/generate', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { month, items, classIds } = req.body
    const schoolId = req.user.schoolId

    // Get target month
    const targetMonth = month ? new Date(month) : new Date()
    const monthStart = startOfMonth(targetMonth)
    const monthEnd = endOfMonth(targetMonth)
    const monthStr = format(targetMonth, 'yyyy-MM')

    // Get all active students (optionally filtered by class)
    const studentWhere = {
      schoolId,
      status: 'ACTIVE'
    }

    if (classIds && classIds.length > 0) {
      studentWhere.enrollments = {
        some: {
          classId: { in: classIds },
          status: 'ACTIVE'
        }
      }
    }

    const students = await prisma.student.findMany({
      where: studentWhere,
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: { class: true }
        }
      }
    })

    // Check for existing invoices this month
    const existingInvoices = await prisma.invoice.findMany({
      where: {
        studentId: { in: students.map(s => s.id) },
        issueDate: { gte: monthStart, lte: monthEnd }
      },
      select: { studentId: true }
    })
    const existingStudentIds = new Set(existingInvoices.map(i => i.studentId))

    // Filter out students who already have invoices
    const studentsToInvoice = students.filter(s => !existingStudentIds.has(s.id))

    if (studentsToInvoice.length === 0) {
      return res.json({
        success: true,
        data: {
          created: 0,
          skipped: students.length,
          message: 'All students already have invoices for this month'
        }
      })
    }

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + (item.amount * (item.quantity || 1)), 0)

    // Generate invoices
    const invoices = []
    let invoiceCounter = await prisma.invoice.count({ where: { student: { schoolId } } })

    for (const student of studentsToInvoice) {
      invoiceCounter++
      const invoiceNumber = `INV-${format(targetMonth, 'yyyyMM')}-${String(invoiceCounter).padStart(4, '0')}`

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          studentId: student.id,
          amount: totalAmount,
          currency: 'TWD',
          issueDate: new Date(),
          dueDate: addMonths(monthStart, 1),
          status: 'PENDING',
          notes: `${format(targetMonth, 'yyyy年MM月')}學費 / Tuition for ${format(targetMonth, 'MMMM yyyy')}`,
          items: {
            create: items.map(item => ({
              description: item.description,
              amount: item.amount,
              quantity: item.quantity || 1
            }))
          }
        }
      })
      invoices.push(invoice)
    }

    res.status(201).json({
      success: true,
      data: {
        created: invoices.length,
        skipped: existingStudentIds.size,
        invoices
      }
    })
  } catch (error) {
    next(error)
  }
})

// PUT /api/invoices/:id - Update invoice
router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id } = req.params
    const { status, paidAmount, paymentMethod, notes, dueDate } = req.body

    const updateData = {}
    if (status) updateData.status = status
    if (notes !== undefined) updateData.notes = notes
    if (dueDate) updateData.dueDate = new Date(dueDate)

    // Handle payment
    if (status === 'PAID') {
      updateData.paidAt = new Date()
      updateData.paidAmount = paidAmount
      updateData.paymentMethod = paymentMethod
    }

    const invoice = await prisma.invoice.update({
      where: { id },
      data: updateData,
      include: { student: true, items: true }
    })

    res.json({ success: true, data: { invoice } })
  } catch (error) {
    next(error)
  }
})

// POST /api/invoices/:id/send-reminder - Send payment reminder via LINE
router.post('/:id/send-reminder', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const { id } = req.params

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        student: {
          include: {
            parents: {
              where: { isPrimary: true },
              include: {
                parent: { select: { lineUserId: true, firstName: true, lastName: true } }
              }
            }
          }
        }
      }
    })

    if (!invoice) {
      return res.status(404).json({ success: false, error: { message: 'Invoice not found' } })
    }

    const primaryParent = invoice.student.parents[0]?.parent
    if (!primaryParent?.lineUserId) {
      return res.status(400).json({
        success: false,
        error: { message: 'Parent does not have LINE connected / 家長尚未連結 LINE' }
      })
    }

    // Send LINE notification
    const studentName = `${invoice.student.lastName}${invoice.student.firstName}`
    const message = createPaymentReminder(
      studentName,
      invoice.amount,
      format(invoice.dueDate, 'yyyy/MM/dd')
    )

    await sendPushMessage(primaryParent.lineUserId, message)

    // Update invoice
    await prisma.invoice.update({
      where: { id },
      data: { 
        reminderSentAt: new Date(),
        reminderCount: { increment: 1 }
      }
    })

    res.json({
      success: true,
      data: { message: 'Reminder sent successfully / 提醒已發送' }
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/invoices/send-bulk-reminders - Send reminders to all pending/overdue
router.post('/send-bulk-reminders', authorize('ADMIN', 'MANAGER'), async (req, res, next) => {
  try {
    const schoolId = req.user.schoolId

    const invoices = await prisma.invoice.findMany({
      where: {
        student: { schoolId },
        status: { in: ['PENDING', 'OVERDUE'] }
      },
      include: {
        student: {
          include: {
            parents: {
              where: { isPrimary: true },
              include: {
                parent: { select: { lineUserId: true } }
              }
            }
          }
        }
      }
    })

    let sent = 0
    let failed = 0

    for (const invoice of invoices) {
      const lineUserId = invoice.student.parents[0]?.parent?.lineUserId
      if (!lineUserId) {
        failed++
        continue
      }

      try {
        const studentName = `${invoice.student.lastName}${invoice.student.firstName}`
        const message = createPaymentReminder(
          studentName,
          invoice.amount,
          format(invoice.dueDate, 'yyyy/MM/dd')
        )
        await sendPushMessage(lineUserId, message)
        
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            reminderSentAt: new Date(),
            reminderCount: { increment: 1 }
          }
        })
        sent++
      } catch (err) {
        failed++
      }
    }

    res.json({
      success: true,
      data: {
        total: invoices.length,
        sent,
        failed,
        message: `${sent} reminders sent / 已發送 ${sent} 則提醒`
      }
    })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/invoices/:id - Delete invoice (only if unpaid)
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const { id } = req.params

    const invoice = await prisma.invoice.findUnique({ where: { id } })
    
    if (!invoice) {
      return res.status(404).json({ success: false, error: { message: 'Invoice not found' } })
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        success: false,
        error: { message: 'Cannot delete paid invoices / 無法刪除已付款的帳單' }
      })
    }

    // Delete items first, then invoice
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } })
    await prisma.invoice.delete({ where: { id } })

    res.json({ success: true, data: { message: 'Invoice deleted' } })
  } catch (error) {
    next(error)
  }
})

export default router
