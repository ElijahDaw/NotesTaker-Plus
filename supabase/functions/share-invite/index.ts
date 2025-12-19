import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nodemailer from "npm:nodemailer@6";

interface ShareInvitePayload {
  shareId: string;
  senderName: string;
  recipient: string;
  recipientType: "email" | "username";
}

const APP_BASE_URL = "https://notestakerplus.vercel.app";
const INVITE_FROM_EMAIL = Deno.env.get("INVITE_FROM_EMAIL");
const FROM_EMAIL = INVITE_FROM_EMAIL ?? Deno.env.get("FROM_EMAIL") ?? "";
const MAILJET_API_KEY = Deno.env.get("MAILJET_API_KEY");
const MAILJET_SECRET_KEY = Deno.env.get("MAILJET_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400"
};

const jsonResponse = (data: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });

const buildShareLink = (shareId: string) => {
  const url = new URL(APP_BASE_URL);
  url.pathname = `/share/${shareId}`;
  return url.toString();
};

const sendViaMailjet = async (payload: ShareInvitePayload, link: string) => {
  if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !FROM_EMAIL) {
    throw new Error("Missing Mailjet config (MAILJET_API_KEY / MAILJET_SECRET_KEY / FROM_EMAIL).");
  }

  const senderDisplay = payload.senderName?.trim() || "A collaborator";
  const transporter = nodemailer.createTransport({
    host: "in-v3.mailjet.com",
    port: 587,
    secure: false,
    auth: {
      user: MAILJET_API_KEY,
      pass: MAILJET_SECRET_KEY,
    },
  });

  const html = `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>NotesTaker Invitation</title>
      <style>
        @media (max-width: 600px) {
          .card {
            padding: 32px 20px !important;
          }
        }
      </style>
    </head>
    <body style="margin:0;padding:0;background:#f7f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f8fb;padding:32px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;box-shadow:0 12px 24px rgba(15,23,42,0.08);overflow:hidden;">
              <tr>
                <td style="padding:48px 56px 40px;" class="card">
                  <div style="text-align:center;margin-bottom:32px;">
                    <div style="display:inline-block;padding:12px 20px;border-radius:999px;background:#eef2ff;color:#4338ca;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;font-size:12px;">
                      NotesTaker Invite
                    </div>
                  </div>
                  <h1 style="margin:0 0 16px;font-size:24px;color:#111827;">You're invited to collaborate</h1>
                  <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#374151;">
                    <strong>${senderDisplay}</strong> wants to work with you on a NotesTaker document. Open it now to start drawing together in real time.
                  </p>
                  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4b5563;">
                    NotesTaker is best experienced on desktop. Install the latest app, then jump into the shared note below.
                  </p>
                  <div style="text-align:center;margin-bottom:32px;">
                    <a
                      href="${link}"
                      style="display:inline-block;padding:14px 28px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:999px;font-size:16px;font-weight:600;box-shadow:0 10px 20px rgba(37,99,235,0.25);"
                    >
                      Open shared note
                    </a>
                  </div>
                  <div style="padding:20px;border-radius:12px;background:#f9fafb;color:#6b7280;font-size:13px;line-height:1.5;">
                    <strong>Having trouble?</strong>
                    <br />
                    Make sure you're signed into the same account that received this invite. Sharing stops automatically if the owner disables it or removes you from the document.
                  </div>
                </td>
              </tr>
              <tr>
                <td style="background:#111827;padding:20px 32px;text-align:center;color:#9ca3af;font-size:12px;">
                  © ${new Date().getFullYear()} NotesTaker. Built for fast thinking and fearless sketching.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

  await transporter.sendMail({
    from: FROM_EMAIL,
    to: payload.recipient,
    subject: `${senderDisplay} invited you to a NotesTaker document`,
    html
  });
};

const ensureRecipientHasAccount = async (email: string) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase admin credentials (PROJECT_URL / SERVICE_ROLE_KEY).");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const url = new URL("/rest/v1/allowed_invite_emails", SUPABASE_URL);
  url.searchParams.set("select", "email");
  url.searchParams.set("email", `eq.${normalizedEmail}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json"
    }
  });

  if (response.ok) {
    const result = (await response.json()) as Array<{ email: string }>;
    return Array.isArray(result) && result.length > 0;
  }

  if (response.status === 404) {
    return false;
  }

  const errorBody = await response.text();
  console.error("[share-invite] Failed to verify recipient:", response.status, errorBody);
  throw new Error("Unable to verify invite recipient. Please try again.");
};


Deno.serve(async req => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const payload = (await req.json()) as ShareInvitePayload;
    if (!payload?.shareId || !payload?.recipient || payload.recipientType !== "email") {
      return jsonResponse({ success: true, skipped: true });
    }

    if (!MAILJET_API_KEY || !MAILJET_SECRET_KEY || !FROM_EMAIL) {
      console.warn(
        "[share-invite] Missing Mailjet config (MAILJET_API_KEY / MAILJET_SECRET_KEY / FROM_EMAIL), skipping email send."
      );
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "missing_email_config"
      });
    }

    const hasAccount = await ensureRecipientHasAccount(payload.recipient);
    if (!hasAccount) {
      return jsonResponse({
        success: false,
        skipped: true,
        reason: "recipient_not_found"
      });
    }

    const link = buildShareLink(payload.shareId);
    await sendViaMailjet(payload, link);

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("[share-invite] failed:", error);
    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unknown error while sending invite email."
      }
    );
  }
});
