import { create } from 'zustand';
import type { User, UserRole } from '@/constants/types';
import { DEMO_AUTH_EMAIL, DEMO_AUTH_PASSWORD, type DemoAccount, findDemoAccount } from '@/constants/demo-accounts';
import { getRoleRoute } from '@/lib/access';
import { supabase, type DbProfile } from '@/lib/supabase';

/** Translate low-level network errors into user-readable messages. */
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('connection refused')
  ) {
    return 'Unable to connect to the server. Please check your internet connection, or the service may be temporarily unavailable.';
  }
  return msg || 'An unexpected error occurred';
}

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
  demoLogin: (account: DemoAccount) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  register: (data: RegisterInput) => Promise<{ success: boolean; error?: string }>;
  refreshSession: () => Promise<boolean>;
  updateUser: (updates: Partial<User>) => void;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  sendMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>;
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

function isInvalidCredentialError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('invalid login credentials') || lower.includes('invalid credentials');
}

async function fetchIsPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['admin', 'super_admin']);
    if (error) {
      console.log('[Auth] fetchIsPlatformAdmin error', error.message);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.log('[Auth] fetchIsPlatformAdmin failed', e);
    return false;
  }
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
  const user = profileToUser(data as DbProfile);
  user.isPlatformAdmin = await fetchIsPlatformAdmin(userId);
  console.log('[Auth] fetched profile', { userId, role: user.role, isPlatformAdmin: user.isPlatformAdmin });
  return user;
}

let authListenerSubscribed = false;
let demoUserOverride: User | null = null;

async function ensureDemoCompany(account: DemoAccount): Promise<string | null> {
  if (!account.companyType) return null;

  const preferredName = `${account.displayName.replace(/ Demo$/, '')} Demo Co.`;

  const { data: existing, error: existingError } = await supabase
    .from('companies')
    .select('id, name, status')
    .eq('type', account.companyType)
    .order('status', { ascending: true })
    .limit(1);

  if (existingError) {
    console.log('[Auth] demo company lookup failed', existingError.message);
  }

  const firstExisting = Array.isArray(existing) ? existing[0] : null;
  if (firstExisting?.id) {
    return firstExisting.id as string;
  }

  const { data: created, error: createError } = await supabase
    .from('companies')
    .insert({
      name: preferredName,
      type: account.companyType,
      city: 'Vancouver',
      address: '',
      status: 'Approved',
    })
    .select('id')
    .maybeSingle();

  if (createError) {
    console.log('[Auth] demo company create failed', createError.message);
    return null;
  }

  return (created?.id as string | undefined) ?? null;
}

async function resolveDemoProfile(account: DemoAccount, authUserId: string): Promise<{ id: string; companyId: string | null; createdAt: string }> {
  const { data: exactProfile } = await supabase
    .from('profiles')
    .select('id, company_id, created_at')
    .eq('email', account.email)
    .maybeSingle();

  if (exactProfile?.id) {
    return {
      id: exactProfile.id as string,
      companyId: (exactProfile.company_id as string | null) ?? null,
      createdAt: (exactProfile.created_at as string | null) ?? new Date().toISOString(),
    };
  }

  const companyId = await ensureDemoCompany(account);
  if (companyId) {
    const { data: membership } = await supabase
      .from('company_users')
      .select('user_id, profiles(id, created_at)')
      .eq('company_id', companyId)
      .eq('status', 'Active')
      .limit(1)
      .maybeSingle();

    const nestedProfile = (membership as { profiles?: { id?: string; created_at?: string } | null } | null)?.profiles;
    if (nestedProfile?.id) {
      return {
        id: nestedProfile.id,
        companyId,
        createdAt: nestedProfile.created_at ?? new Date().toISOString(),
      };
    }
  }

  if (account.role === 'Worker') {
    const { data: workerProfile } = await supabase
      .from('profiles')
      .select('id, company_id, created_at')
      .eq('role', 'Worker')
      .limit(1)
      .maybeSingle();

    if (workerProfile?.id) {
      return {
        id: workerProfile.id as string,
        companyId: (workerProfile.company_id as string | null) ?? null,
        createdAt: (workerProfile.created_at as string | null) ?? new Date().toISOString(),
      };
    }
  }

  return { id: authUserId, companyId, createdAt: new Date().toISOString() };
}

async function buildDemoSessionUser(account: DemoAccount): Promise<User> {
  console.log('[Auth] starting demo session', { role: account.role, email: account.email });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: DEMO_AUTH_EMAIL,
    password: DEMO_AUTH_PASSWORD,
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? 'Demo auth account is not configured.');
  }

  const identity = await resolveDemoProfile(account, data.user.id);
  const isPlatformDemoAdmin = account.role === 'Admin' || account.role === 'SuperAdmin';

  return {
    id: identity.id,
    email: account.email,
    password: '',
    name: account.displayName,
    role: account.role,
    companyId: identity.companyId,
    status: 'Active',
    emailVerified: true,
    twoFactorEnabled: false,
    profileImage: null,
    lastLoginAt: new Date().toISOString(),
    createdAt: identity.createdAt,
    isPlatformAdmin: isPlatformDemoAdmin,
  };
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  isHydrated: false,

  bootstrap: async () => {
    console.log('[Auth] bootstrap');
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      // Stale / revoked refresh token — sign out silently and send to login.
      if (sessionError) {
        const msg = sessionError.message?.toLowerCase() ?? '';
        if (
          msg.includes('refresh token not found') ||
          msg.includes('invalid refresh token') ||
          msg.includes('token has expired') ||
          msg.includes('jwt expired')
        ) {
          console.log('[Auth] stale session detected, clearing:', sessionError.message);
          await supabase.auth.signOut();
          set({ user: null, isHydrated: true });
          return;
        }
      }

      const session = sessionData?.session;

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

          // TOKEN_REFRESH_FAILED = stale/revoked refresh token stored in AsyncStorage.
          // Sign out silently so the user lands on the login screen cleanly.
          if ((event as string) === 'TOKEN_REFRESH_FAILED') {
            console.log('[Auth] TOKEN_REFRESH_FAILED — clearing stale session');
            try { await supabase.auth.signOut(); } catch {}
            set({ user: null });
            return;
          }

          if (event === 'SIGNED_OUT' || !newSession?.user) {
            set({ user: null });
            return;
          }
          if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
            if (demoUserOverride) {
              set({ user: demoUserOverride });
              return;
            }
            const user = await fetchProfile(newSession.user.id);
            set({ user });
            return;
          }
          // For other events (USER_UPDATED etc.) update if we have a session
          if (demoUserOverride) {
            set({ user: demoUserOverride });
            return;
          }
          const user = await fetchProfile(newSession.user.id);
          set({ user });
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        msg.includes('refresh token not found') ||
        msg.includes('invalid refresh token') ||
        msg.includes('token has expired') ||
        msg.includes('jwt expired')
      ) {
        console.log('[Auth] stale session caught in catch, clearing');
        try { await supabase.auth.signOut(); } catch {}
        set({ user: null, isHydrated: true });
        return;
      }
      console.log('[Auth] bootstrap failed', error);
      set({ user: null, isHydrated: true });
    }
  },

  refreshSession: async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        const msg = error.message?.toLowerCase() ?? '';
        if (
          msg.includes('refresh token not found') ||
          msg.includes('invalid refresh token') ||
          msg.includes('token has expired') ||
          msg.includes('jwt expired')
        ) {
          console.log('[Auth] refreshSession: stale/revoked token — clearing local session');
          try { await supabase.auth.signOut({ scope: 'local' }); } catch {}
          set({ user: null });
        }
        return false;
      }
      if (!data.session?.user) return false;
      const user = await fetchProfile(data.session.user.id);
      set({ user });
      return Boolean(user);
    } catch (error) {
      console.log('[Auth] refreshSession failed', error);
      return false;
    }
  },

  login: async (email, password) => {
    demoUserOverride = null;
    try {
      const trimmedEmail = email.trim();
      console.log('[Auth] login attempt', { email: trimmedEmail });
      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        const demoAccount = findDemoAccount(trimmedEmail);
        if (demoAccount && password === demoAccount.password && isInvalidCredentialError(error.message)) {
          try {
            const demoUser = await buildDemoSessionUser(demoAccount);
            demoUserOverride = demoUser;
            set({ user: demoUser });
            return { success: true };
          } catch (demoError) {
            const demoMessage = friendlyError(demoError);
            console.log('[Auth] demo login fallback failed', demoMessage);
            return { success: false, error: demoMessage };
          }
        }
        console.log('[Auth] login error', error.message);
        return { success: false, error: error.message };
      }
      if (!data.user) {
        return { success: false, error: 'No user returned' };
      }
      const user = await fetchProfile(data.user.id);
      if (!user) {
        const demoAccount = findDemoAccount(trimmedEmail);
        if (demoAccount && password === demoAccount.password) {
          const demoUser = await buildDemoSessionUser(demoAccount);
          demoUserOverride = demoUser;
          set({ user: demoUser });
          return { success: true };
        }
        return { success: false, error: 'Profile not found. Please contact support.' };
      }
      set({ user });
      return { success: true };
    } catch (error) {
      const message = friendlyError(error);
      console.log('[Auth] login failed', message);
      return { success: false, error: message };
    }
  },

  demoLogin: async (account) => {
    try {
      const realLogin = await get().login(account.email, account.password);
      if (realLogin.success) {
        const currentUser = get().user;
        if (currentUser && currentUser.role !== account.role) {
          const demoUser = await buildDemoSessionUser(account);
          demoUserOverride = demoUser;
          set({ user: demoUser });
        }
        return { success: true };
      }

      const demoUser = await buildDemoSessionUser(account);
      demoUserOverride = demoUser;
      set({ user: demoUser });
      return { success: true };
    } catch (error) {
      const message = friendlyError(error);
      console.log('[Auth] demoLogin failed', message);
      return { success: false, error: message };
    }
  },

  logout: async () => {
    console.log('[Auth] logout');
    demoUserOverride = null;
    // Clear local session first so the UI redirects immediately, even if the
    // network sign-out stalls (preview sandbox can block the request).
    set({ user: null });
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.log('[Auth] logout failed', error);
    }
  },

  register: async (data) => {
    demoUserOverride = null;
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
            city: data.city ?? '',
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
      const message = friendlyError(error);
      console.log('[Auth] register failed', message);
      return { success: false, error: message };
    }
  },

  updateUser: (updates) => {
    const currentUser = get().user;
    if (!currentUser) return;
    set({ user: { ...currentUser, ...updates } });
  },

  sendPasswordReset: async (email) => {
    try {
      console.log('[Auth] sendPasswordReset', { email });
      const redirectTo = typeof window !== 'undefined' && window.location
        ? `${window.location.origin}/auth/update-password`
        : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (error) {
        console.log('[Auth] sendPasswordReset error', error.message);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (error) {
      const message = friendlyError(error);
      return { success: false, error: message };
    }
  },

  sendMagicLink: async (email) => {
    try {
      console.log('[Auth] sendMagicLink', { email });
      const emailRedirectTo = typeof window !== 'undefined' && window.location
        ? `${window.location.origin}`
        : undefined;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo, shouldCreateUser: false },
      });
      if (error) {
        console.log('[Auth] sendMagicLink error', error.message);
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (error) {
      const message = friendlyError(error);
      return { success: false, error: message };
    }
  },

  updatePassword: async (newPassword) => {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (error) {
      const message = friendlyError(error);
      return { success: false, error: message };
    }
  },
}));
