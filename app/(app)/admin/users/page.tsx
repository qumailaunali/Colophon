import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  ADMIN_EMAIL,
  createAdminClient,
  listUsersWithBookCounts,
  type AdminUser,
} from "@/lib/supabase/admin";
import { UsersManager } from "./UsersManager";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email !== ADMIN_EMAIL) {
    redirect("/library");
  }

  let users: AdminUser[] = [];
  let error: string | null = null;
  const admin = createAdminClient();
  if (!admin) {
    error = "Server is missing SUPABASE_SERVICE_ROLE_KEY";
  } else {
    try {
      users = await listUsersWithBookCounts(admin);
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load users.";
    }
  }

  return <UsersManager initialUsers={users} initialError={error} />;
}
