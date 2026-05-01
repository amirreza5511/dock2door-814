import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

const FALLBACK_SUPABASE_URL = "https://hyargzciywuqhlcaorwy.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "sb_publishable_qHc_d78l_CCiTI-KBrlo_w_bz2eh8wz";

function isUsableSupabaseKey(value: string | undefined): value is string {
  return Boolean(value && (value.startsWith("sb_publishable_") || value.startsWith("eyJ")));
}

function readPublicSupabaseConfig(): { url: string; key: string } {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const envKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (envUrl && isUsableSupabaseKey(envKey)) {
    return { url: envUrl, key: envKey };
  }

  return { url: FALLBACK_SUPABASE_URL, key: FALLBACK_SUPABASE_ANON_KEY };
}

export async function getServerSupabase() {
  const { url, key } = readPublicSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot set cookies; safe to ignore.
        }
      },
    },
  });
}

export async function getCurrentUser() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentSessionContext() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null, isAdmin: false };

  const [profileRes, roleRes] = await Promise.all([
    supabase.from("profiles").select("user_id, full_name, avatar_url, phone, role").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  const profileRole = (profileRes.data as { role?: string | null } | null)?.role ?? null;
  const platformRoles = (roleRes.data ?? []).map((r: { role: string }) => r.role);
  const isAdmin = platformRoles.includes("admin") || platformRoles.includes("super_admin");
  const isSuperAdmin = platformRoles.includes("super_admin");

  let role = profileRole;
  if (isSuperAdmin) role = "SuperAdmin";
  else if (isAdmin && !role) role = "Admin";

  return { user, role, isAdmin, isSuperAdmin, profile: profileRes.data };
}
