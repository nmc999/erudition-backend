// Super Admin Routes
// Platform-level management for Erudition SaaS
// NO access to individual student/parent data - aggregate only

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * Middleware to check super admin status
 */
const requireSuperAdmin = (req, res, next) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Super admin access required',
        messageZh: '需要超級管理員權限'
      }
    });
  }
  next();
};

/**
 * GET /api/superadmin/dashboard
 * Get platform overview statistics (aggregate only - no PII)
 */
router.get('/dashboard', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  // Get school counts by status
  const schoolStats = await prisma.school.groupBy({
    by: ['subscriptionStatus'],
    _count: { id: true }
  });

  // Get total schools
  const totalSchools = await prisma.school.count();

  // Get total students (aggregate count only)
  const totalStudents = await prisma.student.count({
    where: { status: 'ACTIVE' }
  });

  // Get total users by role (aggregate counts)
  const usersByRole = await prisma.user.groupBy({
    by: ['role'],
    where: { isActive: true },
    _count: { id: true }
  });

  // Get recent signups (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSignups = await prisma.school.count({
    where: { createdAt: { gte: thirtyDaysAgo } }
  });

  // Calculate MRR (Monthly Recurring Revenue)
  const schoolsWithStudents = await prisma.school.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    select: {
      pricePerStudent: true,
      _count: { select: { students: { where: { status: 'ACTIVE' } } } }
    }
  });

  const mrr = schoolsWithStudents.reduce((total, school) => {
    return total + (school._count.students * school.pricePerStudent);
  }, 0);

  // Get monthly revenue from payments (last 12 months)
  const monthlyRevenue = [];
  for (let i = 0; i < 12; i++) {
    const startOfMonth = new Date();
    startOfMonth.setMonth(startOfMonth.getMonth() - i);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    const revenue = await prisma.platformPayment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: { gte: startOfMonth, lte: endOfMonth }
      },
      _sum: { amount: true }
    });

    monthlyRevenue.unshift({
      month: startOfMonth.toISOString().slice(0, 7),
      revenue: Number(revenue._sum.amount || 0)
    });
  }

  res.json({
    success: true,
    data: {
      overview: {
        totalSchools,
        activeSchools: schoolStats.find(s => s.subscriptionStatus === 'ACTIVE')?._count.id || 0,
        totalStudents,
        totalTeachers: usersByRole.find(u => u.role === 'TEACHER')?._count.id || 0,
        totalParents: usersByRole.find(u => u.role === 'PARENT')?._count.id || 0,
        mrr,
        recentSignups
      },
      schoolsByStatus: schoolStats.reduce((acc, s) => {
        acc[s.subscriptionStatus] = s._count.id;
        return acc;
      }, {}),
      monthlyRevenue
    }
  });
}));

/**
 * GET /api/superadmin/schools
 * List all schools with aggregate metrics (no PII)
 */
router.get('/schools', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { 
    status, 
    search, 
    page = 1, 
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    ...(status && { subscriptionStatus: status }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { subdomain: { contains: search, mode: 'insensitive' } }
      ]
    })
  };

  const [schools, total] = await Promise.all([
    prisma.school.findMany({
      where,
      select: {
        id: true,
        name: true,
        subdomain: true,
        subscriptionStatus: true,
        pricePerStudent: true,
        createdAt: true,
        // Aggregate counts only - no PII
        _count: {
          select: { 
            students: { where: { status: 'ACTIVE' } },
            users: { where: { isActive: true } },
            classes: true
          }
        }
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take
    }),
    prisma.school.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      schools: schools.map(s => ({
        id: s.id,
        name: s.name,
        subdomain: s.subdomain,
        status: s.subscriptionStatus,
        pricePerStudent: s.pricePerStudent,
        createdAt: s.createdAt,
        // Aggregate metrics only
        metrics: {
          studentCount: s._count.students,
          userCount: s._count.users,
          classCount: s._count.classes,
          monthlyRevenue: s._count.students * s.pricePerStudent
        }
      })),
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
 * GET /api/superadmin/schools/:id
 * Get school overview (aggregate metrics, no student/parent PII)
 */
router.get('/schools/:id', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const school = await prisma.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      subdomain: true,
      email: true,
      phone: true,
      address: true,
      subscriptionStatus: true,
      pricePerStudent: true,
      createdAt: true,
      primaryColor: true,
      logoUrl: true,
      // Aggregate counts
      _count: {
        select: {
          students: { where: { status: 'ACTIVE' } },
          users: true,
          classes: true,
          invoices: true
        }
      }
    }
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      error: { message: 'School not found' }
    });
  }

  // Get user breakdown by role (counts only)
  const usersByRole = await prisma.user.groupBy({
    by: ['role'],
    where: { schoolId: id, isActive: true },
    _count: { id: true }
  });

  // Get billing history (amounts only, no student details)
  const recentInvoices = await prisma.platformInvoice.findMany({
    where: { schoolId: id },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      status: true,
      billingPeriodStart: true,
      billingPeriodEnd: true,
      paidAt: true
    }
  });

  res.json({
    success: true,
    data: {
      school: {
        ...school,
        metrics: {
          studentCount: school._count.students,
          userCount: school._count.users,
          classCount: school._count.classes,
          invoiceCount: school._count.invoices,
          monthlyRevenue: school._count.students * school.pricePerStudent
        },
        userBreakdown: usersByRole.reduce((acc, u) => {
          acc[u.role] = u._count.id;
          return acc;
        }, {})
      },
      billingHistory: recentInvoices
    }
  });
}));

/**
 * PUT /api/superadmin/schools/:id/status
 * Update school subscription status
 */
router.put('/schools/:id/status', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  const validStatuses = ['ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid status' }
    });
  }

  const school = await prisma.school.update({
    where: { id },
    data: { subscriptionStatus: status },
    select: {
      id: true,
      name: true,
      subdomain: true,
      subscriptionStatus: true
    }
  });

  // In production: Log this action, send notification email to school admin

  res.json({
    success: true,
    data: { school }
  });
}));

/**
 * GET /api/superadmin/revenue
 * Get revenue analytics
 */
router.get('/revenue', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  // Calculate current MRR
  const activeSchools = await prisma.school.findMany({
    where: { subscriptionStatus: 'ACTIVE' },
    select: {
      pricePerStudent: true,
      _count: { select: { students: { where: { status: 'ACTIVE' } } } }
    }
  });

  const mrr = activeSchools.reduce((total, school) => {
    return total + (school._count.students * school.pricePerStudent);
  }, 0);

  const totalActiveStudents = activeSchools.reduce((total, school) => {
    return total + school._count.students;
  }, 0);

  // Get monthly data for last 12 months
  const monthlyData = [];
  for (let i = 11; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

    const [payments, newSchools, newStudents] = await Promise.all([
      prisma.platformPayment.aggregate({
        where: {
          status: 'COMPLETED',
          paidAt: { gte: startOfMonth, lte: endOfMonth }
        },
        _sum: { amount: true },
        _count: { id: true }
      }),
      prisma.school.count({
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } }
      }),
      prisma.student.count({
        where: { 
          enrollmentDate: { gte: startOfMonth, lte: endOfMonth },
          status: 'ACTIVE'
        }
      })
    ]);

    monthlyData.push({
      month: startOfMonth.toISOString().slice(0, 7),
      revenue: Number(payments._sum.amount || 0),
      payments: payments._count.id,
      newSchools,
      newStudents
    });
  }

  res.json({
    success: true,
    data: {
      currentMRR: mrr,
      activeStudents: totalActiveStudents,
      activeSchools: activeSchools.length,
      avgRevenuePerSchool: activeSchools.length > 0 ? Math.round(mrr / activeSchools.length) : 0,
      monthlyData
    }
  });
}));

/**
 * GET /api/superadmin/health
 * Platform health check
 */
router.get('/health', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const now = new Date();
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  // Check various metrics
  const [
    recentLogins,
    recentErrors,
    pendingInvoices,
    overdueInvoices
  ] = await Promise.all([
    prisma.user.count({
      where: { lastLoginAt: { gte: oneHourAgo } }
    }),
    // In production: would check error logs
    Promise.resolve(0),
    prisma.platformInvoice.count({
      where: { status: 'PENDING' }
    }),
    prisma.platformInvoice.count({
      where: { status: 'OVERDUE' }
    })
  ]);

  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: now.toISOString(),
      metrics: {
        activeUsersLastHour: recentLogins,
        pendingInvoices,
        overdueInvoices
      }
    }
  });
}));

export default router;
