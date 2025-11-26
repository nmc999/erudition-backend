// LINE Integration Service
// Handles LINE Login OAuth and Messaging API

import crypto from 'crypto';

const LINE_LOGIN_CHANNEL_ID = process.env.LINE_LOGIN_CHANNEL_ID;
const LINE_LOGIN_CHANNEL_SECRET = process.env.LINE_LOGIN_CHANNEL_SECRET;
const LINE_MESSAGING_CHANNEL_SECRET = process.env.LINE_MESSAGING_CHANNEL_SECRET;
const LINE_MESSAGING_ACCESS_TOKEN = process.env.LINE_MESSAGING_ACCESS_TOKEN;
const LINE_REDIRECT_URI = process.env.LINE_REDIRECT_URI || 'http://localhost:5173/auth/line/callback';

// ======================
// LINE LOGIN (OAuth)
// ======================

/**
 * Generate LINE Login authorization URL
 */
export const getLineLoginUrl = (state) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_LOGIN_CHANNEL_ID,
    redirect_uri: LINE_REDIRECT_URI,
    state: state,
    scope: 'profile openid email',
    nonce: crypto.randomBytes(16).toString('hex')
  });

  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
};

/**
 * Exchange authorization code for access token
 */
export const exchangeCodeForToken = async (code) => {
  const response = await fetch('https://api.line.me/oauth2/v2.1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: LINE_REDIRECT_URI,
      client_id: LINE_LOGIN_CHANNEL_ID,
      client_secret: LINE_LOGIN_CHANNEL_SECRET
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`LINE token exchange failed: ${error.error_description || error.error}`);
  }

  return response.json();
};

/**
 * Get LINE user profile using access token
 */
export const getLineProfile = async (accessToken) => {
  const response = await fetch('https://api.line.me/v2/profile', {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get LINE profile');
  }

  return response.json();
};

/**
 * Verify ID token from LINE Login
 */
export const verifyIdToken = async (idToken) => {
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      id_token: idToken,
      client_id: LINE_LOGIN_CHANNEL_ID
    })
  });

  if (!response.ok) {
    throw new Error('Failed to verify LINE ID token');
  }

  return response.json();
};

// ======================
// LINE MESSAGING API
// ======================

/**
 * Verify LINE webhook signature
 */
export const verifyWebhookSignature = (body, signature) => {
  const channelSecret = LINE_MESSAGING_CHANNEL_SECRET;
  
  const hash = crypto
    .createHmac('sha256', channelSecret)
    .update(body)
    .digest('base64');

  return hash === signature;
};

/**
 * Send push message to a user via LINE
 */
export const sendPushMessage = async (lineUserId, messages) => {
  // Ensure messages is an array
  const messageArray = Array.isArray(messages) ? messages : [messages];
  
  // Format messages for LINE API
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
      'Authorization': `Bearer ${LINE_MESSAGING_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('LINE push message failed:', error);
    throw new Error(`LINE push message failed: ${error.message || 'Unknown error'}`);
  }

  return true;
};

/**
 * Send reply message in response to a webhook event
 */
export const sendReplyMessage = async (replyToken, messages) => {
  const messageArray = Array.isArray(messages) ? messages : [messages];
  
  const formattedMessages = messageArray.map(msg => {
    if (typeof msg === 'string') {
      return { type: 'text', text: msg };
    }
    return msg;
  });

  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LINE_MESSAGING_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('LINE reply message failed:', error);
    throw new Error(`LINE reply message failed: ${error.message || 'Unknown error'}`);
  }

  return true;
};

/**
 * Send multicast message to multiple users
 */
export const sendMulticast = async (lineUserIds, messages) => {
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
      'Authorization': `Bearer ${LINE_MESSAGING_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      to: lineUserIds,
      messages: formattedMessages
    })
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('LINE multicast failed:', error);
    throw new Error(`LINE multicast failed: ${error.message || 'Unknown error'}`);
  }

  return true;
};

/**
 * Get user profile from Messaging API
 */
export const getMessagingProfile = async (lineUserId) => {
  const response = await fetch(`https://api.line.me/v2/bot/profile/${lineUserId}`, {
    headers: {
      'Authorization': `Bearer ${LINE_MESSAGING_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to get LINE profile from Messaging API');
  }

  return response.json();
};

// ======================
// MESSAGE TEMPLATES
// ======================

/**
 * Create attendance notification message
 */
export const createAttendanceNotification = (studentName, className, date, status, reason) => {
  const statusMap = {
    PRESENT: { en: 'Present', zh: '出席' },
    ABSENT: { en: 'Absent', zh: '缺席' },
    LATE: { en: 'Late', zh: '遲到' },
    EXCUSED: { en: 'Excused', zh: '請假' },
    EARLY_LEAVE: { en: 'Early Leave', zh: '早退' }
  };

  const statusText = statusMap[status] || { en: status, zh: status };
  const formattedDate = new Date(date).toLocaleDateString('zh-TW');

  let message = `【出席通知】\n`;
  message += `學生：${studentName}\n`;
  message += `班級：${className}\n`;
  message += `日期：${formattedDate}\n`;
  message += `狀態：${statusText.zh}`;
  
  if (reason) {
    message += `\n原因：${reason}`;
  }

  return message;
};

/**
 * Create homework reminder message
 */
export const createHomeworkReminder = (studentName, homeworkTitle, dueDate, className) => {
  const formattedDue = new Date(dueDate).toLocaleDateString('zh-TW', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let message = `【作業提醒】\n`;
  message += `學生：${studentName}\n`;
  message += `班級：${className}\n`;
  message += `作業：${homeworkTitle}\n`;
  message += `截止日期：${formattedDue}\n`;
  message += `記得準時完成喔！`;

  return message;
};

/**
 * Create payment reminder message
 */
export const createPaymentReminder = (studentName, amount, dueDate) => {
  const formattedDue = new Date(dueDate).toLocaleDateString('zh-TW');
  const formattedAmount = new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0
  }).format(amount);

  let message = `【繳費提醒】\n`;
  message += `學生：${studentName}\n`;
  message += `金額：${formattedAmount}\n`;
  message += `截止日期：${formattedDue}\n`;
  message += `請儘快完成繳費，謝謝！`;

  return message;
};

export default {
  // OAuth
  getLineLoginUrl,
  exchangeCodeForToken,
  getLineProfile,
  verifyIdToken,
  
  // Messaging
  verifyWebhookSignature,
  sendPushMessage,
  sendReplyMessage,
  sendMulticast,
  getMessagingProfile,
  
  // Templates
  createAttendanceNotification,
  createHomeworkReminder,
  createPaymentReminder
};
