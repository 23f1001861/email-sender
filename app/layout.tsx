import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReachInbox Email Scheduler - AI-Powered Email Campaigns",
  description: "Production-grade email scheduler with BullMQ, Redis, and real-time monitoring. Schedule, manage, and track email campaigns effortlessly.",
  keywords: ["ReachInbox", "Email Scheduler", "BullMQ", "Redis", "Email Campaigns", "Next.js", "TypeScript"],
  authors: [{ name: "ReachInbox Team" }],
  openGraph: {
    title: "ReachInbox Email Scheduler",
    description: "Production-grade email scheduler with BullMQ and Redis",
    url: "https://reachinbox.ai",
    siteName: "ReachInbox",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ReachInbox Email Scheduler",
    description: "Production-grade email scheduler with BullMQ and Redis",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
