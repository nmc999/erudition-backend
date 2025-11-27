// Public Registration Routes
// Handles public student registration without authentication

import { Router } from 'express';
import prisma from '../config/database.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/**
 * POST /api/public/register
 * Submit a new student registration
 * Includes Taiwan PDPA consent validation
 */
router.post('/register', asyncHandler(async (req, res) => {
  const {
    // Student info
    studentFirstName,
    studentLastName,
    studentEnglishName,
    studentDob,
    studentGender,
    studentPhone,
    studentEmail,
    
    // Parent info
    parentFirstName,
    parentLastName,
    parentPhone,
    parentEmail,
    parentRelation,
    
    // Emergency contact
    emergencyName,
    emergencyPhone,
    emergencyRelation,
    
    // Medical info
    allergies,
    medicalInfo,
    
    // Address
    address,
    
    // Preferences
    interestedClasses,
    howDidYouHear,
    notes,

    // PDPA Consent (Taiwan)
    consentDataCollection,
    consentHealthData,
    consentPrivacyPolicy
  } = req.body;

  // Validate required fields
  if (!studentFirstName || !studentLastName || !parentFirstName || !parentLastName || !parentPhone) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields',
      messageZh: '缺少必填欄位'
    });
  }

  // Validate PDPA consent (Taiwan compliance)
  if (!consentDataCollection || !consentPrivacyPolicy) {
    return res.status(400).json({
      success: false,
      message: 'Data collection consent and privacy policy agreement are required',
      messageZh: '需要同意資料蒐集及隱私權政策'
    });
  }

  // If health data is provided, require health data consent
  if ((allergies || medicalInfo) && !consentHealthData) {
    return res.status(400).json({
      success: false,
      message: 'Health data consent is required when providing medical information',
      messageZh: '提供醫療資訊時需要同意健康資料蒐集'
    });
  }

  // Create registration record
  const registration = await prisma.registration.create({
    data: {
      // Student info
      studentFirstName,
      studentLastName,
      studentEnglishName: studentEnglishName || null,
      studentDob: studentDob ? new Date(studentDob) : null,
      studentGender: studentGender || null,
      studentPhone: studentPhone || null,
      studentEmail: studentEmail || null,
      
      // Parent info
      parentFirstName,
      parentLastName,
      parentPhone,
      parentEmail: parentEmail || null,
      parentRelation: parentRelation || null,
      
      // Emergency contact
      emergencyName: emergencyName || null,
      emergencyPhone: emergencyPhone || null,
      emergencyRelation: emergencyRelation || null,
      
      // Medical info
      allergies: allergies || null,
      medicalInfo: medicalInfo || null,
      
      // Address
      address: address || null,
      
      // Preferences
      interestedClasses: interestedClasses || [],
      howDidYouHear: howDidYouHear || null,
      notes: notes || null,
      
      // PDPA Consent (Taiwan)
      consentDataCollection: Boolean(consentDataCollection),
      consentHealthData: Boolean(consentHealthData),
      consentPrivacyPolicy: Boolean(consentPrivacyPolicy),
      consentTimestamp: new Date(),
      
      // Status
      status: 'PENDING'
    }
  });

  // In production, this would:
  // 1. Send confirmation email to parent
  // 2. Notify admin of new registration
  // 3. Create a follow-up task

  res.status(201).json({
    success: true,
    message: 'Registration submitted successfully',
    messageZh: '報名已成功送出',
    data: {
      registrationId: registration.id,
      submittedAt: registration.createdAt,
      consentRecorded: {
        dataCollection: registration.consentDataCollection,
        healthData: registration.consentHealthData,
        privacyPolicy: registration.consentPrivacyPolicy,
        timestamp: registration.consentTimestamp
      }
    }
  });
}));

/**
 * GET /api/public/classes
 * Get list of available classes for registration form
 */
router.get('/classes', asyncHandler(async (req, res) => {
  const classes = await prisma.class.findMany({
    where: {
      status: 'ACTIVE'
    },
    select: {
      id: true,
      name: true,
      description: true,
      schedule: true,
      maxStudents: true,
      _count: {
        select: { enrollments: true }
      }
    },
    orderBy: {
      name: 'asc'
    }
  });

  const availableClasses = classes.map(cls => ({
    id: cls.id,
    name: cls.name,
    description: cls.description,
    schedule: cls.schedule,
    spotsAvailable: cls.maxStudents ? cls.maxStudents - cls._count.enrollments : null
  }));

  res.json({
    success: true,
    data: { classes: availableClasses }
  });
}));

export default router;
