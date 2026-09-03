import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

export default function SplashScreen({ onFinish }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const timeline = Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
        { iterations: 2 }
      ),
      Animated.timing(fadeAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]);

    timeline.start(() => onFinish && onFinish());

    const spin = Animated.loop(
      Animated.timing(rotateAnim, { toValue: 1, duration: 3000, useNativeDriver: true })
    );
    spin.start();

    return () => spin.stop();
  }, []);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container}>
      <View style={styles.radarRing} />
      <View style={styles.radarRing2} />
      <Animated.View style={{ transform: [{ rotate: spin }, { scale: pulseAnim }] }}>
        <Text style={styles.gear}>{'⚙️'}</Text>
      </Animated.View>
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }, { translateY: slideAnim }],
          alignItems: 'center',
        }}
      >
        <Text style={styles.logoText}>MECHGO</Text>
        <View style={styles.logoLine} />
        <Text style={styles.tagline}>ROADSIDE DISPATCH</Text>
      </Animated.View>
      <Animated.View style={{ opacity: fadeAnim, position: 'absolute', bottom: 60 }}>
        <Text style={styles.statusText}>INITIALIZING SYSTEM...</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  radarRing: {
    position: 'absolute',
    width: width * 0.7,
    height: width * 0.7,
    borderRadius: (width * 0.7) / 2,
    borderWidth: 1,
    borderColor: 'rgba(242,167,27,0.15)',
  },
  radarRing2: {
    position: 'absolute',
    width: width * 0.45,
    height: width * 0.45,
    borderRadius: (width * 0.45) / 2,
    borderWidth: 1,
    borderColor: 'rgba(242,167,27,0.25)',
  },
  gear: {
    fontSize: 64,
    marginBottom: 24,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#F2A71B',
    letterSpacing: 4,
    textAlign: 'center',
  },
  logoLine: {
    width: 60,
    height: 3,
    backgroundColor: '#B03A22',
    marginVertical: 10,
    alignSelf: 'center',
  },
  tagline: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#888',
    letterSpacing: 3,
    textAlign: 'center',
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#555',
    letterSpacing: 2,
  },
});
