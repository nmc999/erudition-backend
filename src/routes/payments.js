// Payment Routes
// Handles Taiwan payment gateway integration (ECPay, LINE Pay)

import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// ECPay configuration (Taiwan's major payment gateway)
const ECPAY_MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const ECPAY_HASH_KEY = process.env.ECPAY_HASH_KEY;
const ECPAY_HASH_IV = process.env.ECPAY_HASH_IV;
const ECPAY_API_URL = process.env.ECPAY_API_URL || 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5';

// LINE Pay configuration
const LINEPAY_CHANNEL_ID = process.env.LINEPAY_CHANNEL_ID;
const LINEPAY_CHANNEL_SECRET = process.env.LINEPAY_CHANNEL_SECRET;
const LINEPAY_API_URL = process.env.LINEPAY_API_URL || 'https://sandbox-api-pay.line.me';

/**
 * GET /api/payments
 * Get payment history for current user (parent)
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  // Get parent's students
  const parentStudents = await prisma.parentStudent.findMany({
    where: { parentId: req.user.id },
    select: { studentId: true }
  });

  const studentIds = parentStudents.map(ps => ps.studentId);

  const where = {
    studentId: { in: studentIds }
  };

  if (status) {
    where.status = status;
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        invoice: {
          select: {
            id: true,
            description: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.payment.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    }
  });
}));

/**
 * GET /api/payments/pending
 * Get pending payments for parent
 */
router.get('/pending', authenticate, asyncHandler(async (req, res) => {
  // Get parent's students
  const parentStudents = await prisma.parentStudent.findMany({
    where: { parentId: req.user.id },
    select: { studentId: true }
  });

  const studentIds = parentStudents.map(ps => ps.studentId);

  // Get unpaid invoices
  const invoices = await prisma.invoice.findMany({
    where: {
      studentId: { in: studentIds },
      status: { in: ['PENDING', 'OVERDUE'] }
    },
    include: {
      student: {
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      }
    },
    orderBy: { dueDate: 'asc' }
  });

  res.json({
    success: true,
    data: { invoices }
  });
}));

/**
 * POST /api/payments/initiate
 * Initiate a payment for an invoice
 */
router.post('/initiate', authenticate, asyncHandler(async (req, res) => {
  const { invoiceId, method } = req.body;

  if (!invoiceId || !method) {
    return res.status(400).json({
      success: false,
      message: 'Invoice ID and payment method are required'
    });
  }

  // Validate method
  const validMethods = ['credit_card', 'line_pay', 'atm', 'cvs'];
  if (!validMethods.includes(method)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method'
    });
  }

  // Get invoice
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      student: true
    }
  });

  if (!invoice) {
    return res.status(404).json({
      success: false,
      message: 'Invoice not found'
    });
  }

  if (invoice.status === 'PAID') {
    return res.status(400).json({
      success: false,
      message: 'Invoice already paid'
    });
  }

  // Create payment record
  const payment = await prisma.payment.create({
    data: {
      invoiceId: invoice.id,
      studentId: invoice.studentId,
      amount: invoice.amount,
      method,
      status: 'PENDING',
      merchantTradeNo: `ERU${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`
    }
  });

  let paymentData = {};

  switch (method) {
    case 'credit_card':
    case 'atm':
    case 'cvs':
      // Generate ECPay form data
      paymentData = generateECPayData(payment, invoice, method);
      break;
    
    case 'line_pay':
      // Generate LINE Pay request
      paymentData = await generateLinePayRequest(payment, invoice);
      break;
  }

  res.json({
    success: true,
    data: {
      paymentId: payment.id,
      method,
      ...paymentData
    }
  });
}));

/**
 * POST /api/payments/ecpay/callback
 * ECPay payment callback
 */
router.post('/ecpay/callback', asyncHandler(async (req, res) => {
  const { MerchantTradeNo, RtnCode, RtnMsg, TradeNo, PaymentDate, PaymentType } = req.body;

  // Verify checksum (in production)
  // const isValid = verifyECPayChecksum(req.body);

  // Find payment
  const payment = await prisma.payment.findFirst({
    where: { merchantTradeNo: MerchantTradeNo }
  });

  if (!payment) {
    return res.send('0|Error');
  }

  if (RtnCode === '1') {
    // Payment successful
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          gatewayTradeNo: TradeNo,
          paidAt: new Date(PaymentDate),
          paymentType: PaymentType
        }
      }),
      prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: {
          status: 'PAID',
          paidAt: new Date()
        }
      })
    ]);
  } else {
    // Payment failed
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        errorMessage: RtnMsg
      }
    });
  }

  res.send('1|OK');
}));

/**
 * POST /api/payments/linepay/confirm
 * LINE Pay payment confirmation
 */
router.post('/linepay/confirm', authenticate, asyncHandler(async (req, res) => {
  const { transactionId, paymentId } = req.body;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId }
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: 'Payment not found'
    });
  }

  // Confirm LINE Pay payment
  try {
    const confirmResult = await confirmLinePayment(transactionId, payment.amount);
    
    if (confirmResult.returnCode === '0000') {
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'COMPLETED',
            gatewayTradeNo: transactionId,
            paidAt: new Date()
          }
        }),
        prisma.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            status: 'PAID',
            paidAt: new Date()
          }
        })
      ]);

      res.json({
        success: true,
        message: 'Payment confirmed'
      });
    } else {
      throw new Error(confirmResult.returnMessage);
    }
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message
      }
    });

    res.status(400).json({
      success: false,
      message: 'Payment confirmation failed'
    });
  }
}));

/**
 * GET /api/payments/:id
 * Get payment details
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: {
      student: true,
      invoice: true
    }
  });

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: 'Payment not found'
    });
  }

  res.json({
    success: true,
    data: { payment }
  });
}));

// =====================
// HELPER FUNCTIONS
// =====================

function generateECPayData(payment, invoice, method) {
  const tradeDate = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
  
  const baseData = {
    MerchantID: ECPAY_MERCHANT_ID,
    MerchantTradeNo: payment.merchantTradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: 'aio',
    TotalAmount: Math.round(payment.amount),
    TradeDesc: encodeURIComponent('Erudition學費'),
    ItemName: invoice.description || '學費',
    ReturnURL: `${process.env.API_BASE_URL}/api/payments/ecpay/callback`,
    ClientBackURL: `${process.env.FRONTEND_URL}/payments`,
    ChoosePayment: getECPayMethod(method)
  };

  // Add method-specific parameters
  if (method === 'atm') {
    baseData.ExpireDate = 7; // 7 days
  } else if (method === 'cvs') {
    baseData.StoreExpireDate = 10080; // 7 days in minutes
  }

  // Generate CheckMacValue (in production)
  // baseData.CheckMacValue = generateCheckMacValue(baseData);

  return {
    formAction: ECPAY_API_URL,
    formData: baseData
  };
}

function getECPayMethod(method) {
  const methodMap = {
    'credit_card': 'Credit',
    'atm': 'ATM',
    'cvs': 'CVS'
  };
  return methodMap[method] || 'ALL';
}

async function generateLinePayRequest(payment, invoice) {
  const requestBody = {
    amount: Math.round(payment.amount),
    currency: 'TWD',
    orderId: payment.merchantTradeNo,
    packages: [{
      id: payment.id,
      amount: Math.round(payment.amount),
      name: invoice.description || '學費',
      products: [{
        name: invoice.description || '學費',
        quantity: 1,
        price: Math.round(payment.amount)
      }]
    }],
    redirectUrls: {
      confirmUrl: `${process.env.FRONTEND_URL}/payments?confirm=linepay`,
      cancelUrl: `${process.env.FRONTEND_URL}/payments?cancel=linepay`
    }
  };

  // In production, make actual LINE Pay API call
  // const response = await fetch(`${LINEPAY_API_URL}/v3/payments/request`, {...});
  
  return {
    redirectUrl: `${LINEPAY_API_URL}/reserve?orderId=${payment.merchantTradeNo}`,
    transactionId: `LINEPAY_${Date.now()}`
  };
}

async function confirmLinePayment(transactionId, amount) {
  // In production, make actual LINE Pay confirmation API call
  return {
    returnCode: '0000',
    returnMessage: 'Success'
  };
}

export default router;
