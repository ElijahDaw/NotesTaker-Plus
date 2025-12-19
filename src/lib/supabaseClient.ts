import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://ffreajhmlqzbmoolqumm.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmcmVhamhtbHF6Ym1vb2xxdW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1Njk5MzgsImV4cCI6MjA4MTE0NTkzOH0.8OBCmra7vN-oG_MzUTlzMjJune2fPMtf-6XEx3QE1Fg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    detectSessionInUrl: true,
    autoRefreshToken: true
  }
});
