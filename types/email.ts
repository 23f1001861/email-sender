export interface User {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export interface EmailJob {
  id: string;
  subject: string;
  body: string;
  scheduledFor: string;
  delaySeconds: number;
  hourlyLimit: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmailRecipient {
  id: string;
  email: string;
  emailJobId: string;
  status: 'pending' | 'sent' | 'failed' | 'scheduled';
  scheduledAt?: string | null;
  sentAt?: string | null;
  errorMessage?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledEmail {
  id: string;
  email: string;
  subject: string;
  body?: string;
  scheduledFor: string;
  status: 'pending' | 'scheduled';
}

export interface SentEmail {
  id: string;
  email: string;
  subject: string;
  body?: string;
  sentAt: string;
  status: 'sent' | 'failed';
  errorMessage?: string | null;
}

export interface ComposeEmailData {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
}

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delaySeconds: number;
  hourlyLimit: number;
  userId: string;
}

export interface ScheduleEmailResponse {
  jobId: string;
  recipientCount: number;
  scheduledFor: string;
}
