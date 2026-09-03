// jobs.js
import { supabase } from './supabase';

// ---------- CREATE / READ ----------

export async function createJob({ driver_id, vehicle, location, description, budget = null, photo_url = null }) {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ driver_id, vehicle, location, description, status: 'open', budget, photo_url })
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

// Active requests only (history has its own fetcher below)
export async function fetchMyJobs(driverId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, bids!bids_job_id_fkey(*, mechanic:users!bids_mechanic_id_fkey(name, phone, rating))')
    .eq('driver_id', driverId)
    .in('status', ['open', 'assigned', 'in_progress'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchJobHistory(driverId) {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, bids!bids_job_id_fkey(*, mechanic:users!bids_mechanic_id_fkey(name, phone, rating)), ratings(*)')
    .eq('driver_id', driverId)
    .in('status', ['completed', 'cancelled'])
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

  // FIX: previously this returned every job the mechanic had *bid* on that was
  // assigned/in_progress, even if a DIFFERENT mechanic's bid was the one accepted.
  // Now we only include jobs actually assigned to THIS mechanic.
  return bids
    .map((bid) => ({ ...bid, job: jobs.find((j) => j.id === bid.job_id) }))
    .filter(
      (b) =>
        b.job &&
        b.job.accepted_mechanic_id === mechanicId &&
        ['assigned', 'in_progress'].includes(b.job.status)
    );
}

export async function fetchMechanicHistory(mechanicId) {
  const { data: bids, error: bidsErr } = await supabase
    .from('bids')
    .select('*')
    .eq('mechanic_id', mechanicId);
  if (bidsErr) throw bidsErr;
  if (!bids || bids.length === 0) return [];

  const jobIds = [...new Set(bids.map((b) => b.job_id))];
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('*, driver:users!jobs_driver_id_fkey(name, phone), ratings(*)')
    .in('id', jobIds)
    .eq('status', 'completed');
  if (jobsErr) throw jobsErr;

  return bids
    .map((bid) => ({ ...bid, job: jobs.find((j) => j.id === bid.job_id) }))
    .filter((b) => b.job && b.job.accepted_mechanic_id === mechanicId);
}

// ---------- BIDDING / STATUS ----------

export async function placeBid({ job_id, mechanic_id, price, eta }) {
  const { data, error } = await supabase
    .from('bids')
    .insert({ job_id, mechanic_id, price, eta })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function acceptBid(jobId, mechanicId) {
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'assigned', accepted_mechanic_id: mechanicId })
    .eq('id', jobId);
  if (error) throw error;
}

export async function updateJobStatus(jobId, status) {
  const { error } = await supabase.from('jobs').update({ status }).eq('id', jobId);
  if (error) throw error;
}

// ---------- CANCEL / EDIT (driver, only while still open) ----------

export async function cancelJob(jobId) {
  const { error } = await supabase
    .from('jobs')
    .update({ status: 'cancelled' })
    .eq('id', jobId)
    .eq('status', 'open');
  if (error) throw error;
}

export async function editJob({ jobId, location, description, vehicle, budget }) {
  const { error } = await supabase
    .from('jobs')
    .update({ location, description, vehicle, budget })
    .eq('id', jobId)
    .eq('status', 'open');
  if (error) throw error;
}

// ---------- PHOTO UPLOAD ----------
// Actual upload to storage lives in supabase.js (uploadJobPhoto). This just
// persists the returned public URL onto the job row.

export async function updateJobPhoto(jobId, photo_url) {
  const { error } = await supabase.from('jobs').update({ photo_url }).eq('id', jobId);
  if (error) throw error;
}

// ---------- RATINGS ----------

export async function submitRating({ job_id, mechanic_id, driver_id, rating, comment }) {
  const { error: ratingErr } = await supabase
    .from('ratings')
    .insert({ job_id, mechanic_id, driver_id, rating, comment });
  if (ratingErr) throw ratingErr;

  const { data: allRatings, error: fetchErr } = await supabase
    .from('ratings')
    .select('rating')
    .eq('mechanic_id', mechanic_id);
  if (fetchErr) throw fetchErr;

  const avg = allRatings.reduce((sum, r) => sum + r.rating, 0) / (allRatings.length || 1);

  const { error: updateErr } = await supabase
    .from('users')
    .update({ rating: Math.round(avg * 10) / 10 })
    .eq('id', mechanic_id);
  if (updateErr) throw updateErr;
}

// ---------- CHAT ----------

export async function sendMessage({ job_id, sender_id, content }) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ job_id, sender_id, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchMessages(jobId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*, sender:users!messages_sender_id_fkey(name, role)')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export function subscribeToMessages(jobId, onInsert) {
  const channel = supabase
    .channel(`messages-job-${jobId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `job_id=eq.${jobId}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---------- REALTIME (drives local notifications) ----------

export function subscribeToJobChanges({ onNewOpenJob, onJobUpdate } = {}) {
  const channel = supabase
    .channel('jobs-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, (payload) => {
      if (onNewOpenJob && payload.new.status === 'open') onNewOpenJob(payload.new);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jobs' }, (payload) => {
      onJobUpdate && onJobUpdate(payload.new);
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToBids({ onNewBid } = {}) {
  const channel = supabase
    .channel('bids-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bids' }, (payload) => {
      onNewBid && onNewBid(payload.new);
    })
    .subscribe();
  return () => supabase.removeChannel(channel);
}