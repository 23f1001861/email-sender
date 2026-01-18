"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Plus, LogOut, Loader2, Mail, Clock, Send, Search, Filter, RotateCw } from "lucide-react";
import { ComposeEmailModal } from "@/components/email/compose-email-modal";
import { ScheduledEmailsTable } from "@/components/email/scheduled-emails-table";
import { SentEmailsTable } from "@/components/email/sent-emails-table";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [activeTab, setActiveTab] = useState("scheduled");
  const [scheduledCount, setScheduledCount] = useState(0);
  const [sentCount, setSentCount] = useState(0);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  // Fetch email counts
  useEffect(() => {
    const fetchCounts = async () => {
      if (!session?.user?.email) return;

      try {
        // Fetch scheduled count
        const scheduledRes = await fetch(`/api/emails/scheduled?userEmail=${session.user.email}`);
        if (scheduledRes.ok) {
          const scheduledData = await scheduledRes.json();
          setScheduledCount(scheduledData.length || 0);
        }

        // Fetch sent count
        const sentRes = await fetch(`/api/emails/sent?userEmail=${session.user.email}`);
        if (sentRes.ok) {
          const sentData = await sentRes.json();
          setSentCount(sentData.length || 0);
        }
      } catch (error) {
        console.error("Error fetching counts:", error);
      }
    };

    fetchCounts();
    // Refresh counts every 30 seconds
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, [session]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const userInitials = session.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="w-full px-3 sm:px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-xl sm:text-2xl font-bold">ReachInbox</div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium">{session.user?.name}</p>
                  <p className="text-xs text-muted-foreground">{session.user?.email}</p>
                </div>
                <Avatar className="h-8 w-8 sm:h-9 sm:w-9">
                  <AvatarImage src={session.user?.image || undefined} />
                  <AvatarFallback className="bg-orange-500 text-white text-xs">{userInitials}</AvatarFallback>
                </Avatar>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 h-[calc(100vh-57px)] overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-64 border-r bg-white p-4 flex-col">
          {/* User Profile */}
          <div className="flex items-center gap-2 mb-4 pb-4 border-b cursor-pointer hover:bg-gray-50 rounded-lg p-2 -m-2">
            <Avatar className="h-10 w-10">
              <AvatarImage src={session.user?.image || undefined} />
              <AvatarFallback className="bg-orange-500 text-white">{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.user?.name || "Oliver Brown"}</p>
              <p className="text-xs text-muted-foreground truncate">{session.user?.email}</p>
            </div>
          </div>

          <Button
            className="w-full mb-6 bg-green-600 hover:bg-green-700 h-10"
            onClick={() => setShowComposeModal(true)}
          >
            Compose
          </Button>
          
          <nav className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">
              CORE
            </div>
            <Button
              variant={activeTab === "scheduled" ? "secondary" : "ghost"}
              className="w-full justify-start gap-2 h-10"
              onClick={() => setActiveTab("scheduled")}
            >
              <Clock className="h-4 w-4 flex-shrink-0" />
              Scheduled
              <span className="ml-auto text-xs text-muted-foreground bg-green-50 px-2 py-0.5 rounded">{scheduledCount}</span>
            </Button>
            <Button
              variant={activeTab === "sent" ? "secondary" : "ghost"}
              className="w-full justify-start gap-2 h-10"
              onClick={() => setActiveTab("sent")}
            >
              <Send className="h-4 w-4 flex-shrink-0" />
              Sent
              <span className="ml-auto text-xs text-muted-foreground bg-green-50 px-2 py-0.5 rounded">{sentCount}</span>
            </Button>
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto flex flex-col">
          {/* Search Bar */}
          <div className="border-b bg-white px-3 sm:px-6 py-2 sm:py-3 sticky top-0 z-30">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search"
                  className="pl-9 bg-gray-50 border-gray-200 h-8 sm:h-9 text-sm"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9">
                <Filter className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9">
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Mobile Tab Navigation */}
          <div className="lg:hidden flex gap-2 px-3 sm:px-6 py-3 border-b bg-white">
            <Button
              variant={activeTab === "scheduled" ? "default" : "outline"}
              className="flex-1 h-8 sm:h-9 text-xs sm:text-sm gap-1"
              onClick={() => setActiveTab("scheduled")}
            >
              <Clock className="h-4 w-4" />
              <span className="hidden sm:inline">Scheduled</span>
              <span className="inline sm:hidden">({scheduledCount})</span>
            </Button>
            <Button
              variant={activeTab === "sent" ? "default" : "outline"}
              className="flex-1 h-8 sm:h-9 text-xs sm:text-sm gap-1"
              onClick={() => setActiveTab("sent")}
            >
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">Sent</span>
              <span className="inline sm:hidden">({sentCount})</span>
            </Button>
          </div>
          
          {/* Compose Button for Mobile */}
          <div className="lg:hidden px-3 sm:px-6 py-2">
            <Button
              className="w-full bg-green-600 hover:bg-green-700 h-9 sm:h-10 text-sm"
              onClick={() => setShowComposeModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Compose Email
            </Button>
          </div>
          
          {/* Content Area */}
          <div className="flex-1 px-3 sm:px-6 py-4 sm:py-6 overflow-auto">
            {activeTab === "scheduled" && <ScheduledEmailsTable />}
            {activeTab === "sent" && <SentEmailsTable />}
          </div>
        </main>
      </div>

      <ComposeEmailModal
        open={showComposeModal}
        onOpenChange={setShowComposeModal}
        onSuccess={() => {
          setActiveTab("scheduled");
          // Refresh counts after successful email scheduling
          if (session?.user?.email) {
            fetch(`/api/emails/scheduled?userEmail=${session.user.email}`)
              .then(res => res.json())
              .then(data => setScheduledCount(data.length || 0))
              .catch(err => console.error("Error updating count:", err));
          }
        }}
      />
    </div>
  );
}
