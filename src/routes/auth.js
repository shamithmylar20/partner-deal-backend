const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const authService = require('../services/authService');
const jwt = require('jsonwebtoken');
const googleSheetsService = require('../services/googleSheetsService');

const router = express.Router();

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/v1/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const googleUser = {
      sub: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      given_name: profile.name.givenName,
      family_name: profile.name.familyName,
      picture: profile.photos[0].value
    };

    const result = await authService.googleLogin(googleUser);
    return done(null, result);
  } catch (error) {
    return done(error, null);
  }
}));

// Initialize passport
router.use(passport.initialize());

/**
 * @route POST /api/v1/auth/register
 * @desc Register new partner user
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, company, territory } = req.body;

    // Basic validation
    if (!email || !password || !firstName || !lastName || !company) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['email', 'password', 'firstName', 'lastName', 'company']
      });
    }

    const result = await authService.registerUser({
      email,
      password,
      firstName,
      lastName,
      company,
      territory
    });

    res.status(201).json({
      message: 'User registered successfully',
      user: result
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).json({
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/auth/email-login
 * @desc Email/password login for testing
 */
router.post('/email-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Test admin credentials
    const testCredentials = {
      'admin@daxa.ai': 'admin123'  // Test admin account
    };

    if (!testCredentials[email] || testCredentials[email] !== password) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Check if user exists in Users sheet, create if not
    let user = await googleSheetsService.findRowByValue('Users', 'email', email);
    
    if (!user) {
      // Create test admin user
      const userData = [
        'test-admin-' + Date.now(), // id
        email, // email
        'Test', // first_name
        'Admin', // last_name
        'Daxa Internal', // partner_company
        'admin', // role
        'active', // status
        googleSheetsService.getCurrentTimestamp() // created_at
      ];

      await googleSheetsService.appendToSheet('Users', userData);
      user = await googleSheetsService.findRowByValue('Users', 'email', email);
    }

    // Create JWT token
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      partnerId: user.partner_company
    };

    const accessToken = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
      expiresIn: '24h' 
    });

    // Format user data for frontend
    const userData = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      partnerId: user.partner_company,
      partnerName: user.partner_company
    };

    res.json({
      message: 'Login successful',
      user: userData,
      accessToken: accessToken
    });

  } catch (error) {
    console.error('Email login error:', error);
    res.status(500).json({
      error: 'Authentication failed',
      message: error.message
    });
  }
});

/**
 * @route POST /api/v1/auth/login
 * @desc Login with email and password
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }

    const result = await authService.loginUser(email, password);

    res.json({
      message: 'Login successful',
      ...result
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(401).json({
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/auth/google
 * @desc Start Google OAuth flow
 */
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

/**
 * @route GET /api/v1/auth/google/callback
 * @desc Google OAuth callback with admin check - FIXED VERSION
 */
router.get('/google/callback', 
  passport.authenticate('google', { session: false }),
  async (req, res) => {
    try {
      const { user, accessToken } = req.user;
      
      // Import the checkAdminStatus function
      const { checkAdminStatus } = require('../middleware/auth');
      
      // Check if user should be admin based on Admins sheet
      const isAdmin = await checkAdminStatus(user.email);
      
      // Override role based on Admins sheet check
      const updatedUser = {
        ...user,
        role: isAdmin ? 'admin' : user.role || 'user'
      };
      
      // HARDCODED frontend URL to fix deployment issue
      const frontendURL = 'https://partner-deal-registration-c3p3n0uq2-shamiths-projects-c74c59b6.vercel.app';
      
      console.log('OAuth Redirect - Using hardcoded frontend URL:', frontendURL);
      console.log('User role after admin check:', updatedUser.role);
      
      const redirectUrl = `${frontendURL}/auth/callback?token=${accessToken}&user=${encodeURIComponent(JSON.stringify(updatedUser))}`;
      console.log('Final redirect URL:', redirectUrl);
      
      res.redirect(redirectUrl);
      
    } catch (error) {
      console.error('Google callback error:', error);
      
      // Also hardcode the error redirect
      const frontendURL = 'https://partner-deal-registration-c3p3n0uq2-shamiths-projects-c74c59b6.vercel.app';
      res.redirect(`${frontendURL}/auth?error=google_auth_failed`);
    }
  }
);

// Add this debug route temporarily
router.get('/debug-frontend-url', (req, res) => {
  res.json({
    FRONTEND_URL: process.env.FRONTEND_URL,
    NODE_ENV: process.env.NODE_ENV,
    hardcoded_url: 'https://partner-deal-registration-c3p3n0uq2-shamiths-projects-c74c59b6.vercel.app',
    all_env: Object.keys(process.env).filter(key => key.includes('FRONTEND'))
  });
});

/**
 * @route GET /api/v1/auth/me
 * @desc Get current user info (requires auth middleware)
 */
router.get('/me', (req, res) => {
  res.json({
    message: 'Auth middleware not implemented yet',
    note: 'This will return current user info after implementing auth middleware'
  });
});

/**
 * @route POST /api/v1/auth/logout
 * @desc Logout user
 */
router.post('/logout', (req, res) => {
  res.json({
    message: 'Logout successful',
    note: 'Clear the token on frontend'
  });
});

module.exports = router;