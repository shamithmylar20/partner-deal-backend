const jwt = require('jsonwebtoken');
const googleSheetsService = require('../services/googleSheetsService');

/**
 * Check if user is admin by checking Admins sheet
 */
const checkAdminStatus = async (email) => {
  try {
    const adminsData = await googleSheetsService.getSheetData('Admins');
    
    if (!adminsData || adminsData.length <= 1) {
      return false;
    }

    const headers = adminsData[0];
    const emailIndex = headers.indexOf('email');
    const statusIndex = headers.indexOf('status');

    // Check if email exists in Admins sheet with active status
    for (let i = 1; i < adminsData.length; i++) {
      const adminEmail = adminsData[i][emailIndex];
      const adminStatus = adminsData[i][statusIndex];
      
      if (adminEmail && adminStatus === 'active' && adminEmail.toLowerCase() === email.toLowerCase()) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
};

/**
 * JWT Authentication Middleware with Admin Sheet Check
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid authentication token'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user details from Google Sheets
    const user = await googleSheetsService.findRowByValue('Users', 'id', decoded.id);
    
    if (!user || user.status !== 'active') {
      return res.status(401).json({
        error: 'Invalid or inactive user',
        message: 'User account not found or inactive'
      });
    }

    // Check if user is admin by checking Admins sheet
    const isAdmin = await checkAdminStatus(user.email);
    
    // Override role based on Admins sheet
    const userRole = isAdmin ? 'admin' : user.role;

    // Add user info to request object
    req.user = {
      id: user.id,
      email: user.email,
      role: userRole, // This is now determined by Admins sheet check
      partnerId: user.partner_company, // Keep your existing field mapping
      firstName: user.first_name,
      lastName: user.last_name,
      partnerName: user.partner_company
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'The provided token is invalid'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired. Please login again'
      });
    }

    return res.status(500).json({
      error: 'Authentication error',
      message: 'Failed to authenticate user'
    });
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await googleSheetsService.findRowByValue('Users', 'id', decoded.id);
      
      if (user && user.status === 'active') {
        // Check admin status for optional auth too
        const isAdmin = await checkAdminStatus(user.email);
        const userRole = isAdmin ? 'admin' : user.role;

        req.user = {
          id: user.id,
          email: user.email,
          role: userRole,
          partnerId: user.partner_id,
          firstName: user.first_name,
          lastName: user.last_name,
          partnerName: user.partner_company
        };
      }
    }

    next();
  } catch (error) {
    // For optional auth, we continue even if token is invalid
    console.log('Optional auth failed:', error.message);
    next();
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  checkAdminStatus
};