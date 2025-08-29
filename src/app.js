const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('express-async-errors');
require('dotenv').config();


// Import route modules
const authRoutes = require('./routes/auth');
const dealRoutes = require('./routes/deals');
const adminRoutes = require('./routes/admin');



const app = express();

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  }
});

app.use('/api', limiter);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Daxa Partner Portal API',
    version: 'v1',
    description: 'RESTful API for partner deal registration system with Google Sheets',
    endpoints: {
      health: '/health',
      authentication: '/api/v1/auth',
      deals: '/api/v1/deals',
      partners: '/api/v1/partners',
      dashboard: '/api/v1/dashboard'
    }
  });
});

// Basic route for testing
app.get('/api/v1/test', (req, res) => {
  res.json({
    message: 'Daxa Backend API is working!',
    timestamp: new Date().toISOString()
  });
});

// Authentication routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/deals', dealRoutes);
app.use('/api/v1/admin', adminRoutes);

// Test Google Sheets connection
app.get('/api/v1/test-sheets', async (req, res) => {
  try {
    const googleSheetsService = require('./services/googleSheetsService');
    const result = await googleSheetsService.testConnection();
    res.json({
      message: 'Google Sheets connection successful!',
      ...result
    });
  } catch (error) {
    res.status(500).json({
      error: 'Google Sheets connection failed',
      message: error.message
    });
  }
});

// Debug Google Sheets auth
app.get('/api/v1/debug-sheets', async (req, res) => {
  try {
    res.json({
      spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
      keyPath: process.env.GOOGLE_PRIVATE_KEY_PATH,
      fileExists: require('fs').existsSync(process.env.GOOGLE_PRIVATE_KEY_PATH),
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug OAuth config
app.get('/api/v1/debug-oauth', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID ? 'SET' : 'MISSING',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'MISSING',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
    authUrl: `http://localhost:3001/api/v1/auth/google`
  });
});

// Debug OAuth URLs
app.get('/api/v1/debug-oauth-urls', (req, res) => {
    const baseURL = `${req.protocol}://${req.get('host')}`;
    res.json({
      currentHost: req.get('host'),
      protocol: req.protocol,
      baseURL: baseURL,
      expectedCallbackURL: `${baseURL}/api/v1/auth/google/callback`,
      envCallbackURL: process.env.GOOGLE_CALLBACK_URL,
      actualPort: process.env.PORT || 3001
    });
  });

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  
  res.status(error.status || 500).json({
    error: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

module.exports = app;