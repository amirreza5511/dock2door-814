/** @type {import('next').NextConfig} */
const fallbackSupabaseUrl = "https://hyargzciywuqhlcaorwy.supabase.co";
const fallbackSupabaseAnonKey = "sb_publishable_qHc_d78l_CCiTI-KBrlo_w_bz2eh8wz";
const envSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const envSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const hasUsableSupabaseConfig = Boolean(
  envSupabaseUrl &&
  (envSupabaseAnonKey?.startsWith("sb_publishable_") || envSupabaseAnonKey?.startsWith("eyJ")),
);

const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: hasUsableSupabaseConfig ? envSupabaseUrl : fallbackSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: hasUsableSupabaseConfig ? envSupabaseAnonKey : fallbackSupabaseAnonKey,
  },
};

export default nextConfig;
