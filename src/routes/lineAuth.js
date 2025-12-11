// LINE Authentication Routes
// Handles LINE Login OAuth flow for parent account linking

import express from 'express';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import lineService from '../services/lineService.js';

const router = express.Router();

// Store state tokens temporarily (in production, use Redis)
const stateTokens = new Map();

// ======================
// LINE LOGIN OAUTH FLOW
// ======================

/**
 * GET /api/auth/line/login
 * Initiates LINE Login - redirects to LINE authorization page
 * Query params:
 *   - linkMode: 'link' to link to existing account, 'login' for LINE-only login
 *   - userId: (required if linkMode=link) the user ID to link LINE to
 */
router.get('/login', (req, res) => {
  try {
    const { linkMode, userId } = req.query;
    
    // Generate state token for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    
    // Store state with metadata (expires in 10 minutes)
    stateTokens.set(state, {
      linkMode: linkMode || 'login',
      userId: userId || null,
      createdAt: Date.now()
    });
    
    // Clean up old tokens
    for (const [key, value] of stateTokens) {
      if (Date.now() - value.createdAt > 10 * 60 * 1000) {
        stateTokens.delete(key);
      }
    }
    
    const loginUrl = lineService.getLineLoginUrl(state);
    res.redirect(loginUrl);
  } catch (error) {
    console.error('LINE login initiation error:', error);
    res.redirect(`${process.env.CLIENT_URL}/auth/line/callback?error=init_failed`);
  }
});

/**
 * GET /api/auth/line/callback
 * Handles LINE OAuth callback
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error: lineError } = req.query;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    
    // Handle LINE errors
    if (lineError) {
      console.error('LINE OAuth error:', lineError);
      return res.redirect(`${clientUrl}/auth/line/callback?error=${lineError}`);
    }
    
    // Verify state token
    const stateData = stateTokens.get(state);
    if (!stateData) {
      console.error('Invalid or expired state token');
      return res.redirect(`${clientUrl}/auth/line/callback?error=invalid_state`);
    }
    stateTokens.delete(state);
    
    // Exchange code for tokens
    const tokenResponse = await lineService.exchangeCodeForToken(code);
    const { access_token, id_token } = tokenResponse;
    
    // Get LINE profile
    const lineProfile = await lineService.getLineProfile(access_token);
    const lineUserId = lineProfile.userId;
    const lineDisplayName = lineProfile.displayName;
    const linePictureUrl = lineProfile.pictureUrl;
    
    console.log('LINE Profile received:', { lineUserId, lineDisplayName });
    
    // Handle based on mode
    if (stateData.linkMode === 'link' && stateData.userId) {
      // Link LINE to existing user account
      const result = await linkLineToUser(stateData.userId, lineUserId, lineDisplayName, linePictureUrl);
      
      if (result.error) {
        return res.redirect(`${clientUrl}/auth/line/callback?error=${result.error}`);
      }
      
      return res.redirect(`${clientUrl}/auth/line/callback?success=linked&name=${encodeURIComponent(lineDisplayName)}`);
    } else {
      // LINE-only login (find existing user)
      const result = await findLineUser(lineUserId, lineDisplayName, linePictureUrl);
      
      if (result.error) {
        return res.redirect(`${clientUrl}/auth/line/callback?error=${result.error}`);
      }
      
      // Return with token for auto-login
      return res.redirect(`${clientUrl}/auth/line/callback?success=login&token=${result.token}&name=${encodeURIComponent(lineDisplayName)}`);
    }
  } catch (error) {
    console.error('LINE callback error:', error);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    res.redirect(`${clientUrl}/auth/line/callback?error=callback_failed`);
  }
});

/**
 * POST /api/auth/line/link
 * Get redirect URL to link LINE account (authenticated endpoint)
 */
router.post('/link', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Generate state for linking
    const state = crypto.randomBytes(32).toString('hex');
    stateTokens.set(state, {
      linkMode: 'link',
      userId: userId,
      createdAt: Date.now()
    });
    
    const loginUrl = lineService.getLineLoginUrl(state);
    
    res.json({
      success: true,
      redirectUrl: loginUrl
    });
  } catch (error) {
    console.error('LINE link initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate LINE linking' });
  }
});

/**
 * POST /api/auth/line/unlink
 * Unlink LINE account from current user
 */
router.post('/unlink', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    await prisma.user.update({
      where: { id: userId },
      data: {
        lineUserId: null,
        lineDisplayName: null,
        lineProfileUrl: null,
        lineAccessToken: null
      }
    });
    
    res.json({ success: true, message: 'LINE account unlinked' });
  } catch (error) {
    console.error('LINE unlink error:', error);
    res.status(500).json({ error: 'Failed to unlink LINE account' });
  }
});

/**
 * GET /api/auth/line/status
 * Check if current user has LINE linked
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        lineUserId: true,
        lineDisplayName: true,
        lineProfileUrl: true
      }
    });
    
    res.json({
      linked: !!user?.lineUserId,
      displayName: user?.lineDisplayName,
      profileUrl: user?.lineProfileUrl
    });
  } catch (error) {
    console.error('LINE status error:', error);
    res.status(500).json({ error: 'Failed to get LINE status' });
  }
});

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Link LINE account to existing user
 */
async function linkLineToUser(userId, lineUserId, displayName, pictureUrl) {
  try {
    // Check if LINE account is already linked to another user
    const existingLink = await prisma.user.findFirst({
      where: {
        lineUserId: lineUserId,
        id: { not: userId }
      }
    });
    
    if (existingLink) {
      return { error: 'line_already_linked' };
    }
    
    // Update user with LINE info
    await prisma.user.update({
      where: { id: userId },
      data: {
        lineUserId: lineUserId,
        lineDisplayName: displayName,
        lineProfileUrl: pictureUrl
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Link LINE to user error:', error);
    return { error: 'link_failed' };
  }
}

/**
 * Find user by LINE ID (for LINE-only login)
 */
async function findLineUser(lineUserId, displayName, pictureUrl) {
  try {
    // Find existing user with this LINE ID
    let user = await prisma.user.findFirst({
      where: { lineUserId: lineUserId }
    });
    
    if (!user) {
      // No account linked - user must link from existing account first
      return { error: 'no_account_linked' };
    }
    
    if (!user.isActive) {
      return { error: 'account_disabled' };
    }
    
    // Update LINE profile info (might have changed)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lineDisplayName: displayName,
        lineProfileUrl: pictureUrl
      }
    });
    
    // Refetch user with updated data
    user = await prisma.user.findUnique({
      where: { id: user.id }
    });
    
    // Generate JWT token
    const { generateToken } = await import('../middleware/auth.js');
    const token = generateToken(user);
    
    return { success: true, token, user };
  } catch (error) {
    console.error('Find LINE user error:', error);
    return { error: 'login_failed' };
  }
}

export default router;