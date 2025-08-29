const express = require('express');
const { 
  createDeal, 
  getDeals, 
  getDealById, 
  checkDuplicateDeals 
} = require('../controllers/dealController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @route POST /api/v1/deals
 * @desc Create new deal registration (requires auth)
 * @body {companyName, domain, partnerCompany, submitterName, submitterEmail, territory, customerIndustry, customerLocation, dealStage, expectedCloseDate, dealValue, contractType, primaryProduct, additionalNotes, uploadedFiles, agreedToTerms}
 */
router.post('/', authenticateToken, createDeal);

/**
 * @route GET /api/v1/deals
 * @desc Get all deals with optional filtering (requires auth)
 * @query {status, partner, limit}
 */
router.get('/', authenticateToken, getDeals);

/**
 * @route GET /api/v1/deals/:id
 * @desc Get single deal by ID (requires auth)
 * @param {string} id - Deal ID
 */
router.get('/:id', authenticateToken, getDealById);

/**
 * @route POST /api/v1/deals/check-duplicate
 * @desc Check for duplicate deals before submission (optional auth)
 * @body {companyName, domain}
 */
router.post('/check-duplicate', optionalAuth, async (req, res) => {
  try {
    const { companyName, domain } = req.body;
    
    if (!companyName || !domain) {
      return res.status(400).json({
        error: 'Company name and domain are required'
      });
    }

    const result = await checkDuplicateDeals(companyName, domain);
    
    res.json({
      hasDuplicates: result.hasDuplicates,
      duplicates: result.duplicates,
      message: result.hasDuplicates ? 
        'Potential duplicates found' : 
        'No duplicates detected'
    });

  } catch (error) {
    console.error('Duplicate check error:', error);
    res.status(500).json({
      error: 'Failed to check duplicates',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/deals/stats/summary
 * @desc Get deal statistics summary (requires auth)
 */
router.get('/stats/summary', authenticateToken, async (req, res) => {
  try {
    const deals = await require('../services/googleSheetsService').getSheetData('Deals');
    
    if (!deals || deals.length < 2) {
      return res.json({
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        submitted: 0,
        totalValue: 0
      });
    }

    const headers = deals[0];
    const statusIndex = headers.indexOf('status');
    const valueIndex = headers.indexOf('deal_value');
    const submitterEmailIndex = headers.indexOf('submitter_email'); // FIXED: Use actual field name
    
    let stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      submitted: 0,
      totalValue: 0
    };

    // Filter deals by authenticated user's email (if not admin)
    for (let i = 1; i < deals.length; i++) {
      const submitterEmail = deals[i][submitterEmailIndex] || '';
      const status = deals[i][statusIndex] || '';
      const value = parseFloat((deals[i][valueIndex] || '0').replace(/[^0-9.]/g, '')) || 0;
      
      // FIXED: Role-based filtering using actual email field
      const canViewDeal = req.user?.role === 'admin' || submitterEmail === req.user?.email;
      
      if (canViewDeal) {
        stats.total++;
        stats.totalValue += value;
        
        switch (status.toLowerCase()) {
          case 'pending':
          case 'under_review':
            stats.pending++;
            break;
          case 'approved':
            stats.approved++;
            break;
          case 'rejected':
            stats.rejected++;
            break;
          case 'submitted':
            stats.submitted++;
            break;
        }
      }
    }

    res.json(stats);

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      error: 'Failed to get deal statistics',
      message: error.message
    });
  }
});

/**
 * @route PUT /api/v1/deals/:id/status
 * @desc Update deal status (requires auth)
 * @body {status, approvedBy, rejectionReason}
 */
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    const validStatuses = ['submitted', 'under_review', 'approved', 'rejected'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        validStatuses: validStatuses
      });
    }

    // Find the deal
    const deal = await require('../services/googleSheetsService').findRowByValue('Deals', 'id', id);
    
    if (!deal) {
      return res.status(404).json({
        error: 'Deal not found'
      });
    }

    // FIXED: Check permission using email instead of non-existent partner_id
    if (req.user?.role !== 'admin' && deal.submitter_email !== req.user?.email) {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'You can only update deals you submitted'
      });
    }

    // This would require implementing updateRow functionality in googleSheetsService
    // For now, return a placeholder response
    res.json({
      message: 'Status update functionality coming soon',
      dealId: id,
      newStatus: status,
      updatedBy: req.user?.email,
      note: 'This will be implemented when we add updateRow to googleSheetsService'
    });

  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({
      error: 'Failed to update deal status',
      message: error.message
    });
  }
});

/**
 * @route GET /api/v1/deals/my-deals
 * @desc Get current user's deals only (requires auth)
 */
router.get('/my-deals', authenticateToken, async (req, res) => {
  try {
    const { status, limit = 50 } = req.query;
    
    const deals = await require('../services/googleSheetsService').getSheetData('Deals');
    
    if (!deals || deals.length < 2) {
      return res.json({
        deals: [],
        total: 0,
        message: 'No deals found'
      });
    }

    const headers = deals[0];
    const submitterEmailIndex = headers.indexOf('submitter_email'); // FIXED: Use actual field name
    let dealRecords = [];

    // Convert to objects and filter by user's email
    for (let i = 1; i < deals.length && dealRecords.length < limit; i++) {
      const deal = {};
      headers.forEach((header, index) => {
        deal[header] = deals[i][index] || '';
      });
      
      // FIXED: Only include deals submitted by the current user (unless admin)
      const canViewDeal = req.user?.role === 'admin' || deal.submitter_email === req.user?.email;
      
      if (canViewDeal) {
        // Apply status filter
        if (status && deal.status !== status) continue;
        
        dealRecords.push(deal);
      }
    }

    res.json({
      deals: dealRecords,
      total: dealRecords.length,
      filters: { status, limit },
      user: {
        email: req.user?.email,
        role: req.user?.role
      }
    });

  } catch (error) {
    console.error('Get my deals error:', error);
    res.status(500).json({
      error: 'Failed to retrieve deals',
      message: error.message
    });
  }
});

module.exports = router;