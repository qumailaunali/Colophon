import { NextResponse } from "next/server";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

async function collectAllFilePaths(admin: SupabaseClient, prefix: string): Promise<string[]> {
  const { data: entries } = await admin.storage.from("library").list(prefix, { limit: 1000 });
  if (!entries) return [];

  const paths: string[] = [];
  for (const entry of entries) {
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...(await collectAllFilePaths(admin, fullPath)));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const admin = createSupabaseJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const filePaths = await collectAllFilePaths(admin, user.id);
  if (filePaths.length > 0) {
    await admin.storage.from("library").remove(filePaths);
  }

  // Deleting the auth user cascades books/highlights/reading_progress/reader_settings
  // via their ON DELETE CASCADE foreign keys to auth.users.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
