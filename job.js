// jobs.js
import { supabase } from './supabase';

export async function createJob({ driver_id, vehicle, location, description }) {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ driver_id, vehicle, location, description, status: 'open' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchOpenJobs() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, driver:users!jobs_driver_id_fkey(name, phone)')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchMyJobs(driverId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, bids(*, mechanic:users!bids_mechanic_id_fkey(name, phone, rating))')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchBidsByMechanic(mechanicId) {
  const { data: bids, error: bidsErr } = await supabase
    .from('bids')
    .select('*')
    .eq('mechanic_id', mechanicId)
    .order('created_at', { ascending: false });

  if (bidsErr) throw bidsErr;
  if (!bids || bids.length === 0) return [];

  const jobIds = [...new Set(bids.map((b) => b.job_id))];
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('*, driver:users!jobs_driver_id_fkey(name, phone)')
    .in('id', jobIds);

  if (jobsErr) throw jobsErr;

  return bids.map((bid) => ({
    ...bid,
    job: jobs.find((j) => j.id === bid.job_id),
  }));
}

export async function placeBid({ job_id, mechanic_id, price, eta }) {
  const { data, error } = await supabase
    .from('bids')
    .insert({ job_id, mechanic_id, price, eta })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptBid(jobId) {
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'assigned' })
    .eq('id', jobId);
  if (error) throw error;
}

export async function updateJobStatus(jobId, status) {
  const { error } = await supabase.from('jobs').update({ status }).eq('id', jobId);
  if (error) throw error;
}