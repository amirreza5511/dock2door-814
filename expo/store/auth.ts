import { create } from 'zustand';
import type { User, UserRole } from '@/constants/types';
import { getRoleRoute } from '@/lib/access';
import { supabase, type DbProfile } from '@/lib/supabase';

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

export { getRoleRoute };

function profileToUser(p: DbProfile): User {
  return {
    id: p.id,
    email: p.email,
    password: '',
    name: p.name,
    role: p.role as UserRole,
    companyId: p.company_id,
    status: (p.status === 'Suspended' ? 'Suspended' : 'Active') as 'Active' | 'Suspended',
    emailVerified: Boolean(p.email_verified),
    twoFactorEnabled: Boolean(p.two_factor_enabled),
    profileImage: p.profile_image,
    lastLoginAt: p.last_login_at,
    createdAt: p.created_at,
  };
}

async function fetchProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.log('[Auth] fetchProfile error', error.message);
    return null;
  }
  if (!data) {
    console.log('[Auth] no profile row found for user', userId);
    return null;
  }
  return profileToUser(data as DbProfile);
}

let authListenerSubscribed = false;

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isHydrated: false,

  bootstrap: async () => {
    console.log('[Auth] bootstrap');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;

      if (session?.user) {
        const user = await fetchProfile(session.user.id);
        set({ user, isHydrated: true });
      } else {
        set({ user: null, isHydrated: true });
      }

      if (!authListenerSubscribed) {
        authListenerSubscribed = true;
        supabase.auth.onAuthStateChange(async (event, newSession) => {
          console.log('[Auth] onAuthStateChange', event);
          if (event === 'SIGNED_OUT' || !newSession?.user) {
            set({ user: null });
            return;
          }
          const user = await fetchProfile(newSession.user.id);
          set({ user });
        });
      }
    } catch (error) {
      console.log('[Auth] bootstrap failed', error);
      set({ user: null, isHydrated: true });
    }
  },

  refreshSession: async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session?.user) return false;
      const user = await fetchProfile(data.session.user.id);
      set({ user });
      return Boolean(user);
    } catch (error) {
      console.log('[Auth] refreshSession failed', error);
      return false;
    }
  },

  login: async (email, password) => {
    try {
      console.log('[Auth] login attempt', { email });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        console.log('[Auth] login error', error.message);
        return { success: false, error: error.message };
      }
      if (!data.user) {
        return { success: false, error: 'No user returned' };
      }
      const user = await fetchProfile(data.user.id);
      if (!user) {
        return { success: false, error: 'Profile not found. Please contact support.' };
      }
      set({ user });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log('[Auth] login failed', message);
      return { success: false, error: message || 'Login failed' };
    }
  },

  logout: async () => {
    console.log('[Auth] logout');
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.log('[Auth] logout failed', error);
    }
    set({ user: null });
  },

  register: async (data) => {
    try {
      console.log('[Auth] register', { email: data.email, role: data.role });
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: {
          data: {
            name: data.name,
            role: data.role,
            company_name: data.companyName ?? '',
            city: data.city ?? 'Vancouver',
          },
        },
      });
      if (error) {
        console.log('[Auth] register error', error.message);
        return { success: false, error: error.message };
      }
      if (!signUpData.user) {
        return { success: false, error: 'No user returned from signup' };
      }

      if (signUpData.session) {
        const user = await fetchProfile(signUpData.user.id);
        set({ user });
        return { success: true };
      }

      return {
        success: true,
        error: 'Please verify your email before signing in.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      console.log('[Auth] register failed', message);
      return { success: false, error: message };
    }
  },

  updateUser: (updates) => {
    const currentUser = get().user;
    if (!currentUser) return;
    set({ user: { ...currentUser, ...updates } });
  },
}));
