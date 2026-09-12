// Supabase Edge Function: create-user
// ============================================================
// app_users.id references auth.users(id), and only the service role
// (never the anon/authenticated client) can create an auth.users row.
// This function is the one place that's allowed to hold the service
// role key — it runs server-side on Supabase's infrastructure, never
// in the browser. It re-checks the caller is actually HQ before
// doing anything, so this endpoint can't be used to self-elevate
// even if someone guesses the URL.
//
// Deploy with: supabase functions deploy create-user
// (See DEPLOYMENT.md for the full one-time setup.)

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Client bound to the CALLER's own token — used only to verify
    // who's asking and that they're actually HQ.
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user: callerAuthUser },
    } = await callerClient.auth.getUser();
    if (!callerAuthUser) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerAppUser } = await callerClient
      .from('app_users')
      .select('role, is_active')
      .eq('id', callerAuthUser.id)
      .single();

    if (callerAppUser?.role !== 'hq' || !callerAppUser.is_active) {
      return new Response(JSON.stringify({ error: 'Only HQ can create users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { email, password, full_name, role, outlet_id } = await req.json();
    if (!email || !password || !full_name || !role) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (role !== 'hq' && !outlet_id) {
      return new Response(JSON.stringify({ error: 'outlet_id is required for non-HQ roles' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Admin client — service role, only usable server-side.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? 'Could not create auth user' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await adminClient.from('app_users').insert({
      id: created.user.id,
      full_name,
      role,
      outlet_id: role === 'hq' ? null : outlet_id,
    });
    if (insertError) {
      // Roll back the orphaned auth user rather than leave a login
      // that can never actually load an app_users row.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ id: created.user.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
