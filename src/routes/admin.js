const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const googleSheetsService = require('../services/googleSheetsService');

const router = express.Router();

/**
 * @route GET /api/v1/admin/debug-user
 * @desc Debug current user info
 */
router.get('/debug-user', authenticateToken, async (req, res) => {
  try {
    // Get admins data for comparison
    let adminsData = [];
    try {
      adminsData = await googleSheetsService.getSheetData('Admins');
    } catch (error) {
      adminsData = [];
    }

    res.json({
      currentUser: {
        email: req.user?.email,
        role: req.user?.role,
        isAdmin: req.user?.role === 'admin',
        firstName: req.user?.firstName,
        lastName: req.user?.lastName
      },
      adminsSheet: {
        exists: adminsData.length > 0,
        headers: adminsData.length > 0 ? adminsData[0] : [],
        adminEmails: adminsData.slice(1).map(row => ({
          email: row[0],
          status: row[3],
          matches: row[0]?.toLowerCase() === req.user?.email?.toLowerCase()
        }))
      },
      message: 'Debug info for current user and admin sheet'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Debug failed',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/admin/test
 * @desc Simple test route
 */
router.get('/test', (req, res) => {
  res.json({ message: 'Admin routes are working!' });
});

/**
 * @route GET /api/v1/admin/profile/deals
 * @desc Get current user's own deals only (for profile page)
 */
router.get('/profile/deals', authenticateToken, async (req, res) => {
  try {
    const deals = await googleSheetsService.getSheetData('Deals');
    
    if (!deals || deals.length <= 1) {
      return res.json({
        deals: [],
        total: 0,
        message: 'No deals found'
      });
    }

    const headers = deals[0];
    const userDeals = [];
    const submitterEmailIndex = headers.indexOf('submitter_email');

    // Only include deals submitted by the current user (regardless of admin status)
    for (let i = 1; i < deals.length; i++) {
      const deal = {};
      headers.forEach((header, index) => {
        deal[header] = deals[i][index] || '';
      });
      
      // Filter by submitter email - only user's own deals
      if (deal.submitter_email === req.user?.email) {
        userDeals.push(deal);
      }
    }

    res.json({
      deals: userDeals,
      total: userDeals.length,
      user_email: req.user?.email
    });

  } catch (error) {
    console.error('Error loading user deals:', error);
    res.status(500).json({
      error: 'Failed to load user deals',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/admin/profile
 * @desc Get current user's profile data (from Users + UserProfiles sheets)
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // Get base user data from Users sheet
    let usersData = [];
    try {
      usersData = await googleSheetsService.getSheetData('Users');
    } catch (error) {
      console.log('Users sheet not found or empty');
    }

    // Get additional profile data from UserProfiles sheet
    let profilesData = [];
    try {
      profilesData = await googleSheetsService.getSheetData('UserProfiles');
    } catch (error) {
      console.log('UserProfiles sheet not found or empty');
    }

    // Find user's base data
    let userData = null;
    if (usersData && usersData.length > 1) {
      const headers = usersData[0];
      const emailIndex = headers.indexOf('email');
      
      for (let i = 1; i < usersData.length; i++) {
        if (usersData[i][emailIndex] === req.user?.email) {
          userData = {};
          headers.forEach((header, index) => {
            userData[header] = usersData[i][index] || '';
          });
          break;
        }
      }
    }

    // Find user's profile data
    let profileData = null;
    if (profilesData && profilesData.length > 1) {
      const headers = profilesData[0];
      const emailIndex = headers.indexOf('email');
      
      for (let i = 1; i < profilesData.length; i++) {
        if (profilesData[i][emailIndex] === req.user?.email) {
          profileData = {};
          headers.forEach((header, index) => {
            profileData[header] = profilesData[i][index] || '';
          });
          break;
        }
      }
    }

    // Merge data with defaults
    const profile = {
      // From authentication (non-editable)
      firstName: req.user?.firstName || '',
      lastName: req.user?.lastName || '',
      email: req.user?.email || '',
      
      // From Users sheet (base company name, can be overridden)
      partner_company: profileData?.company_name || userData?.partner_company || req.user?.partnerId || '',
      role: req.user?.role || 'user',
      
      // From UserProfiles sheet (editable)
      territory: profileData?.territory || 'North America',
      company_description: profileData?.company_description || '',
      company_size: profileData?.company_size || '',
      website_url: profileData?.website_url || '',
      updated_at: profileData?.updated_at || null
    };

    res.json({
      profile: profile,
      sources: {
        userData: userData ? 'found' : 'not_found',
        profileData: profileData ? 'found' : 'not_found'
      }
    });

  } catch (error) {
    console.error('Error loading profile:', error);
    res.status(500).json({
      error: 'Failed to load profile',
      message: error.message
    });
  }
});

/**
 * @route PUT /api/v1/admin/profile
 * @desc Update current user's profile data (to UserProfiles sheet)
 */
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { territory, company_description, company_size, website_url, company } = req.body;
    const currentTime = googleSheetsService.getCurrentTimestamp();

    // Check if UserProfiles sheet exists, if not create headers
    let profilesData = [];
    try {
      profilesData = await googleSheetsService.getSheetData('UserProfiles');
    } catch (error) {
      // Sheet might not exist, we'll create it
    }

    // If sheet is empty or doesn't exist, add headers
    if (!profilesData || profilesData.length === 0) {
      const headers = ['email', 'territory', 'company_description', 'company_size', 'website_url', 'company_name', 'created_at', 'updated_at'];
      await googleSheetsService.appendToSheet('UserProfiles', headers);
      profilesData = [headers];
    }

    const headers = profilesData[0];
    const emailIndex = headers.indexOf('email');
    
    // Check if user profile already exists
    let profileExists = false;
    for (let i = 1; i < profilesData.length; i++) {
      if (profilesData[i][emailIndex] === req.user?.email) {
        profileExists = true;
        break;
      }
    }

    if (profileExists) {
      // Profile exists - would need updateRow functionality
      // For now, we'll return a success message noting the limitation
      res.json({
        message: 'Profile update noted',
        email: req.user?.email,
        updates: { territory, company_description, company_size, website_url, company_name: company },
        updated_at: currentTime,
        note: 'Profile update recorded (Google Sheets row update pending implementation)'
      });
    } else {
      // Profile doesn't exist - create new row
      const newProfileData = [
        req.user?.email || '',           // email
        territory || '',                 // territory
        company_description || '',       // company_description
        company_size || '',             // company_size  
        website_url || '',              // website_url
        company || '',                  // company_name
        currentTime,                    // created_at
        currentTime                     // updated_at
      ];

      await googleSheetsService.appendToSheet('UserProfiles', newProfileData);

      res.json({
        message: 'Profile created successfully',
        email: req.user?.email,
        profile: { territory, company_description, company_size, website_url, company_name: company },
        created_at: currentTime
      });
    }

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/admin/pending-deals
 * @desc Get all pending deals for approval
 */
router.get('/pending-deals', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    const deals = await googleSheetsService.getSheetData('Deals');
    
    if (!deals || deals.length <= 1) {
      return res.json({
        deals: [],
        total: 0,
        message: 'No pending deals found'
      });
    }

    const headers = deals[0];
    const pendingDeals = [];

    // Process deals and filter for pending status
    for (let i = 1; i < deals.length; i++) {
      const deal = {};
      headers.forEach((header, index) => {
        deal[header] = deals[i][index] || '';
      });
      
      // Only include deals that need approval
      if (deal.status && ['submitted', 'pending', 'under_review'].includes(deal.status.toLowerCase())) {
        pendingDeals.push(deal);
      }
    }

    res.json({
      deals: pendingDeals,
      total: pendingDeals.length
    });

  } catch (error) {
    console.error('Error loading pending deals:', error);
    res.status(500).json({
      error: 'Failed to load pending deals',
      message: error.message
    });
  }
});

/**
 * @route POST /api/v1/admin/deals/:id/approve
 * @desc Approve a deal
 */
router.post('/deals/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    const { id } = req.params;
    const { approver_name } = req.body;

    // For now, return success message
    // TODO: Implement actual Google Sheets update when updateRow is available
    res.json({
      message: 'Deal approved successfully',
      dealId: id,
      status: 'approved',
      approver: approver_name,
      approved_at: new Date().toISOString(),
      note: 'Deal approval recorded (Google Sheets update pending implementation)'
    });

  } catch (error) {
    console.error('Error approving deal:', error);
    res.status(500).json({
      error: 'Failed to approve deal',
      message: error.message
    });
  }
});

/**
 * @route POST /api/v1/admin/deals/:id/reject
 * @desc Reject a deal
 */
router.post('/deals/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    const { id } = req.params;
    const { approver_name, rejection_reason } = req.body;

    // For now, return success message
    // TODO: Implement actual Google Sheets update when updateRow is available
    res.json({
      message: 'Deal rejected successfully',
      dealId: id,
      status: 'rejected',
      approver: approver_name,
      rejection_reason: rejection_reason,
      rejected_at: new Date().toISOString(),
      note: 'Deal rejection recorded (Google Sheets update pending implementation)'
    });

  } catch (error) {
    console.error('Error rejecting deal:', error);
    res.status(500).json({
      error: 'Failed to reject deal',
      message: error.message
    });
  }
});

/**
 * @route POST /api/v1/admin/add
 * @desc Add new admin by email
 */
router.post('/add', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Please provide a valid email address'
      });
    }

    const adminEmail = email.trim().toLowerCase();
    const currentTime = googleSheetsService.getCurrentTimestamp();

    // Check if Admins sheet exists, if not create headers
    let adminsData = [];
    try {
      adminsData = await googleSheetsService.getSheetData('Admins');
    } catch (error) {
      // Sheet might not exist, we'll create it
    }

    // If sheet is empty or doesn't exist, add headers
    if (!adminsData || adminsData.length === 0) {
      const headers = ['email', 'added_by', 'added_at', 'status'];
      await googleSheetsService.appendToSheet('Admins', headers);
      adminsData = [headers];
    }

    // Check if admin already exists
    const headers = adminsData[0];
    const emailIndex = headers.indexOf('email');
    
    for (let i = 1; i < adminsData.length; i++) {
      const existingEmail = adminsData[i][emailIndex];
      if (existingEmail && existingEmail.toLowerCase() === adminEmail) {
        return res.status(409).json({
          error: 'Admin already exists',
          message: 'This email is already in the admin list'
        });
      }
    }

    // Add new admin to sheet
    const newAdminData = [
      adminEmail,                           // email
      req.user?.email || 'system',         // added_by
      currentTime,                         // added_at
      'active'                            // status
    ];

    await googleSheetsService.appendToSheet('Admins', newAdminData);

    res.json({
      message: 'Admin added successfully',
      email: adminEmail,
      added_by: req.user?.email,
      added_at: currentTime
    });

  } catch (error) {
    console.error('Error adding admin:', error);
    res.status(500).json({
      error: 'Failed to add admin',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/admin/list
 * @desc Get list of all admins
 */
router.get('/list', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    let adminsData = [];
    try {
      adminsData = await googleSheetsService.getSheetData('Admins');
    } catch (error) {
      // Sheet might not exist
      return res.json({
        admins: [],
        total: 0,
        message: 'No admins sheet found'
      });
    }

    if (!adminsData || adminsData.length <= 1) {
      return res.json({
        admins: [],
        total: 0,
        message: 'No admins found'
      });
    }

    const headers = adminsData[0];
    const adminList = [];

    // Convert rows to objects
    for (let i = 1; i < adminsData.length; i++) {
      const admin = {};
      headers.forEach((header, index) => {
        admin[header] = adminsData[i][index] || '';
      });
      
      // Only include active admins
      if (admin.status === 'active') {
        adminList.push(admin);
      }
    }

    res.json({
      admins: adminList,
      total: adminList.length
    });

  } catch (error) {
    console.error('Error loading admin list:', error);
    res.status(500).json({
      error: 'Failed to load admin list',
      message: error.message
    });
  }
});

/**
 * @route POST /api/v1/admin/remove
 * @desc Remove admin by email
 */
router.post('/remove', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin privileges required'
      });
    }

    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        error: 'Email required',
        message: 'Please provide a valid email address'
      });
    }

    // Prevent removing self
    if (email.toLowerCase() === req.user?.email.toLowerCase()) {
      return res.status(400).json({
        error: 'Cannot remove self',
        message: 'You cannot remove your own admin privileges'
      });
    }

    // For now, return success message
    // TODO: Implement actual row removal when Google Sheets update functionality is available
    res.json({
      message: 'Admin removal noted',
      email: email,
      removed_by: req.user?.email,
      removed_at: new Date().toISOString(),
      note: 'Admin removal recorded (Google Sheets update pending implementation)'
    });

  } catch (error) {
    console.error('Error removing admin:', error);
    res.status(500).json({
      error: 'Failed to remove admin',
      message: error.message
    });
  }
});

module.exports = router;