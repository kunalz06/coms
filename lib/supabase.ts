import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let browserSupabase: ReturnType<typeof createClient> | null = null;
let currentAccessToken: string | null = null;

if (!supabaseUrl || !supabaseAnonKey) {
  // Keep this non-throwing during static analysis; runtime forms show friendly setup errors.
  console.warn("Supabase public environment variables are not configured.");
}

export function createBrowserSupabase(accessToken?: string | null) {
  currentAccessToken = accessToken ?? null;

  if (!browserSupabase) {
    browserSupabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
      accessToken: async () => currentAccessToken,
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      realtime: {
        params: {
          eventsPerSecond: 12
        }
      }
    });
  }

  if (currentAccessToken) {
    browserSupabase.realtime.setAuth(currentAccessToken);
  }

  return browserSupabase;
}

export function createServiceSupabase() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase server environment variables are missing.");
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false
    }
  });
}
