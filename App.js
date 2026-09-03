// App.js
import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Modal,
  Image,
  Linking,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { supabase, signUp, signIn, signOut, getUserProfile, uploadJobPhoto } from './supabase';
import {
  createJob,
  fetchOpenJobs,
  fetchMyJobs,
  fetchJobHistory,
  fetchBidsByMechanic,
  fetchMechanicHistory,
  placeBid,
  acceptBid,
  updateJobStatus,
  cancelJob,
  editJob,
  updateJobPhoto,
  submitRating,
  sendMessage,
  fetchMessages,
  subscribeToMessages,
  subscribeToJobChanges,
  subscribeToBids,
} from './jobs';
import { registerForLocalNotifications, notifyLocal, notifyLocalWithSound } from './notifications';
import { haversineKm, formatDistance, formatTime } from './utils';
import SplashScreen from './SplashScreen';
import RadarView from './RadarView';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [splashReady, setSplashReady] = useState(false);

  // 'landing' | 'loginForm' | 'regRole' | 'regForm' | 'app'
  const [view, setView] = useState('landing');
  const [selectedRole, setSelectedRole] = useState('driver');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [vehicle, setVehicle] = useState('bike');
  const [locLabel, setLocLabel] = useState('');
  const [jobDesc, setJobDesc] = useState('');
  const [budget, setBudget] = useState('');
  const [photoUri, setPhotoUri] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [editingJobId, setEditingJobId] = useState(null);

  const [openJobs, setOpenJobs] = useState([]);
  const [mechanicBids, setMechanicBids] = useState([]);
  const [bidPrice, setBidPrice] = useState({});
  const [bidEta, setBidEta] = useState({});

  // Active/History tab (both roles)
  const [appTab, setAppTab] = useState('active');
  const [jobHistory, setJobHistory] = useState([]);
  const [mechanicHistory, setMechanicHistory] = useState([]);

  // Sort/filter (mechanic dashboard)
  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'distance' | 'budget'
  const [vehicleFilter, setVehicleFilter] = useState('all'); // 'all' | 'bike' | 'car'
  const [coords, setCoords] = useState(null);

  // Rating modal
  const [ratingModal, setRatingModal] = useState({ visible: false, jobId: null, mechanicId: null, mechanicName: '' });
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  // Chat modal
  const [chatModal, setChatModal] = useState({ visible: false, jobId: null, otherName: '' });
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const myRequestsRef = useRef([]);
  useEffect(() => {
    myRequestsRef.current = myRequests;
  }, [myRequests]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => handleSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => handleSession(session));
    return () => subscription.unsubscribe();
  }, []);

  // Device location - used for job coordinates + mechanic distance sorting
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch (e) {
        console.log('location error', e);
      }
    })();
    registerForLocalNotifications();
  }, []);

  // Realtime -> local notifications
  useEffect(() => {
    if (!session?.user || !profile) return;
    let unsubscribe;

    if (profile.role === 'mechanic') {
      unsubscribe = subscribeToJobChanges({
        onNewOpenJob: (job) => {
          notifyLocalWithSound('New Job Nearby', job.description || 'A driver needs help');
          loadMechanicData(session.user.id).catch(() => {});
        },
      });
    } else {
      const unsubBids = subscribeToBids({
        onNewBid: (bid) => {
          const isMine = myRequestsRef.current.some((j) => j.id === bid.job_id);
          if (isMine) {
            notifyLocalWithSound('New Bid Received', 'A mechanic placed a bid on your request.');
            loadDriverData(session.user.id).catch(() => {});
          }
        },
      });
      const unsubJobs = subscribeToJobChanges({
        onJobUpdate: (job) => {
          if (job.driver_id !== session.user.id) return;
          notifyLocalWithSound('Job Update', `Your request is now ${job.status.replace('_', ' ')}.`);
          loadDriverData(session.user.id).catch(() => {});
        },
      });
      unsubscribe = () => {
        unsubBids();
        unsubJobs();
      };
    }
    return () => unsubscribe && unsubscribe();
  }, [session, profile]);

  async function handleSession(s) {
    setSession(s);
    if (s?.user) {
      const p = await getUserProfile(s.user.id);
      setProfile(p);
      setView('app');
      if (p?.role === 'mechanic') await loadMechanicData(s.user.id);
      else await loadDriverData(s.user.id);
    } else {
      setProfile(null);
      setView('landing');
    }
    setLoading(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    if (session?.user) {
      if (profile?.role === 'mechanic') await loadMechanicData(session.user.id);
      else await loadDriverData(session.user.id);
      if (appTab === 'history') await loadHistory();
    }
    setRefreshing(false);
  }

  async function refreshLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      }
    } catch (e) {
      console.log('location refresh error', e);
    }
  }

  async function loadDriverData(userId) {
    try {
      setMyRequests(await fetchMyJobs(userId));
    } catch (e) {
      console.log(e);
    }
  }

  async function loadMechanicData(userId) {
    try {
      setOpenJobs(await fetchOpenJobs());
      setMechanicBids(await fetchBidsByMechanic(userId));
    } catch (e) {
      console.log(e);
    }
  }

  async function loadHistory() {
    try {
      if (profile?.role === 'mechanic') {
        setMechanicHistory(await fetchMechanicHistory(session.user.id));
      } else {
        setJobHistory(await fetchJobHistory(session.user.id));
      }
    } catch (e) {
      console.log(e);
    }
  }

  useEffect(() => {
    if (view === 'app' && appTab === 'history') loadHistory();
  }, [appTab, view]);

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
    if (!name.trim() || !phone.trim() || !email.trim() || !password) return Alert.alert('Error', 'Please fill in all fields.');
    try {
      setLoading(true);
      await signUp({ email: email.trim(), password, role: selectedRole, name: name.trim(), phone: phone.trim() });
      Alert.alert('Success', 'Account created successfully!');
    } catch (err) {
      Alert.alert('Registration Error', err.message);
      setLoading(false);
    }
  }

  // ---------- Photo picker ----------
  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Please allow photo library access.');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  // ---------- Create / Edit job ----------
  function resetJobForm() {
    setJobDesc('');
    setLocLabel('');
    setBudget('');
    setPhotoUri(null);
    setEditingJobId(null);
  }

  function startEditJob(job) {
    setEditingJobId(job.id);
    setVehicle(job.vehicle);
    setLocLabel(job.location?.label || '');
    setJobDesc(job.description || '');
    setBudget(job.budget ? String(job.budget) : '');
  }

  async function handleCreateJob() {
    if (!jobDesc.trim()) return Alert.alert('Error', 'Please describe the breakdown issue.');
    if (!locLabel.trim()) return Alert.alert('Error', 'Please enter your location.');
    try {
      setLoading(true);
      const job = await createJob({
        driver_id: session.user.id,
        vehicle,
        location: { label: locLabel.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null },
        description: jobDesc.trim(),
        budget: budget ? Number(budget) : null,
      });
      if (photoUri) {
        try {
          const photoUrl = await uploadJobPhoto(`job-${job.id}-${Date.now()}`, photoUri);
          await updateJobPhoto(job.id, photoUrl);
        } catch (e) {
          console.log('photo upload failed', e);
        }
      }
      resetJobForm();
      await loadDriverData(session.user.id);
      Alert.alert('Broadcast Sent!', 'Nearby mechanics have been notified.');
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEdit() {
    if (!jobDesc.trim()) return Alert.alert('Error', 'Please describe the breakdown issue.');
    if (!locLabel.trim()) return Alert.alert('Error', 'Please enter your location.');
    try {
      setLoading(true);
      await editJob({
        jobId: editingJobId,
        vehicle,
        location: { label: locLabel.trim(), lat: coords?.lat ?? null, lng: coords?.lng ?? null },
        description: jobDesc.trim(),
        budget: budget ? Number(budget) : null,
      });
      resetJobForm();
      await loadDriverData(session.user.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleCancelJob(jobId) {
    Alert.alert('Cancel Request', 'Are you sure you want to cancel this request?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelJob(jobId);
            await loadDriverData(session.user.id);
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }

  // ---------- Bidding ----------
  async function handlePlaceBid(jobId) {
    const price = bidPrice[jobId];
    const eta = bidEta[jobId];
    if (!price || !eta) return Alert.alert('Error', 'Please enter price and ETA.');
    try {
      await placeBid({ job_id: jobId, mechanic_id: session.user.id, price, eta });
      Alert.alert('Bid Placed', 'Offer sent to driver.');
      loadMechanicData(session.user.id);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleAcceptBid(jobId, mechanicId) {
    try {
      await acceptBid(jobId, mechanicId);
      Alert.alert('Mechanic Assigned!', 'The mechanic is on their way.');
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

  // ---------- Ratings ----------
  async function handleSubmitRating() {
    try {
      await submitRating({
        job_id: ratingModal.jobId,
        mechanic_id: ratingModal.mechanicId,
        driver_id: session.user.id,
        rating: ratingValue,
        comment: ratingComment.trim() || null,
      });
      setRatingModal({ visible: false, jobId: null, mechanicId: null, mechanicName: '' });
      setRatingValue(5);
      setRatingComment('');
      await loadHistory();
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  // ---------- Chat / Call ----------
  function openChat(jobId, otherName) {
    setChatModal({ visible: true, jobId, otherName: otherName || 'Chat' });
  }

  function closeChat() {
    setChatModal({ visible: false, jobId: null, otherName: '' });
    setChatMessages([]);
  }

  useEffect(() => {
    if (!chatModal.visible || !chatModal.jobId) return;
    let unsub;
    (async () => {
      try {
        setChatMessages(await fetchMessages(chatModal.jobId));
      } catch (e) {
        console.log(e);
      }
    })();
    unsub = subscribeToMessages(chatModal.jobId, async (msg) => {
      setChatMessages((prev) => [...prev, msg]);
      if (msg.sender_id !== session?.user?.id) {
        let senderName = 'Someone';
        try {
          const { data } = await supabase.from('users').select('name').eq('id', msg.sender_id).single();
          if (data?.name) senderName = data.name;
        } catch (e) { /* ignore */ }
        notifyLocalWithSound('New Message', `${senderName}: ${msg.content}`);
      }
    });
    return () => unsub && unsub();
  }, [chatModal.visible, chatModal.jobId]);

  async function handleSendMessage() {
    if (!chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput('');
    try {
      await sendMessage({ job_id: chatModal.jobId, sender_id: session.user.id, content });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  function callNumber(phoneNumber) {
    if (!phoneNumber) return Alert.alert('Unavailable', 'No phone number on file.');
    Linking.openURL(`tel:${phoneNumber}`);
  }

  // ---------- Derived: sorted/filtered open jobs for mechanic ----------
  const sortedOpenJobs = useMemo(() => {
    let jobs = [...openJobs];
    if (vehicleFilter !== 'all') jobs = jobs.filter((j) => j.vehicle === vehicleFilter);

    if (sortBy === 'distance' && coords) {
      jobs.sort((a, b) => {
        const da = haversineKm(coords.lat, coords.lng, a.location?.lat, a.location?.lng);
        const db = haversineKm(coords.lat, coords.lng, b.location?.lat, b.location?.lng);
        if (da === null) return 1;
        if (db === null) return -1;
        return da - db;
      });
    } else if (sortBy === 'budget') {
      jobs.sort((a, b) => (b.budget || 0) - (a.budget || 0));
    } else {
      jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    return jobs;
  }, [openJobs, sortBy, vehicleFilter, coords]);

  if (!splashReady) {
    return <SplashScreen onFinish={() => setSplashReady(true)} />;
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

      {/* NAVBAR WITH LOGIN/LOGOUT */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.plate}
          onPress={() => {
            if (!session) setView('landing');
          }}
        >
          <View style={styles.dot} />
          <Text style={styles.plateText} numberOfLines={1}>
            MECHGO
          </Text>
        </TouchableOpacity>

        {session ? (
          <TouchableOpacity style={styles.logoutBtn} onPress={() => signOut()}>
            <Text style={styles.logoutText} numberOfLines={1}>
              Log Out
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setView('loginForm')} style={{ marginRight: 16 }}>
              <Text style={styles.navLink} numberOfLines={1}>
                Login
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setView('regRole')}>
              <Text style={styles.navLink} numberOfLines={1}>
                Register
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F2A71B" />}
      >
        {/* ================= LANDING SCREEN ================= */}
        {view === 'landing' && (
          <View style={styles.landingContainer}>
            <Text style={styles.heroEyebrow} numberOfLines={1}>
              ROADSIDE DISPATCH, REIMAGINED
            </Text>
            <Text style={styles.heroTitle}>
              BROKEN DOWN?{'\n'}MECHANICS <Text style={{ color: '#B03A22' }}>BID</Text> TO REACH YOU.
            </Text>
            <Text style={styles.heroLede}>
              MechGo connects stranded drivers with nearby verified mechanics in real time - mechanics bid with a
              price and ETA, you pick the winner, and the job goes on-site or straight to the workshop.
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setSelectedRole('driver');
                setView('regForm');
              }}
            >
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                OPEN DRIVER APP
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                setSelectedRole('mechanic');
                setView('regForm');
              }}
            >
              <Text style={styles.secondaryBtnText} numberOfLines={1}>
                JOIN AS A MECHANIC
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.sectionEyebrow} numberOfLines={1}>
              WHY THIS EXISTS
            </Text>
            <Text style={styles.sectionTitle}>THE 20 MINUTES AFTER A BREAKDOWN</Text>

            <View style={styles.problemCard}>
              <Text style={styles.cardTagProblem}>PROBLEM</Text>
              <Text style={styles.cardTitle}>NO TRUSTED MECHANIC IN REACH</Text>
              <Text style={styles.cardDesc}>
                When a vehicle breaks down mid-route, people don't know who's nearby or trustworthy. They end up
                calling friends or waiting on a passerby's recommendation.
              </Text>
            </View>

            <View style={styles.solutionCard}>
              <Text style={styles.cardTagSolution}>SOLUTION</Text>
              <Text style={styles.cardTitle}>VERIFIED MECHANICS COME TO YOU</Text>
              <Text style={styles.cardDesc}>
                MechGo broadcasts the job to nearby mechanics. They bid with a price and arrival time, the driver
                picks one, and the vehicle is fixed on-spot or towed.
              </Text>
            </View>

            <View style={styles.divider} />

            <Text style={styles.sectionEyebrow} numberOfLines={1}>
              HOW IT WORKS
            </Text>
            <Text style={styles.sectionTitle}>FOUR STEPS FROM STRANDED TO SORTED</Text>

            <View style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>1</Text>
              </View>
              <Text style={styles.stepText}>
                <Text style={{ fontWeight: 'bold' }}>SELECT VEHICLE:</Text> Choose Car or Bike.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>2</Text>
              </View>
              <Text style={styles.stepText}>
                <Text style={{ fontWeight: 'bold' }}>LOCATION:</Text> Share your current landmark.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>3</Text>
              </View>
              <Text style={styles.stepText}>
                <Text style={{ fontWeight: 'bold' }}>DESCRIBE:</Text> Tell mechanics what went wrong.
              </Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>4</Text>
              </View>
              <Text style={styles.stepText}>
                <Text style={{ fontWeight: 'bold' }}>MECHANICS BID:</Text> Pick the best price and ETA.
              </Text>
            </View>
          </View>
        )}

        {/* ================= REGISTRATION ROLE SELECT ================= */}
        {view === 'regRole' && (
          <View style={styles.roleWrap}>
            <Text style={styles.roleHeader} numberOfLines={1}>
              JOIN MECHGO
            </Text>
            <Text style={styles.roleSub} numberOfLines={1}>
              Select your account type to register
            </Text>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => {
                setSelectedRole('driver');
                setView('regForm');
              }}
            >
              <Text style={styles.roleIcon}>🚦</Text>
              <Text style={styles.roleCardTitle} numberOfLines={1} adjustsFontSizeToFit>
                I AM A DRIVER
              </Text>
              <Text style={styles.roleCardDesc}>Request emergency roadside assistance</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.roleCard}
              onPress={() => {
                setSelectedRole('mechanic');
                setView('regForm');
              }}
            >
              <Text style={styles.roleIcon}>🔧</Text>
              <Text style={styles.roleCardTitle} numberOfLines={1} adjustsFontSizeToFit>
                I AM A MECHANIC
              </Text>
              <Text style={styles.roleCardDesc}>Browse live requests & send bids</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView('landing')}>
              <Text style={styles.backLink} numberOfLines={1}>
                Back to Home
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= LOGIN FORM ================= */}
        {view === 'loginForm' && (
          <View style={styles.card}>
            <Text style={styles.formTitle} numberOfLines={1}>
              LOGIN TO MECHGO
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
            <TextInput style={styles.input} placeholder="********" secureTextEntry value={password} onChangeText={setPassword} />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin}>
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                LOG IN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setView('landing')}>
              <Text style={styles.backLink}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= REGISTER FORM ================= */}
        {view === 'regForm' && (
          <View style={styles.card}>
            <Text style={styles.formTitle} numberOfLines={1}>
              {selectedRole === 'mechanic' ? 'MECHANIC REGISTRATION' : 'DRIVER REGISTRATION'}
            </Text>
            <Text style={styles.inputLabel}>FULL NAME / SHOP NAME</Text>
            <TextInput style={styles.input} placeholder="e.g. Ahmed Auto" value={name} onChangeText={setName} />
            <Text style={styles.inputLabel}>PHONE NUMBER</Text>
            <TextInput style={styles.input} placeholder="03xx-xxxxxxx" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              placeholder="name@example.com"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <Text style={styles.inputLabel}>PASSWORD</Text>
            <TextInput style={styles.input} placeholder="********" secureTextEntry value={password} onChangeText={setPassword} />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleRegister}>
              <Text style={styles.primaryBtnText} numberOfLines={1}>
                CREATE ACCOUNT
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setView('regRole')}>
              <Text style={styles.backLink}>Change Account Type</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ================= DRIVER APP VIEW ================= */}
        {view === 'app' && profile?.role === 'driver' && (
          <View style={{ width: '100%' }}>
            <Text style={styles.appTitle}>DRIVER DISPATCH PANEL</Text>

            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, appTab === 'active' && styles.tabBtnActive]}
                onPress={() => setAppTab('active')}
              >
                <Text style={[styles.tabBtnText, appTab === 'active' && styles.tabBtnTextActive]}>ACTIVE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, appTab === 'history' && styles.tabBtnActive]}
                onPress={() => setAppTab('history')}
              >
                <Text style={[styles.tabBtnText, appTab === 'history' && styles.tabBtnTextActive]}>HISTORY</Text>
              </TouchableOpacity>
            </View>

            {appTab === 'active' && (
              <View>
                <View style={styles.darkCard}>
                  <Text style={styles.darkCardTitle}>{editingJobId ? 'EDIT REQUEST' : 'REQUEST ASSISTANCE'}</Text>
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
                  <View style={styles.locStatusRow}>
                    <Text style={styles.locStatusText}>
                      {coords ? `GPS: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : 'GPS: ACQUIRING...'}
                    </Text>
                    <TouchableOpacity style={styles.locRefreshBtn} onPress={refreshLocation}>
                      <Text style={styles.locRefreshText}>REFRESH</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.darkLabel}>LOCATION</Text>
                  <TextInput
                    style={styles.darkInput}
                    placeholder="e.g. Tariq Road"
                    placeholderTextColor="#666"
                    value={locLabel}
                    onChangeText={setLocLabel}
                  />
                  <Text style={styles.darkLabel}>ISSUE</Text>
                  <TextInput
                    style={[styles.darkInput, { height: 70 }]}
                    multiline
                    placeholder="e.g. Flat tire"
                    placeholderTextColor="#666"
                    value={jobDesc}
                    onChangeText={setJobDesc}
                  />
                  <Text style={styles.darkLabel}>BUDGET (OPTIONAL, RS)</Text>
                  <TextInput
                    style={styles.darkInput}
                    placeholder="e.g. 1500"
                    placeholderTextColor="#666"
                    keyboardType="numeric"
                    value={budget}
                    onChangeText={setBudget}
                  />

                  {!editingJobId && (
                    <TouchableOpacity style={styles.photoPickBtn} onPress={pickPhoto}>
                      <Text style={styles.photoPickText}>{photoUri ? "📷 Photo Selected" : "📷 Add Photo (optional)"}</Text>
                    </TouchableOpacity>
                  )}
                  {photoUri && <Image source={{ uri: photoUri }} style={styles.photoPreview} />}

                  <TouchableOpacity style={styles.primaryBtn} onPress={editingJobId ? handleSaveEdit : handleCreateJob}>
                    <Text style={styles.primaryBtnText} numberOfLines={1}>
                      {editingJobId ? 'SAVE CHANGES' : 'BROADCAST REQUEST'}
                    </Text>
                  </TouchableOpacity>
                  {editingJobId && (
                    <TouchableOpacity onPress={resetJobForm}>
                      <Text style={styles.backLink}>Cancel Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={styles.sectionHeading}>MY REQUESTS</Text>
                {myRequests.length === 0 ? (
                  <Text style={styles.emptyHint}>No requests yet.</Text>
                ) : (
                  myRequests.map((j) => {
                    const acceptedBid = j.bids?.find((b) => b.mechanic_id === j.accepted_mechanic_id);
                    return (
                      <View key={j.id} style={styles.jobCard}>
                        <View style={styles.jobTop}>
                          <Text style={styles.jobVeh}>{j.vehicle.toUpperCase()}</Text>
                          <Text style={styles.jobPill}>{j.status.toUpperCase()}</Text>
                        </View>
                        <Text style={styles.jobDesc}>{j.description}</Text>
                        <Text style={styles.jobLoc}>📍 {j.location?.label}</Text>
                        {!!j.budget && <Text style={styles.jobBudget}>Budget: Rs {j.budget}</Text>}
                        {!!j.photo_url && <Image source={{ uri: j.photo_url }} style={styles.jobPhoto} />}

                        {j.status === 'open' && (
                          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                            <TouchableOpacity
                              style={[styles.statusBtn, { backgroundColor: '#3E4F60' }]}
                              onPress={() => startEditJob(j)}
                            >
                              <Text style={styles.statusBtnText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.statusBtn, { backgroundColor: '#B03A22' }]}
                              onPress={() => handleCancelJob(j.id)}
                            >
                              <Text style={styles.statusBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {['assigned', 'in_progress'].includes(j.status) && acceptedBid && (
                          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                            <TouchableOpacity
                              style={[styles.statusBtn, { backgroundColor: '#3E4F60' }]}
                              onPress={() => callNumber(acceptedBid.mechanic?.phone)}
                            >
                              <Text style={styles.statusBtnText}>Call</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.statusBtn, { backgroundColor: '#2F6B4F' }]}
                              onPress={() => openChat(j.id, acceptedBid.mechanic?.name)}
                            >
                              <Text style={styles.statusBtnText}>Chat</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        {j.bids && j.bids.length > 0 && (
                          <View style={styles.bidsContainer}>
                            <Text style={styles.bidsHeader}>BIDS ({j.bids.length})</Text>
                            {j.bids.map((b) => (
                              <View key={b.id} style={styles.bidItem}>
                                <View>
                                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>{b.mechanic?.name}</Text>
                                  <Text style={{ color: '#F2A71B', fontSize: 13 }}>
                                    Rs {b.price} - {b.eta} min
                                    {b.mechanic?.rating ? ` - Rating ${b.mechanic.rating}` : ''}
                                  </Text>
                                </View>
                                {j.status === 'open' && (
                                  <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAcceptBid(j.id, b.mechanic_id)}>
                                    <Text style={styles.acceptBtnText}>ACCEPT</Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {appTab === 'history' && (
              <View>
                {jobHistory.length === 0 ? (
                  <Text style={styles.emptyHint}>No past requests yet.</Text>
                ) : (
                  jobHistory.map((j) => {
                    const acceptedBid = j.bids?.find((b) => b.mechanic_id === j.accepted_mechanic_id);
                    const existingRating = j.ratings && j.ratings[0];
                    return (
                      <View key={j.id} style={styles.jobCard}>
                        <View style={styles.jobTop}>
                          <Text style={styles.jobVeh}>{j.vehicle.toUpperCase()}</Text>
                          <Text style={[styles.jobPill, j.status === 'cancelled' && { color: '#B03A22' }]}>
                            {j.status.toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.jobDesc}>{j.description}</Text>
                        <Text style={styles.jobLoc}>📍 {j.location?.label}</Text>
                        {acceptedBid && (
                          <Text style={{ color: '#AAA', fontSize: 12, marginTop: 4 }}>Mechanic: {acceptedBid.mechanic?.name}</Text>
                        )}
                        {j.status === 'completed' && acceptedBid && !existingRating && (
                          <TouchableOpacity
                            style={[styles.statusBtn, { backgroundColor: '#F2A71B', marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 16 }]}
                            onPress={() =>
                              setRatingModal({
                                visible: true,
                                jobId: j.id,
                                mechanicId: acceptedBid.mechanic_id,
                                mechanicName: acceptedBid.mechanic?.name,
                              })
                            }
                          >
                            <Text style={[styles.statusBtnText, { color: '#191A16' }]}>RATE MECHANIC</Text>
                          </TouchableOpacity>
                        )}
                        {existingRating && (
                          <Text style={{ color: '#F2A71B', marginTop: 6 }}>
                            Rating: {existingRating.rating}/5
                            {existingRating.comment ? ` - "${existingRating.comment}"` : ''}
                          </Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </View>
        )}

        {/* ================= MECHANIC APP VIEW ================= */}
        {view === 'app' && profile?.role === 'mechanic' && (
          <View style={{ width: '100%' }}>
            <Text style={styles.appTitle}>MECHANIC DASHBOARD</Text>
            {!!profile.rating && <Text style={styles.ratingBadge}>YOUR RATING: {profile.rating} / 5</Text>}

            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tabBtn, appTab === 'active' && styles.tabBtnActive]}
                onPress={() => setAppTab('active')}
              >
                <Text style={[styles.tabBtnText, appTab === 'active' && styles.tabBtnTextActive]}>ACTIVE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabBtn, appTab === 'history' && styles.tabBtnActive]}
                onPress={() => setAppTab('history')}
              >
                <Text style={[styles.tabBtnText, appTab === 'history' && styles.tabBtnTextActive]}>HISTORY</Text>
              </TouchableOpacity>
            </View>

            {appTab === 'active' && (
              <View>
                <Text style={styles.sectionHeading}>LIVE REQUESTS 📡</Text>

                <View style={styles.filterRow}>
                  {['newest', 'distance', 'budget'].map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.filterChip, sortBy === s && styles.filterChipActive]}
                      onPress={() => setSortBy(s)}
                    >
                      <Text style={[styles.filterChipText, sortBy === s && styles.filterChipTextActive]}>{s.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                  {['all', 'bike', 'car'].map((v) => (
                    <TouchableOpacity
                      key={v}
                      style={[styles.filterChip, vehicleFilter === v && styles.filterChipActive]}
                      onPress={() => setVehicleFilter(v)}
                    >
                      <Text style={[styles.filterChipText, vehicleFilter === v && styles.filterChipTextActive]}>
                        {v.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <RadarView jobs={sortedOpenJobs} coords={coords} />

                {sortedOpenJobs.length === 0 ? (
                  <Text style={styles.emptyHint}>Scanning area...</Text>
                ) : (
                  sortedOpenJobs.map((j) => {
                    const dist = coords ? haversineKm(coords.lat, coords.lng, j.location?.lat, j.location?.lng) : null;
                    return (
                      <View key={j.id} style={styles.jobCard}>
                        <View style={styles.jobTop}>
                          <Text style={styles.jobVeh}>{j.vehicle.toUpperCase()}</Text>
                          <Text style={{ color: '#AAA', fontSize: 12 }}>👤 {j.driver?.name}</Text>
                        </View>
                        <Text style={styles.jobDesc}>{j.description}</Text>
                        <Text style={styles.jobLoc}>
                          📍 {j.location?.label}
                          {formatDistance(dist) ? ` - ${formatDistance(dist)}` : ''}
                        </Text>
                        {!!j.budget && <Text style={styles.jobBudget}>Budget: Rs {j.budget}</Text>}
                        {!!j.photo_url && <Image source={{ uri: j.photo_url }} style={styles.jobPhoto} />}
                        <View style={styles.bidRow}>
                          <TextInput
                            style={styles.bidInput}
                            placeholder="Rs"
                            placeholderTextColor="#777"
                            keyboardType="numeric"
                            onChangeText={(val) => setBidPrice({ ...bidPrice, [j.id]: val })}
                          />
                          <TextInput
                            style={styles.bidInput}
                            placeholder="Min"
                            placeholderTextColor="#777"
                            keyboardType="numeric"
                            onChangeText={(val) => setBidEta({ ...bidEta, [j.id]: val })}
                          />
                          <TouchableOpacity style={styles.bidBtn} onPress={() => handlePlaceBid(j.id)}>
                            <Text style={styles.bidBtnText}>BID</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })
                )}

                <Text style={styles.sectionHeading}>MY JOBS</Text>
                {mechanicBids.length === 0 ? (
                  <Text style={styles.emptyHint}>No assigned jobs yet.</Text>
                ) : (
                  mechanicBids.map((b) => (
                    <View key={b.id} style={styles.jobCard}>
                      <Text style={styles.jobVeh}>{b.job?.vehicle?.toUpperCase()}</Text>
                      <Text style={{ color: '#F2A71B', fontSize: 13 }}>
                        Rs {b.price} - {b.eta} min
                      </Text>
                      <Text style={{ color: '#2F6B4F', marginTop: 4, fontWeight: 'bold' }}>Status: {b.job?.status?.toUpperCase()}</Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                        <TouchableOpacity
                          style={[styles.statusBtn, { backgroundColor: '#3E4F60' }]}
                          onPress={() => callNumber(b.job?.driver?.phone)}
                        >
                          <Text style={styles.statusBtnText}>Call</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.statusBtn, { backgroundColor: '#2F6B4F' }]}
                          onPress={() => openChat(b.job_id, b.job?.driver?.name)}
                        >
                          <Text style={styles.statusBtnText}>Chat</Text>
                        </TouchableOpacity>
                      </View>
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
                            <Text style={styles.statusBtnText}>Complete</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </View>
            )}

            {appTab === 'history' && (
              <View>
                {mechanicHistory.length === 0 ? (
                  <Text style={styles.emptyHint}>No completed jobs yet.</Text>
                ) : (
                  mechanicHistory.map((b) => (
                    <View key={b.id} style={styles.jobCard}>
                      <Text style={styles.jobVeh}>{b.job?.vehicle?.toUpperCase()}</Text>
                      <Text style={{ color: '#F2A71B', fontSize: 13 }}>
                        Rs {b.price} - {b.eta} min
                      </Text>
                      <Text style={{ color: '#AAA', fontSize: 12, marginTop: 4 }}>Driver: {b.job?.driver?.name}</Text>
                      {b.job?.ratings?.length > 0 ? (
                        <Text style={{ color: '#F2A71B', marginTop: 6 }}>
                          Rating: {b.job.ratings[0].rating}/5
                          {b.job.ratings[0].comment ? ` - "${b.job.ratings[0].comment}"` : ''}
                        </Text>
                      ) : (
                        <Text style={{ color: '#666', fontStyle: 'italic', marginTop: 6 }}>Not rated yet</Text>
                      )}
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ================= RATING MODAL ================= */}
      <Modal visible={ratingModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.card}>
            <Text style={styles.formTitle}>RATE {ratingModal.mechanicName?.toUpperCase()}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <TouchableOpacity key={n} onPress={() => setRatingValue(n)}>
                  <Text style={{ fontSize: 22, marginHorizontal: 4, fontWeight: 'bold', color: n <= ratingValue ? '#F2A71B' : '#CCC' }}>
                    {n}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, { height: 70 }]}
              multiline
              placeholder="Optional comment"
              value={ratingComment}
              onChangeText={setRatingComment}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSubmitRating}>
              <Text style={styles.primaryBtnText}>SUBMIT RATING</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setRatingModal({ visible: false, jobId: null, mechanicId: null, mechanicName: '' })}
            >
              <Text style={styles.backLink}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ================= CHAT MODAL ================= */}
      <Modal visible={chatModal.visible} animationType="slide" onRequestClose={closeChat}>
        <SafeAreaView style={styles.chatContainer}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatHeaderTitle} numberOfLines={1}>
              {chatModal.otherName}
            </Text>
            <TouchableOpacity onPress={closeChat}>
              <Text style={styles.chatCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.chatScroll} contentContainerStyle={{ padding: 14 }}>
            {chatMessages.length === 0 ? (
              <Text style={styles.chatEmpty}>No messages yet - say hello.</Text>
            ) : (
              chatMessages.map((m) => {
                const isMine = m.sender_id === session?.user?.id;
                return (
                    <View
                      key={m.id}
                      style={[styles.chatBubble, isMine ? styles.chatBubbleMine : styles.chatBubbleTheirs]}
                    >
                      <Text style={[styles.chatText, isMine ? styles.chatTextMine : styles.chatTextTheirs]}>{m.content}</Text>
                      <Text style={[styles.chatTime, isMine ? styles.chatTimeMine : styles.chatTimeTheirs]}>{formatTime(m.created_at)}</Text>
                    </View>
                );
              })
            )}
          </ScrollView>
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Type a message..."
              placeholderTextColor="#888"
              value={chatInput}
              onChangeText={setChatInput}
            />
            <TouchableOpacity style={styles.bidBtn} onPress={handleSendMessage}>
              <Text style={styles.bidBtnText}>SEND</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// ================= STYLES =================
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#C7C4B8' },
  center: { justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: 20, flexGrow: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 50,
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
  navLink: { color: '#3E4F60', fontWeight: 'bold', fontSize: 15 },
  logoutBtn: { padding: 6 },
  logoutText: { color: '#B03A22', fontWeight: 'bold', fontSize: 15 },

  landingContainer: { width: '100%', paddingBottom: 40 },
  heroEyebrow: { fontSize: 11, letterSpacing: 1.5, color: '#3E4F60', marginBottom: 8, fontWeight: 'bold' },
  heroTitle: { fontSize: 32, fontWeight: '900', color: '#191A16', marginBottom: 16, lineHeight: 36 },
  heroLede: { fontSize: 14, color: '#3E4F60', lineHeight: 22, marginBottom: 24 },

  divider: { height: 4, backgroundColor: '#191A16', width: 40, marginVertical: 30 },

  sectionEyebrow: { fontSize: 11, letterSpacing: 1.5, color: '#3E4F60', marginBottom: 8, fontWeight: 'bold' },
  sectionTitle: { fontSize: 22, fontWeight: '900', color: '#191A16', marginBottom: 20 },

  problemCard: { backgroundColor: '#FFF', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#B03A22', borderLeftWidth: 6, marginBottom: 16 },
  cardTagProblem: { color: '#B03A22', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 6 },

  solutionCard: { backgroundColor: '#FFF', padding: 20, borderRadius: 8, borderWidth: 1, borderColor: '#2F6B4F', borderLeftWidth: 6, marginBottom: 16 },
  cardTagSolution: { color: '#2F6B4F', fontSize: 10, fontWeight: 'bold', letterSpacing: 1, marginBottom: 6 },

  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#191A16', marginBottom: 8 },
  cardDesc: { fontSize: 13, color: '#3E4F60', lineHeight: 20 },

  stepRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1EFE7', borderWidth: 1, borderColor: '#191A16', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  stepNumText: { fontWeight: 'bold', color: '#191A16', fontSize: 14 },
  stepText: { fontSize: 14, color: '#3E4F60', flex: 1 },

  primaryBtn: { backgroundColor: '#F2A71B', paddingVertical: 15, borderRadius: 8, width: '100%', marginVertical: 6, justifyContent: 'center' },
  primaryBtnText: { color: '#191A16', fontWeight: 'bold', fontSize: 15, textAlign: 'center', width: '100%' },
  secondaryBtn: { borderWidth: 2, borderColor: '#191A16', paddingVertical: 15, borderRadius: 8, width: '100%', marginVertical: 6, justifyContent: 'center' },
  secondaryBtnText: { color: '#191A16', fontWeight: 'bold', fontSize: 15, textAlign: 'center', width: '100%' },

  roleWrap: { paddingTop: 20, width: '100%' },
  roleHeader: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 6, width: '100%' },
  roleSub: { textAlign: 'center', color: '#3E4F60', marginBottom: 20, width: '100%' },
  roleCard: { backgroundColor: '#F1EFE7', borderWidth: 1, borderColor: '#DDD', borderRadius: 12, paddingVertical: 20, paddingHorizontal: 10, width: '100%', marginBottom: 14, alignItems: 'center', justifyContent: 'center' },
  roleIcon: { fontSize: 32, marginBottom: 8, textAlign: 'center' },
  roleCardTitle: { fontWeight: 'bold', fontSize: 16, textAlign: 'center', width: '100%' },
  roleCardDesc: { color: '#666', fontSize: 12, marginTop: 2, textAlign: 'center', width: '100%' },

  backLink: { textAlign: 'center', marginTop: 16, color: '#3E4F60', fontWeight: 'bold', width: '100%' },

  card: { backgroundColor: '#F1EFE7', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#DDD', width: '100%' },
  formTitle: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  inputLabel: { fontSize: 11, fontWeight: 'bold', color: '#3E4F60', marginBottom: 4 },
  input: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#DDD', borderRadius: 6, padding: 10, marginBottom: 14 },

  appTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 6 },
  ratingBadge: { fontSize: 12, fontWeight: 'bold', color: '#3E4F60', marginBottom: 10 },

  tabRow: { flexDirection: 'row', backgroundColor: '#F1EFE7', borderRadius: 8, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  tabBtnActive: { backgroundColor: '#191A16' },
  tabBtnText: { color: '#3E4F60', fontWeight: 'bold', fontSize: 12 },
  tabBtnTextActive: { color: '#F2A71B' },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterChip: { borderWidth: 1, borderColor: '#191A16', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  filterChipActive: { backgroundColor: '#191A16' },
  filterChipText: { fontSize: 11, fontWeight: 'bold', color: '#191A16' },
  filterChipTextActive: { color: '#F2A71B' },

  darkCard: { backgroundColor: '#22241E', borderRadius: 12, padding: 18, marginBottom: 20 },
  darkCardTitle: { color: '#F2A71B', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 12 },
  darkLabel: { color: '#AAA', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  darkInput: { backgroundColor: '#181913', borderWidth: 1, borderColor: '#3D3F35', color: '#FFF', borderRadius: 6, padding: 10, marginBottom: 12 },
  vehToggleRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  vehBtn: { flex: 1, backgroundColor: '#181913', borderWidth: 1, borderColor: '#3D3F35', padding: 10, borderRadius: 6, alignItems: 'center' },
  vehBtnActive: { backgroundColor: '#F2A71B', borderColor: '#F2A71B' },
  vehBtnText: { color: '#FFF', fontWeight: 'bold' },
  vehBtnTextActive: { color: '#191A16' },
  locStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  locStatusText: { color: '#888', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 },
  locRefreshBtn: { borderWidth: 1, borderColor: '#3D3F35', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4 },
  locRefreshText: { color: '#F2A71B', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },

  photoPickBtn: { borderWidth: 1, borderColor: '#3D3F35', borderRadius: 6, padding: 10, marginBottom: 10, alignItems: 'center' },
  photoPickText: { color: '#F2A71B', fontWeight: 'bold', fontSize: 13 },
  photoPreview: { width: '100%', height: 140, borderRadius: 8, marginBottom: 12 },
  jobPhoto: { width: '100%', height: 130, borderRadius: 8, marginTop: 8 },

  sectionHeading: { fontSize: 14, fontWeight: 'bold', color: '#3E4F60', marginTop: 10, marginBottom: 10 },
  jobCard: { backgroundColor: '#181913', borderRadius: 8, padding: 14, marginBottom: 12 },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  jobVeh: { color: '#F2A71B', fontWeight: 'bold', fontSize: 12 },
  jobPill: { color: '#2F6B4F', fontSize: 11, fontWeight: 'bold' },
  jobDesc: { color: '#DAD8CC', fontSize: 14, marginBottom: 6 },
  jobLoc: { color: '#888', fontSize: 12 },
  jobBudget: { color: '#F2A71B', fontSize: 12, marginTop: 4 },
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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(25,26,22,0.6)', justifyContent: 'center', padding: 20 },

  chatContainer: { flex: 1, backgroundColor: '#121212' },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(242,167,27,0.15)',
    backgroundColor: '#121212',
  },
  chatHeaderTitle: { fontWeight: 'bold', fontSize: 16, color: '#EFECE1', letterSpacing: 1 },
  chatCloseText: { color: '#F2A71B', fontWeight: 'bold', fontSize: 14, letterSpacing: 1 },
  chatScroll: { flex: 1, backgroundColor: '#121212' },
  chatEmpty: { color: '#666', fontStyle: 'italic', marginBottom: 10, textAlign: 'center', marginTop: 20 },
  chatInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#3D3F35',
    color: '#FFF',
    borderRadius: 6,
    padding: 10,
    marginBottom: 0,
  },
  chatBubble: { maxWidth: '80%', padding: 10, borderRadius: 10, marginBottom: 8 },
  chatBubbleMine: { backgroundColor: '#F2A71B', alignSelf: 'flex-end' },
  chatBubbleTheirs: { backgroundColor: '#1A1A1A', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#333' },
  chatText: { fontSize: 14 },
  chatTextMine: { color: '#191A16' },
  chatTextTheirs: { color: '#EFECE1' },
  chatTime: { fontSize: 9, marginTop: 4, textAlign: 'right' },
  chatTimeMine: { color: 'rgba(25,26,22,0.6)' },
  chatTimeTheirs: { color: '#888' },
  chatInputRow: { flexDirection: 'row', gap: 8, padding: 14, borderTopWidth: 1, borderTopColor: '#333', backgroundColor: '#121212' },
});