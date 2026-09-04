// supabase.js
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://usmmjpoicjimglbgtbcc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzbW1qcG9pY2ppbWdsYmd0YmNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MDg2NTMsImV4cCI6MjEwMjk4NDY1M30.Nl1htiV6XfPKyXAdkyRUHpWDANxwAyuilHuttNHHPY4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // prevents automatic deep-link handling
  },
});

export async function signUp({ email, password, role, name, phone }) {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Use a regular web URL instead of a custom scheme
      redirectTo: 'https://mechgo-app.com',
    },
  });
  if (authError) throw authError;

  if (authData?.user) {
    const { error: profileError } = await supabase.from('users').insert({
      id: authData.user.id,
      role,
      name,
      phone,
    });
    if (profileError) throw profileError;
  }
  return authData;
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
  if (error) return null;
  return data;
}

export async function uploadJobPhoto(fileName, uri) {
  const fileExt = uri.split('.').pop();
  const fullName = `${fileName}.${fileExt}`;
  const formData = new FormData();
  formData.append('file', {
    uri,
    type: `image/${fileExt}`,
    name: fullName,
  });

  const { data, error } = await supabase.storage
    .from('job-photos')
    .upload(fullName, formData, {
      cacheControl: '3600',
      upsert: false,
    });
  if (error) throw error;

  const { data: urlData } = supabase.storage
    .from('job-photos')
    .getPublicUrl(fullName);
  return urlData.publicUrl;
}

export async function updateMechanicAvailability(userId, isAvailable, location = null) {
  const updateData = {
    is_available: isAvailable,
    last_active_at: new Date().toISOString(),
  };
  if (location) {
    updateData.last_location = location;
  }
  const { error } = await supabase.from('users').update(updateData).eq('id', userId);
  if (error) throw error;
}

export async function getAvailableMechanics(lat, lng, radiusKm = 2, serviceType = 'mechanic') {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, phone, rating, last_location, avatar_url, is_tow_provider')
    .eq('role', 'mechanic')
    .eq('is_available', true);
  if (error) throw error;
  
  let filtered = data.filter(m => {
    if (!m.last_location) return false;
    const dist = haversineKm(lat, lng, m.last_location.lat, m.last_location.lng);
    return dist !== null && dist <= radiusKm;
  });
  
  if (serviceType === 'tow') {
    filtered = filtered.filter(m => m.is_tow_provider === true);
  }
  
  return filtered.map(m => ({
    ...m,
    distance: haversineKm(lat, lng, m.last_location.lat, m.last_location.lng)
  })).sort((a, b) => a.distance - b.distance);
}