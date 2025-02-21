const { Pool } = require('pg');  // Using PostgreSQL

// SQL Schema
const SCHEMA = `
  -- Zip code table with geocoding
  CREATE TABLE IF NOT EXISTS zip_codes (
    zip VARCHAR(5) PRIMARY KEY,
    city VARCHAR(100),
    state VARCHAR(2),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6)
  );

  -- Service types lookup table
  CREATE TABLE IF NOT EXISTS service_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,  -- e.g., 'plumbing', 'electrical', 'hvac'
    description TEXT
  );

  -- Contractors table
  CREATE TABLE IF NOT EXISTS contractors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    company_name VARCHAR(100),
    phone VARCHAR(15),
    email VARCHAR(255),
    service_type_id INTEGER REFERENCES service_types(id),
    zip_code VARCHAR(5) REFERENCES zip_codes(zip),
    active BOOLEAN DEFAULT true,
    rating DECIMAL(3,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Availability table
  CREATE TABLE IF NOT EXISTS availability (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER REFERENCES contractors(id),
    date_start TIMESTAMP NOT NULL,
    date_end TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'available',  -- available, booked, blocked
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- Bookings table
  CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    contractor_id INTEGER REFERENCES contractors(id),
    customer_name VARCHAR(100),
    customer_phone VARCHAR(15),
    customer_zip VARCHAR(5) REFERENCES zip_codes(zip),
    service_description TEXT,
    booking_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, confirmed, completed, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

class DbService {
  constructor() {
    this.pool = new Pool({
      user: process.env.PGUSER || process.env.USER || 'anushkajogalekar',
      host: 'localhost',
      database: 'contractors_db',
      port: 5432
    });
  }

  async initialize() {
    try {
      await this.pool.query(SCHEMA);
      console.log('Database schema initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database schema:', error);
      throw error;
    }
  }

  // Basic query to find contractor by zip and service
  async findContractor(zipCode, serviceType) {
    const query = `
      SELECT c.*, s.name as service_type
      FROM contractors c
      JOIN service_types s ON c.service_type_id = s.id
      WHERE c.zip_code = $1 
      AND s.name = $2
      AND c.active = true
      LIMIT 1;
    `;
    
    return await this.pool.query(query, [zipCode, serviceType]);
  }

  async findAvailableContractor(zipCode, serviceType) {
    const query = `
      SELECT c.*, s.name as service_type
      FROM contractors c
      JOIN service_types s ON c.service_type_id = s.id
      WHERE c.zip_code = $1 
      AND s.name = $2
      AND c.active = true
      LIMIT 1;
    `;
    
    try {
      const result = await this.pool.query(query, [zipCode, serviceType]);
      return {
        found: result.rows.length > 0,
        contractor: result.rows[0] || null,
        message: result.rows.length > 0 
          ? `Great! I found ${result.rows[0].name} who can help with your ${serviceType} needs. Would you like me to check their availability?`
          : `I apologize, but I don't have any ${serviceType} professionals in your area right now. Would you like me to take your number for a callback?`
      };
    } catch (error) {
      console.error('Database error:', error);
      return {
        found: false,
        contractor: null,
        message: "I'm having trouble checking availability right now. Would you like me to take your number for a callback?"
      };
    }
  }
}

module.exports = { DbService }; 