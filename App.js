// App.js
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { supabase, signUp, signIn, signOut, getUserProfile } from './supabase';
import { createJob, fetchOpenJobs, fetchMyJobs, fetchBidsByMechanic, placeBid, acceptBid, updateJobStatus } from './jobs';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Navigation & Auth Flow: 'landing' | 'loginRole' | 'loginForm' | 'regRole' | 'regForm' | 'app'
  const [view, setView] = useState('landing');
  const [selectedRole, setSelectedRole] = useState('driver');

  // Auth Inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  // Driver States
  const [vehicle, setVehicle] = useState('bike');
  const [locLabel, setLocLabel] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [myRequests, setMyRequests] = useState([]);

  // Mechanic States
  const [openJobs, setOpenJobs] = useState([]);
  const [mechanicBids, setMechanicBids] = useState([]);
  const [bidPrice, setBidPrice] = useState({});
  const [bidEta, setBidEta] = useState({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSession(s) {
    setSession(s);
    if (s?.user) {
      const p = await getUserProfile(s.user.id);
      setProfile(p);
      setView('app');
      if (p?.role === 'mechanic') {
        loadMechanicData(s.user.id);
      } else {
        loadDriverData(s.user.id);
      }
    } else {
      setProfile(null);
      setView('landing');
    }
    setLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    if (session?.user) {
      if (profile?.role === 'mechanic') {
        await loadMechanicData(session.user.id);
      } else {
        await loadDriverData(session.user.id);
      }
    }
    setRefreshing(false);
  }

  async function loadDriverData(userId) {
    try {
      const jobs = await fetchMyJobs(userId);
      setMyRequests(jobs);
    } catch (e) {
      console.log(e);
    }
  }

  async function loadMechanicData(userId) {
    try {
      const jobs = await fetchOpenJobs();
      setOpenJobs(jobs);
      const bids = await fetchBidsByMechanic(userId);
      setMechanicBids(bids);
    } catch (e) {
      console.log(e);
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password) return Alert.alert('Error', 'Please enter email and password.');
    try {
      setLoading(true);
      await signIn({ email: email.trim(), password });
    } catch (err) {
      Alert.alert('Login Error', err.message);
      setLoading(false);
    }
  }

  async function handleRegister() {
    if (!name.trim() || !phone.trim() || !email.trim() || !password) {
      return Alert.alert('Error', 'Please fill in all registration fields.');
    }
    try {
      setLoading(true);
      await signUp({
        email: email.trim(),
        password,
        role: selectedRole,
        name: name.trim(),
        phone: phone.trim(),
      });
      Alert.alert('Success', 'Account created successfully!');
    } catch (err) {
      Alert.alert('Registration Error', err.message);
      setLoading(false);
    }
  }

  async function handleCreateJob() {
    if (!jobDesc.trim()) return Alert.alert('Error', 'Please describe the breakdown issue.');
    if (!locLabel.trim()) return Alert.alert('Error', 'Please enter your current location landmark.');

    try {
      setLoading(true);
      await createJob({
        driver_id: session.user.id,
        vehicle,
        location: { label: locLabel.trim() },
        description: jobDesc.trim(),
      });
      setJobDesc('');
      setLocLabel('');
      await loadDriverData(session.user.id);
      Alert.alert('Broadcast Sent!', 'Nearby verified mechanics have been notified.');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePlaceBid(jobId) {
    const price = bidPrice[jobId];
    const eta = bidEta[jobId];
    if (!price || !eta) return Alert.alert('Error', 'Please enter both your bid price (Rs) and ETA (mins).');

    try {
      await placeBid({ job_id: jobId, mechanic_id: session.user.id, price, eta });
      Alert.alert('Bid Placed', 'Your offer has been sent to the driver.');
      loadMechanicData(session.user.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleAcceptBid(jobId) {
    try {
      await acceptBid(jobId);
      Alert.alert('Mechanic Assigned!', 'The mechanic is now dispatched to your location.');
      loadDriverData(session.user.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleUpdateStatus(jobId, status) {
    try {
      await updateJobStatus(jobId, status);
      Alert.alert('Status Updated', `Job marked as ${status}.`);
      loadMechanicData(session.user.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#F2A71B" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#C7C4B8" />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <View style={styles.plate}>
          <View style={styles.dot} />
          <Text style={styles.plateText}>MECHGO</Text>
        </View>

        {session ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={() => signOut()}>
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F2A71B" />}
      >
        {/* ================= LANDING SCREEN ================= */}
        {view === 'landing' && (
          <View style={styles.landingWrap}>
            <Text style={styles.heroEyebrow}>ROADSIDE DISPATCH, REIMAGINED</Text>
            <Text style={styles.heroTitle}>
              STRANDED?{'\n'}GET <Text style={{ color: '#B03A22' }}>FIXED</Text> FAST.
            </Text>
            <Text style={styles.heroLede}>
              Connect instantly with certified mechanics nearby, receive competitive bids, and track repairs in real-time.
            </Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={() => setView('regRole')}>
              <Text style={styles.primaryBtnText}>GET HELP NOW</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setView('loginRole')}>
              <Text style={styles.secondaryBtnText}>LOG IN</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= ROLE SELECT ================= */}
        {(view === 'loginRole' || view === 'regRole') && (
          <View style={styles.roleWrap}>
            <Text style={styles.roleHeader}>
              {view === 'loginRole' ? 'LOG IN TO MECHGO' : 'JOIN MECHGO'}
            </Text>
            <Text style={styles.roleSub}>Select your account role</Text>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => {
                setSelectedRole('driver');
                setView(view === 'loginRole' ? 'loginForm' : 'regForm');
              }}
            >
              <Text style={styles.roleIcon}>🚦</Text>
              <Text style={styles.roleCardTitle}>I AM A DRIVER</Text>
              <Text style={styles.roleCardDesc}>Request emergency roadside assistance</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => {
                setSelectedRole('mechanic');
                setView(view === 'loginRole' ? 'loginForm' : 'regForm');
              }}
            >
              <Text style={styles.roleIcon}>🔧</Text>
              <Text style={styles.roleCardTitle}>I AM A MECHANIC</Text>
              <Text style={styles.roleCardDesc}>Browse live requests & send bids</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView('landing')}>
              <Text style={styles.backLink}>← Back to Home</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= LOGIN FORM ================= */}
        {view === 'loginForm' && (
          <View style={styles.card}>
            <Text style={styles.formTitle}>
              {selectedRole === 'mechanic' ? 'MECHANIC LOGIN' : 'DRIVER LOGIN'}
            </Text>

            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              placeholder="name@example.com"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.inputLabel}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin}>
              <Text style={styles.primaryBtnText}>LOG IN</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView('loginRole')}>
              <Text style={styles.backLink}>← Change Account Type</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= REGISTER FORM ================= */}
        {view === 'regForm' && (
          <View style={styles.card}>
            <Text style={styles.formTitle}>
              {selectedRole === 'mechanic' ? 'MECHANIC REGISTRATION' : 'DRIVER REGISTRATION'}
            </Text>

            <Text style={styles.inputLabel}>FULL NAME / SHOP NAME</Text>
            <TextInput style={styles.input} placeholder="e.g. Ahmed Auto Garage" value={name} onChangeText={setName} />

            <Text style={styles.inputLabel}>PHONE NUMBER</Text>
            <TextInput style={styles.input} placeholder="03xx-xxxxxxx" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <TextInput style={styles.input} placeholder="name@example.com" autoCapitalize="none" value={email} onChangeText={setEmail} />

            <Text style={styles.inputLabel}>PASSWORD</Text>
            <TextInput style={styles.input} placeholder="••••••••" secureTextEntry value={password} onChangeText={setPassword} />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRegister}>
              <Text style={styles.primaryBtnText}>CREATE ACCOUNT</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView('regRole')}>
              <Text style={styles.backLink}>← Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= DRIVER APP VIEW ================= */}
        {view === 'app' && profile?.role === 'driver' && (
          <View>
            <Text style={styles.appTitle}>DRIVER DISPATCH PANEL</Text>

            {/* Broadcast Form */}
            <View style={styles.darkCard}>
              <Text style={styles.darkCardTitle}>REQUEST ROADSIDE ASSISTANCE</Text>

              <View style={styles.vehToggleRow}>
                <TouchableOpacity
                  style={[styles.vehBtn, vehicle === 'bike' && styles.vehBtnActive]}
                  onPress={() => setVehicle('bike')}
                >
                  <Text style={[styles.vehBtnText, vehicle === 'bike' && styles.vehBtnTextActive]}>🏍 Bike</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.vehBtn, vehicle === 'car' && styles.vehBtnActive]}
                  onPress={() => setVehicle('car')}
                >
                  <Text style={[styles.vehBtnText, vehicle === 'car' && styles.vehBtnTextActive]}>🚗 Car</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.darkLabel}>LOCATION LANDMARK</Text>
              <TextInput
                style={styles.darkInput}
                placeholder="e.g. Tariq Road near Dolmen Mall"
                placeholderTextColor="#666"
                value={locLabel}
                onChangeText={setLocLabel}
              />

              <Text style={styles.darkLabel}>DESCRIBE THE ISSUE</Text>
              <TextInput
                style={[styles.darkInput, { height: 70 }]}
                multiline
                placeholder="e.g. Engine won't crank, flat rear tire"
                placeholderTextColor="#666"
                value={jobDesc}
                onChangeText={setJobDesc}
              />

              <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateJob}>
                <Text style={styles.primaryBtnText}>BROADCAST TO NEARBY MECHANICS</Text>
              </TouchableOpacity>
            </View>

            {/* My Requests & Bids */}
            <Text style={styles.sectionHeading}>MY BREAKDOWN REQUESTS</Text>
            {myRequests.length === 0 ? (
              <Text style={styles.emptyHint}>No requests created yet. Submit one above!</Text>
            ) : (
              myRequests.map((j) => (
                <View key={j.id} style={styles.jobCard}>
                  <View style={styles.jobTop}>
                    <Text style={styles.jobVeh}>{j.vehicle.toUpperCase()}</Text>
                    <Text style={styles.jobPill}>{j.status.toUpperCase()}</Text>
                  </View>
                  <Text style={styles.jobDesc}>{j.description}</Text>
                  <Text style={styles.jobLoc}>📍 {j.location?.label || 'GPS Pin'}</Text>

                  {/* Incoming Bids Section */}
                  {j.bids && j.bids.length > 0 && (
                    <View style={styles.bidsContainer}>
                      <Text style={styles.bidsHeader}>INCOMING MECHANIC BIDS ({j.bids.length})</Text>
                      {j.bids.map((b) => (
                        <View key={b.id} style={styles.bidItem}>
                          <View>
                            <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{b.mechanic?.name || 'Mechanic'} (★ {b.mechanic?.rating || 5.0})</Text>
                            <Text style={{ color: '#F2A71B', fontSize: 13, marginTop: 2 }}>Rs {b.price} · ETA {b.eta} mins</Text>
                          </View>
                          {j.status === 'open' && (
                            <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAcceptBid(j.id)}>
                              <Text style={styles.acceptBtnText}>ACCEPT</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {/* ================= MECHANIC APP VIEW ================= */}
        {view === 'app' && profile?.role === 'mechanic' && (
          <View>
            <Text style={styles.appTitle}>MECHANIC COMMAND CENTER</Text>

            <View style={styles.darkCard}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#FFF' }}>{profile.name}</Text>
              <Text style={{ color: '#F2A71B', marginVertical: 4 }}>★ {profile.rating || 5.0} Rating · 📞 {profile.phone}</Text>
              <Text style={{ color: '#888', fontSize: 12 }}>Status: Online & Ready for Dispatch</Text>
            </View>

            <Text style={styles.sectionHeading}>LIVE OPEN REQUESTS NEARBY 📡</Text>
            {openJobs.length === 0 ? (
              <Text style={styles.emptyHint}>Scanning area for breakdowns...</Text>
            ) : (
              openJobs.map((j) => (
                <View key={j.id} style={styles.jobCard}>
                  <View style={styles.jobTop}>
                    <Text style={styles.jobVeh}>{j.vehicle.toUpperCase()}</Text>
                    <Text style={{ color: '#AAA', fontSize: 12 }}>👤 {j.driver?.name || 'Driver'}</Text>
                  </View>
                  <Text style={styles.jobDesc}>{j.description}</Text>
                  <Text style={styles.jobLoc}>📍 {j.location?.label || 'GPS Pin'}</Text>

                  <View style={styles.bidRow}>
                    <TextInput
                      style={styles.bidInput}
                      placeholder="Price (Rs)"
                      placeholderTextColor="#777"
                      keyboardType="numeric"
                      onChangeText={(val) => setBidPrice({ ...bidPrice, [j.id]: val })}
                    />
                    <TextInput
                      style={styles.bidInput}
                      placeholder="ETA (min)"
                      placeholderTextColor="#777"
                      keyboardType="numeric"
                      onChangeText={(val) => setBidEta({ ...bidEta, [j.id]: val })}
                    />
                    <TouchableOpacity style={styles.bidBtn} onPress={() => handlePlaceBid(j.id)}>
                      <Text style={styles.bidBtnText}>SEND BID</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}

            <Text style={styles.sectionHeading}>MY BIDS & ASSIGNED JOBS</Text>
            {mechanicBids.length === 0 ? (
              <Text style={styles.emptyHint}>You have not placed any bids yet.</Text>
            ) : (
              mechanicBids.map((b) => (
                <View key={b.id} style={styles.jobCard}>
                  <Text style={styles.jobVeh}>{b.job?.vehicle?.toUpperCase()}</Text>
                  <Text style={styles.jobDesc}>{b.job?.description}</Text>
                  <Text style={{ color: '#F2A71B', fontSize: 13, marginTop: 4 }}>
                    Your Offer: Rs {b.price} · ETA {b.eta} min
                  </Text>
                  <Text style={{ color: '#2F6B4F', marginTop: 4, fontWeight: 'bold' }}>
                    Job Status: {b.job?.status?.toUpperCase()}
                  </Text>

                  {b.job?.status === 'assigned' && (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity
                        style={[styles.statusBtn, { backgroundColor: '#3E4F60' }]}
                        onPress={() => handleUpdateStatus(b.job_id, 'in_progress')}
                      >
                        <Text style={styles.statusBtnText}>En Route</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.statusBtn, { backgroundColor: '#2F6B4F' }]}
                        onPress={() => handleUpdateStatus(b.job_id, 'completed')}
                      >
                        <Text style={styles.statusBtnText}>Complete Job</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#C7C4B8' },
  center: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(25,26,22,0.1)',
  },
  plate: {
    backgroundColor: '#F1EFE7',
    borderWidth: 2,
    borderColor: '#191A16',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B03A22', marginRight: 6 },
  plateText: { fontWeight: 'bold', fontSize: 16, color: '#191A16' },
  logoutBtn: { padding: 6 },
  logoutText: { color: '#3E4F60', fontWeight: 'bold' },

  landingWrap: { paddingTop: 40, alignItems: 'center' },
  heroEyebrow: { fontSize: 12, letterSpacing: 1.5, color: '#3E4F60', marginBottom: 10, fontWeight: 'bold' },
  heroTitle: { fontSize: 34, fontWeight: 'bold', textAlign: 'center', color: '#191A16', marginBottom: 16 },
  heroLede: { fontSize: 14, color: '#3E4F60', textAlign: 'center', lineHeight: 20, marginBottom: 30 },

  primaryBtn: { backgroundColor: '#F2A71B', padding: 14, borderRadius: 8, alignItems: 'center', width: '100%', marginVertical: 6 },
  primaryBtnText: { color: '#191A16', fontWeight: 'bold', fontSize: 14 },
  secondaryBtn: { borderWidth: 2, borderColor: '#191A16', padding: 14, borderRadius: 8, alignItems: 'center', width: '100%', marginVertical: 6 },
  secondaryBtnText: { color: '#191A16', fontWeight: 'bold', fontSize: 14 },

  roleWrap: { paddingTop: 20 },
  roleHeader: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 6 },
  roleSub: { textAlign: 'center', color: '#3E4F60', marginBottom: 20 },
  roleCard: { backgroundColor: '#F1EFE7', borderWidth: 1, borderColor: '#DDD', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 14 },
  roleIcon: { fontSize: 32, marginBottom: 8 },
  roleCardTitle: { fontWeight: 'bold', fontSize: 16 },
  roleCardDesc: { color: '#666', fontSize: 12, marginTop: 2 },
  backLink: { textAlign: 'center', marginTop: 16, color: '#3E4F60', fontWeight: 'bold' },

  card: { backgroundColor: '#F1EFE7', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#DDD' },
  formTitle: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  inputLabel: { fontSize: 11, fontWeight: 'bold', color: '#3E4F60', marginBottom: 4 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DDD', borderRadius: 6, padding: 10, marginBottom: 14 },

  appTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 14 },
  darkCard: { backgroundColor: '#22241E', borderRadius: 12, padding: 18, marginBottom: 20 },
  darkCardTitle: { color: '#F2A71B', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 12 },
  darkLabel: { color: '#AAA', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  darkInput: { backgroundColor: '#181913', borderWidth: 1, borderColor: '#3D3F35', color: '#FFF', borderRadius: 6, padding: 10, marginBottom: 12 },

  vehToggleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  vehBtn: { flex: 1, backgroundColor: '#181913', borderWidth: 1, borderColor: '#3D3F35', padding: 10, borderRadius: 6, alignItems: 'center' },
  vehBtnActive: { backgroundColor: '#F2A71B', borderColor: '#F2A71B' },
  vehBtnText: { color: '#FFF', fontWeight: 'bold' },
  vehBtnTextActive: { color: '#191A16' },

  sectionHeading: { fontSize: 14, fontWeight: 'bold', color: '#3E4F60', marginTop: 10, marginBottom: 10 },
  jobCard: { backgroundColor: '#181913', borderRadius: 8, padding: 14, marginBottom: 12 },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  jobVeh: { color: '#F2A71B', fontWeight: 'bold', fontSize: 12 },
  jobPill: { color: '#2F6B4F', fontSize: 11, fontWeight: 'bold' },
  jobDesc: { color: '#DAD8CC', fontSize: 14, marginBottom: 6 },
  jobLoc: { color: '#888', fontSize: 12 },
  emptyHint: { color: '#666', fontStyle: 'italic', marginBottom: 10 },

  bidsContainer: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#333', paddingTop: 10 },
  bidsHeader: { color: '#F2A71B', fontSize: 11, fontWeight: 'bold', marginBottom: 8 },
  bidItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#22241E', padding: 10, borderRadius: 6, marginBottom: 6 },
  acceptBtn: { backgroundColor: '#2F6B4F', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  acceptBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 11 },

  bidRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  bidInput: { flex: 1, backgroundColor: '#22241E', borderWidth: 1, borderColor: '#3D3F35', color: '#FFF', borderRadius: 6, padding: 8, fontSize: 12 },
  bidBtn: { backgroundColor: '#2F6B4F', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6 },
  bidBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 12 },

  statusBtn: { flex: 1, padding: 8, borderRadius: 6, alignItems: 'center' },
  statusBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 11 },
});