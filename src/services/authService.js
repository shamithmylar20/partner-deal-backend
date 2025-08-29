const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const googleSheetsService = require('./googleSheetsService');

class AuthService {
  constructor() {
    this.initializeGoogleStrategy();
  }

  initializeGoogleStrategy() {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/v1/auth/google/callback',
      scope: ['profile', 'email'] // Explicitly request email scope
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const result = await this.googleLogin(profile);
        return done(null, result);
      } catch (error) {
        console.error('Google Strategy Error:', error);
        return done(error);
      }
    }));
  }

  async googleLogin(profile) {
    try {
      console.log('=== GOOGLE PROFILE DEBUG ===');
      console.log('Full profile object:', JSON.stringify(profile, null, 2));
      console.log('Profile keys:', Object.keys(profile));
      console.log('Profile.email directly:', profile.email);
      console.log('===========================');

      // The profile object IS the user data - Google returns it directly
      const email = profile.email;
      const firstName = profile.given_name || 'Unknown';
      const lastName = profile.family_name || 'User';
      const googleId = profile.sub; // Google uses 'sub' for user ID

      if (!email) {
        console.error('No email found in profile keys:', Object.keys(profile));
        console.error('Profile email value:', profile.email);
        throw new Error('No email found in Google profile. Please ensure email scope is granted.');
      }

      console.log('Successfully extracted - Email:', email, 'Name:', firstName, lastName, 'ID:', googleId);

      // Check if user exists in Users sheet
      let user = await googleSheetsService.findRowByValue('Users', 'email', email);

      if (!user) {
        // Create new user with default partner company
        const defaultPartnerCompany = this.getPartnerCompanyFromEmail(email);
        
        const userData = [
          googleId, // id
          email, // email
          firstName, // first_name
          lastName, // last_name
          defaultPartnerCompany, // partner_company
          'user', // role
          'active', // status
          googleSheetsService.getCurrentTimestamp() // created_at
        ];

        await googleSheetsService.appendToSheet('Users', userData);
        
        // Fetch the newly created user
        user = await googleSheetsService.findRowByValue('Users', 'email', email);
        
        console.log('✅ New user created:', email);
      } else {
        console.log('✅ Existing user found:', email);
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

      return {
        user: userData,
        accessToken: accessToken
      };

    } catch (error) {
      console.error('Google login error:', error);
      throw new Error('Authentication failed: ' + error.message);
    }
  }

  /**
   * Determine partner company from email domain
   * This is a simple mapping - you can customize this logic
   */
  getPartnerCompanyFromEmail(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    
    // Simple domain to partner company mapping
    const domainMappings = {
      'techflow.com': 'TechFlow Solutions',
      'digitalinnovations.com': 'Digital Innovations Inc.',
      'cloudware.com': 'CloudWare Partners',
      'databridge.com': 'DataBridge Consulting',
      'daxa.ai': 'Daxa Internal', // For internal testing
    };

    return domainMappings[domain] || 'External Partner';
  }

  /**
   * Create or update user in Users sheet
   */
  async createOrUpdateUser(profile) {
    try {
      const email = profile.emails[0].value;
      const firstName = profile.name.givenName;
      const lastName = profile.name.familyName;
      
      let user = await googleSheetsService.findRowByValue('Users', 'email', email);
      
      if (!user) {
        // Create new user
        const partnerCompany = this.getPartnerCompanyFromEmail(email);
        
        const userData = [
          profile.id, // id (use Google ID)
          email,
          firstName,
          lastName,
          partnerCompany,
          'user', // default role
          'active', // status
          googleSheetsService.getCurrentTimestamp()
        ];

        await googleSheetsService.appendToSheet('Users', userData);
        user = await googleSheetsService.findRowByValue('Users', 'email', email);
      }

      return user;
    } catch (error) {
      console.error('Create/update user error:', error);
      throw error;
    }
  }

  /**
   * Generate JWT token
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      partnerId: user.partner_company
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '24h'
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}

module.exports = new AuthService();