const googleSheetsService = require('../services/googleSheetsService');

/**
 * Create new deal registration
 * POST /api/v1/deals
 */
const createDeal = async (req, res) => {
  try {
    const {
      // Quick Check fields
      companyName,
      domain,
      
      // Core Info fields
      partnerCompany,
      submitterName,
      submitterEmail,
      territory,
      customerLegalName,
      customerIndustry,
      customerLocation,
      
      // Deal Intelligence fields
      dealStage,
      expectedCloseDate,
      dealValue,
      contractType,
      primaryProduct,
      
      // Documentation fields
      additionalNotes,
      agreedToTerms
    } = req.body;

    // Basic validation
    if (!companyName || !domain || !partnerCompany || !submitterName || !submitterEmail) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['companyName', 'domain', 'partnerCompany', 'submitterName', 'submitterEmail']
      });
    }

    if (!agreedToTerms) {
      return res.status(400).json({
        error: 'Must agree to terms and conditions'
      });
    }

    // Check for duplicate deals
    const duplicateCheck = await checkDuplicateDeals(companyName, domain);
    
    if (duplicateCheck.hasDuplicates) {
      return res.status(409).json({
        error: 'Potential duplicate deal detected',
        duplicates: duplicateCheck.duplicates,
        message: 'Please review existing deals or contact your partner manager'
      });
    }

    const dealId = googleSheetsService.generateId();

    // Create deal record (single sheet - no separate customer table)
    const dealData = [
      dealId, // A: id
      'submitted', // B: status
      googleSheetsService.getCurrentTimestamp(), // C: created_at
      companyName, // D: company_name
      domain, // E: domain
      partnerCompany, // F: partner_company
      submitterName, // G: submitter_name
      submitterEmail, // H: submitter_email
      territory, // I: territory
      customerIndustry, // J: customer_industry
      customerLocation, // K: customer_location
      dealStage, // L: deal_stage
      expectedCloseDate, // M: expected_close_date
      dealValue, // N: deal_value
      contractType, // O: contract_type
      primaryProduct || '', // P: primary_product
      additionalNotes || '', // Q: additional_notes
      customerLegalName || '' // R: customer_legal_name
    ];

    await googleSheetsService.appendToSheet('Deals', dealData);

    // Add audit log entry
    const auditData = [
      googleSheetsService.generateId(), // A: id
      dealId, // B: deal_id
      submitterEmail, // C: user_email
      'created', // D: action
      googleSheetsService.getCurrentTimestamp(), // E: timestamp
      `Deal created for ${companyName}` // F: notes
    ];

    await googleSheetsService.appendToSheet('Audit_Log', auditData);

    res.status(201).json({
      message: 'Deal registration submitted successfully',
      dealId: dealId,
      status: 'submitted',
      estimatedApprovalTime: getEstimatedApprovalTime(dealValue),
      nextSteps: [
        'Deal submitted for review',
        'You will receive an email confirmation shortly',
        'Approval typically takes 24-48 hours',
        'Contact your partner manager for urgent requests'
      ]
    });

  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({
      error: 'Failed to create deal registration',
      message: error.message
    });
  }
};

/**
 * Get all deals with optional filtering
 * GET /api/v1/deals
 */
const getDeals = async (req, res) => {
  try {
    const { status, partner, limit = 50 } = req.query;
    
    const deals = await googleSheetsService.getSheetData('Deals');
    
    if (!deals || deals.length <= 1) {
      return res.json({
        deals: [],
        total: 0,
        message: 'No deals found'
      });
    }

    const headers = deals[0];
    const submitterEmailIndex = headers.indexOf('submitter_email');
    const dealRecords = [];

    // Process deals (skip header row)
    for (let i = 1; i < Math.min(deals.length, parseInt(limit) + 1); i++) {
      const deal = {};
      headers.forEach((header, index) => {
        deal[header] = deals[i][index] || '';
      });
      
      // FIXED: Role-based filtering - admins see all deals, users see only their own
      const canViewDeal = req.user?.role === 'admin' || deal.submitter_email === req.user?.email;
      
      if (!canViewDeal) {
        continue; // Skip deals this user shouldn't see
      }
      
      // Apply additional filters
      if (status && deal.status !== status) continue;
      if (partner && deal.partner_company !== partner) continue;
      
      dealRecords.push(deal);
    }

    res.json({
      deals: dealRecords,
      total: dealRecords.length,
      filters: { status, partner, limit },
      user: {
        email: req.user?.email,
        role: req.user?.role
      }
    });

  } catch (error) {
    console.error('Get deals error:', error);
    res.status(500).json({
      error: 'Failed to retrieve deals',
      message: error.message
    });
  }
};

/**
 * Get single deal by ID
 * GET /api/v1/deals/:id
 */
const getDealById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const deal = await googleSheetsService.findRowByValue('Deals', 'id', id);
    
    if (!deal) {
      return res.status(404).json({
        error: 'Deal not found',
        dealId: id
      });
    }

    // FIXED: Check if user can view this specific deal
    const canViewDeal = req.user?.role === 'admin' || deal.submitter_email === req.user?.email;
    
    if (!canViewDeal) {
      return res.status(403).json({
        error: 'Permission denied',
        message: 'You can only view deals you submitted'
      });
    }

    res.json({
      deal: deal,
      message: 'Deal retrieved successfully'
    });

  } catch (error) {
    console.error('Get deal error:', error);
    res.status(500).json({
      error: 'Failed to retrieve deal',
      message: error.message
    });
  }
};

/**
 * Check for duplicate deals - simplified
 */
const checkDuplicateDeals = async (companyName, domain) => {
  try {
    const deals = await googleSheetsService.getSheetData('Deals');
    const duplicates = [];

    if (deals && deals.length > 1) {
      const headers = deals[0];
      const companyIndex = headers.indexOf('company_name');
      const domainIndex = headers.indexOf('domain');
      const statusIndex = headers.indexOf('status');

      for (let i = 1; i < deals.length; i++) {
        const row = deals[i];
        const existingCompany = row[companyIndex] || '';
        const existingDomain = row[domainIndex] || '';
        const existingStatus = row[statusIndex] || '';

        // Check for exact matches on active deals
        if (existingStatus !== 'rejected') {
          if (existingCompany.toLowerCase() === companyName.toLowerCase() ||
              existingDomain.toLowerCase() === domain.toLowerCase()) {
            
            const duplicate = {};
            headers.forEach((header, index) => {
              duplicate[header] = row[index] || '';
            });
            duplicates.push(duplicate);
          }
        }
      }
    }

    return {
      hasDuplicates: duplicates.length > 0,
      duplicates: duplicates
    };

  } catch (error) {
    console.error('Duplicate check error:', error);
    return { hasDuplicates: false, duplicates: [] };
  }
};

/**
 * Get estimated approval time based on deal value
 */
const getEstimatedApprovalTime = (dealValue) => {
  const value = parseFloat(dealValue?.replace(/[^0-9.]/g, '') || 0);
  
  if (value >= 500000) {
    return '3-5 business days';
  } else if (value >= 100000) {
    return '2-3 business days';
  } else {
    return '1-2 business days';
  }
};

module.exports = {
  createDeal,
  getDeals,
  getDealById,
  checkDuplicateDeals,
  getEstimatedApprovalTime
};