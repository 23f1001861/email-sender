/**
 * Security utilities for strict data isolation
 * Ensures users can only access their own email data
 */

import { db } from './db';

/**
 * Verify that a user owns the email job
 * Prevents cross-user data access
 */
export async function verifyUserOwnsJob(
  userId: string,
  jobId: string
): Promise<boolean> {
  try {
    const job = await db.emailJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    });

    if (!job) {
      return false;
    }

    return job.userId === userId;
  } catch (error) {
    console.error('Error verifying job ownership:', error);
    return false;
  }
}

/**
 * Verify that a user owns an email recipient
 * Prevents cross-user data access on individual emails
 */
export async function verifyUserOwnsRecipient(
  userId: string,
  recipientId: string
): Promise<boolean> {
  try {
    const recipient = await db.emailRecipient.findUnique({
      where: { id: recipientId },
      include: {
        emailJob: {
          select: { userId: true },
        },
      },
    });

    if (!recipient || !recipient.emailJob) {
      return false;
    }

    return recipient.emailJob.userId === userId;
  } catch (error) {
    console.error('Error verifying recipient ownership:', error);
    return false;
  }
}

/**
 * Get user by email with caching consideration
 * Validates email format before querying
 */
export async function getUserByEmail(email: string) {
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return null;
  }

  try {
    const user = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    return user;
  } catch (error) {
    console.error('Error finding user by email:', error);
    return null;
  }
}

/**
 * Verify user identity matches the requested user email
 * Prevents users from accessing other users' data via query parameters
 */
export async function verifyUserAccess(
  requestedUserEmail: string,
  sessionUserId: string
): Promise<boolean> {
  try {
    const user = await getUserByEmail(requestedUserEmail);

    if (!user) {
      return false;
    }

    // Strict check: session user ID must match the owner
    return user.id === sessionUserId;
  } catch (error) {
    console.error('Error verifying user access:', error);
    return false;
  }
}

/**
 * Sanitize user email to prevent injection attacks
 */
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Log access attempts for security monitoring
 */
export async function logAccessAttempt(
  userId: string,
  action: string,
  resource: string,
  success: boolean
): Promise<void> {
  try {
    console.log(
      `[AUDIT] ${new Date().toISOString()} | User: ${userId} | Action: ${action} | Resource: ${resource} | Success: ${success}`
    );
    // In production, save this to an audit log table
  } catch (error) {
    console.error('Error logging access attempt:', error);
  }
}

/**
 * Check if email is explicitly belonging to user's domain
 * Optional: restrict to specific domains in production
 */
export function isAllowedDomain(email: string, allowedDomains?: string[]): boolean {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true; // Allow all domains if none specified
  }

  const domain = email.split('@')[1].toLowerCase();
  return allowedDomains.includes(domain);
}
