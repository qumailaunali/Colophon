import { createClient as createSupabaseJsClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const ADMIN_EMAIL = "qumailaunali@gmail.com";

/** Service-role client. Server-only; returns null when the key is not configured. */
export function createAdminClient(): SupabaseClient | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;

  return createSupabaseJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function collectAllFilePaths(admin: SupabaseClient, prefix: string): Promise<string[]> {
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

/** Removes a user's storage folder, then the auth user (DB rows cascade via FKs to auth.users). */
export async function deleteUserAndFiles(admin: SupabaseClient, userId: string) {
  const filePaths = await collectAllFilePaths(admin, userId);
  if (filePaths.length > 0) {
    await admin.storage.from("library").remove(filePaths);
  }
  return admin.auth.admin.deleteUser(userId);
}

export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  book_count: number;
  is_admin: boolean;
};

/** Every auth user with their uploaded-book count, newest first. */
export async function listUsersWithBookCounts(admin: SupabaseClient): Promise<AdminUser[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }

  const [{ data: bookRows }, { data: profileRows }] = await Promise.all([
    admin.from("books").select("user_id"),
    admin.from("profiles").select("id, full_name"),
  ]);

  const bookCounts: Record<string, number> = {};
  (bookRows ?? []).forEach((b: { user_id: string }) => {
    bookCounts[b.user_id] = (bookCounts[b.user_id] ?? 0) + 1;
  });

  const profileNames: Record<string, string | null> = {};
  (profileRows ?? []).forEach((p: { id: string; full_name: string | null }) => {
    profileNames[p.id] = p.full_name;
  });

  return users
    .map((u) => ({
      id: u.id,
      // Fall back to signup metadata until the profiles migration is applied.
      name:
        profileNames[u.id] ??
        (typeof u.user_metadata?.full_name === "string" ? u.user_metadata.full_name : null),
      email: u.email ?? null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      book_count: bookCounts[u.id] ?? 0,
      is_admin: u.email === ADMIN_EMAIL,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
