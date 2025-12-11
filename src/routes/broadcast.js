// Broadcast Messaging Routes
// Multi-tenant LINE messaging with per-school credentials

import express from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Get LINE credentials for a school
 */
const getSchoolLineCredentials = async (schoolId) => {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      lineChannelId: true,
      lineChannelSecret: true,
      lineAccessToken: true
    }
  });

  if (!school?.lineAccessToken) {
    return null;
  }

  return {
    channelId: school.lineChannelId,
    channelSecret: school.lineChannelSecret,
    accessToken: school.lineAccessToken
  };
};

/**
 * Send LINE push message using school credentials
 */
const sendLineMessage = async (accessToken, lineUserId, messages) => {
  const messageArray = Array.isArray(messages) ? messages : [messages];
  
  const formattedMessages = messageArray.map(msg => {
    if (typeof msg === 'string') {
      return { type: 'text', text: msg };
    }
    return msg;
  });

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'LINE push failed');
  }

  return true;
};

/**
 * Send LINE multicast using school credentials (up to 500 users)
 */
const sendLineMulticast = async (accessToken, lineUserIds, messages) => {
  const messageArray = Array.isArray(messages) ? messages : [messages];
  
  const formattedMessages = messageArray.map(msg => {
    if (typeof msg === 'string') {
      return { type: 'text', text: msg };
    }
    return msg;
  });

  const response = await fetch('https://api.line.me/v2/bot/message/multicast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      to: lineUserIds,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'LINE multicast failed');
  }

  return true;
};

/**
 * Replace template placeholders with values
 */
const replacePlaceholders = (text, values) => {
  if (!text) return text;
  
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return result;
};

// ======================
// LINE STATUS
// ======================

// GET /api/broadcast/line/status - Check LINE API configuration
router.get('/line/status', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const credentials = await getSchoolLineCredentials(req.user.schoolId);

    if (!credentials) {
      return res.json({
        configured: false,
        message: 'LINE credentials not configured for this school'
      });
    }

    // Test the credentials by getting bot info
    const response = await fetch('https://api.line.me/v2/bot/info', {
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`
      }
    });

    if (!response.ok) {
      return res.json({
        configured: true,
        valid: false,
        message: 'LINE credentials are invalid or expired'
      });
    }

    const botInfo = await response.json();

    res.json({
      configured: true,
      valid: true,
      botName: botInfo.displayName,
      botId: botInfo.userId,
      pictureUrl: botInfo.pictureUrl
    });
  } catch (error) {
    console.error('LINE status check error:', error);
    res.status(500).json({ error: 'Failed to check LINE status' });
  }
});

// ======================
// TEMPLATES
// ======================

// GET /api/broadcast/templates - List all templates
router.get('/templates', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      where: { schoolId: req.user.schoolId },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: {
        createdBy: {
          select: { firstName: true, lastName: true }
        }
      }
    });

    res.json(templates);
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// GET /api/broadcast/templates/:id - Get single template
router.get('/templates/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const template = await prisma.messageTemplate.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId
      }
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(template);
  } catch (error) {
    console.error('Get template error:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// POST /api/broadcast/templates - Create template
router.post('/templates', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { type, name, nameChinese, subject, subjectChinese, body, bodyChinese, placeholders, isDefault } = req.body;

    if (!type || !name || !body) {
      return res.status(400).json({ error: 'Type, name, and body are required' });
    }

    // If setting as default, unset other defaults of same type
    if (isDefault) {
      await prisma.messageTemplate.updateMany({
        where: {
          schoolId: req.user.schoolId,
          type: type,
          isDefault: true
        },
        data: { isDefault: false }
      });
    }

    const template = await prisma.messageTemplate.create({
      data: {
        schoolId: req.user.schoolId,
        type,
        name,
        nameChinese,
        subject,
        subjectChinese,
        body,
        bodyChinese,
        placeholders: placeholders || [],
        isDefault: isDefault || false,
        createdById: req.user.id
      }
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// PUT /api/broadcast/templates/:id - Update template
router.put('/templates/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const existing = await prisma.messageTemplate.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const { name, nameChinese, subject, subjectChinese, body, bodyChinese, placeholders, isActive, isDefault } = req.body;

    // If setting as default, unset other defaults of same type
    if (isDefault && !existing.isDefault) {
      await prisma.messageTemplate.updateMany({
        where: {
          schoolId: req.user.schoolId,
          type: existing.type,
          isDefault: true
        },
        data: { isDefault: false }
      });
    }

    const template = await prisma.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        name,
        nameChinese,
        subject,
        subjectChinese,
        body,
        bodyChinese,
        placeholders,
        isActive,
        isDefault
      }
    });

    res.json(template);
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// DELETE /api/broadcast/templates/:id - Delete template
router.delete('/templates/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const existing = await prisma.messageTemplate.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId
      }
    });

    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await prisma.messageTemplate.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ======================
// RECIPIENT PREVIEW
// ======================

// GET /api/broadcast/recipients/preview - Preview recipients based on scope
router.get('/recipients/preview', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { scope, classIds } = req.query;

    let whereClause = {
      schoolId: req.user.schoolId,
      role: 'PARENT',
      isActive: true,
      lineUserId: { not: null }
    };

    let parents;

    if (scope === 'CLASS_PARENTS' && classIds) {
      const classIdArray = classIds.split(',');
      
      // Get parents of students in these classes
      parents = await prisma.user.findMany({
        where: {
          ...whereClause,
          parentRelations: {
            some: {
              student: {
                enrollments: {
                  some: {
                    classId: { in: classIdArray },
                    status: 'ACTIVE'
                  }
                }
              }
            }
          }
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          lineDisplayName: true,
          parentRelations: {
            select: {
              student: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });
    } else {
      // ALL_PARENTS
      parents = await prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          lineDisplayName: true,
          parentRelations: {
            select: {
              student: {
                select: {
                  firstName: true,
                  lastName: true
                }
              }
            }
          }
        }
      });
    }

    res.json({
      count: parents.length,
      recipients: parents.map(p => ({
        id: p.id,
        name: `${p.lastName}${p.firstName}`,
        lineDisplayName: p.lineDisplayName,
        students: p.parentRelations.map(pr => `${pr.student.lastName}${pr.student.firstName}`)
      }))
    });
  } catch (error) {
    console.error('Preview recipients error:', error);
    res.status(500).json({ error: 'Failed to preview recipients' });
  }
});

// GET /api/broadcast/classes - Get classes for selection
router.get('/classes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const classes = await prisma.class.findMany({
      where: { schoolId: req.user.schoolId },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            enrollments: {
              where: { status: 'ACTIVE' }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(classes.map(c => ({
      id: c.id,
      name: c.name,
      studentCount: c._count.enrollments
    })));
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// ======================
// BROADCAST MESSAGES
// ======================

// GET /api/broadcast/messages - List broadcasts
router.get('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { status, limit = 20, offset = 0 } = req.query;

    const where = { schoolId: req.user.schoolId };
    if (status) {
      where.status = status;
    }

    const [broadcasts, total] = await Promise.all([
      prisma.broadcastMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: {
          createdBy: {
            select: { firstName: true, lastName: true }
          },
          template: {
            select: { name: true, type: true }
          }
        }
      }),
      prisma.broadcastMessage.count({ where })
    ]);

    res.json({ broadcasts, total });
  } catch (error) {
    console.error('Get broadcasts error:', error);
    res.status(500).json({ error: 'Failed to fetch broadcasts' });
  }
});

// GET /api/broadcast/messages/:id - Get broadcast details
router.get('/messages/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const broadcast = await prisma.broadcastMessage.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId
      },
      include: {
        createdBy: {
          select: { firstName: true, lastName: true }
        },
        template: true,
        recipients: {
          include: {
            parent: {
              select: { firstName: true, lastName: true, lineDisplayName: true }
            },
            student: {
              select: { firstName: true, lastName: true }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 100
        }
      }
    });

    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast not found' });
    }

    res.json(broadcast);
  } catch (error) {
    console.error('Get broadcast error:', error);
    res.status(500).json({ error: 'Failed to fetch broadcast' });
  }
});

// POST /api/broadcast/messages - Create broadcast (draft or send immediately)
router.post('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      subject,
      subjectChinese,
      body,
      bodyChinese,
      scope,
      targetClassIds,
      templateId,
      calendarEventId,
      sendNow
    } = req.body;

    if (!body || !scope) {
      return res.status(400).json({ error: 'Body and scope are required' });
    }

    // Create the broadcast
    const broadcast = await prisma.broadcastMessage.create({
      data: {
        schoolId: req.user.schoolId,
        subject,
        subjectChinese,
        body,
        bodyChinese,
        scope,
        targetClassIds: targetClassIds || [],
        templateId,
        calendarEventId,
        status: sendNow ? 'SENDING' : 'DRAFT',
        createdById: req.user.id
      }
    });

    // If sendNow, trigger sending in background
    if (sendNow) {
      sendBroadcastInBackground(broadcast.id, req.user.schoolId);
    }

    res.status(201).json(broadcast);
  } catch (error) {
    console.error('Create broadcast error:', error);
    res.status(500).json({ error: 'Failed to create broadcast' });
  }
});

// POST /api/broadcast/messages/:id/send - Send a draft broadcast
router.post('/messages/:id/send', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const broadcast = await prisma.broadcastMessage.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
        status: 'DRAFT'
      }
    });

    if (!broadcast) {
      return res.status(404).json({ error: 'Draft broadcast not found' });
    }

    // Update status
    await prisma.broadcastMessage.update({
      where: { id: broadcast.id },
      data: { status: 'SENDING' }
    });

    // Send in background
    sendBroadcastInBackground(broadcast.id, req.user.schoolId);

    res.json({ success: true, message: 'Broadcast sending started' });
  } catch (error) {
    console.error('Send broadcast error:', error);
    res.status(500).json({ error: 'Failed to send broadcast' });
  }
});

// DELETE /api/broadcast/messages/:id - Delete a draft broadcast
router.delete('/messages/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const broadcast = await prisma.broadcastMessage.findFirst({
      where: {
        id: req.params.id,
        schoolId: req.user.schoolId,
        status: 'DRAFT'
      }
    });

    if (!broadcast) {
      return res.status(404).json({ error: 'Draft broadcast not found' });
    }

    await prisma.broadcastMessage.delete({
      where: { id: broadcast.id }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete broadcast error:', error);
    res.status(500).json({ error: 'Failed to delete broadcast' });
  }
});

// ======================
// BACKGROUND SENDING
// ======================

/**
 * Send broadcast in background (non-blocking)
 */
const sendBroadcastInBackground = async (broadcastId, schoolId) => {
  try {
    // Get credentials
    const credentials = await getSchoolLineCredentials(schoolId);
    if (!credentials) {
      await prisma.broadcastMessage.update({
        where: { id: broadcastId },
        data: {
          status: 'FAILED',
          completedAt: new Date()
        }
      });
      return;
    }

    // Get broadcast details
    const broadcast = await prisma.broadcastMessage.findUnique({
      where: { id: broadcastId }
    });

    // Get recipients based on scope
    let parents;
    const baseWhere = {
      schoolId,
      role: 'PARENT',
      isActive: true,
      lineUserId: { not: null }
    };

    if (broadcast.scope === 'CLASS_PARENTS' && broadcast.targetClassIds?.length > 0) {
      parents = await prisma.user.findMany({
        where: {
          ...baseWhere,
          parentRelations: {
            some: {
              student: {
                enrollments: {
                  some: {
                    classId: { in: broadcast.targetClassIds },
                    status: 'ACTIVE'
                  }
                }
              }
            }
          }
        },
        select: {
          id: true,
          lineUserId: true,
          parentRelations: {
            select: {
              studentId: true
            },
            take: 1
          }
        }
      });
    } else {
      parents = await prisma.user.findMany({
        where: baseWhere,
        select: {
          id: true,
          lineUserId: true,
          parentRelations: {
            select: {
              studentId: true
            },
            take: 1
          }
        }
      });
    }

    // Update total recipients
    await prisma.broadcastMessage.update({
      where: { id: broadcastId },
      data: {
        totalRecipients: parents.length,
        sentAt: new Date()
      }
    });

    if (parents.length === 0) {
      await prisma.broadcastMessage.update({
        where: { id: broadcastId },
        data: {
          status: 'SENT',
          completedAt: new Date()
        }
      });
      return;
    }

    // Create recipient records
    await prisma.broadcastRecipient.createMany({
      data: parents.map(p => ({
        broadcastId,
        parentId: p.id,
        studentId: p.parentRelations[0]?.studentId || null,
        status: 'PENDING'
      }))
    });

    // Send in batches of 500 (LINE multicast limit)
    const batchSize = 500;
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < parents.length; i += batchSize) {
      const batch = parents.slice(i, i + batchSize);
      const lineUserIds = batch.map(p => p.lineUserId);

      try {
        await sendLineMulticast(credentials.accessToken, lineUserIds, broadcast.body);

        // Mark as sent
        const batchParentIds = batch.map(p => p.id);
        await prisma.broadcastRecipient.updateMany({
          where: {
            broadcastId,
            parentId: { in: batchParentIds }
          },
          data: {
            status: 'SENT',
            sentAt: new Date()
          }
        });

        sentCount += batch.length;
      } catch (error) {
        console.error('Batch send error:', error);

        // Mark as failed
        const batchParentIds = batch.map(p => p.id);
        await prisma.broadcastRecipient.updateMany({
          where: {
            broadcastId,
            parentId: { in: batchParentIds }
          },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            failureReason: error.message
          }
        });

        failedCount += batch.length;
      }

      // Update progress
      await prisma.broadcastMessage.update({
        where: { id: broadcastId },
        data: {
          sentCount,
          failedCount
        }
      });
    }

    // Final status
    const finalStatus = failedCount === 0 ? 'SENT' : 
                        sentCount === 0 ? 'FAILED' : 
                        'PARTIAL_FAILURE';

    await prisma.broadcastMessage.update({
      where: { id: broadcastId },
      data: {
        status: finalStatus,
        completedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Background send error:', error);
    
    await prisma.broadcastMessage.update({
      where: { id: broadcastId },
      data: {
        status: 'FAILED',
        completedAt: new Date()
      }
    });
  }
};

export default router;