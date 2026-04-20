import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = 'dock2door-access-token';
const REFRESH_TOKEN_KEY = 'dock2door-refresh-token';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export async function loadSessionTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [storedAccessToken, storedRefreshToken] = await Promise.all([
    AsyncStorage.getItem(ACCESS_TOKEN_KEY),
    AsyncStorage.getItem(REFRESH_TOKEN_KEY),
  ]);

  accessToken = storedAccessToken;
  refreshToken = storedRefreshToken;

  return { accessToken, refreshToken };
}

export async function setSessionTokens(next: { accessToken: string | null; refreshToken: string | null }): Promise<void> {
  accessToken = next.accessToken;
  refreshToken = next.refreshToken;

  await Promise.all([
    next.accessToken ? AsyncStorage.setItem(ACCESS_TOKEN_KEY, next.accessToken) : AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
    next.refreshToken ? AsyncStorage.setItem(REFRESH_TOKEN_KEY, next.refreshToken) : AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
  ]);
}

export async function clearSessionTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await Promise.all([
    AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
    AsyncStorage.removeItem(REFRESH_TOKEN_KEY),
  ]);
}
