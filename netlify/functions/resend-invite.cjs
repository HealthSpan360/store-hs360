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
const { randomUUID } = require('crypto');
const sendEmail = require('./send-email.cjs');

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

function jsonError(statusCode, error, detail) {
  console.error('[resend-invite]', error, detail || '');
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(detail ? { error, detail } : { error }),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonError(405, 'Method not allowed');
  }

  try {
    // ── Verify caller is an authenticated admin ──
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return jsonError(401, 'Missing authorization header');

    const userClient = getSupabaseUser(token);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonError(401, 'Invalid session', userError?.message);

    const adminClient = getSupabaseAdmin();
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (callerProfileError || !callerProfile) {
      return jsonError(401, 'Profile not found', callerProfileError?.message);
    }
    if (callerProfile.role !== 'admin') {
      return jsonError(403, 'Only admins can resend invites');
    }

    // ── Parse body ──
    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseErr) {
      return jsonError(400, 'Invalid JSON body', parseErr.message);
    }
    const { userId, email, siteUrl: bodySiteUrl } = body;
    if (!userId && !email) return jsonError(400, 'userId or email is required');

    // ── Look up the target profile ──
    const profileQuery = adminClient
      .from('profiles')
      .select('id, email, role, full_name');
    const { data: profile, error: profileLookupError } = userId
      ? await profileQuery.eq('id', userId).single()
      : await profileQuery.eq('email', email).single();

    if (profileLookupError || !profile) {
      return jsonError(404, 'User not found', profileLookupError?.message);
    }
    if (!profile.email) {
      return jsonError(400, 'User has no email on file');
    }

    const siteUrl = (bodySiteUrl || process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');

    // ── Ensure an auth.users row exists for this email ──
    // Look up by email (not id) because the profile id may not match the auth
    // user id, and a name-collision on email would make createUser fail. Only
    // bootstrap when no auth user with this email exists at all.
    let authUserExists = false;
    try {
      const { data: byId } = await adminClient.auth.admin.getUserById(profile.id);
      if (byId?.user) {
        authUserExists = true;
      }
    } catch (lookupErr) {
      console.warn('[resend-invite] getUserById failed (non-fatal):', lookupErr?.message);
    }

    if (!authUserExists) {
      try {
        // Paginate listUsers to find by email — listUsers caps at 1000/page.
        let page = 1;
        const perPage = 1000;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: list, error: listErr } = await adminClient.auth.admin.listUsers({ page, perPage });
          if (listErr) throw listErr;
          const match = (list?.users || []).find(
            (u) => (u.email || '').toLowerCase() === profile.email.toLowerCase()
          );
          if (match) {
            authUserExists = true;
            break;
          }
          if (!list?.users || list.users.length < perPage) break;
          page += 1;
        }
      } catch (listErr) {
        console.warn('[resend-invite] listUsers failed (non-fatal):', listErr?.message);
      }
    }

    if (!authUserExists) {
      console.log('[resend-invite] No auth user for', profile.email, '— bootstrapping with id', profile.id);
      const { error: createErr } = await adminClient.auth.admin.createUser({
        id: profile.id,
        email: profile.email,
        password: `${randomUUID()}${randomUUID()}`,
        email_confirm: false,
        user_metadata: { full_name: profile.full_name || '' },
      });
      if (createErr) {
        return jsonError(500, 'Failed to bootstrap auth user', createErr.message);
      }
    }

    // ── Generate recovery link via admin API ──
    const redirectUrl = siteUrl ? `${siteUrl}?type=recovery` : undefined;
    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
      options: { redirectTo: redirectUrl },
    });

    if (linkError) {
      return jsonError(500, 'Failed to generate recovery link', linkError.message);
    }

    // Build link to our app with token_hash (avoids email scanners pre-fetching
    // the action_link and consuming the one-time token).
    const tokenHash = linkData?.properties?.hashed_token;
    const loginUrl = tokenHash && siteUrl
      ? `${siteUrl}?type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
      : linkData?.properties?.action_link || siteUrl;

    // ── Dispatch via send-email handler (in-process, no cross-function HTTP) ──
    const emailType = EMAIL_TYPE_MAP[profile.role] || 'user_invitation';
    const emailSubject = SUBJECT_MAP[profile.role] || "You're Invited to HealthSpan360";

    const sendEmailResult = await sendEmail.handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json' },
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

    if (!sendEmailResult || sendEmailResult.statusCode >= 400) {
      let detail;
      try { detail = JSON.parse(sendEmailResult?.body || '{}'); } catch (_) { detail = sendEmailResult?.body; }
      return jsonError(502, 'send-email handler failed', detail);
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
    return jsonError(500, 'Unexpected error', err?.message || String(err));
  }
};
