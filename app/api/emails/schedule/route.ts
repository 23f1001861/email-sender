import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !(session?.user as any)?.id) {
      console.error("[SECURITY] Unauthorized email schedule attempt - no session or user ID");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // CRITICAL: Use session.user.id as the unique identifier
    // NEVER use a fallback like 'default-user' as it causes cross-user data contamination
    const userId = (session.user as any).id;
    
    if (!userId) {
      console.error("[SECURITY] Missing userId in session for user:", session.user?.email);
      return NextResponse.json(
        { error: "Session error: Missing user ID" },
        { status: 500 }
      );
    }

    // Add userId and userEmail to the request
    const requestBody = {
      ...body,
      userId: userId,
      userEmail: session.user?.email, // Pass email for backend user creation
    };
    
    console.log(`[AUDIT] User ${userId} (${session.user?.email}) scheduling ${body.recipients?.length || 0} emails`);

    // Forward to backend service
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:3001";
    const response = await fetch(
      `${backendUrl}/api/emails/schedule`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || "Failed to schedule email" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error scheduling email:", error);
    return NextResponse.json(
      { error: "Failed to schedule email" },
      { status: 500 }
    );
  }
}
