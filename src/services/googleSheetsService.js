const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs');

class GoogleSheetsService {
  constructor() {
    this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    this.auth = null;
    this.sheets = null;
    this.initialized = false;
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initializeAuth();
    }
  }

  async initializeAuth() {
    try {
      let credentials;

      // Check if we have direct environment variables (Railway production)
      if (process.env.GOOGLE_SHEETS_PRIVATE_KEY && process.env.GOOGLE_SHEETS_CLIENT_EMAIL) {
        console.log('Using environment variable credentials for Google Sheets');
        
        credentials = {
          type: 'service_account',
          project_id: process.env.GOOGLE_PROJECT_ID || 'dealflow-backend-468922',
          private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
          private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
          client_id: process.env.GOOGLE_CLIENT_ID_SERVICE,
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
          universe_domain: 'googleapis.com'
        };

        this.auth = new JWT({
          email: credentials.client_email,
          key: credentials.private_key,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file'
          ]
        });

      } else {
        // Fall back to file-based authentication (development)
        console.log('Using file-based credentials for Google Sheets');
        const keyPath = process.env.GOOGLE_PRIVATE_KEY_PATH || './credentials/google-service-account.json';
        
        if (!fs.existsSync(keyPath)) {
          throw new Error(`Google service account key file not found at: ${keyPath}`);
        }

        this.auth = new JWT({
          keyFile: keyPath,
          scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file'
          ]
        });
      }

      await this.auth.authorize();
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      this.initialized = true;
      
      console.log('Google Sheets authentication successful');
    } catch (error) {
      console.error('Google Sheets authentication error:', error.message);
      throw error;
    }
  }

  /**
   * Test connection to Google Sheets
   */
  async testConnection() {
    try {
      await this.ensureInitialized();
      
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      return {
        success: true,
        title: response.data.properties.title,
        sheetCount: response.data.sheets.length,
        sheets: response.data.sheets.map(sheet => sheet.properties.title)
      };
    } catch (error) {
      console.error('Connection test failed:', error.message);
      throw error;
    }
  }

  /**
   * Get data from a specific sheet
   */
  async getSheetData(sheetName, range = null) {
    await this.ensureInitialized();
    try {
      const sheetRange = range ? `${sheetName}!${range}` : sheetName;
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: sheetRange,
      });

      return response.data.values || [];
    } catch (error) {
      console.error(`Error getting sheet data from ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Append data to a sheet
   */
  async appendToSheet(sheetName, values) {
    await this.ensureInitialized();
    try {
      const response = await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [Array.isArray(values) ? values : [values]]
        }
      });

      console.log(`Data appended to ${sheetName}`);
      return response.data;
    } catch (error) {
      console.error(`Error appending to ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Update a specific row in a sheet
   */
  async updateRow(sheetName, rowIndex, values) {
    await this.ensureInitialized();
    try {
      const response = await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${rowIndex}:${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [values]
        }
      });

      console.log(`Row ${rowIndex} updated in ${sheetName}`);
      return response.data;
    } catch (error) {
      console.error(`Error updating row in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Find a row by value in a specific column
   */
  async findRowByValue(sheetName, columnName, searchValue) {
    await this.ensureInitialized();
    try {
      const data = await this.getSheetData(sheetName);
      
      if (!data || data.length === 0) {
        return null;
      }

      const headers = data[0];
      const columnIndex = headers.indexOf(columnName);
      
      if (columnIndex === -1) {
        throw new Error(`Column '${columnName}' not found in sheet '${sheetName}'`);
      }

      // Search for the value
      for (let i = 1; i < data.length; i++) {
        if (data[i][columnIndex] === searchValue) {
          // Convert row array to object with headers as keys
          const rowObject = {};
          headers.forEach((header, index) => {
            rowObject[header] = data[i][index] || '';
          });
          return rowObject;
        }
      }

      return null;
    } catch (error) {
      console.error(`Error finding row by value in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all rows as objects with headers as keys
   */
  async getAllRows(sheetName) {
    await this.ensureInitialized();
    try {
      const data = await this.getSheetData(sheetName);
      
      if (!data || data.length < 2) {
        return [];
      }

      const headers = data[0];
      const rows = [];

      for (let i = 1; i < data.length; i++) {
        const rowObject = {};
        headers.forEach((header, index) => {
          rowObject[header] = data[i][index] || '';
        });
        rows.push(rowObject);
      }

      return rows;
    } catch (error) {
      console.error(`Error getting all rows from ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Delete a row by index
   */
  async deleteRow(sheetName, rowIndex) {
    await this.ensureInitialized();
    try {
      // Get sheet ID first
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) {
        throw new Error(`Sheet '${sheetName}' not found`);
      }

      const sheetId = sheet.properties.sheetId;

      // Delete the row
      const response = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1, // Convert to 0-based index
                endIndex: rowIndex
              }
            }
          }]
        }
      });

      console.log(`Row ${rowIndex} deleted from ${sheetName}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting row from ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Clear a range of cells
   */
  async clearRange(sheetName, range) {
    await this.ensureInitialized();
    try {
      const response = await this.sheets.spreadsheets.values.clear({
        spreadsheetId: this.spreadsheetId,
        range: `${sheetName}!${range}`
      });

      console.log(`Range ${range} cleared in ${sheetName}`);
      return response.data;
    } catch (error) {
      console.error(`Error clearing range in ${sheetName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get current timestamp in ISO format
   */
  getCurrentTimestamp() {
    return new Date().toISOString();
  }

  /**
   * Format date for Google Sheets
   */
  formatDate(date = new Date()) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  /**
   * Create a new sheet
   */
  async createSheet(sheetName) {
    await this.ensureInitialized();
    try {
      const response = await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }]
        }
      });

      console.log(`Sheet '${sheetName}' created successfully`);
      return response.data;
    } catch (error) {
      console.error(`Error creating sheet '${sheetName}':`, error.message);
      throw error;
    }
  }

  /**
   * Check if sheet exists
   */
  async sheetExists(sheetName) {
    try {
      await this.ensureInitialized();
      
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      return spreadsheet.data.sheets.some(sheet => sheet.properties.title === sheetName);
    } catch (error) {
      console.error(`Error checking if sheet exists:`, error.message);
      return false;
    }
  }

  /**
   * Batch update multiple cells
   */
  async batchUpdate(updates) {
    await this.ensureInitialized();
    try {
      const response = await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });

      console.log(`Batch update completed: ${updates.length} ranges updated`);
      return response.data;
    } catch (error) {
      console.error('Error in batch update:', error.message);
      throw error;
    }
  }

  /**
   * Get sheet metadata
   */
  async getSheetMetadata(sheetName) {
    await this.ensureInitialized();
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) {
        throw new Error(`Sheet '${sheetName}' not found`);
      }

      return {
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
        rowCount: sheet.properties.gridProperties.rowCount,
        columnCount: sheet.properties.gridProperties.columnCount
      };
    } catch (error) {
      console.error(`Error getting metadata for ${sheetName}:`, error.message);
      throw error;
    }
  }
}

module.exports = new GoogleSheetsService();