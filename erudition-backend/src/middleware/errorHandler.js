// Global Error Handler Middleware
// Catches and formats all errors consistently

import { Prisma } from '@prisma/client';

/**
 * Custom application error class
 */
export class AppError extends Error {
  constructor(code, message, messageZh, statusCode = 400) {
    super(message);
    this.code = code;
    this.messageZh = messageZh;
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Global error handler
 */
export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error response
  let statusCode = err.statusCode || 500;
  let errorResponse = {
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred',
      messageZh: err.messageZh || '發生意外錯誤'
    }
  };

  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        // Unique constraint violation
        statusCode = 409;
        const field = err.meta?.target?.[0] || 'field';
        errorResponse.error = {
          code: 'DUPLICATE_ENTRY',
          message: `A record with this ${field} already exists`,
          messageZh: `此${field}的記錄已存在`
        };
        break;

      case 'P2025':
        // Record not found
        statusCode = 404;
        errorResponse.error = {
          code: 'NOT_FOUND',
          message: 'Record not found',
          messageZh: '找不到記錄'
        };
        break;

      case 'P2003':
        // Foreign key constraint violation
        statusCode = 400;
        errorResponse.error = {
          code: 'INVALID_REFERENCE',
          message: 'Referenced record does not exist',
          messageZh: '引用的記錄不存在'
        };
        break;

      default:
        statusCode = 400;
        errorResponse.error = {
          code: 'DATABASE_ERROR',
          message: 'Database operation failed',
          messageZh: '資料庫操作失敗'
        };
    }
  }

  // Handle Prisma validation errors
  if (err instanceof Prisma.PrismaClientValidationError) {
    statusCode = 400;
    errorResponse.error = {
      code: 'VALIDATION_ERROR',
      message: 'Invalid data provided',
      messageZh: '提供的資料無效'
    };
  }

  // Handle JSON parse errors
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    errorResponse.error = {
      code: 'INVALID_JSON',
      message: 'Invalid JSON in request body',
      messageZh: '請求內容的 JSON 格式無效'
    };
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
export const notFound = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
      messageZh: `找不到路由 ${req.method} ${req.originalUrl}`
    }
  });
};

/**
 * Async handler wrapper to catch async errors
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export default { errorHandler, notFound, asyncHandler, AppError };
