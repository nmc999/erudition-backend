// Upload Routes
// Handles secure file uploads for messages and documents

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// Allowed file types
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES];

// Blocked file extensions (security)
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.bash', '.ps1', '.psm1',
  '.js', '.jsx', '.ts', '.tsx', '.php', '.py', '.rb', '.pl',
  '.jar', '.class', '.dll', '.so', '.dylib',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.html', '.htm', '.svg', '.xml'
];

// Max file sizes (bytes)
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate file for security
 */
function validateFile(fileName, mimeType, fileSize) {
  const errors = [];

  // Check extension
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    errors.push(`File type ${ext} is not allowed for security reasons`);
  }

  // Check MIME type
  if (!ALLOWED_TYPES.includes(mimeType)) {
    errors.push(`MIME type ${mimeType} is not allowed`);
  }

  // Check size
  const isImage = ALLOWED_IMAGE_TYPES.includes(mimeType);
  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_DOCUMENT_SIZE;
  if (fileSize > maxSize) {
    errors.push(`File too large. Maximum size is ${maxSize / 1024 / 1024}MB`);
  }

  return errors;
}

/**
 * POST /api/upload/message-attachment
 * Upload attachment for a message
 * In production: This would upload to S3/Supabase Storage
 */
router.post('/message-attachment', authenticate, asyncHandler(async (req, res) => {
  const { fileName, mimeType, fileSize, fileBase64, messageId } = req.body;

  if (!fileName || !mimeType || !fileSize) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing file information', messageZh: '缺少檔案資訊' }
    });
  }

  // Validate file
  const errors = validateFile(fileName, mimeType, fileSize);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE',
        message: errors.join('. '),
        messageZh: '檔案類型不允許'
      }
    });
  }

  // In production: Upload to cloud storage (S3, Supabase Storage)
  // For now, we'll generate a placeholder URL
  const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileUrl = `/api/files/${fileId}/${encodeURIComponent(fileName)}`;

  // If messageId provided, create attachment record
  let attachment = null;
  if (messageId) {
    // Verify message exists and user has access
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        senderId: req.user.id
      }
    });

    if (message) {
      attachment = await prisma.messageAttachment.create({
        data: {
          messageId,
          fileName,
          fileUrl,
          fileSize,
          mimeType,
          scanStatus: 'PENDING'
        }
      });
    }
  }

  res.json({
    success: true,
    data: {
      fileId,
      fileName,
      fileUrl,
      mimeType,
      fileSize,
      attachmentId: attachment?.id
    }
  });
}));

/**
 * POST /api/upload/document
 * Upload HR document
 */
router.post('/document', authenticate, asyncHandler(async (req, res) => {
  const { fileName, mimeType, fileSize } = req.body;

  if (!fileName || !mimeType || !fileSize) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing file information', messageZh: '缺少檔案資訊' }
    });
  }

  // Validate file
  const errors = validateFile(fileName, mimeType, fileSize);
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE',
        message: errors.join('. '),
        messageZh: '檔案類型不允許'
      }
    });
  }

  // Generate file URL
  const fileId = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileUrl = `/api/files/${fileId}/${encodeURIComponent(fileName)}`;

  res.json({
    success: true,
    data: {
      fileId,
      fileName,
      fileUrl,
      mimeType,
      fileSize
    }
  });
}));

/**
 * POST /api/upload/receipt
 * Upload expense receipt
 */
router.post('/receipt', authenticate, asyncHandler(async (req, res) => {
  const { fileName, mimeType, fileSize } = req.body;

  if (!fileName || !mimeType || !fileSize) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing file information', messageZh: '缺少檔案資訊' }
    });
  }

  // For receipts, only allow images and PDFs
  const allowedReceiptTypes = [...ALLOWED_IMAGE_TYPES, 'application/pdf'];
  if (!allowedReceiptTypes.includes(mimeType)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE',
        message: 'Only images and PDFs are allowed for receipts',
        messageZh: '收據只能上傳圖片或 PDF'
      }
    });
  }

  // Validate size
  if (fileSize > MAX_IMAGE_SIZE) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File too large. Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
        messageZh: `檔案過大，最大 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`
      }
    });
  }

  // Generate file URL
  const fileId = `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const fileUrl = `/api/files/${fileId}/${encodeURIComponent(fileName)}`;

  res.json({
    success: true,
    data: {
      fileId,
      fileName,
      fileUrl,
      mimeType,
      fileSize
    }
  });
}));

/**
 * GET /api/upload/allowed-types
 * Get list of allowed file types
 */
router.get('/allowed-types', authenticate, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      images: {
        types: ALLOWED_IMAGE_TYPES,
        maxSize: MAX_IMAGE_SIZE,
        maxSizeMB: MAX_IMAGE_SIZE / 1024 / 1024
      },
      documents: {
        types: ALLOWED_DOCUMENT_TYPES,
        maxSize: MAX_DOCUMENT_SIZE,
        maxSizeMB: MAX_DOCUMENT_SIZE / 1024 / 1024
      },
      blockedExtensions: BLOCKED_EXTENSIONS
    }
  });
}));

export default router;
