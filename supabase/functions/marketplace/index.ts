// Marketplace actions that need the service role: sending queued emails, inviting agents, deleting accounts.
// "Verify JWT" is off because the database calls send_email without a user; every other action checks the
// caller's token itself.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://rate-board.github.io/rate-board/";
const EMAIL_MAX_AGE_HOURS = 72;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// The admin portal runs from a local file (origin "null"), so allow any origin; auth is by bearer token.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// The token is verified by getUser; its payload is then read for the MFA level, which getUser doesn't return.
async function requireUser(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired; sign in again");
  const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { user: data.user, aal: payload.aal as string };
}

async function requireAdmin(req: Request) {
  const caller = await requireUser(req);
  const { data } = await db.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (data?.role !== "admin" || caller.aal !== "aal2") {
    throw new HttpError(403, "Admins only (sign in to the admin portal with your authenticator code)");
  }
  return caller.user;
}

async function logAdmin(adminId: string, action: string, target: string, detail: unknown) {
  await db.from("admin_log").insert({ admin_id: adminId, action, target, detail });
}

// Sends one queued email through Resend. Without RESEND_API_KEY and EMAIL_FROM set, emails wait in the queue;
// ones older than EMAIL_MAX_AGE_HOURS are marked expired rather than sent late.
async function sendEmail(id: number) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const { data: row } = await db.from("email_outbox").select("*").eq("id", id).eq("status", "queued").maybeSingle();
  if (!row) return { status: "skipped" };
  if (Date.now() - new Date(row.created_at).getTime() > EMAIL_MAX_AGE_HOURS * 3_600_000) {
    await db.from("email_outbox").update({ status: "expired" }).eq("id", id);
    return { status: "expired" };
  }
  if (!key || !from) return { status: "waiting" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [row.to_email], subject: row.subject, text: row.body }),
  });
  if (res.ok) {
    await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", id);
    return { status: "sent" };
  }
  const error = `${res.status} ${(await res.text()).slice(0, 300)}`;
  await db.from("email_outbox").update({ status: "failed", error }).eq("id", id);
  return { status: "failed", error };
}

async function flushEmails(req: Request) {
  await requireAdmin(req);
  const { data } = await db.from("email_outbox").select("id").eq("status", "queued").order("id").limit(100);
  const results = [];
  for (const row of data || []) results.push(await sendEmail(row.id));
  return { sent: results.filter(r => r.status === "sent").length, total: results.length, results };
}

type AgentInput = {
  email: string; full_name: string; mobile: string; business: string; licence: string;
  aggregator?: string; lenders: string[]; bio?: string;
};

// Creates an approved agent. A new email gets an invitation to set a password; an existing account is upgraded.
async function createAgent(req: Request, input: AgentInput) {
  const admin = await requireAdmin(req);
  const email = String(input.email || "").trim().toLowerCase();
  const mobile = String(input.mobile || "").replace(/\D/g, "");
  const licence = String(input.licence || "").replace(/\s/g, "");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email");
  if (!/^04\d{8}$/.test(mobile)) throw new HttpError(400, "Enter an Australian mobile number");
  if (!/^\d{3,10}$/.test(licence)) throw new HttpError(400, "Enter the licence number (digits only)");
  if (!input.full_name?.trim() || !input.business?.trim()) throw new HttpError(400, "Enter the agent's name and business");
  if (!Array.isArray(input.lenders) || !input.lenders.length) throw new HttpError(400, "Choose at least one lender");

  let { data: userId } = await db.rpc("user_id_by_email", { p_email: email });
  let invited = false;
  if (!userId) {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: SITE + "agent.html",
      data: { needs_password: true },
    });
    if (error) throw new HttpError(400, error.message);
    userId = data.user.id;
    invited = true;
  }
  if (await db.from("agents").select("id").eq("id", userId).maybeSingle().then(r => r.data)) {
    throw new HttpError(409, "That account is already an agent");
  }

  const profile = await db.from("profiles").update({ full_name: input.full_name.trim(), mobile }).eq("id", userId);
  if (profile.error) throw new HttpError(400, profile.error.message);
  const agent = await db.from("agents").insert({
    id: userId,
    full_name: input.full_name.trim(),
    business: input.business.trim(),
    contact_email: email,
    licence_number: licence,
    aggregator: input.aggregator?.trim() || null,
    lenders: input.lenders,
    bio: input.bio?.trim() || null,
    status: "approved",
  });
  if (agent.error) throw new HttpError(400, agent.error.message);
  await logAdmin(admin.id, "create agent", userId, { email, invited });
  return { id: userId, invited };
}

async function deleteUser(req: Request, userId: string) {
  const admin = await requireAdmin(req);
  const { data: target } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!target) throw new HttpError(404, "Account not found");
  if (target.role === "admin") throw new HttpError(400, "Admin accounts are removed in the SQL editor");
  const email = (await db.auth.admin.getUserById(userId)).data.user?.email;
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new HttpError(400, error.message);
  await logAdmin(admin.id, "delete account", userId, { email });
  return { deleted: true };
}

async function deleteSelf(req: Request) {
  const { user } = await requireUser(req);
  const { data } = await db.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role === "admin") throw new HttpError(400, "Admin accounts are removed in the SQL editor");
  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) throw new HttpError(400, error.message);
  return { deleted: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "send_email": return json(await sendEmail(Number(body.id)));
      case "flush_emails": return json(await flushEmails(req));
      case "create_agent": return json(await createAgent(req, body.agent || {}));
      case "delete_user": return json(await deleteUser(req, String(body.user_id || "")));
      case "delete_self": return json(await deleteSelf(req));
      default: throw new HttpError(400, "Unknown action");
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});
