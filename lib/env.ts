function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function getOptionalEnv(name: string) {
  const value = process.env[name];
  if (!value) return null;
  return value;
}

export const env = {
  supabaseUrl: getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseServiceKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),
  sessionSecret: getEnv("SESSION_SECRET"),
  ouraClientId: getOptionalEnv("OURA_CLIENT_ID"),
  ouraClientSecret: getOptionalEnv("OURA_CLIENT_SECRET"),
  ouraRedirectUri: getOptionalEnv("OURA_REDIRECT_URI"),
};
