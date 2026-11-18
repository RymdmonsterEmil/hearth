// Hearth settings. Fill in the two Supabase values from
// Supabase → Project Settings → API Keys (see README, step 2).
// Both are designed to be public: your data is protected by the database's security rules.
// Leave them empty to try the app in demo mode (data stays on this device only).

export const SUPABASE_URL = "https://lkyirxzoxwxnoriyebsa.supabase.co";   // e.g. "https://abcdefghijkl.supabase.co"
export const SUPABASE_KEY = "sb_publishable_ShTd4ndNWlaQC8TzBUywsw_qQfiDTYw";   // the "publishable" (or "anon") key

// Public half of the push-notification key pair. The private half goes into Supabase secrets.
export const VAPID_PUBLIC_KEY = "BJAB4-YgnsyGj7Zjqu9Z5t21mPzdsxdFcMFoVr3IsFKCFU6qgG2xIR4ILMj548jQhlNH17ZIk4JQeCWGzbzEHf4";
