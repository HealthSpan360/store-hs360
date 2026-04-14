/**
 * resend-invite.cjs
 *
 * Re-sends the welcome / invitation email to an existing user (e.g. a
 * distributor whose original invite was never delivered or got lost).
 *
 * Generates a fresh Supabase password-recovery link via the admin API,
 * then dispatches the role-specific invitation template through the
 * existing send-email function so the email matches the template the
 * user would have received on initial creation.
 *
 * Caller must be an authenticated admin.
 */
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || '*';

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase admin config missing');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function getSupabaseUser(accessToken) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase anon config missing');
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

const EMAIL_TYPE_MAP = {
  customer: 'customer_invitation',
  distributor: 'distributor_invitation',
  sales_rep: 'sales_rep_invitation',
};

const SUBJECT_MAP = {
  customer: 'Welcome to HealthSpan360',
  distributor: 'Welcome to HealthSpan360 — Distributor Account',
  sales_rep: 'Welcome to HealthSpan360 — Sales Rep Account',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // ── Verify caller is an authenticated admin ──
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const userClient = getSupabaseUser(token);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid session' }) };
    }

    const adminClient = getSupabaseAdmin();
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfileError || !callerProfile) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Profile not found' }) };
    }

    if (callerProfile.role !== 'admin') {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Only admins can resend invites' }) };
    }

    // ── Parse body ──
    const { userId, email, siteUrl: bodySiteUrl } = JSON.parse(event.body || '{}');
    if (!userId && !email) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'userId or email is required' }) };
    }

    // ── Look up the target profile ──
    const profileQuery = adminClient
      .from('profiles')
      .select('id, email, role, full_name');
    const { data: profile, error: profileLookupError } = userId
      ? await profileQuery.eq('id', userId).single()
      : await profileQuery.eq('email', email).single();

    if (profileLookupError || !profile) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'User not found' }) };
    }

    if (!profile.email) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'User has no email on file' }) };
    }

    const siteUrl = (bodySiteUrl || process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

    // ── Generate recovery link via admin API ──
    const redirectUrl = siteUrl ? `${siteUrl}?type=recovery` : undefined;
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
      options: { redirectTo: redirectUrl },
    });

    if (linkError) {
      console.error('[resend-invite] generateLink error:', linkError);
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: linkError.message }) };
    }

    // Build link to our app with token_hash directly (avoids email scanners
    // pre-fetching the action_link and consuming the one-time token).
    const tokenHash = linkData?.properties?.hashed_token;
    const loginUrl = tokenHash && siteUrl
      ? `${siteUrl}?type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
      : linkData?.properties?.action_link || siteUrl;

    // ── Dispatch via send-email function so we use the role-specific template ──
    const emailType = EMAIL_TYPE_MAP[profile.role] || 'user_invitation';
    const emailSubject = SUBJECT_MAP[profile.role] || "You're Invited to HealthSpan360";

    const sendEmailUrl = siteUrl ? `${siteUrl}/.netlify/functions/send-email` : '';
    if (!sendEmailUrl) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'SITE_URL is not configured' }) };
    }

    const emailRes = await fetch(sendEmailUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: profile.email,
        email_type: emailType,
        subject: emailSubject,
        template_data: {
          full_name: profile.full_name || '',
          email: profile.email,
          role: profile.role,
          login_url: loginUrl,
        },
        user_id: profile.id,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => ({}));
      console.error('[resend-invite] send-email error:', errBody);
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: errBody.error || `send-email returned ${emailRes.status}` }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        userId: profile.id,
        email: profile.email,
        role: profile.role,
      }),
    };
  } catch (err) {
    console.error('[resend-invite] Unexpected error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: err.message || 'Internal server error' }) };
  }
};
