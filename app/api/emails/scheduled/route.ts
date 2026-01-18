import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    // SECURITY: Verify user is authenticated
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      console.warn("[SECURITY] Unauthorized access attempt to /api/emails/scheduled");
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get("userEmail");

    // SECURITY: Validate that the requested email matches the authenticated user's email
    // This prevents users from requesting other users' data
    if (!userEmail) {
      console.warn(`[SECURITY] Missing userEmail parameter for user ${session.user.email}`);
      return NextResponse.json(
        { error: "userEmail parameter is required" },
        { status: 400 }
      );
    }

    const sanitizedRequestEmail = userEmail.toLowerCase().trim();
    const authenticatedUserEmail = session.user.email.toLowerCase().trim();

    // CRITICAL SECURITY CHECK: Ensure user can only access their own data
    if (sanitizedRequestEmail !== authenticatedUserEmail) {
      console.error(
        `[SECURITY] Cross-user access attempt detected! User ${authenticatedUserEmail} tried to access ${sanitizedRequestEmail}'s emails`
      );
      return NextResponse.json(
        { error: "Forbidden: You can only access your own email data" },
        { status: 403 }
      );
    }

    // Forward to backend service with the authenticated user's email
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:3001";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let response: Response | null = null;
    try {
      response = await fetch(
        `${backendUrl}/api/emails/scheduled?userEmail=${encodeURIComponent(sanitizedRequestEmail)}`,
        { signal: controller.signal, cache: "no-store" }
      );
    } catch (err) {
      console.error("Backend fetch error (scheduled):", err);
      clearTimeout(timeout);
      return NextResponse.json(
        { error: "Backend scheduler is unreachable. Please start the email-scheduler service on port 3001." },
        { status: 503 }
      );
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text().catch(() => "");
      console.error("Backend responded non-OK (scheduled):", error || response.statusText);
      return NextResponse.json(
        { error: error || "Failed to fetch scheduled emails" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unhandled error in scheduled route:", error);
    return NextResponse.json(
      { error: "Unexpected error fetching scheduled emails" },
      { status: 500 }
    );
  }
}
