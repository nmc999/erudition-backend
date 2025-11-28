// Email Integration Routes
// Handles OAuth connections to Gmail and Outlook

import { Router } from 'express';
import prisma from '../config/database.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// OAuth Configuration (would come from environment in production)
const OAUTH_CONFIG = {
  GMAIL: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://erudition.com.tw/api/email/callback/gmail',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  },
  OUTLOOK: {
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'https://erudition.com.tw/api/email/callback/outlook',
    scopes: [
      'offline_access',
      'Mail.Read',
      'Mail.Send',
      'User.Read'
    ]
  }
};

/**
 * GET /api/email/integrations
 * Get user's email integrations
 */
router.get('/integrations', authenticate, asyncHandler(async (req, res) => {
  const integrations = await prisma.emailIntegration.findMany({
    where: { userId: req.user.id },
    select: {
      id: true,
      provider: true,
      email: true,
      isActive: true,
      lastSyncAt: true,
      createdAt: true
    }
  });

  res.json({
    success: true,
    data: { integrations }
  });
}));

/**
 * GET /api/email/connect/:provider
 * Get OAuth authorization URL
 */
router.get('/connect/:provider', authenticate, asyncHandler(async (req, res) => {
  const { provider } = req.params;
  const providerUpper = provider.toUpperCase();

  if (!['GMAIL', 'OUTLOOK'].includes(providerUpper)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid provider. Use gmail or outlook.', messageZh: '無效的提供者，請使用 gmail 或 outlook' }
    });
  }

  const config = OAUTH_CONFIG[providerUpper];
  
  if (!config.clientId) {
    return res.status(503).json({
      success: false,
      error: { 
        message: `${provider} integration is not configured. Please contact support.`,
        messageZh: `${provider} 整合尚未設定，請聯繫客服`
      }
    });
  }

  // Generate state token for CSRF protection
  const state = Buffer.from(JSON.stringify({
    userId: req.user.id,
    schoolId: req.user.schoolId,
    timestamp: Date.now()
  })).toString('base64');

  let authUrl;

  if (providerUpper === 'GMAIL') {
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    // Outlook/Microsoft
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      response_mode: 'query',
      state
    });
    authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }

  res.json({
    success: true,
    data: { authUrl, state }
  });
}));

/**
 * GET /api/email/callback/gmail
 * Handle Gmail OAuth callback
 */
router.get('/callback/gmail', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/settings?email_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect('/settings?email_error=missing_params');
  }

  try {
    // Decode state
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId, schoolId } = stateData;

    // Check state age (max 10 minutes)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect('/settings?email_error=state_expired');
    }

    const config = OAUTH_CONFIG.GMAIL;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return res.redirect(`/settings?email_error=${tokens.error}`);
    }

    // Get user email from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userInfoResponse.json();

    // Upsert integration
    await prisma.emailIntegration.upsert({
      where: {
        userId_provider: { userId, provider: 'GMAIL' }
      },
      create: {
        userId,
        schoolId,
        provider: 'GMAIL',
        email: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        isActive: true
      },
      update: {
        email: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        isActive: true
      }
    });

    res.redirect('/settings?email_success=gmail');
  } catch (err) {
    console.error('Gmail OAuth error:', err);
    res.redirect('/settings?email_error=callback_failed');
  }
}));

/**
 * GET /api/email/callback/outlook
 * Handle Outlook OAuth callback
 */
router.get('/callback/outlook', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/settings?email_error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return res.redirect('/settings?email_error=missing_params');
  }

  try {
    // Decode state
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId, schoolId } = stateData;

    // Check state age
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect('/settings?email_error=state_expired');
    }

    const config = OAUTH_CONFIG.OUTLOOK;

    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      return res.redirect(`/settings?email_error=${tokens.error}`);
    }

    // Get user email from Microsoft Graph
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userInfoResponse.json();

    // Upsert integration
    await prisma.emailIntegration.upsert({
      where: {
        userId_provider: { userId, provider: 'OUTLOOK' }
      },
      create: {
        userId,
        schoolId,
        provider: 'OUTLOOK',
        email: userInfo.mail || userInfo.userPrincipalName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        isActive: true
      },
      update: {
        email: userInfo.mail || userInfo.userPrincipalName,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        isActive: true
      }
    });

    res.redirect('/settings?email_success=outlook');
  } catch (err) {
    console.error('Outlook OAuth error:', err);
    res.redirect('/settings?email_error=callback_failed');
  }
}));

/**
 * DELETE /api/email/integrations/:id
 * Disconnect email integration
 */
router.delete('/integrations/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const integration = await prisma.emailIntegration.findFirst({
    where: { id, userId: req.user.id }
  });

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: { message: 'Integration not found', messageZh: '找不到整合' }
    });
  }

  // In production: Also revoke OAuth tokens
  await prisma.emailIntegration.delete({ where: { id } });

  res.json({
    success: true,
    message: 'Email integration removed'
  });
}));

/**
 * POST /api/email/send
 * Send email through connected account
 */
router.post('/send', authenticate, asyncHandler(async (req, res) => {
  const { integrationId, to, subject, body, isHtml } = req.body;

  if (!integrationId || !to || !subject || !body) {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing required fields', messageZh: '缺少必填欄位' }
    });
  }

  const integration = await prisma.emailIntegration.findFirst({
    where: { id: integrationId, userId: req.user.id, isActive: true }
  });

  if (!integration) {
    return res.status(404).json({
      success: false,
      error: { message: 'Email integration not found or inactive', messageZh: '找不到電子郵件整合或已停用' }
    });
  }

  // Check if token needs refresh
  if (integration.tokenExpiresAt && integration.tokenExpiresAt < new Date()) {
    // In production: Refresh the token
    return res.status(401).json({
      success: false,
      error: { message: 'Token expired. Please reconnect your email.', messageZh: '權杖過期，請重新連接電子郵件' }
    });
  }

  try {
    if (integration.provider === 'GMAIL') {
      // Send via Gmail API
      const message = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
        '',
        body
      ].join('\r\n');

      const encodedMessage = Buffer.from(message).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: encodedMessage })
      });

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error.message);
      }

      res.json({
        success: true,
        data: { messageId: result.id }
      });
    } else {
      // Send via Microsoft Graph
      const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${integration.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: {
            subject,
            body: {
              contentType: isHtml ? 'HTML' : 'Text',
              content: body
            },
            toRecipients: to.split(',').map(email => ({
              emailAddress: { address: email.trim() }
            }))
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Failed to send email');
      }

      res.json({
        success: true,
        data: { sent: true }
      });
    }
  } catch (err) {
    console.error('Email send error:', err);
    res.status(500).json({
      success: false,
      error: { message: err.message, messageZh: '發送電子郵件失敗' }
    });
  }
}));

/**
 * GET /api/email/providers
 * Get available email providers and their status
 */
router.get('/providers', authenticate, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      providers: [
        {
          id: 'GMAIL',
          name: 'Gmail',
          icon: 'gmail',
          available: !!OAUTH_CONFIG.GMAIL.clientId
        },
        {
          id: 'OUTLOOK',
          name: 'Outlook / Microsoft 365',
          icon: 'outlook',
          available: !!OAUTH_CONFIG.OUTLOOK.clientId
        }
      ]
    }
  });
}));

export default router;
