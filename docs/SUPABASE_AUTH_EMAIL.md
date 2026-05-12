# Supabase Auth Email Sending

HeartHaven should use a custom SMTP provider for production Auth emails.

## Where To Configure It

In Supabase, go to:

```text
Authentication -> Emails / Email Configuration -> Custom SMTP
```

The Sign In / Providers page only controls whether email login is enabled. SMTP sending is configured in the email
configuration area.

## Recommended Provider Shape

Use a transactional email service that supports SMTP, such as Resend, Postmark, AWS SES, SendGrid, ZeptoMail, or Brevo.

Recommended sending identity:

```text
From name: HeartHaven
From email: no-reply@auth.your-domain.com
Reply-to: support@your-domain.com
```

Keep Auth email separate from marketing email. Configure SPF, DKIM, and DMARC for the sending domain before opening signups
widely.

## Supabase Fields

```text
SMTP host: provider SMTP host
SMTP port: 587
SMTP user: provider username
SMTP password: provider password/API key
Sender name: HeartHaven
Sender email: no-reply@auth.your-domain.com
```

After saving, send a test email from Supabase. Then check Authentication -> Rate Limits and raise the email rate limit
with the provider if needed.

## Required Redirect URLs

Add these in Authentication -> URL Configuration:

```text
https://your-hearthaven-domain.com/auth/callback
https://*.pages.dev/auth/callback
http://localhost:3000/auth/callback
```

The app already handles both `code` and `token_hash` flows at `/auth/callback`.

## Templates

Copy the HTML files in `supabase/auth-templates/` into Supabase Auth email templates:

```text
confirm-signup.html -> Confirm signup
magic-link.html -> Magic link
reset-password.html -> Reset password
invite-user.html -> Invite user
change-email.html -> Change email address
reauthentication.html -> Reauthentication
```

Disable click tracking in the email provider for Auth emails. Link rewriting can break Supabase confirmation URLs.
