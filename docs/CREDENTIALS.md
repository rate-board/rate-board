# Credentials inventory

| Document | CRD |
| --- | --- |
| Version | 1.0 |
| Last updated | 26 Oct 2026 |

**No secret values are stored in this file or anywhere in the repository.** This inventory records what each
credential is for, where its value lives, who owns it and when to rotate it (process [BP-15](PROCESSES.md)).
Keep secret values in a password manager (for example 1Password or Bitwarden) shared only with people who need them.

| ID | Credential | Type | Value lives in | Owner | Rotation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `CRD-01` | GitHub account (owner of `rate-board` org) | Login + 2FA | Password manager | Varun | On change of staff; 2FA required | Controls both sites' code and Pages |
| `CRD-02` | Supabase account | Login + 2FA | Password manager | Varun | As above | Controls database, auth and functions |
| `CRD-03` | GoDaddy account | Login + 2FA | Password manager | Varun | As above | Controls the domain and DNS |
| `CRD-04` | Supabase publishable key | Public key | In code (`common.js`) | — | Only if revoked | Safe in browsers; row-level security protects data |
| `CRD-05` | Supabase anon key (legacy JWT) | Public key | In code (`app.js`) and in cron job commands | — | Only if the JWT secret is rotated | Safe in browsers; used to call edge functions that keep Verify JWT on |
| `CRD-06` | Supabase service role key | **Secret** | Supabase function environment (automatic) | Varun | 12 months, or at once if exposed | Bypasses row-level security; never in code or chat |
| `CRD-07` | Supabase JWT secret | **Secret** | Supabase | Varun | Only if exposed (rotating changes CRD-05) | |
| `CRD-08` | Database password | **Secret** | Password manager | Varun | 12 months | Only needed for direct database connections |
| `CRD-09` | `RESEND_API_KEY` | **Secret** | Supabase secrets (not set yet) | Varun | 12 months | For outgoing email |
| `CRD-10` | `EMAIL_FROM` | Setting | Supabase secrets (not set yet) | Varun | — | e.g. hello@beatinflation.com.au once the domain is verified in Resend |
| `CRD-11` | Admin account (varundabas@gmail.com) | Login + authenticator app | Password manager + authenticator | Varun | 12 months | Admin role in `profiles` |
| `CRD-12` | State fuel API keys (NSW, QLD, SA, NT, TAS, VIC) | **Secret** | Supabase secrets (to add) | Varun | Per provider | Needed to switch on fuel prices outside WA |
| `CRD-13` | Affiliate and partner logins (insurance, gift cards, retailers) | Logins / API keys | Password manager; API keys in Supabase secrets | Varun | Per partner | Add a row per partner when signed (BP-17) |
