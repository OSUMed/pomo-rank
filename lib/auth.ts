import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function findUserByUsername(username: string) {
  const { data, error } = await supabase
    .from("app_users")
    .select("id, username, password_hash")
    .eq("username", username)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createUser(username: string, passwordHash: string) {
  const { data, error } = await supabase
    .from("app_users")
    .insert({ username, password_hash: passwordHash })
    .select("id, username")
    .single();

  if (error) throw error;
  return data;
}
