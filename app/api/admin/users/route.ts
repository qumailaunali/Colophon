import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ADMIN_EMAIL, createAdminClient, listUsersWithBookCounts } from "@/lib/supabase/admin";

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  try {
    return NextResponse.json({ users: await listUsersWithBookCounts(admin) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list users" },
      { status: 500 }
    );
  }
}
