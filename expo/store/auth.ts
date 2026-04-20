import { create } from 'zustand';
import type { User, UserRole } from '@/constants/types';
import { getRoleRoute } from '@/lib/access';
import { clearSessionTokens, loadSessionTokens, getRefreshToken, setSessionTokens } from '@/lib/session';
import { trpcClient } from '@/lib/trpc';

interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  companyName?: string;
  city?: string;
}

interface AuthState {
  user: User | null;
  isHydrated: boolean;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  register: (data: RegisterInput) => Promise<{ success: boolean; error?: string }>;
  refreshSession: () => Promise<boolean>;
  updateUser: (updates: Partial<User>) => void;
}

function toClientUser(user: Awaited<ReturnType<typeof trpcClient.auth.me.query>>['user']): User {
  return {
    ...user,
    password: '',
  };
}

export { getRoleRoute };

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isHydrated: false,

  bootstrap: async () => {
    console.log('[Auth] bootstrap');
    try {
      await loadSessionTokens();
      const accessRefreshSucceeded = await get().refreshSession();
      if (!accessRefreshSucceeded) {
        set({ user: null, isHydrated: true });
        return;
      }

      const result = await trpcClient.auth.me.query();
      set({ user: toClientUser(result.user), isHydrated: true });
    } catch (error) {
      console.log('[Auth] bootstrap failed', error);
      await clearSessionTokens();
      set({ user: null, isHydrated: true });
    }
  },

  refreshSession: async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      const refreshed = await trpcClient.auth.refresh.mutate({ refreshToken });
      await setSessionTokens({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
      set({ user: toClientUser(refreshed.user) });
      return true;
    } catch (error) {
      console.log('[Auth] refresh failed', error);
      await clearSessionTokens();
      set({ user: null });
      return false;
    }
  },

  login: async (email, password) => {
    try {
      const apiUrl = process.env.EXPO_PUBLIC_RORK_API_BASE_URL;
      console.log('[Auth] login attempt', { email, apiUrl, endpoint: `${apiUrl}/api/trpc/auth.login` });
      const result = await trpcClient.auth.login.mutate({ email, password });
      await setSessionTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      set({ user: toClientUser(result.user) });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('[Auth] login failed', { message, error });
      if (message.includes('Failed to fetch') || message.includes('Network request failed')) {
        return { success: false, error: `Cannot reach server at ${process.env.EXPO_PUBLIC_RORK_API_BASE_URL}. Check your connection.` };
      }
      return { success: false, error: message || 'Login failed' };
    }
  },

  logout: async () => {
    console.log('[Auth] logout');
    try {
      await trpcClient.auth.logout.mutate({ refreshToken: getRefreshToken() ?? undefined });
    } catch (error) {
      console.log('[Auth] logout request failed', error);
    }

    await clearSessionTokens();
    set({ user: null });
  },

  register: async (data) => {
    try {
      const result = await trpcClient.auth.register.mutate(data);
      await setSessionTokens({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      set({ user: toClientUser(result.user) });
      return { success: true };
    } catch (error) {
      console.log('[Auth] register failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Registration failed' };
    }
  },

  updateUser: (updates) => {
    const currentUser = get().user;
    if (!currentUser) {
      return;
    }

    set({ user: { ...currentUser, ...updates } });
  },
}));
