import { Platform } from 'react-native';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import { AudioModule } from 'expo-audio';

export type PermissionKey = 'camera' | 'microphone' | 'photos' | 'contacts' | 'location';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface PermissionResult {
  key: PermissionKey;
  status: PermissionState;
}

const isWeb = Platform.OS === 'web';

/** Normalize the various expo permission shapes into our simple state. */
function normalize(status: string | undefined, canAskAgain?: boolean): PermissionState {
  if (status === 'granted') return 'granted';
  if (status === 'undetermined') return 'undetermined';
  if (status === 'denied' && canAskAgain) return 'undetermined';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/** Request a single device permission. Safe to call on web (returns 'unsupported' where relevant). */
export async function requestPermission(key: PermissionKey): Promise<PermissionState> {
  try {
    switch (key) {
      case 'camera': {
        const res = await Camera.requestCameraPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'microphone': {
        const res = await AudioModule.requestRecordingPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'photos': {
        const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'contacts': {
        if (isWeb) return 'unsupported';
        const res = await Contacts.requestPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'location': {
        const res = await Location.requestForegroundPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      default:
        return 'undetermined';
    }
  } catch {
    return 'denied';
  }
}

/** Read the current status of a permission without prompting. */
export async function getPermission(key: PermissionKey): Promise<PermissionState> {
  try {
    switch (key) {
      case 'camera': {
        const res = await Camera.getCameraPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'microphone': {
        const res = await AudioModule.getRecordingPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'photos': {
        const res = await ImagePicker.getMediaLibraryPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'contacts': {
        if (isWeb) return 'unsupported';
        const res = await Contacts.getPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      case 'location': {
        const res = await Location.getForegroundPermissionsAsync();
        return normalize(res.status, res.canAskAgain);
      }
      default:
        return 'undetermined';
    }
  } catch {
    return 'undetermined';
  }
}

export async function getAllPermissions(keys: readonly PermissionKey[]): Promise<Record<PermissionKey, PermissionState>> {
  const out = {} as Record<PermissionKey, PermissionState>;
  await Promise.all(
    keys.map(async (k) => {
      out[k] = await getPermission(k);
    }),
  );
  return out;
}
