import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CreateUserRequest {
  email: string;
  role: "customer" | "sales_rep" | "distributor" | "admin";
  fullName?: string;
  phone?: string;
  // Customer-specific
  organizationId?: string;
  orgRole?: string;
  isHouseAccount?: boolean;
  salesRepId?: string;
  // Sales rep-specific
  isIndependent?: boolean;
  distributorId?: string;
  // Commission split fields (for company-affiliated sales reps)
  commissionSplitType?: "percentage_of_distributor" | "fixed_with_override";
  salesRepRate?: number;
  distributorOverrideRate?: number;
  // Skip role-specific entity creation (user/profile only)
  skipEntityCreation?: boolean;
  // W-9 fields (for independent sales rep or distributor)
  taxId?: string;
  taxIdType?: "ein" | "ssn";
  legalName?: string;
  businessName?: string;
  taxClassification?: string;
  w9Consent?: boolean;
  // Org creation
  createOrganization?: boolean;
  newOrgName?: string;
  newOrgCode?: string;
  orgType?: "customer" | "distributor";
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  // Delegate creation (distributor adding a delegate user)
  delegateForDistributorId?: string;
  delegateNotes?: string;
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

    // Create admin client with service role key
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

    if (!callerProfile || !["admin", "distributor"].includes(callerProfile.role)) {
      return jsonResponse({ success: false, error: "Only admins and distributors can create users" }, 403);
    }

    const callerIsAdmin = callerProfile.role === "admin";
    const callerIsDistributor = callerProfile.role === "distributor";

    const body: CreateUserRequest = await req.json();

    if (!body.email || !body.role) {
      return jsonResponse({ success: false, error: "Email and role are required" }, 400);
    }

    // Validate role
    if (!["customer", "sales_rep", "distributor", "admin"].includes(body.role)) {
      return jsonResponse({ success: false, error: "Invalid role" }, 400);
    }

    // Distributors can create sales_rep, distributor (delegate), or customer users
    if (callerIsDistributor) {
      if (!["sales_rep", "distributor", "customer"].includes(body.role)) {
        return jsonResponse({ success: false, error: "Distributors can only create sales reps, delegates, and customers" }, 403);
      }
      // Verify the distributor owns the distributorId or delegateForDistributorId they're targeting
      const targetDistId = body.distributorId || body.delegateForDistributorId;
      if (targetDistId) {
        const { data: ownedDist } = await adminClient
          .from("distributors")
          .select("id")
          .eq("id", targetDistId)
          .eq("profile_id", caller.id)
          .single();
        if (!ownedDist) {
          // Check if they're a delegate for this distributor
          const { data: delegateAccess } = await adminClient
            .from("distributor_delegates")
            .select("id")
            .eq("distributor_id", targetDistId)
            .eq("user_id", caller.id)
            .eq("is_active", true)
            .single();
          if (!delegateAccess) {
            return jsonResponse({ success: false, error: "You don't have access to this distributor" }, 403);
          }
        }
      }
    }

    // ═══════════════════════════════════════
    // 1. Create Auth user (random password — user sets their own via invite email)
    //    If the user already exists (e.g. soft-deleted), reactivate them instead.
    // ═══════════════════════════════════════
    let userId: string;
    let reactivated = false;

    // ── Pre-check for an orphan profile with this email ──
    // profiles.email is UNIQUE, and an admin-created profile whose auth.users
    // row never existed (or got deleted) would otherwise cause the
    // handle_new_user trigger to raise on email-uniqueness, surfacing as a
    // generic "Database error creating new user". When we find an orphan, we
    // pin the new auth user to the existing profile id so the trigger no-ops
    // on (id) instead of colliding on (email).
    let orphanProfileId: string | null = null;
    {
      const { data: existingProfileByEmail } = await adminClient
        .from("profiles")
        .select("id")
        .ilike("email", body.email)
        .maybeSingle();
      if (existingProfileByEmail?.id) {
        const { data: authMatch } = await adminClient.auth.admin.getUserById(existingProfileByEmail.id);
        if (!authMatch?.user) {
          orphanProfileId = existingProfileByEmail.id;
          console.log("Found orphan profile (no matching auth user) for", body.email, "id =", orphanProfileId);
        }
      }
    }

    const tempPassword = crypto.randomUUID() + crypto.randomUUID();
    const createPayload: Record<string, unknown> = {
      email: body.email,
      password: tempPassword,
      email_confirm: false,
      user_metadata: { full_name: body.fullName || "" },
    };
    if (orphanProfileId) {
      createPayload.id = orphanProfileId;
    }
    const { data: authData, error: createError } = await adminClient.auth.admin.createUser(createPayload);

    if (createError) {
      console.error("createUser failed:", createError.message, "— scanning for existing user by email");

      // Check if this is a "user already exists" error — try to reactivate.
      // Paginate listUsers (default page size is 50, so a stale email past
      // page 1 would otherwise be missed and we'd rethrow the original
      // "Database error creating new user" instead of adopting).
      let existingUser: { id: string; email?: string } | undefined;
      const targetEmail = body.email.toLowerCase();
      let page = 1;
      const perPage = 1000;
      while (!existingUser) {
        const { data: pageData, error: listErr } = await adminClient.auth.admin.listUsers({ page, perPage });
        if (listErr) {
          console.error("listUsers failed during duplicate scan:", listErr.message);
          break;
        }
        existingUser = (pageData?.users || []).find(
          (u: { email?: string }) => u.email?.toLowerCase() === targetEmail
        );
        if (existingUser) break;
        if (!pageData?.users || pageData.users.length < perPage) break;
        page += 1;
      }

      if (!existingUser) {
        // Genuinely a new user but creation failed — surface the underlying
        // cause (likely a trigger / constraint failure on auth.users).
        return jsonResponse({
          success: false,
          error: createError.message,
          detail: "auth.admin.createUser failed and no existing user with this email was found. The most common cause is the public.handle_new_user trigger raising — check the Postgres logs.",
        }, 400);
      }

      // Check if profile is soft-deleted or pending approval
      const { data: existingProfile } = await adminClient
        .from("profiles")
        .select("id, deleted_at, approval_status, role")
        .eq("id", existingUser.id)
        .single();

      if (existingProfile && !existingProfile.deleted_at) {
        // User exists and is active — check if they're pending approval
        // (e.g. self-registered, now being claimed by a distributor/admin)
        if (existingProfile.approval_status === "pending" || !existingProfile.role || existingProfile.role === "customer") {
          // Adopt the existing user: approve them and update their role
          userId = existingUser.id;
          reactivated = false;
          // Skip auth user creation — they already exist
          // Fall through to profile upsert + role-specific setup below
        } else {
          // User exists, is approved, and has a non-customer role — genuinely duplicate
          return jsonResponse({
            success: false,
            error: "A user with this email already exists and is active. Please use the existing account.",
          }, 400);
        }
      } else {
        // Profile is soft-deleted — reactivate
        userId = existingUser.id;
        reactivated = true;

        await adminClient.auth.admin.updateUserById(userId, {
          password: tempPassword,
          email_confirm: false,
          user_metadata: { full_name: body.fullName || "" },
        });
      }
    } else {
      userId = authData.user.id;
    }

    // ═══════════════════════════════════════
    // 2. Create/update profile
    // ═══════════════════════════════════════
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert({
        id: userId,
        email: body.email,
        role: body.role,
        approval_status: "approved",
        approved: true,
        full_name: body.fullName || null,
        phone: body.phone || null,
        // Clear soft-delete fields when reactivating
        ...(reactivated ? { deleted_at: null, deleted_by: null, is_approved: true } : {}),
      }, { onConflict: "id" });

    if (profileError) {
      // Clean up auth user on profile failure (only if we just created it)
      if (!reactivated) await adminClient.auth.admin.deleteUser(userId);
      return jsonResponse({ success: false, error: `Profile creation failed: ${profileError.message}` }, 500);
    }

    // ═══════════════════════════════════════
    // 3. Send password reset + custom invite email
    // ═══════════════════════════════════════
    // Generate a password recovery link so the user is prompted to set their own password.
    // The redirect URL includes ?type=recovery so the frontend can reliably detect the
    // recovery flow — the Supabase PASSWORD_RECOVERY event doesn't fire consistently
    // with PKCE auth flow.
    const siteUrl = body.siteUrl || Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") || "";
    const redirectUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}?type=recovery` : undefined;
    const { data: resetData, error: resetError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: body.email,
      options: {
        redirectTo: redirectUrl,
      },
    });
    // Build link to the app with token_hash instead of using Supabase's action_link.
    // Email security scanners (Safe Links, Proofpoint) pre-fetch URLs and consume
    // the one-time token. By linking to our app with token_hash, the exchange only
    // happens client-side via verifyOtp() in a real browser.
    const tokenHash = resetData?.properties?.hashed_token || "";
    const baseUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}` : "";
    const loginUrl = tokenHash && baseUrl
      ? `${baseUrl}?type=recovery&token_hash=${encodeURIComponent(tokenHash)}`
      : resetData?.properties?.action_link || "";
    if (resetError) {
      console.error("Password reset link failed (non-fatal):", resetError.message);
    }

    // Send the custom invite email via the send-email Netlify function
    const sendEmailUrl = siteUrl ? `${siteUrl.replace(/\/$/, "")}/.netlify/functions/send-email` : "";

    // Use role-specific email template type so admins can customize per-role
    const emailTypeMap: Record<string, string> = {
      customer: "customer_invitation",
      distributor: "distributor_invitation",
      sales_rep: "sales_rep_invitation",
    };
    const emailType = emailTypeMap[body.role] || "user_invitation";

    const subjectMap: Record<string, string> = {
      customer: "Welcome to HealthSpan360",
      distributor: "Welcome to HealthSpan360 — Distributor Account",
      sales_rep: "Welcome to HealthSpan360 — Sales Rep Account",
    };
    const emailSubject = subjectMap[body.role] || "You're Invited to HealthSpan360";

    let inviteError: Error | null = null;
    if (sendEmailUrl) {
      try {
        const emailRes = await fetch(sendEmailUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: body.email,
            email_type: emailType,
            subject: emailSubject,
            template_data: {
              full_name: body.fullName || "",
              email: body.email,
              role: body.role,
              login_url: loginUrl || siteUrl,
            },
            user_id: userId,
          }),
        });
        if (!emailRes.ok) {
          const errBody = await emailRes.json().catch(() => ({}));
          throw new Error((errBody as Record<string, string>).error || `send-email returned ${emailRes.status}`);
        }
      } catch (err) {
        inviteError = err instanceof Error ? err : new Error("Failed to send invite email");
        console.error("Invite email failed (non-fatal):", inviteError.message);
      }
    } else {
      // Fallback to Supabase built-in invite if SITE_URL not configured
      const { error: supaInviteErr } = await adminClient.auth.admin.inviteUserByEmail(body.email);
      if (supaInviteErr) {
        inviteError = supaInviteErr;
        console.error("Invite email failed (non-fatal):", supaInviteErr.message);
      }
    }

    // ═══════════════════════════════════════
    // 4. Role-specific setup (skip if caller handles entity creation)
    // ═══════════════════════════════════════
    if (body.skipEntityCreation) {
      return jsonResponse({
        success: true,
        userId,
        inviteEmailSent: !inviteError,
        reactivated,
      });
    }

    let organizationId = body.organizationId;

    // Handle org creation if requested
    if (body.createOrganization && body.newOrgName && body.newOrgCode) {
      const orgType = body.orgType || (body.role === "distributor" ? "distributor" : "customer");
      const { data: newOrg, error: orgError } = await adminClient
        .from("organizations")
        .insert({
          name: body.newOrgName,
          code: body.newOrgCode,
          org_type: orgType,
          is_house_account: body.role === "customer" && body.isHouseAccount === true,
          created_by: caller.id,
          is_active: true,
          contact_name: body.contactName || null,
          contact_email: body.contactEmail || null,
          contact_phone: body.contactPhone || null,
        })
        .select("id")
        .single();

      if (orgError) {
        return jsonResponse({
          success: false,
          error: `Organization creation failed: ${orgError.message}`,
          userId,
        }, 500);
      }
      organizationId = newOrg.id;
    }

    // --- CUSTOMER setup ---
    if (body.role === "customer") {
      if (organizationId) {
        // Set house account flag if needed
        if (body.isHouseAccount) {
          await adminClient
            .from("organizations")
            .update({ is_house_account: true })
            .eq("id", organizationId);
        }

        // Assign user to organization
        // First delete any existing role for this user+org (handles NULL location_id uniqueness issue)
        await adminClient
          .from("user_organization_roles")
          .delete()
          .eq("user_id", userId)
          .eq("organization_id", organizationId)
          .is("location_id", null);

        const { error: roleError } = await adminClient
          .from("user_organization_roles")
          .insert({
            user_id: userId,
            organization_id: organizationId,
            role: body.orgRole || "member",
            is_primary: true,
          });

        if (roleError) {
          console.error("Failed to assign user to organization:", roleError);
        }

        // Assign sales rep if not a house account
        if (!body.isHouseAccount && body.salesRepId) {
          // Find the sales rep's distributor
          const { data: repDistributor } = await adminClient
            .from("distributor_sales_reps")
            .select("distributor_id")
            .eq("sales_rep_id", body.salesRepId)
            .eq("is_active", true)
            .limit(1)
            .single();

          const distributorId = repDistributor?.distributor_id || null;

          // Create organization_sales_reps link
          await adminClient
            .from("organization_sales_reps")
            .upsert({
              organization_id: organizationId,
              sales_rep_id: body.salesRepId,
              distributor_id: distributorId,
              is_active: true,
            }, { onConflict: "organization_id,sales_rep_id" });

          // Auto-link customer org to distributor
          if (distributorId) {
            await adminClient
              .from("distributor_customers")
              .upsert({
                distributor_id: distributorId,
                organization_id: organizationId,
              }, { onConflict: "distributor_id,organization_id" });

            // Also link via distributor_rep_customers for commission fallback
            await adminClient
              .from("distributor_rep_customers")
              .upsert({
                distributor_id: distributorId,
                sales_rep_id: body.salesRepId,
                organization_id: organizationId,
                is_active: true,
              }, { onConflict: "distributor_id,sales_rep_id,organization_id" });
          }
        }
      }
    }

    // --- SALES REP setup ---
    if (body.role === "sales_rep") {
      if (body.isIndependent !== false) {
        // Independent: auto-create distributor entity linked to same profile
        const repName = body.fullName || body.email.split("@")[0];
        const code = `IND-${body.email.split("@")[0].toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}`;

        const { data: newDist, error: distError } = await adminClient
          .from("distributors")
          .insert({
            profile_id: userId,
            name: repName,
            code,
            distributor_class: "independent",
            contact_name: body.fullName || null,
            phone: body.phone || null,
            is_active: true,
            // W-9 fields
            tax_id: body.taxId || null,
            tax_id_type: body.taxIdType || null,
            legal_name: body.legalName || null,
            business_name: body.businessName || null,
            tax_classification: body.taxClassification || null,
            w9_consent: body.w9Consent === true,
            w9_consent_date: body.w9Consent ? new Date().toISOString() : null,
            w9_status: body.w9Consent ? "received" : "pending",
          })
          .select("id")
          .single();

        if (distError) {
          return jsonResponse({
            success: false,
            error: `Distributor creation failed: ${distError.message}`,
            userId,
          }, 500);
        }

        // Self-link: sales rep belongs to their own distributor entity
        await adminClient
          .from("distributor_sales_reps")
          .upsert({
            distributor_id: newDist.id,
            sales_rep_id: userId,
            commission_split_type: "percentage_of_distributor",
            sales_rep_rate: 100,
            distributor_override_rate: 0,
            is_active: true,
          }, { onConflict: "distributor_id,sales_rep_id" });

      } else if (body.distributorId) {
        // Company-affiliated: link to existing distributor with commission split
        const repLink: Record<string, unknown> = {
          distributor_id: body.distributorId,
          sales_rep_id: userId,
          is_active: true,
        };
        if (body.commissionSplitType) {
          repLink.commission_split_type = body.commissionSplitType;
        }
        if (body.salesRepRate !== undefined) {
          repLink.sales_rep_rate = body.salesRepRate;
        }
        if (body.commissionSplitType === "fixed_with_override" && body.distributorOverrideRate !== undefined) {
          repLink.distributor_override_rate = body.distributorOverrideRate;
        }
        await adminClient
          .from("distributor_sales_reps")
          .upsert(repLink, { onConflict: "distributor_id,sales_rep_id" });
      }
    }

    // --- DISTRIBUTOR setup ---
    if (body.role === "distributor") {
      if (body.delegateForDistributorId) {
        // Delegate: add user as delegate for an existing distributor (no new distributor entity)
        await adminClient
          .from("distributor_delegates")
          .upsert({
            distributor_id: body.delegateForDistributorId,
            user_id: userId,
            is_active: true,
            notes: body.delegateNotes || null,
          }, { onConflict: "distributor_id,user_id" });
      } else {
        // New distributor entity
        const distName = body.fullName || body.newOrgName || body.email.split("@")[0];
        const code = `DIST-${(body.newOrgCode || body.email.split("@")[0]).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}`;

        const { error: distError } = await adminClient
          .from("distributors")
          .insert({
            profile_id: userId,
            name: distName,
            code,
            distributor_class: "company",
            contact_name: body.fullName || null,
            phone: body.phone || null,
            is_active: true,
            // W-9 fields
            tax_id: body.taxId || null,
            tax_id_type: body.taxIdType || null,
            legal_name: body.legalName || null,
            business_name: body.businessName || null,
            tax_classification: body.taxClassification || null,
            w9_consent: body.w9Consent === true,
            w9_consent_date: body.w9Consent ? new Date().toISOString() : null,
            w9_status: body.w9Consent ? "received" : "pending",
          });

        if (distError) {
          return jsonResponse({
            success: false,
            error: `Distributor creation failed: ${distError.message}`,
            userId,
          }, 500);
        }

        // Assign to distributor org if provided
        if (organizationId) {
          await adminClient
            .from("user_organization_roles")
            .upsert({
              user_id: userId,
              organization_id: organizationId,
              role: "admin",
              is_primary: true,
            }, { onConflict: "user_id,organization_id,location_id" });
        }
      }
    }

    // --- ADMIN setup ---
    // No additional setup needed for admin role

    return jsonResponse({
      success: true,
      userId,
      inviteEmailSent: !inviteError,
      reactivated,
    });

  } catch (err) {
    console.error("create-admin-user error:", err);
    return jsonResponse({
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    }, 500);
  }
});
