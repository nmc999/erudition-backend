// Message Routes
// Handles messaging between teachers and parents with translation

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import lineService from '../services/lineService.js';
import translationService from '../services/translationService.js';

const router = Router();

/**
 * GET /api/messages
 * Get messages for current user
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { 
    conversationWith, // userId to filter conversation with specific person
    classId,          // for class announcements
    unreadOnly,
    page = 1, 
    limit = 50 
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const take = parseInt(limit);

  const where = {
    OR: [
      { senderId: req.user.id },
      { recipientId: req.user.id }
    ]
  };

  if (conversationWith) {
    where.OR = [
      { senderId: req.user.id, recipientId: conversationWith },
      { senderId: conversationWith, recipientId: req.user.id }
    ];
  }

  if (classId) {
    where.classId = classId;
    where.isAnnouncement = true;
  }

  if (unreadOnly === 'true') {
    where.recipientId = req.user.id;
    where.readAt = null;
  }

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            lineProfileUrl: true
          }
        },
        recipient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        class: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take
    }),
    prisma.message.count({ where })
  ]);

  res.json({
    success: true,
    data: {
      messages,
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
 * GET /api/messages/conversations
 * Get list of conversations (unique contacts)
 */
router.get('/conversations', authenticate, asyncHandler(async (req, res) => {
  // Get latest message from each conversation
  const sentMessages = await prisma.message.findMany({
    where: {
      senderId: req.user.id,
      isAnnouncement: false
    },
    select: {
      recipientId: true,
      createdAt: true,
      originalText: true,
      recipient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          lineProfileUrl: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const receivedMessages = await prisma.message.findMany({
    where: {
      recipientId: req.user.id,
      isAnnouncement: false
    },
    select: {
      senderId: true,
      createdAt: true,
      originalText: true,
      readAt: true,
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          lineProfileUrl: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Combine and deduplicate by contact
  const conversationsMap = new Map();

  sentMessages.forEach(msg => {
    if (msg.recipientId && !conversationsMap.has(msg.recipientId)) {
      conversationsMap.set(msg.recipientId, {
        contact: msg.recipient,
        lastMessage: {
          text: msg.originalText.substring(0, 50),
          createdAt: msg.createdAt,
          isFromMe: true
        },
        unreadCount: 0
      });
    }
  });

  receivedMessages.forEach(msg => {
    const existing = conversationsMap.get(msg.senderId);
    if (!existing || msg.createdAt > existing.lastMessage.createdAt) {
      const unreadCount = receivedMessages.filter(
        m => m.senderId === msg.senderId && !m.readAt
      ).length;

      conversationsMap.set(msg.senderId, {
        contact: msg.sender,
        lastMessage: {
          text: msg.originalText.substring(0, 50),
          createdAt: msg.createdAt,
          isFromMe: false
        },
        unreadCount
      });
    }
  });

  // Sort by last message date
  const conversations = Array.from(conversationsMap.values())
    .sort((a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt);

  res.json({
    success: true,
    data: { conversations }
  });
}));

/**
 * GET /api/messages/unread-count
 * Get count of unread messages
 */
router.get('/unread-count', authenticate, asyncHandler(async (req, res) => {
  const count = await prisma.message.count({
    where: {
      recipientId: req.user.id,
      readAt: null
    }
  });

  res.json({
    success: true,
    data: { unreadCount: count }
  });
}));

/**
 * POST /api/messages
 * Send a message
 */
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { 
    recipientId, 
    classId,         // for class announcements
    text, 
    attachments,
    sendViaLine = true 
  } = req.body;

  if (!text) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'TEXT_REQUIRED',
        message: 'Message text is required',
        messageZh: '需要訊息內容'
      }
    });
  }

  const isAnnouncement = !!classId && !recipientId;

  if (!recipientId && !isAnnouncement) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'RECIPIENT_REQUIRED',
        message: 'recipientId or classId is required',
        messageZh: '需要收件人 ID 或班級 ID'
      }
    });
  }

  // Detect source language
  const sourceLang = translationService.detectLanguage(text);
  const targetLang = sourceLang === 'zh-TW' ? 'en' : 'zh-TW';

  // Translate message
  let translatedText = null;
  try {
    translatedText = await translationService.translateText(text, sourceLang, targetLang);
  } catch (error) {
    console.error('Translation failed:', error);
  }

  // Handle class announcement
  if (isAnnouncement) {
    // Verify class exists and user has access
    const classData = await prisma.class.findFirst({
      where: {
        id: classId,
        schoolId: req.user.schoolId,
        ...(req.user.role === 'TEACHER' && { teacherId: req.user.id })
      },
      include: {
        enrollments: {
          where: { status: 'ACTIVE' },
          include: {
            student: {
              include: {
                parentRelations: {
                  include: {
                    parent: { select: { id: true, lineUserId: true, preferredLang: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!classData) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CLASS_NOT_FOUND',
          message: 'Class not found',
          messageZh: '找不到班級'
        }
      });
    }

    // Create announcement message
    const message = await prisma.message.create({
      data: {
        senderId: req.user.id,
        classId,
        originalText: text,
        originalLang: sourceLang,
        translatedText,
        translatedLang: targetLang,
        isAnnouncement: true,
        attachments: attachments || []
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        class: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Send LINE notifications to all parents
    if (sendViaLine) {
      const lineUserIds = [];
      
      for (const enrollment of classData.enrollments) {
        for (const pr of enrollment.student.parentRelations) {
          if (pr.parent.lineUserId && !lineUserIds.includes(pr.parent.lineUserId)) {
            lineUserIds.push(pr.parent.lineUserId);
          }
        }
      }

      if (lineUserIds.length > 0) {
        try {
          const lineMessage = `【班級公告】\n` +
            `班級：${classData.name}\n` +
            `來自：${req.user.firstName} ${req.user.lastName}\n\n` +
            (sourceLang === 'zh-TW' ? text : translatedText || text);

          await lineService.sendMulticast(lineUserIds, lineMessage);
        } catch (error) {
          console.error('Failed to send LINE announcement:', error);
        }
      }
    }

    return res.status(201).json({
      success: true,
      data: { message, isAnnouncement: true }
    });
  }

  // Direct message
  // Verify recipient exists in same school
  const recipient = await prisma.user.findFirst({
    where: {
      id: recipientId,
      schoolId: req.user.schoolId
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      lineUserId: true,
      preferredLang: true
    }
  });

  if (!recipient) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'RECIPIENT_NOT_FOUND',
        message: 'Recipient not found',
        messageZh: '找不到收件人'
      }
    });
  }

  const message = await prisma.message.create({
    data: {
      senderId: req.user.id,
      recipientId,
      originalText: text,
      originalLang: sourceLang,
      translatedText,
      translatedLang: targetLang,
      sentViaLine: sendViaLine && !!recipient.lineUserId,
      attachments: attachments || []
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          lineProfileUrl: true
        }
      },
      recipient: {
        select: {
          id: true,
          firstName: true,
          lastName: true
        }
      }
    }
  });

  // Send via LINE if recipient has LINE account
  if (sendViaLine && recipient.lineUserId) {
    try {
      // Use translated text based on recipient's preference
      const lineText = recipient.preferredLang === sourceLang 
        ? text 
        : (translatedText || text);

      const lineMessage = `📩 來自 ${req.user.firstName} ${req.user.lastName} 的訊息：\n\n${lineText}`;
      
      await lineService.sendPushMessage(recipient.lineUserId, lineMessage);
    } catch (error) {
      console.error('Failed to send LINE message:', error);
    }
  }

  res.status(201).json({
    success: true,
    data: { message }
  });
}));

/**
 * PUT /api/messages/:id/read
 * Mark message as read
 */
router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const message = await prisma.message.findFirst({
    where: {
      id,
      recipientId: req.user.id
    }
  });

  if (!message) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
        messageZh: '找不到訊息'
      }
    });
  }

  if (!message.readAt) {
    await prisma.message.update({
      where: { id },
      data: { readAt: new Date() }
    });
  }

  res.json({
    success: true,
    data: {
      message: 'Message marked as read',
      messageZh: '訊息已標記為已讀'
    }
  });
}));

/**
 * PUT /api/messages/read-all
 * Mark all messages as read
 */
router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
  const { senderId } = req.body;

  const where = {
    recipientId: req.user.id,
    readAt: null
  };

  if (senderId) {
    where.senderId = senderId;
  }

  const result = await prisma.message.updateMany({
    where,
    data: { readAt: new Date() }
  });

  res.json({
    success: true,
    data: {
      message: `${result.count} messages marked as read`,
      messageZh: `${result.count} 則訊息已標記為已讀`,
      count: result.count
    }
  });
}));

/**
 * GET /api/messages/:id
 * Get single message with both original and translated text
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const message = await prisma.message.findFirst({
    where: {
      id,
      OR: [
        { senderId: req.user.id },
        { recipientId: req.user.id }
      ]
    },
    include: {
      sender: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          lineProfileUrl: true
        }
      },
      recipient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true
        }
      }
    }
  });

  if (!message) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found',
        messageZh: '找不到訊息'
      }
    });
  }

  // Mark as read if recipient
  if (message.recipientId === req.user.id && !message.readAt) {
    await prisma.message.update({
      where: { id },
      data: { readAt: new Date() }
    });
    message.readAt = new Date();
  }

  res.json({
    success: true,
    data: { message }
  });
}));

/**
 * DELETE /api/messages/:id
 * Delete a message (soft delete or hide)
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Only sender can delete their own message
  const message = await prisma.message.findFirst({
    where: {
      id,
      senderId: req.user.id
    }
  });

  if (!message) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'MESSAGE_NOT_FOUND',
        message: 'Message not found or you can only delete your own messages',
        messageZh: '找不到訊息或您只能刪除自己的訊息'
      }
    });
  }

  await prisma.message.delete({
    where: { id }
  });

  res.json({
    success: true,
    data: {
      message: 'Message deleted',
      messageZh: '訊息已刪除'
    }
  });
}));

export default router;
