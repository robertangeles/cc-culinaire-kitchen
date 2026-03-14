/**
 * @module services/emailService
 *
 * Email delivery service using Resend. Handles sending verification
 * emails and other transactional messages.
 */

import { Resend } from "resend";
import pino from "pino";

const logger = pino({ name: "emailService" });

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — email sending is disabled");
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@culinaire.kitchen";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/**
 * Sends an email verification link to a newly registered user.
 */
export async function sendVerificationEmail(
  email: string,
  name: string,
  token: string,
) {
  const verifyUrl = `${CLIENT_URL}/verify-email?token=${token}`;

  const client = getResend();
  if (!client) return;

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your email — CulinAIre Kitchen",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #292524; margin-bottom: 8px;">Welcome to CulinAIre Kitchen</h2>
        <p style="color: #57534e; font-size: 15px;">Hi ${name},</p>
        <p style="color: #57534e; font-size: 15px;">
          Please verify your email address by clicking the button below.
          This link expires in 24 hours.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}"
             style="display: inline-block; background-color: #b45309; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Verify Email
          </a>
        </div>
        <p style="color: #a8a29e; font-size: 13px;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${verifyUrl}" style="color: #b45309; word-break: break-all;">${verifyUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error }, "Failed to send verification email");
  }
}

/**
 * Sends a direct email from an admin to a user.
 *
 * @param to      - Recipient email address.
 * @param subject - Email subject line.
 * @param body    - HTML email body content.
 * @returns `{ sent: true }` on success, `{ sent: false, error: string }` on failure.
 */
export async function sendDirectEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ sent: boolean; error?: string }> {
  const client = getResend();
  if (!client) return { sent: false, error: "Email service not configured (RESEND_API_KEY missing)" };

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        ${body}
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          Sent from CulinAIre Kitchen
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error, to }, "Failed to send direct email");
    return { sent: false, error: error.message };
  }

  return { sent: true };
}

/**
 * Sends a password reset link to the user.
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  token: string,
): Promise<{ sent: boolean; error?: string }> {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;

  const client = getResend();
  if (!client) return { sent: false, error: "Email service not configured (RESEND_API_KEY missing)" };

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your password — CulinAIre Kitchen",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #292524; margin-bottom: 8px;">Password Reset</h2>
        <p style="color: #57534e; font-size: 15px;">Hi ${name},</p>
        <p style="color: #57534e; font-size: 15px;">
          We received a request to reset your password. Click the button below
          to choose a new one. This link expires in 1 hour.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}"
             style="display: inline-block; background-color: #b45309; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>
        </div>
        <p style="color: #a8a29e; font-size: 13px;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${resetUrl}" style="color: #b45309; word-break: break-all;">${resetUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error, email }, "Failed to send password reset email");
    return { sent: false, error: error.message };
  }

  return { sent: true };
}
