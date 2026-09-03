import React, { useEffect, useRef, useMemo } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions } from 'react-native';
import { haversineKm, formatDistance } from './utils';

const { width } = Dimensions.get('window');
const RADAR_SIZE = Math.min(width * 0.78, 320);

function bearing(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export default function RadarView({ jobs, coords }) {
  const sweepAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sweep = Animated.loop(
      Animated.timing(sweepAnim, { toValue: 1, duration: 4000, useNativeDriver: true })
    );
    sweep.start();
    return () => sweep.stop();
  }, []);

  const blips = useMemo(() => {
    if (!coords || !jobs) return [];
    const MAX_RANGE_KM = 50;
    return jobs
      .map((job) => {
        const dist = haversineKm(coords.lat, coords.lng, job.location?.lat, job.location?.lng);
        if (dist === null || dist > MAX_RANGE_KM) return null;
        const bear = bearing(coords.lat, coords.lng, job.location?.lat, job.location?.lng);
        const radius = (dist / MAX_RANGE_KM) * (RADAR_SIZE / 2);
        const angleRad = ((bear - 90) * Math.PI) / 180;
        const x = Math.cos(angleRad) * radius;
        const y = Math.sin(angleRad) * radius;
        return { job, dist, x, y };
      })
      .filter(Boolean);
  }, [jobs, coords]);

  const sweepRotate = sweepAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const radarStyle = {
    width: RADAR_SIZE,
    height: RADAR_SIZE,
    borderRadius: RADAR_SIZE / 2,
    backgroundColor: '#0A0A0A',
    borderWidth: 2,
    borderColor: '#F2A71B',
    overflow: 'hidden',
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>LIVE RADAR</Text>
      <View style={styles.radarContainer}>
        <View style={radarStyle}>
          {[0.25, 0.5, 0.75, 1].map((scale) => (
            <View
              key={scale}
              style={[
                styles.ring,
                {
                  width: RADAR_SIZE * scale,
                  height: RADAR_SIZE * scale,
                  borderRadius: (RADAR_SIZE * scale) / 2,
                },
              ]}
            />
          ))}
          <View style={styles.crossH} />
          <View style={styles.crossV} />
          <Animated.View
            style={[
              styles.sweep,
              {
                width: RADAR_SIZE / 2,
                height: RADAR_SIZE / 2,
                borderRadius: RADAR_SIZE / 2,
                transform: [{ rotate: sweepRotate }],
              },
            ]}
          />
          <View style={styles.centerDot} />
          {!coords && (
            <View style={styles.noGps}>
              <Text style={styles.noGpsText}>WAITING FOR GPS...</Text>
            </View>
          )}
          {blips.map((blip) => {
            const color = blip.job.vehicle === 'car' ? '#F2A71B' : '#2F6B4F';
            return (
              <View
                key={blip.job.id}
                style={[
                  styles.blip,
                  {
                    left: RADAR_SIZE / 2 + blip.x - 6,
                    top: RADAR_SIZE / 2 + blip.y - 6,
                    backgroundColor: color,
                  },
                ]}
              >
                <Text style={styles.blipLabel}>{formatDistance(blip.dist)}</Text>
              </View>
            );
          })}
        </View>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#F2A71B' }]} />
          <Text style={styles.legendText}>CAR</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#2F6B4F' }]} />
          <Text style={styles.legendText}>BIKE</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 14, fontWeight: 'bold', color: '#F2A71B', letterSpacing: 1, marginBottom: 10 },
  radarContainer: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(242,167,27,0.12)', top: 0, left: 0 },
  crossH: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(242,167,27,0.15)' },
  crossV: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(242,167,27,0.15)' },
  sweep: { position: 'absolute', top: 0, left: 0, backgroundColor: 'rgba(242,167,27,0.08)', transformOrigin: 'top left' },
  centerDot: { position: 'absolute', top: '50%', left: '50%', width: 8, height: 8, borderRadius: 4, backgroundColor: '#F2A71B', marginTop: -4, marginLeft: -4 },
  blip: { position: 'absolute', width: 12, height: 12, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  blipLabel: { position: 'absolute', top: 14, left: -10, fontSize: 9, color: '#AAA', fontWeight: 'bold', width: 50 },
  noGps: { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -60 }, { translateY: -10 }] },
  noGpsText: { fontSize: 10, fontWeight: 'bold', color: '#B03A22', letterSpacing: 1 },
  legend: { flexDirection: 'row', gap: 20, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, fontWeight: 'bold', color: '#AAA', letterSpacing: 1 },
});
