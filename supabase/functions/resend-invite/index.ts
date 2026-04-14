import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ResendInviteRequest {
  // Identify the user to re-invite — either userId or email is required
  userId?: string;
  email?: string;
  // Frontend can pass site URL for email delivery
  siteUrl?: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Missing authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !caller) {
      return jsonResponse({ success: false, error: "Invalid or expired token" }, 401);
    }

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin") {
      return jsonResponse({ success: false, error: "Only admins can resend invites" }, 403);
    }

    const body: ResendInviteRequest = await req.json();
    if (!body.userId && !body.email) {
      return jsonResponse({ success: false, error: "userId or email is required" }, 400);
    }

    // Look up the target profile
    const profileQuery = adminClient
      .from("profiles")
      .select("id, email, role, full_name");
    const { data: profile, error: profileLookupError } = body.userId
      ? await profileQuery.eq("id", body.userId).single()
      : await profileQuery.eq("email", body.email!).single();

    if (profileLookupError || !profile) {
      return jsonResponse({ success: false, error: "User not found" }, 404);
    }

    if (!profile.email) {
      return jsonResponse({ success: false, error: "User has no email on file" }, 400);
    }

    // Generate password recovery link so the user can set their own password
    const siteUrl = body.siteUrl || Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") || "";
    const redirectUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}?type=recovery` : undefined;
    const { data: resetData, error: resetError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
      options: {
        redirectTo: redirectUrl,
      },
    });

    if (resetError) {
      return jsonResponse({
        success: false,
        error: `Failed to generate recovery link: ${resetError.message}`,
      }, 500);
    }

    // Build link to the app with token_hash (avoids email scanners pre-fetching the action_link).
    const tokenHash = resetData?.properties?.hashed_token || "";
    const baseUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}` : "";
    const loginUrl = tokenHash && baseUrl
      ? `${baseUrl}?type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
      : resetData?.properties?.action_link || "";

    // Send the custom invite email via the send-email Netlify function
    const sendEmailUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}/.netlify/functions/send-email` : "";

    const emailTypeMap: Record<string, string> = {
      customer: "customer_invitation",
      distributor: "distributor_invitation",
      sales_rep: "sales_rep_invitation",
    };
    const emailType = emailTypeMap[profile.role] || "user_invitation";

    const subjectMap: Record<string, string> = {
      customer: "Welcome to HealthSpan360",
      distributor: "Welcome to HealthSpan360 — Distributor Account",
      sales_rep: "Welcome to HealthSpan360 — Sales Rep Account",
    };
    const emailSubject = subjectMap[profile.role] || "You're Invited to HealthSpan360";

    if (sendEmailUrl) {
      const emailRes = await fetch(sendEmailUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: profile.email,
          email_type: emailType,
          subject: emailSubject,
          template_data: {
            full_name: profile.full_name || "",
            email: profile.email,
            role: profile.role,
            login_url: loginUrl || siteUrl,
          },
          user_id: profile.id,
        }),
      });
      if (!emailRes.ok) {
        const errBody = await emailRes.json().catch(() => ({}));
        return jsonResponse({
          success: false,
          error: (errBody as Record<string, string>).error || `send-email returned ${emailRes.status}`,
        }, 500);
      }
    } else {
      // Fallback: Supabase built-in invite email if SITE_URL not configured
      const { error: supaInviteErr } = await adminClient.auth.admin.inviteUserByEmail(profile.email);
      if (supaInviteErr) {
        return jsonResponse({ success: false, error: supaInviteErr.message }, 500);
      }
    }

    return jsonResponse({
      success: true,
      userId: profile.id,
      email: profile.email,
      role: profile.role,
    });
  } catch (err) {
    console.error("resend-invite error:", err);
    return jsonResponse({
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    }, 500);
  }
});
