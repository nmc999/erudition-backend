// Messages Routes
// Two-way messaging with LINE integration

import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Send LINE message using school credentials
 */
const sendLineMessage = async (schoolId, lineUserId, text) => {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { lineAccessToken: true }
  });

  if (!school?.lineAccessToken) {
    console.error('No LINE access token for school');
    return false;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${school.lineAccessToken}`
      },
      body: JSON.stringify({
        to: lineUserId,
        messages: [{ type: 'text', text }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('LINE push failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('LINE send error:', error);
    return false;
  }
};

/**
 * Simple language detection
 */
const detectLanguage = (text) => {
  const chineseRegex = /[\u4e00-\u9fff]/;
  return chineseRegex.test(text) ? 'zh-TW' : 'en';
};

// ======================
// CONVERSATIONS
// ======================

// GET /api/messages/conversations - Get all conversations
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.id;
    const schoolId = req.user.schoolId;
    const isStaff = ['ADMIN', 'MANAGER', 'TEACHER'].includes(req.user.role);

    // Get all messages involving this user
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId },
          { recipientId: userId },
          // Staff can see all LINE messages for their school
          ...(isStaff ? [{
            sender: { schoolId },
            threadId: { startsWith: 'line-' }
          }] : [])
        ]
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            lineDisplayName: true,
            lineProfileUrl: true,
            lineUserId: true
          }
        },
        recipient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            lineDisplayName: true,
            lineProfileUrl: true,
            lineUserId: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Group by conversation (threadId or sender-recipient pair)
    const conversationsMap = new Map();

    for (const msg of messages) {
      // Determine conversation key
      let convKey;
      let otherUser;

      if (msg.threadId?.startsWith('line-')) {
        // LINE conversation - group by threadId
        convKey = msg.threadId;
        // The "other user" is the parent (the LINE user)
        const parentId = msg.threadId.replace('line-', '');
        otherUser = msg.senderId === parentId ? msg.sender : msg.recipient;
        if (!otherUser || otherUser.id !== parentId) {
          // Find the parent user
          otherUser = msg.sender?.role === 'PARENT' ? msg.sender : msg.recipient;
        }
      } else {
        // Regular conversation - group by user pair
        const otherId = msg.senderId === userId ? msg.recipientId : msg.senderId;
        convKey = [userId, otherId].sort().join('-');
        otherUser = msg.senderId === userId ? msg.recipient : msg.sender;
      }

      if (!convKey || !otherUser) continue;

      if (!conversationsMap.has(convKey)) {
        conversationsMap.set(convKey, {
          id: convKey,
          threadId: msg.threadId,
          otherUser: {
            id: otherUser.id,
            name: `${otherUser.lastName}${otherUser.firstName}`,
            firstName: otherUser.firstName,
            lastName: otherUser.lastName,
            role: otherUser.role,
            lineDisplayName: otherUser.lineDisplayName,
            lineProfileUrl: otherUser.lineProfileUrl,
            hasLine: !!otherUser.lineUserId
          },
          lastMessage: msg.originalText,
          lastMessageAt: msg.createdAt,
          isLine: msg.threadId?.startsWith('line-') || msg.sentViaLine,
          unreadCount: 0
        });
      }

      // Count unread
      if (!msg.readAt && msg.recipientId === userId) {
        const conv = conversationsMap.get(convKey);
        conv.unreadCount++;
      }
    }

    // Sort by last message time
    const conversations = Array.from(conversationsMap.values())
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    res.json(conversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/messages/conversation/:id - Get messages in a conversation
router.get('/conversation/:id', async (req, res) => {
  try {
    const userId = req.user.id;
    const convId = req.params.id;
    const isStaff = ['ADMIN', 'MANAGER', 'TEACHER'].includes(req.user.role);

    let whereClause;

    if (convId.startsWith('line-')) {
      // LINE conversation
      whereClause = { threadId: convId };
    } else {
      // Regular conversation (user pair)
      const [user1, user2] = convId.split('-');
      whereClause = {
        OR: [
          { senderId: user1, recipientId: user2 },
          { senderId: user2, recipientId: user1 }
        ]
      };
    }

    const messages = await prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            lineDisplayName: true,
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
      },
      orderBy: { createdAt: 'asc' }
    });

    // Mark as read
    const unreadIds = messages
      .filter(m => !m.readAt && m.recipientId === userId)
      .map(m => m.id);

    if (unreadIds.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: unreadIds } },
        data: { readAt: new Date() }
      });
    }

    res.json(messages);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ======================
// SEND MESSAGE
// ======================

// POST /api/messages/send - Send a message
router.post('/send', async (req, res) => {
  try {
    const { recipientId, text, threadId } = req.body;
    const senderId = req.user.id;
    const schoolId = req.user.schoolId;

    if (!recipientId || !text) {
      return res.status(400).json({ error: 'Recipient and text are required' });
    }

    // Get recipient info
    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: {
        id: true,
        lineUserId: true,
        schoolId: true,
        role: true,
        firstName: true,
        lastName: true
      }
    });

    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    // Determine thread ID
    let messageThreadId = threadId;
    if (!messageThreadId && recipient.lineUserId && recipient.role === 'PARENT') {
      // This is a reply to a LINE user
      messageThreadId = `line-${recipient.id}`;
    }

    // Create message in database
    const message = await prisma.message.create({
      data: {
        senderId,
        recipientId,
        originalText: text,
        originalLang: detectLanguage(text),
        threadId: messageThreadId,
        sentViaLine: false // Will update if LINE send succeeds
      },
      include: {
        sender: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true
          }
        },
        recipient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
            lineUserId: true
          }
        }
      }
    });

    // If recipient has LINE connected, also send via LINE
    if (recipient.lineUserId) {
      const senderName = `${req.user.lastName}${req.user.firstName}`;
      const lineText = `💬 ${senderName}老師：\n${text}`;
      
      const lineSent = await sendLineMessage(schoolId, recipient.lineUserId, lineText);
      
      if (lineSent) {
        await prisma.message.update({
          where: { id: message.id },
          data: { sentViaLine: true }
        });
        message.sentViaLine = true;
      }
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ======================
// PARENTS LIST (for new conversation)
// ======================

// GET /api/messages/parents - Get list of parents to message
router.get('/parents', authorize('ADMIN', 'MANAGER', 'TEACHER'), async (req, res) => {
  try {
    const schoolId = req.user.schoolId;

    const parents = await prisma.user.findMany({
      where: {
        schoolId,
        role: 'PARENT',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        lineUserId: true,
        lineDisplayName: true,
        parentRelations: {
          select: {
            student: {
              select: {
                firstName: true,
                lastName: true,
                englishName: true
              }
            }
          }
        }
      },
      orderBy: { lastName: 'asc' }
    });

    res.json(parents.map(p => ({
      id: p.id,
      name: `${p.lastName}${p.firstName}`,
      firstName: p.firstName,
      lastName: p.lastName,
      hasLine: !!p.lineUserId,
      lineDisplayName: p.lineDisplayName,
      students: p.parentRelations.map(pr => ({
        name: `${pr.student.lastName}${pr.student.firstName}`,
        englishName: pr.student.englishName
      }))
    })));
  } catch (error) {
    console.error('Get parents error:', error);
    res.status(500).json({ error: 'Failed to fetch parents' });
  }
});

// ======================
// UNREAD COUNT
// ======================

// GET /api/messages/unread-count - Get total unread count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await prisma.message.count({
      where: {
        recipientId: req.user.id,
        readAt: null
      }
    });

    res.json({ count });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

export default router;