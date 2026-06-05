// Sends OTP emails. Priority: Resend API > SMTP (nodemailer) > console log (dev).
export async function sendOtpEmail(to: string, otp: string, brandName: string): Promise<void> {
  const subject = `Your ${brandName} verification code`;
  const html = `<p>Your verification code is: <strong style="font-size:24px;letter-spacing:4px">${otp}</strong></p><p>Expires in 15 minutes.</p>`;
  const text = `Your verification code is: ${otp}. Expires in 15 minutes.`;

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const SMTP_HOST = process.env.SMTP_HOST;
  const FROM = process.env.EMAIL_FROM ?? "noreply@stylique.app";

  if (RESEND_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) throw new Error(`Resend failed: ${res.status}`);
    return;
  }

  if (SMTP_HOST) {
    // Dynamic import to avoid requiring nodemailer when not needed.
    // @ts-expect-error — nodemailer is an optional peer dep; not in devDeps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = await import("nodemailer") as typeof import("nodemailer");
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({ from: FROM, to, subject, html, text });
    return;
  }

  // Dev fallback — log to console
  console.log(`[email-dev] OTP for ${to}: ${otp} (subject: ${subject})`);
}
