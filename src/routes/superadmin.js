// Super Admin Routes
// Platform-level management for Erudition SaaS

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
 * Get platform overview statistics
 */
router.get('/dashboard', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  // Get school counts by status
  const schoolStats = await prisma.school.groupBy({
    by: ['subscriptionStatus'],
    _count: { id: true }
  });

  // Get total schools
  const totalSchools = await prisma.school.count();

  // Get total students
  const totalStudents = await prisma.student.count({
    where: { status: 'ACTIVE' }
  });

  // Get total users
  const totalUsers = await prisma.user.count({
    where: { isActive: true }
  });

  // Get revenue this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyRevenue = await prisma.platformPayment.aggregate({
    where: {
      status: 'COMPLETED',
      paidAt: { gte: startOfMonth }
    },
    _sum: { amount: true }
  });

  // Get recent signups (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentSignups = await prisma.school.count({
    where: { createdAt: { gte: thirtyDaysAgo } }
  });

  // Get schools with most students
  const topSchools = await prisma.school.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      subdomain: true,
      subscriptionStatus: true,
      createdAt: true,
      _count: {
        select: { students: true }
      }
    },
    orderBy: {
      students: { _count: 'desc' }
    }
  });

  res.json({
    success: true,
    data: {
      overview: {
        totalSchools,
        totalStudents,
        totalUsers,
        monthlyRevenue: Number(monthlyRevenue._sum.amount || 0),
        recentSignups
      },
      schoolsByStatus: schoolStats.reduce((acc, s) => {
        acc[s.subscriptionStatus] = s._count.id;
        return acc;
      }, {}),
      topSchools: topSchools.map(s => ({
        id: s.id,
        name: s.name,
        subdomain: s.subdomain,
        status: s.subscriptionStatus,
        studentCount: s._count.students,
        createdAt: s.createdAt
      }))
    }
  });
}));

/**
 * GET /api/superadmin/schools
 * List all schools with pagination and filters
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
        { subdomain: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
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
        email: true,
        phone: true,
        subscriptionStatus: true,
        pricePerStudent: true,
        createdAt: true,
        _count: {
          select: { 
            students: true,
            users: true,
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
        ...s,
        studentCount: s._count.students,
        userCount: s._count.users,
        classCount: s._count.classes,
        monthlyRevenue: s._count.students * s.pricePerStudent
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
 * Get detailed school info
 */
router.get('/schools/:id', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const school = await prisma.school.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          students: true,
          users: true,
          classes: true,
          invoices: true
        }
      },
      users: {
        where: { role: 'ADMIN' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          lastLoginAt: true
        }
      },
      platformInvoices: {
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          status: true,
          billingPeriodStart: true,
          billingPeriodEnd: true
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

  res.json({
    success: true,
    data: { school }
  });
}));

/**
 * PUT /api/superadmin/schools/:id/status
 * Update school subscription status
 */
router.put('/schools/:id/status', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

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
      subscriptionStatus: true
    }
  });

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
  const { months = 12 } = req.query;

  // Get monthly revenue for last N months
  const monthlyData = [];
  const now = new Date();

  for (let i = 0; i < parseInt(months); i++) {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

    const revenue = await prisma.platformPayment.aggregate({
      where: {
        status: 'COMPLETED',
        paidAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      },
      _sum: { amount: true },
      _count: { id: true }
    });

    monthlyData.unshift({
      month: startOfMonth.toISOString().slice(0, 7),
      revenue: Number(revenue._sum.amount || 0),
      payments: revenue._count.id
    });
  }

  // Calculate current MRR (Monthly Recurring Revenue)
  const activeStudents = await prisma.student.count({
    where: {
      status: 'ACTIVE',
      school: { subscriptionStatus: 'ACTIVE' }
    }
  });

  const mrr = activeStudents * 50; // NT$50 per student

  res.json({
    success: true,
    data: {
      currentMRR: mrr,
      activeStudents,
      monthlyData
    }
  });
}));

/**
 * GET /api/superadmin/invoices
 * List all platform invoices
 */
router.get('/invoices', authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = status ? { status } : {};

  const [invoices, total] = await Promise.all([
    prisma.platformInvoice.findMany({
      where,
      include: {
        school: {
          select: {
            name: true,
            subdomain: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.platformInvoice.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

export default router;
