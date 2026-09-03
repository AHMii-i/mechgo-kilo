// notifications.js
// Local notifications: fired on this device in response to Supabase realtime
// events (new bid, job status change). No push server/token needed.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForLocalNotifications() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  return true;
}

export async function notifyLocal(title, body, sound = false) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: sound ? 'default' : undefined },
      trigger: null,
    });
  } catch (e) {
    console.log('notifyLocal failed', e);
  }
}

export async function notifyLocalWithSound(title, body) {
  return notifyLocal(title, body, true);
}