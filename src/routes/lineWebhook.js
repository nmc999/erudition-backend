// LINE Webhook Handler
// Processes incoming LINE messages and events

import { Router } from 'express';
import prisma from '../config/database.js';
import lineService from '../services/lineService.js';
import translationService from '../services/translationService.js';

const router = Router();

/**
 * POST /api/webhook/line
 * Receive LINE webhook events
 * Note: Body is raw buffer for signature verification
 */
router.post('/', async (req, res) => {
  // Get signature from header
  const signature = req.headers['x-line-signature'];
  
  if (!signature) {
    console.log('Missing LINE signature');
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Get raw body as string for signature verification
  const body = req.body.toString();

  // Verify signature
  if (!lineService.verifyWebhookSignature(body, signature)) {
    console.log('Invalid LINE signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse the body
  let events;
  try {
    const parsed = JSON.parse(body);
    events = parsed.events || [];
  } catch (error) {
    console.error('Failed to parse LINE webhook body:', error);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // Respond immediately to LINE (they expect 200 within 1 second)
  res.status(200).json({ success: true });

  // Process events asynchronously
  for (const event of events) {
    try {
      await handleLineEvent(event);
    } catch (error) {
      console.error('Error handling LINE event:', error);
    }
  }
});

/**
 * Handle individual LINE event
 */
async function handleLineEvent(event) {
  console.log('LINE Event:', event.type, event);

  switch (event.type) {
    case 'message':
      await handleMessageEvent(event);
      break;
      
    case 'follow':
      await handleFollowEvent(event);
      break;
      
    case 'unfollow':
      await handleUnfollowEvent(event);
      break;
      
    case 'postback':
      await handlePostbackEvent(event);
      break;
      
    default:
      console.log('Unhandled event type:', event.type);
  }
}

/**
 * Handle incoming message from LINE
 */
async function handleMessageEvent(event) {
  const { source, message, replyToken } = event;
  const lineUserId = source.userId;

  if (!lineUserId) {
    console.log('No userId in message event');
    return;
  }

  // Find user by LINE ID
  const user = await prisma.user.findUnique({
    where: { lineUserId },
    include: {
      school: {
        select: { id: true, name: true }
      }
    }
  });

  if (!user) {
    // User not registered - send welcome/registration message
    await lineService.sendReplyMessage(replyToken, [
      {
        type: 'text',
        text: '您好！歡迎使用 Erudition 教育管理系統。\n\n' +
              'Hello! Welcome to Erudition Education Management System.\n\n' +
              '請先透過網頁或應用程式完成註冊，然後連結您的 LINE 帳號。\n' +
              'Please register through our website or app first, then link your LINE account.'
      }
    ]);
    return;
  }

  // Handle text messages
  if (message.type === 'text') {
    await handleTextMessage(user, message.text, replyToken);
  } else if (message.type === 'image') {
    await handleImageMessage(user, message, replyToken);
  } else {
    // Unsupported message type
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '目前僅支援文字訊息。\nCurrently only text messages are supported.'
    });
  }
}

/**
 * Handle text message from user
 */
async function handleTextMessage(user, text, replyToken) {
  const lowerText = text.toLowerCase().trim();

  // Check for commands
  if (lowerText === '出席' || lowerText === 'attendance') {
    await sendAttendanceSummary(user, replyToken);
    return;
  }

  if (lowerText === '作業' || lowerText === 'homework') {
    await sendHomeworkSummary(user, replyToken);
    return;
  }

  if (lowerText === '幫助' || lowerText === 'help') {
    await sendHelpMessage(user, replyToken);
    return;
  }

  // Regular message - forward to school/teacher
  // Detect language and translate
  const sourceLang = translationService.detectLanguage(text);
  const targetLang = sourceLang === 'zh-TW' ? 'en' : 'zh-TW';
  
  let translatedText = null;
  try {
    translatedText = await translationService.translateText(text, sourceLang, targetLang);
  } catch (error) {
    console.error('Translation error:', error);
  }

  // If parent, find their children's teachers
  if (user.role === 'PARENT') {
    const parentStudents = await prisma.parentStudent.findMany({
      where: { parentId: user.id },
      include: {
        student: {
          include: {
            enrollments: {
              where: { status: 'ACTIVE' },
              include: {
                class: {
                  include: {
                    teacher: {
                      select: { id: true, firstName: true, lastName: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    // Get unique teachers
    const teachers = new Map();
    parentStudents.forEach(ps => {
      ps.student.enrollments.forEach(e => {
        if (e.class.teacher) {
          teachers.set(e.class.teacher.id, e.class.teacher);
        }
      });
    });

    if (teachers.size === 0) {
      await lineService.sendReplyMessage(replyToken, {
        type: 'text',
        text: '找不到您孩子的老師。請先確認孩子已加入班級。\n' +
              'No teachers found for your children. Please ensure your child is enrolled in a class.'
      });
      return;
    }

    // Save message and notify we've received it
    for (const [teacherId, teacher] of teachers) {
      await prisma.message.create({
        data: {
          senderId: user.id,
          recipientId: teacherId,
          originalText: text,
          originalLang: sourceLang,
          translatedText,
          translatedLang: targetLang,
          sentViaLine: true,
          lineMessageId: replyToken
        }
      });
    }

    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: `訊息已送達！老師們會盡快回覆您。\n` +
            `Message sent! Teachers will reply soon.\n\n` +
            `已發送給 ${teachers.size} 位老師。\nSent to ${teachers.size} teacher(s).`
    });
  } else {
    // For teachers/admins - just acknowledge
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '訊息已收到。請使用 Erudition 應用程式發送訊息給家長。\n' +
            'Message received. Please use the Erudition app to send messages to parents.'
    });
  }
}

/**
 * Handle image message
 */
async function handleImageMessage(user, message, replyToken) {
  await lineService.sendReplyMessage(replyToken, {
    type: 'text',
    text: '已收到您的圖片！目前圖片需透過應用程式上傳。\n' +
          'Image received! Please upload images through the app for now.'
  });
}

/**
 * Send attendance summary for parent's children
 */
async function sendAttendanceSummary(user, replyToken) {
  if (user.role !== 'PARENT') {
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '此功能僅供家長使用。\nThis feature is for parents only.'
    });
    return;
  }

  // Get parent's children
  const parentStudents = await prisma.parentStudent.findMany({
    where: { parentId: user.id },
    include: {
      student: {
        include: {
          attendance: {
            where: {
              date: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
              }
            },
            include: {
              class: { select: { name: true } }
            },
            orderBy: { date: 'desc' },
            take: 10
          }
        }
      }
    }
  });

  if (parentStudents.length === 0) {
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '找不到您的孩子資料。\nNo children found for your account.'
    });
    return;
  }

  let summary = '📊 出席記錄 (過去7天)\nAttendance Summary (Last 7 days)\n\n';

  for (const ps of parentStudents) {
    const student = ps.student;
    summary += `👤 ${student.firstName} ${student.lastName}\n`;
    
    if (student.attendance.length === 0) {
      summary += '   無記錄 No records\n\n';
    } else {
      for (const att of student.attendance.slice(0, 5)) {
        const date = new Date(att.date).toLocaleDateString('zh-TW');
        const statusEmoji = {
          'PRESENT': '✅',
          'ABSENT': '❌',
          'LATE': '⏰',
          'EXCUSED': '📝',
          'EARLY_LEAVE': '🚶'
        }[att.status] || '❓';
        summary += `   ${date} ${att.class.name}: ${statusEmoji}\n`;
      }
      summary += '\n';
    }
  }

  await lineService.sendReplyMessage(replyToken, {
    type: 'text',
    text: summary
  });
}

/**
 * Send homework summary for parent's children
 */
async function sendHomeworkSummary(user, replyToken) {
  if (user.role !== 'PARENT') {
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '此功能僅供家長使用。\nThis feature is for parents only.'
    });
    return;
  }

  // Get parent's children and their pending homework
  const parentStudents = await prisma.parentStudent.findMany({
    where: { parentId: user.id },
    include: {
      student: {
        include: {
          enrollments: {
            where: { status: 'ACTIVE' },
            include: {
              class: {
                include: {
                  homework: {
                    where: {
                      dueDate: { gte: new Date() }
                    },
                    orderBy: { dueDate: 'asc' },
                    take: 5
                  }
                }
              }
            }
          },
          homeworkSubmissions: {
            select: { homeworkId: true }
          }
        }
      }
    }
  });

  if (parentStudents.length === 0) {
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: '找不到您的孩子資料。\nNo children found for your account.'
    });
    return;
  }

  let summary = '📚 待完成作業\nPending Homework\n\n';

  for (const ps of parentStudents) {
    const student = ps.student;
    const submittedIds = new Set(student.homeworkSubmissions.map(s => s.homeworkId));
    
    summary += `👤 ${student.firstName} ${student.lastName}\n`;
    
    let hasHomework = false;
    for (const enrollment of student.enrollments) {
      for (const hw of enrollment.class.homework) {
        if (!submittedIds.has(hw.id)) {
          hasHomework = true;
          const dueDate = new Date(hw.dueDate).toLocaleDateString('zh-TW');
          summary += `   📝 ${hw.title}\n`;
          summary += `      班級: ${enrollment.class.name}\n`;
          summary += `      截止: ${dueDate}\n\n`;
        }
      }
    }

    if (!hasHomework) {
      summary += '   ✅ 所有作業已完成！All homework done!\n\n';
    }
  }

  await lineService.sendReplyMessage(replyToken, {
    type: 'text',
    text: summary
  });
}

/**
 * Send help message
 */
async function sendHelpMessage(user, replyToken) {
  const helpText = `🎓 Erudition 指令說明\nCommand Guide\n\n` +
    `📊 出席 / attendance\n` +
    `   查看出席記錄\n   View attendance records\n\n` +
    `📚 作業 / homework\n` +
    `   查看待完成作業\n   View pending homework\n\n` +
    `💬 直接輸入訊息\n   Direct message\n` +
    `   發送訊息給老師\n   Send message to teachers\n\n` +
    `❓ 幫助 / help\n` +
    `   顯示此說明\n   Show this guide`;

  await lineService.sendReplyMessage(replyToken, {
    type: 'text',
    text: helpText
  });
}

/**
 * Handle new follower
 */
async function handleFollowEvent(event) {
  const lineUserId = event.source.userId;
  const replyToken = event.replyToken;

  // Check if user exists
  const user = await prisma.user.findUnique({
    where: { lineUserId }
  });

  if (user) {
    // Existing user - welcome back
    await lineService.sendReplyMessage(replyToken, {
      type: 'text',
      text: `歡迎回來，${user.firstName}！\n` +
            `Welcome back, ${user.firstName}!\n\n` +
            `輸入「幫助」或「help」查看可用指令。\n` +
            `Type "help" to see available commands.`
    });
  } else {
    // New follower - registration prompt
    await lineService.sendReplyMessage(replyToken, [
      {
        type: 'text',
        text: '歡迎加入 Erudition！🎓\n' +
              'Welcome to Erudition!\n\n' +
              '請先透過我們的網站或應用程式完成註冊，' +
              '然後在設定中連結您的 LINE 帳號。\n\n' +
              'Please register through our website or app first, ' +
              'then link your LINE account in settings.'
      }
    ]);
  }
}

/**
 * Handle unfollow (user blocked the bot)
 */
async function handleUnfollowEvent(event) {
  const lineUserId = event.source.userId;
  
  // Optionally update user record
  const user = await prisma.user.findUnique({
    where: { lineUserId }
  });

  if (user) {
    console.log(`User ${user.id} unfollowed LINE bot`);
    // Could clear LINE credentials or mark for follow-up
  }
}

/**
 * Handle postback events (from buttons/quick replies)
 */
async function handlePostbackEvent(event) {
  const { postback, replyToken, source } = event;
  const lineUserId = source.userId;
  const data = new URLSearchParams(postback.data);
  const action = data.get('action');

  console.log('Postback action:', action, data);

  const user = await prisma.user.findUnique({
    where: { lineUserId }
  });

  if (!user) {
    return;
  }

  switch (action) {
    case 'view_attendance':
      await sendAttendanceSummary(user, replyToken);
      break;
      
    case 'view_homework':
      await sendHomeworkSummary(user, replyToken);
      break;
      
    default:
      await lineService.sendReplyMessage(replyToken, {
        type: 'text',
        text: '未知的操作。\nUnknown action.'
      });
  }
}

export default router;
