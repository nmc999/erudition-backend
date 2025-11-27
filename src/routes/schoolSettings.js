// School Settings Routes
// Handles school branding, permissions, and billing

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * GET /api/school/settings
 * Get current school settings (branding & permissions)
 */
router.get('/settings', authenticate, asyncHandler(async (req, res) => {
  const school = await prisma.school.findUnique({
    where: { id: req.user.schoolId },
    select: {
      id: true,
      name: true,
      subdomain: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      address: true,
      phone: true,
      email: true,
      billingEmail: true,
      timezone: true,
      // Teacher permissions
      teacherCanMessageWithoutApproval: true,
      teacherCanEditStudents: true,
      teacherCanViewAllClasses: true,
      teacherCanManageAttendance: true,
      teacherCanGradeHomework: true,
      teacherCanCreateHomework: true,
      teacherCanViewParentContacts: true,
      // Parent permissions
      parentCanMessageTeachers: true,
      parentCanViewGrades: true,
      parentCanViewAttendance: true,
      // Subscription
      subscriptionStatus: true,
      pricePerStudent: true
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
 * PUT /api/school/settings/branding
 * Update school branding (logo, colors)
 */
router.put('/settings/branding',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { logoUrl, primaryColor, secondaryColor, name } = req.body;

    const school = await prisma.school.update({
      where: { id: req.user.schoolId },
      data: {
        ...(logoUrl !== undefined && { logoUrl }),
        ...(primaryColor && { primaryColor }),
        ...(secondaryColor && { secondaryColor }),
        ...(name && { name })
      },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true
      }
    });

    res.json({
      success: true,
      data: { school }
    });
  })
);

/**
 * PUT /api/school/settings/permissions
 * Update teacher/parent permissions
 */
router.put('/settings/permissions',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const {
      // Teacher permissions
      teacherCanMessageWithoutApproval,
      teacherCanEditStudents,
      teacherCanViewAllClasses,
      teacherCanManageAttendance,
      teacherCanGradeHomework,
      teacherCanCreateHomework,
      teacherCanViewParentContacts,
      // Parent permissions
      parentCanMessageTeachers,
      parentCanViewGrades,
      parentCanViewAttendance
    } = req.body;

    const school = await prisma.school.update({
      where: { id: req.user.schoolId },
      data: {
        ...(teacherCanMessageWithoutApproval !== undefined && { teacherCanMessageWithoutApproval }),
        ...(teacherCanEditStudents !== undefined && { teacherCanEditStudents }),
        ...(teacherCanViewAllClasses !== undefined && { teacherCanViewAllClasses }),
        ...(teacherCanManageAttendance !== undefined && { teacherCanManageAttendance }),
        ...(teacherCanGradeHomework !== undefined && { teacherCanGradeHomework }),
        ...(teacherCanCreateHomework !== undefined && { teacherCanCreateHomework }),
        ...(teacherCanViewParentContacts !== undefined && { teacherCanViewParentContacts }),
        ...(parentCanMessageTeachers !== undefined && { parentCanMessageTeachers }),
        ...(parentCanViewGrades !== undefined && { parentCanViewGrades }),
        ...(parentCanViewAttendance !== undefined && { parentCanViewAttendance })
      },
      select: {
        teacherCanMessageWithoutApproval: true,
        teacherCanEditStudents: true,
        teacherCanViewAllClasses: true,
        teacherCanManageAttendance: true,
        teacherCanGradeHomework: true,
        teacherCanCreateHomework: true,
        teacherCanViewParentContacts: true,
        parentCanMessageTeachers: true,
        parentCanViewGrades: true,
        parentCanViewAttendance: true
      }
    });

    res.json({
      success: true,
      data: { permissions: school }
    });
  })
);

/**
 * PUT /api/school/settings/contact
 * Update school contact info
 */
router.put('/settings/contact',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { address, phone, email, billingEmail, timezone } = req.body;

    const school = await prisma.school.update({
      where: { id: req.user.schoolId },
      data: {
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(billingEmail !== undefined && { billingEmail }),
        ...(timezone && { timezone })
      },
      select: {
        address: true,
        phone: true,
        email: true,
        billingEmail: true,
        timezone: true
      }
    });

    res.json({
      success: true,
      data: { school }
    });
  })
);

/**
 * GET /api/school/billing
 * Get billing information and invoices
 */
router.get('/billing',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const schoolId = req.user.schoolId;

    // Get school billing info
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: {
        subscriptionStatus: true,
        pricePerStudent: true,
        billingEmail: true,
        stripeCustomerId: true
      }
    });

    // Get current student count
    const studentCount = await prisma.student.count({
      where: { 
        schoolId,
        status: 'ACTIVE'
      }
    });

    // Get recent invoices
    const invoices = await prisma.platformInvoice.findMany({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        invoiceNumber: true,
        billingPeriodStart: true,
        billingPeriodEnd: true,
        studentCount: true,
        total: true,
        status: true,
        dueDate: true,
        paidAt: true
      }
    });

    // Calculate current monthly estimate
    const monthlyEstimate = studentCount * school.pricePerStudent;

    res.json({
      success: true,
      data: {
        subscription: {
          status: school.subscriptionStatus,
          pricePerStudent: school.pricePerStudent,
          billingEmail: school.billingEmail,
          hasPaymentMethod: !!school.stripeCustomerId
        },
        usage: {
          activeStudents: studentCount,
          monthlyEstimate
        },
        invoices
      }
    });
  })
);

/**
 * GET /api/school/public/:subdomain
 * Get public school info by subdomain (for login page branding)
 */
router.get('/public/:subdomain', asyncHandler(async (req, res) => {
  const { subdomain } = req.params;

  const school = await prisma.school.findUnique({
    where: { subdomain },
    select: {
      id: true,
      name: true,
      logoUrl: true,
      primaryColor: true,
      secondaryColor: true,
      subscriptionStatus: true
    }
  });

  if (!school) {
    return res.status(404).json({
      success: false,
      error: { message: 'School not found' }
    });
  }

  // Don't expose internal IDs or sensitive data
  res.json({
    success: true,
    data: {
      name: school.name,
      logoUrl: school.logoUrl,
      primaryColor: school.primaryColor,
      secondaryColor: school.secondaryColor,
      isActive: school.subscriptionStatus === 'ACTIVE'
    }
  });
}));

export default router;
