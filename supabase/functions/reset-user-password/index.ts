// Supabase Edge Function: reset-user-password
// ============================================================
// HQ-only. app_users has no email column (email lives only in
// auth.users), so resetting a staff member's password from the admin
// UI needs a server-side call with the service role to look the user
// up and generate a recovery link. Mirrors the create-user function's
// caller-verification pattern.
//
// Deploy with: supabase functions deploy reset-user-password

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
      return new Response(JSON.stringify({ error: 'Only HQ can reset passwords' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { user_id } = await req.json();
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: targetUser, error: getUserError } =
      await adminClient.auth.admin.getUserById(user_id);
    if (getUserError || !targetUser.user?.email) {
      return new Response(JSON.stringify({ error: 'Could not find that user\'s email' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: targetUser.user.email,
    });
    if (linkError || !linkData) {
      return new Response(JSON.stringify({ error: linkError?.message ?? 'Could not generate link' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Returned to HQ to share with the staff member directly (WhatsApp,
    // SMS, in person) — this app has no outbound email sending set up.
    return new Response(
      JSON.stringify({ email: targetUser.user.email, action_link: linkData.properties.action_link }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
