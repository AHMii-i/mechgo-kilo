-- Tow Provider Fleet Management
-- Run this in Supabase SQL Editor

-- Update role constraint to allow tow_provider
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('driver','mechanic','tow','tow_provider'));

CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tow_provider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('flatbed', 'hook_and_chain', 'wheel_lift', 'integrated')),
  name TEXT NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tow providers can view own fleet" ON fleet_vehicles
  FOR SELECT USING (auth.uid() = tow_provider_id);

CREATE POLICY "Tow providers can insert own fleet" ON fleet_vehicles
  FOR INSERT WITH CHECK (auth.uid() = tow_provider_id);

CREATE POLICY "Tow providers can delete own fleet" ON fleet_vehicles
  FOR DELETE USING (auth.uid() = tow_provider_id);

-- Add tow-specific bid columns
ALTER TABLE bids ADD COLUMN IF NOT EXISTS fleet_vehicle_id UUID REFERENCES fleet_vehicles(id);
ALTER TABLE bids ADD COLUMN IF NOT EXISTS is_tow_bid BOOLEAN DEFAULT false;

-- Add tow status values to jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accepted_tow_provider_id UUID REFERENCES users(id);
