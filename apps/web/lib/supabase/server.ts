import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
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
