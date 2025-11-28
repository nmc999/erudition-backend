// Finance Routes
// Handles pricing rules, expenses, revenues, and invoice automation

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// =====================
// PRICING RULES
// =====================

/**
 * GET /api/finance/pricing-rules
 * Get all pricing rules
 */
router.get('/pricing-rules', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;

  const rules = await prisma.pricingRule.findMany({
    where: { schoolId },
    include: {
      class: {
        select: { id: true, name: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  res.json({
    success: true,
    data: { rules }
  });
}));

/**
 * POST /api/finance/pricing-rules
 * Create pricing rule
 */
router.post('/pricing-rules', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const {
    name,
    description,
    priceType,
    amount,
    classId,
    validFrom,
    validUntil
  } = req.body;

  if (!name || !amount) {
    return res.status(400).json({
      success: false,
      error: { message: 'Name and amount are required', messageZh: '名稱和金額為必填' }
    });
  }

  const rule = await prisma.pricingRule.create({
    data: {
      name,
      description,
      priceType: priceType || 'PER_CLASS',
      amount: parseFloat(amount),
      classId: classId || null,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      isActive: true,
      schoolId
    },
    include: {
      class: { select: { id: true, name: true } }
    }
  });

  res.status(201).json({
    success: true,
    data: { rule }
  });
}));

/**
 * PUT /api/finance/pricing-rules/:id
 * Update pricing rule
 */
router.put('/pricing-rules/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;
  const {
    name,
    description,
    priceType,
    amount,
    classId,
    validFrom,
    validUntil,
    isActive
  } = req.body;

  const existing = await prisma.pricingRule.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Pricing rule not found', messageZh: '找不到定價規則' }
    });
  }

  const rule = await prisma.pricingRule.update({
    where: { id },
    data: {
      name,
      description,
      priceType,
      amount: amount ? parseFloat(amount) : undefined,
      classId,
      validFrom: validFrom ? new Date(validFrom) : undefined,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      isActive
    }
  });

  res.json({
    success: true,
    data: { rule }
  });
}));

/**
 * DELETE /api/finance/pricing-rules/:id
 * Delete pricing rule
 */
router.delete('/pricing-rules/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;

  const existing = await prisma.pricingRule.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Pricing rule not found', messageZh: '找不到定價規則' }
    });
  }

  await prisma.pricingRule.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Pricing rule deleted'
  });
}));

// =====================
// EXPENSES
// =====================

/**
 * GET /api/finance/expenses
 * Get expenses with filters
 */
router.get('/expenses', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { category, status, startDate, endDate, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    schoolId,
    ...(category && { category }),
    ...(status && { status }),
    ...(startDate && endDate && {
      expenseDate: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    })
  };

  const [expenses, total, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      skip,
      take
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({
      where,
      _sum: { amount: true }
    })
  ]);

  // Group by category
  const byCategory = await prisma.expense.groupBy({
    by: ['category'],
    where,
    _sum: { amount: true }
  });

  res.json({
    success: true,
    data: {
      expenses,
      summary: {
        total: Number(totals._sum.amount || 0),
        byCategory: byCategory.reduce((acc, c) => {
          acc[c.category] = Number(c._sum.amount || 0);
          return acc;
        }, {})
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * POST /api/finance/expenses
 * Create expense
 */
router.post('/expenses', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const {
    category,
    description,
    amount,
    expenseDate,
    receiptUrl,
    notes
  } = req.body;

  if (!category || !description || !amount || !expenseDate) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing required fields', messageZh: '缺少必填欄位' }
    });
  }

  const expense = await prisma.expense.create({
    data: {
      category,
      description,
      amount: parseFloat(amount),
      expenseDate: new Date(expenseDate),
      receiptUrl,
      notes,
      status: 'PENDING',
      schoolId,
      createdById: req.user.id
    }
  });

  res.status(201).json({
    success: true,
    data: { expense }
  });
}));

/**
 * PUT /api/finance/expenses/:id
 * Update expense
 */
router.put('/expenses/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;
  const {
    category,
    description,
    amount,
    expenseDate,
    receiptUrl,
    status,
    notes
  } = req.body;

  const existing = await prisma.expense.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Expense not found', messageZh: '找不到支出記錄' }
    });
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: {
      category,
      description,
      amount: amount ? parseFloat(amount) : undefined,
      expenseDate: expenseDate ? new Date(expenseDate) : undefined,
      receiptUrl,
      status,
      notes,
      ...(status === 'APPROVED' && {
        approvedById: req.user.id,
        approvedAt: new Date()
      })
    }
  });

  res.json({
    success: true,
    data: { expense }
  });
}));

/**
 * DELETE /api/finance/expenses/:id
 * Delete expense
 */
router.delete('/expenses/:id', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const schoolId = req.user.schoolId;

  const existing = await prisma.expense.findFirst({
    where: { id, schoolId }
  });

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { message: 'Expense not found', messageZh: '找不到支出記錄' }
    });
  }

  await prisma.expense.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Expense deleted'
  });
}));

// =====================
// REVENUES (Manual entries)
// =====================

/**
 * GET /api/finance/revenues
 * Get manual revenue entries
 */
router.get('/revenues', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { category, startDate, endDate, page = 1, limit = 50 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    schoolId,
    ...(category && { category }),
    ...(startDate && endDate && {
      revenueDate: {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    })
  };

  const [revenues, total, totals] = await Promise.all([
    prisma.revenue.findMany({
      where,
      orderBy: { revenueDate: 'desc' },
      skip,
      take
    }),
    prisma.revenue.count({ where }),
    prisma.revenue.aggregate({
      where,
      _sum: { amount: true }
    })
  ]);

  res.json({
    success: true,
    data: {
      revenues,
      summary: {
        total: Number(totals._sum.amount || 0)
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * POST /api/finance/revenues
 * Create manual revenue entry
 */
router.post('/revenues', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const {
    category,
    description,
    amount,
    revenueDate,
    invoiceId,
    notes
  } = req.body;

  if (!category || !description || !amount || !revenueDate) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing required fields', messageZh: '缺少必填欄位' }
    });
  }

  const revenue = await prisma.revenue.create({
    data: {
      category,
      description,
      amount: parseFloat(amount),
      revenueDate: new Date(revenueDate),
      invoiceId,
      notes,
      schoolId,
      createdById: req.user.id
    }
  });

  res.status(201).json({
    success: true,
    data: { revenue }
  });
}));

// =====================
// INVOICE GENERATION
// =====================

/**
 * POST /api/finance/generate-invoices
 * Auto-generate invoices based on enrollment and pricing rules
 */
router.post('/generate-invoices', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { billingMonth, dueDate } = req.body; // billingMonth: "2024-01"

  if (!billingMonth) {
    return res.status(400).json({
      success: false,
      error: { message: 'Billing month is required (YYYY-MM)', messageZh: '請提供計費月份 (YYYY-MM)' }
    });
  }

  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0);

  // Get active pricing rules
  const pricingRules = await prisma.pricingRule.findMany({
    where: {
      schoolId,
      isActive: true,
      OR: [
        { validFrom: null },
        { validFrom: { lte: endOfMonth } }
      ]
    }
  });

  if (pricingRules.length === 0) {
    return res.status(400).json({
      success: false,
      error: { message: 'No active pricing rules found. Create pricing rules first.', messageZh: '找不到有效的定價規則，請先建立定價規則' }
    });
  }

  // Get all active students with enrollments
  const students = await prisma.student.findMany({
    where: {
      schoolId,
      status: 'ACTIVE'
    },
    include: {
      enrollments: {
        where: { status: 'ACTIVE' },
        include: { class: true }
      }
    }
  });

  const invoicesCreated = [];
  const invoiceDueDate = dueDate ? new Date(dueDate) : new Date(year, month, 15); // Default: 15th of next month

  for (const student of students) {
    // Skip if student has no enrollments
    if (student.enrollments.length === 0) continue;

    // Check if invoice already exists for this period
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        studentId: student.id,
        issueDate: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });

    if (existingInvoice) continue; // Skip if already invoiced

    // Calculate amount based on pricing rules
    let totalAmount = 0;
    const items = [];

    for (const enrollment of student.enrollments) {
      // Find applicable pricing rule (class-specific first, then general)
      let rule = pricingRules.find(r => r.classId === enrollment.classId);
      if (!rule) {
        rule = pricingRules.find(r => !r.classId); // General rule
      }

      if (rule) {
        let itemAmount = Number(rule.amount);

        // For PER_CLASS pricing, count sessions in the month
        if (rule.priceType === 'PER_CLASS' && enrollment.class.dayOfWeek) {
          const daysPerWeek = enrollment.class.dayOfWeek.split(',').length;
          const weeksInMonth = 4; // Simplified
          itemAmount = Number(rule.amount) * daysPerWeek * weeksInMonth;
        }

        items.push({
          description: `${enrollment.class.name} - ${billingMonth}`,
          amount: itemAmount,
          quantity: 1
        });
        totalAmount += itemAmount;
      }
    }

    if (totalAmount > 0) {
      // Generate invoice number
      const invoiceCount = await prisma.invoice.count({ where: { schoolId } });
      const invoiceNumber = `INV-${year}${String(month).padStart(2, '0')}-${String(invoiceCount + 1).padStart(4, '0')}`;

      // Create invoice with items
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          amount: totalAmount,
          issueDate: new Date(),
          dueDate: invoiceDueDate,
          description: `學費 ${billingMonth}`,
          schoolId,
          studentId: student.id,
          items: {
            create: items
          }
        },
        include: { items: true }
      });

      invoicesCreated.push(invoice);
    }
  }

  res.json({
    success: true,
    message: `Generated ${invoicesCreated.length} invoices`,
    data: {
      count: invoicesCreated.length,
      totalAmount: invoicesCreated.reduce((sum, inv) => sum + Number(inv.amount), 0),
      invoices: invoicesCreated.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        studentId: inv.studentId
      }))
    }
  });
}));

/**
 * GET /api/finance/preview-invoices
 * Preview what invoices would be generated
 */
router.get('/preview-invoices', authenticate, authorize('ADMIN'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { billingMonth } = req.query;

  if (!billingMonth) {
    return res.status(400).json({
      success: false,
      error: { message: 'Billing month is required', messageZh: '請提供計費月份' }
    });
  }

  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0);

  // Get pricing rules
  const pricingRules = await prisma.pricingRule.findMany({
    where: { schoolId, isActive: true }
  });

  // Get students
  const students = await prisma.student.findMany({
    where: { schoolId, status: 'ACTIVE' },
    include: {
      enrollments: {
        where: { status: 'ACTIVE' },
        include: { class: true }
      }
    }
  });

  const preview = [];

  for (const student of students) {
    if (student.enrollments.length === 0) continue;

    // Check existing invoice
    const existing = await prisma.invoice.findFirst({
      where: {
        studentId: student.id,
        issueDate: { gte: startOfMonth, lte: endOfMonth }
      }
    });

    let totalAmount = 0;
    const items = [];

    for (const enrollment of student.enrollments) {
      let rule = pricingRules.find(r => r.classId === enrollment.classId);
      if (!rule) rule = pricingRules.find(r => !r.classId);

      if (rule) {
        let itemAmount = Number(rule.amount);
        if (rule.priceType === 'PER_CLASS' && enrollment.class.dayOfWeek) {
          const daysPerWeek = enrollment.class.dayOfWeek.split(',').length;
          itemAmount = Number(rule.amount) * daysPerWeek * 4;
        }
        items.push({ class: enrollment.class.name, amount: itemAmount });
        totalAmount += itemAmount;
      }
    }

    preview.push({
      studentId: student.id,
      studentName: `${student.lastName}${student.firstName}`,
      alreadyInvoiced: !!existing,
      items,
      totalAmount
    });
  }

  res.json({
    success: true,
    data: {
      billingMonth,
      preview: preview.filter(p => !p.alreadyInvoiced),
      alreadyInvoiced: preview.filter(p => p.alreadyInvoiced).length,
      totalToGenerate: preview.filter(p => !p.alreadyInvoiced).length,
      totalAmount: preview.filter(p => !p.alreadyInvoiced).reduce((sum, p) => sum + p.totalAmount, 0)
    }
  });
}));

// =====================
// FINANCIAL REPORTS
// =====================

/**
 * GET /api/finance/summary
 * Get financial summary
 */
router.get('/summary', authenticate, authorize('ADMIN', 'MANAGER'), asyncHandler(async (req, res) => {
  const schoolId = req.user.schoolId;
  const { startDate, endDate } = req.query;

  const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
  const end = endDate ? new Date(endDate) : new Date();

  // Get invoice totals
  const invoiceTotals = await prisma.invoice.aggregate({
    where: {
      schoolId,
      issueDate: { gte: start, lte: end }
    },
    _sum: { amount: true, paidAmount: true },
    _count: { id: true }
  });

  // Get by status
  const invoicesByStatus = await prisma.invoice.groupBy({
    by: ['status'],
    where: { schoolId, issueDate: { gte: start, lte: end } },
    _sum: { amount: true },
    _count: { id: true }
  });

  // Get expenses
  const expenseTotals = await prisma.expense.aggregate({
    where: {
      schoolId,
      expenseDate: { gte: start, lte: end },
      status: { in: ['APPROVED', 'PAID'] }
    },
    _sum: { amount: true }
  });

  // Get manual revenues
  const revenueTotals = await prisma.revenue.aggregate({
    where: {
      schoolId,
      revenueDate: { gte: start, lte: end }
    },
    _sum: { amount: true }
  });

  const totalInvoiced = Number(invoiceTotals._sum.amount || 0);
  const totalCollected = Number(invoiceTotals._sum.paidAmount || 0);
  const totalExpenses = Number(expenseTotals._sum.amount || 0);
  const totalManualRevenue = Number(revenueTotals._sum.amount || 0);

  res.json({
    success: true,
    data: {
      period: { start, end },
      revenue: {
        invoiced: totalInvoiced,
        collected: totalCollected,
        outstanding: totalInvoiced - totalCollected,
        manualEntries: totalManualRevenue,
        total: totalCollected + totalManualRevenue
      },
      expenses: {
        total: totalExpenses
      },
      netIncome: (totalCollected + totalManualRevenue) - totalExpenses,
      invoices: {
        total: invoiceTotals._count.id,
        byStatus: invoicesByStatus.reduce((acc, s) => {
          acc[s.status] = { count: s._count.id, amount: Number(s._sum.amount || 0) };
          return acc;
        }, {})
      }
    }
  });
}));

export default router;
