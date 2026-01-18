import express from 'express';
import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { db } from './lib/db';
import { Prisma } from '@prisma/client';
import {
  getUserByEmail,
  verifyUserOwnsRecipient,
  sanitizeEmail,
  logAccessAttempt,
} from './lib/security';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3001', 10);

// Redis configuration (force IPv4 on Windows to avoid ::1 issues)
const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,

  family: 4 as 4, // Force IPv4 to avoid ECONNREFUSED on ::1
  maxRetriesPerRequest: null,
  // Retry gently to avoid log spam if Redis is down
  retryStrategy: (times: number) => Math.min(times * 500, 5000),
};

// Create Redis connection
const connection = new Redis(redisConfig);

connection.on('error', (err) => {
  console.error('Redis connection error:', err);
});

connection.on('connect', () => {
  console.log('Redis connected successfully');
});

// BullMQ Queues
const emailQueue = new Queue('emails', { connection: redisConfig as any });

emailQueue.on('error', (err) => {
  console.error('Queue error:', err);
});

// Email transporter (Ethereal)
const transporter = nodemailer.createTransport({
  host: process.env.ETHEREAL_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.ETHEREAL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.ETHEREAL_USER || '',
    pass: process.env.ETHEREAL_PASS || '',
  },
});

// Validation schemas
const scheduleEmailSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  // Accept various datetime inputs and normalize to ISO UTC
  startTime: z.preprocess((val) => {
    if (typeof val === 'string') {
      const d = new Date(val);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
    return val;
  }, z.string().datetime()),
  delaySeconds: z.number().min(1).max(300),
  hourlyLimit: z.number().min(1).max(1000),
  userId: z.string(),
  userEmail: z.string().email().optional(), // For auto-creating users
});

interface SendEmailJobData {
  recipientId: string;
  email: string;
  subject: string;
  body: string;
  jobId: string;
  userId: string;
  hourlyLimit: number;
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Schedule emails
app.post('/api/emails/schedule', async (req, res) => {
  try {
    console.log('[DEBUG] Received schedule request:', JSON.stringify(req.body, null, 2));
    const data = scheduleEmailSchema.parse(req.body);
    const startTime = new Date(data.startTime);

    // SECURITY CHECK: Reject default-user to prevent cross-contamination
    if (data.userId === 'default-user' || !data.userId) {
      console.error('[SECURITY] Rejected schedule request with invalid userId:', data.userId);
      return res.status(400).json({ 
        error: 'Invalid user ID. Please log in again.' 
      });
    }

    // Find or create user - userId should be the actual user ID from NextAuth
    let user = await db.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      // User exists in frontend but not in backend - auto-create with actual email
      if (!data.userEmail) {
        console.error('[SECURITY] Cannot create user without email:', data.userId);
        return res.status(400).json({ 
          error: 'User email is required. Please log in again.' 
        });
      }

      console.log(`[INFO] Creating new user in backend: ${data.userId} (${data.userEmail})`);
      try {
        user = await db.user.create({
          data: {
            id: data.userId,
            email: data.userEmail, // Use ACTUAL email from frontend
            name: data.userEmail.split('@')[0], // Extract name from email
          },
        });
      } catch (createError: any) {
        // If the email already exists with a different userId, reuse that user to avoid P2002
        if (
          createError instanceof Prisma.PrismaClientKnownRequestError &&
          createError.code === 'P2002'
        ) {
          console.warn(
            `[WARN] Email ${data.userEmail} already exists; reusing existing user record instead of failing.`
          );
          user = await db.user.findUnique({ where: { email: data.userEmail } });

          if (!user) {
            console.error('[ERROR] Expected existing user after P2002 but none found');
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }
    
    console.log(`[AUDIT] User ${user.id} (${user.email}) scheduling email job with ${data.recipients.length} recipients`);

    // Create email job
    const emailJob = await db.emailJob.create({
      data: {
        subject: data.subject,
        body: data.body,
        scheduledFor: startTime,
        delaySeconds: data.delaySeconds,
        hourlyLimit: data.hourlyLimit,
        userId: user.id,
        recipients: {
          create: data.recipients.map((email) => ({
            email,
            status: 'pending',
          })),
        },
      },
      include: {
        recipients: true,
      },
    });

    // Schedule individual emails with BullMQ
    const promises = emailJob.recipients.map(async (recipient, index) => {
      const delay = index * data.delaySeconds * 1000;
      const scheduledTime = new Date(startTime.getTime() + delay);
      const queueDelay = Math.max(0, scheduledTime.getTime() - Date.now());
      
      // Determine if this is immediate send (within next 10 seconds) or scheduled
      const isImmediate = queueDelay < 10000;

      // Update recipient with scheduledAt timestamp and appropriate status
      await db.emailRecipient.update({
        where: { id: recipient.id },
        data: {
          scheduledAt: scheduledTime,
          status: isImmediate ? 'pending' : 'scheduled',
        },
      });

      return emailQueue.add(
        'send-email',
        {
          recipientId: recipient.id,
          email: recipient.email,
          subject: data.subject,
          body: data.body,
          jobId: emailJob.id,
          userId: user.id,
          hourlyLimit: data.hourlyLimit,
        } as SendEmailJobData,
        {
          delay: queueDelay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );
    });

    await Promise.all(promises);

    res.json({
      jobId: emailJob.id,
      recipientCount: emailJob.recipients.length,
      scheduledFor: emailJob.scheduledFor,
    });
  } catch (error) {
    console.error('Error scheduling email:', error);
    if (error instanceof z.ZodError) {
      const zodError = error as any;
      console.error('[VALIDATION] Zod error details:', JSON.stringify(zodError.errors, null, 2));
      res.status(400).json({ 
        error: 'Validation failed',
        details: zodError.errors.map((e: any) => `${e.path.join('.')}: ${e.message}`)
      });
    } else {
      res.status(500).json({ error: 'Failed to schedule email' });
    }
  }
});

// Get scheduled emails with strict user isolation
app.get('/api/emails/scheduled', async (req, res) => {
  try {
    const { userEmail } = req.query;

    // Validate userEmail is provided
    if (!userEmail || typeof userEmail !== 'string') {
      console.warn('[SECURITY] Scheduled emails requested without userEmail');
      return res.status(400).json({ error: 'userEmail parameter is required' });
    }

    // Sanitize and validate email format
    const sanitizedEmail = sanitizeEmail(userEmail);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      await logAccessAttempt('unknown', 'GET /api/emails/scheduled', sanitizedEmail, false);
      console.warn(`[SECURITY] Invalid email format requested: ${sanitizedEmail}`);
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Fetch user - STRICT ISOLATION: must exist and match email exactly
    let user = await getUserByEmail(sanitizedEmail);
    if (!user) {
      // User might have just logged in but not scheduled emails yet
      // Auto-create user to support first-time users
      console.log(`[INFO] User not found for GET, creating: ${sanitizedEmail}`);
      try {
        user = await db.user.create({
          data: {
            email: sanitizedEmail,
            name: sanitizedEmail.split('@')[0],
          },
        });
        console.log(`[INFO] User created for GET: ${user.id}`);
      } catch (createError: any) {
        // User might have been created by another request (race condition)
        if (createError.code === 'P2002') {
          // Unique constraint violation - user was just created, fetch again
          user = await getUserByEmail(sanitizedEmail);
          if (!user) {
            console.error(`[ERROR] User still not found after create attempt: ${sanitizedEmail}`);
            return res.json([]);
          }
        } else {
          console.error(`[ERROR] Failed to create user: ${createError.message}`);
          return res.json([]);
        }
      }
    }

    // Log the access attempt
    await logAccessAttempt(user.id, 'GET /api/emails/scheduled', user.email, true);

    // STRICT ISOLATION: Query with userId filter - no overlapping data
    // Show emails that are scheduled for the future or pending
    const recipients = await db.emailRecipient.findMany({
      where: {
        status: { in: ['pending', 'scheduled'] },
        emailJob: {
          userId: user.id, // CRITICAL: Filter by userId to prevent cross-user access
        },
      },
      include: {
        emailJob: {
          select: {
            id: true,
            subject: true,
            body: true,
            scheduledFor: true,
            userId: true, // Include userId for verification
          },
        },
      },
      orderBy: {
        scheduledAt: 'asc',
      },
      take: 100,
    });

    // Verify data integrity: ensure all results belong to the authenticated user
    const result = recipients
      .filter((r) => {
        // Double-check: each result must have the matching userId
        const isOwned = r.emailJob.userId === user.id;
        if (!isOwned) {
          console.error(
            `[SECURITY] Data isolation violation detected for user ${user.id}. Found mismatched emailJob.`
          );
        }
        return isOwned;
      })
      .map((r) => ({
        id: r.id,
        email: r.email,
        subject: r.emailJob.subject,
        body: r.emailJob.body,
        scheduledFor: r.scheduledAt?.toISOString() || r.emailJob.scheduledFor.toISOString(),
        status: r.status,
      }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching scheduled emails:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
});

// Get sent emails with strict user isolation
app.get('/api/emails/sent', async (req, res) => {
  try {
    const { userEmail } = req.query;

    // Validate userEmail is provided
    if (!userEmail || typeof userEmail !== 'string') {
      console.warn('[SECURITY] Sent emails requested without userEmail');
      return res.status(400).json({ error: 'userEmail parameter is required' });
    }

    // Sanitize and validate email format
    const sanitizedEmail = sanitizeEmail(userEmail);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitizedEmail)) {
      await logAccessAttempt('unknown', 'GET /api/emails/sent', sanitizedEmail, false);
      console.warn(`[SECURITY] Invalid email format requested: ${sanitizedEmail}`);
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Fetch user - STRICT ISOLATION: must exist and match email exactly
    let user = await getUserByEmail(sanitizedEmail);
    if (!user) {
      // User might have just logged in but not scheduled emails yet
      // Auto-create user to support first-time users
      console.log(`[INFO] User not found for GET, creating: ${sanitizedEmail}`);
      try {
        user = await db.user.create({
          data: {
            email: sanitizedEmail,
            name: sanitizedEmail.split('@')[0],
          },
        });
        console.log(`[INFO] User created for GET: ${user.id}`);
      } catch (createError: any) {
        // User might have been created by another request (race condition)
        if (createError.code === 'P2002') {
          // Unique constraint violation - user was just created, fetch again
          user = await getUserByEmail(sanitizedEmail);
          if (!user) {
            console.error(`[ERROR] User still not found after create attempt: ${sanitizedEmail}`);
            return res.json([]);
          }
        } else {
          console.error(`[ERROR] Failed to create user: ${createError.message}`);
          return res.json([]);
        }
      }
    }

    // Log the access attempt
    await logAccessAttempt(user.id, 'GET /api/emails/sent', user.email, true);

    // STRICT ISOLATION: Query with userId filter - no overlapping data
    const recipients = await db.emailRecipient.findMany({
      where: {
        status: { in: ['sent', 'failed'] },
        emailJob: {
          userId: user.id, // CRITICAL: Filter by userId to prevent cross-user access
        },
      },
      include: {
        emailJob: {
          select: {
            id: true,
            subject: true,
            body: true,
            userId: true, // Include userId for verification
          },
        },
      },
      orderBy: {
        sentAt: 'desc',
      },
      take: 100,
    });

    // Verify data integrity: ensure all results belong to the authenticated user
    const result = recipients
      .filter((r) => {
        // Double-check: each result must have the matching userId
        const isOwned = r.emailJob.userId === user.id;
        if (!isOwned) {
          console.error(
            `[SECURITY] Data isolation violation detected for user ${user.id}. Found mismatched emailJob.`
          );
        }
        return isOwned;
      })
      .map((r) => ({
        id: r.id,
        email: r.email,
        subject: r.emailJob.subject,
        body: r.emailJob.body,
        sentAt: r.sentAt?.toISOString(),
        status: r.status,
        errorMessage: r.errorMessage,
      }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching sent emails:', error);
    res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
});

// Rate limiting helper using Redis
async function checkRateLimit(
  userId: string,
  hourlyLimit: number
): Promise<boolean> {
  const currentHour = Math.floor(Date.now() / (1000 * 60 * 60));
  const key = `rate_limit:${userId}:${currentHour}`;

  const currentCount = await connection.incr(key);

  if (currentCount === 1) {
    // Set expiry to 1 hour
    await connection.expire(key, 3600);
  }

  return currentCount <= hourlyLimit;
}

// BullMQ Worker
let worker: Worker;

try {
  worker = new Worker(
    'emails',
    async (job: Job<SendEmailJobData>) => {
      const { recipientId, email, subject, body, userId, hourlyLimit } = job.data;

      try {
        // Check rate limit
        const canSend = await checkRateLimit(userId, hourlyLimit);

        if (!canSend) {
          // Rate limit exceeded, reschedule to next hour
          const nextHour = Math.ceil(Date.now() / (1000 * 60 * 60)) * (1000 * 60 * 60);
          const delay = nextHour - Date.now();

          console.log(`Rate limit exceeded for user ${userId}, rescheduling in ${delay}ms`);

          // Update recipient status to scheduled for later
          await db.emailRecipient.update({
            where: { id: recipientId },
            data: {
              status: 'scheduled',
              scheduledAt: new Date(nextHour),
            },
          });

          // Throw to trigger retry with delay
          throw new Error('Rate limit exceeded, will retry next hour');
        }

      // Send email via Ethereal
      const info = await transporter.sendMail({
        from: process.env.ETHEREAL_USER || '"ReachInbox" <noreply@reachinbox.ai>',
        to: email,
        subject,
        html: body,
      });

      console.log('Email sent:', info.messageId);

      // Update recipient status to sent
      await db.emailRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'sent',
          sentAt: new Date(),
        },
      });

      // Update email job status if all recipients are sent
      const jobRecipients = await db.emailRecipient.findMany({
        where: { emailJobId: job.data.jobId },
      });

      const allSent = jobRecipients.every((r) => r.status === 'sent');

      if (allSent) {
        await db.emailJob.update({
          where: { id: job.data.jobId },
          data: { status: 'completed' },
        });
      }

      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending email:', error);

      if (error instanceof Error && error.message === 'Rate limit exceeded, will retry next hour') {
        throw error; // Re-throw for retry
      }

      // Update recipient status to failed
      await db.emailRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          retryCount: { increment: 1 },
        },
      });

      throw error;
    }
  },
  {
    connection: {
      ...redisConfig,
      maxRetriesPerRequest: null,  // Added to fix BullMQ error
    },
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
    limiter: {
      max: parseInt(process.env.MAX_EMAILS_PER_MINUTE || '10'),
      duration: 60000, // 1 minute
    },
  }
  );
  console.log('✓ BullMQ Worker initialized successfully');
} catch (workerError) {
  console.error('Failed to initialize BullMQ Worker:', workerError);
  process.exit(1);
}

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
  console.error('Worker error:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start server
console.log('Starting email scheduler service...');
console.log('Connecting to Redis:', redisConfig.host + ':' + redisConfig.port);

try {
  const server = app.listen(PORT, () => {
    console.log(`✓ Email scheduler service running on port ${PORT}`);
    console.log(`✓ Redis: ${redisConfig.host}:${redisConfig.port}`);
    console.log(`✓ Worker concurrency: ${process.env.WORKER_CONCURRENCY || '5'}`);
    console.log(`✓ Max emails per minute: ${process.env.MAX_EMAILS_PER_MINUTE || '10'}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
} catch (err) {
  console.error('Failed to start server:', err);
  process.exit(1);
}