const { DbService } = require('../services/db-service');

async function initializeDatabase() {
  const db = new DbService();
  
  // First create schema
  await db.initialize();
  
  // Insert test data
  const testData = `
    -- Insert some zip codes
    INSERT INTO zip_codes (zip, city, state, latitude, longitude) VALUES
    ('95138', 'San Jose', 'CA', 37.2358, -121.7858),
    ('95148', 'San Jose', 'CA', 37.3358, -121.8158),
    ('95123', 'San Jose', 'CA', 37.2258, -121.8458)
    ON CONFLICT (zip) DO NOTHING;

    -- Insert service types
    INSERT INTO service_types (name, description) VALUES
    ('plumbing', 'Plumbing services including repairs and installations'),
    ('electrical', 'Electrical work and repairs'),
    ('hvac', 'Heating, ventilation, and air conditioning services')
    ON CONFLICT (name) DO NOTHING;

    -- Insert contractors
    INSERT INTO contractors (name, company_name, phone, email, service_type_id, zip_code, rating) VALUES
    ('John Smith', 'Smith Plumbing', '4081234567', 'john@smithplumbing.com', 
      (SELECT id FROM service_types WHERE name = 'plumbing'), '95138', 4.8),
    ('Mike Johnson', 'Johnson Electric', '4087654321', 'mike@johnsonelectric.com',
      (SELECT id FROM service_types WHERE name = 'electrical'), '95148', 4.9)
    ON CONFLICT DO NOTHING;

    -- Insert availability
    INSERT INTO availability (contractor_id, date_start, date_end, status) VALUES
    (1, NOW(), NOW() + INTERVAL '1 week', 'available'),
    (2, NOW(), NOW() + INTERVAL '1 week', 'available')
    ON CONFLICT DO NOTHING;
  `;
  
  try {
    await db.pool.query(testData);
    console.log('Test data inserted successfully');
  } catch (error) {
    console.error('Error inserting test data:', error);
  }
}

// Add test data
const TEST_DATA = `
  INSERT INTO service_types (name, description) VALUES
  ('roofing', 'Roof repairs and installations'),
  ('plumbing', 'Plumbing services'),
  ('electrical', 'Electrical services')
  ON CONFLICT (name) DO NOTHING;

  INSERT INTO zip_codes (zip, city, state, latitude, longitude) VALUES
  ('94102', 'San Francisco', 'CA', 37.7749, -122.4194),
  ('94103', 'San Francisco', 'CA', 37.7749, -122.4194)
  ON CONFLICT (zip) DO NOTHING;

  INSERT INTO contractors (name, company_name, service_type_id, zip_code, active, rating)
  VALUES 
  ('John Smith', 'Smith Roofing', 
    (SELECT id FROM service_types WHERE name = 'roofing'), 
    '94102', true, 4.8),
  ('Mike Johnson', 'Johnson Electric',
    (SELECT id FROM service_types WHERE name = 'electrical'),
    '94103', true, 4.9)
  ON CONFLICT DO NOTHING;
`;

// Add to initialization
async function initializeDatabase() {
  const db = new DbService();
  await db.initialize();
  await db.pool.query(TEST_DATA);
  console.log('Test data inserted successfully');
}

initializeDatabase().catch(console.error); 