const MAX_ENV_VALUE_LENGTH = 1024;

export function requireEnv(name: string): string {
  const rawEnvValue = process.env[name];

  if(!rawEnvValue)
    throw new Error("document_not_found");
  if(rawEnvValue === undefined)
    throw new Error("document_not_found");
  const envVariable = rawEnvValue.trim();

  if(envVariable.length === 0)
    throw new Error("bad_request"); //TODO: Ask Error logs
  if(envVariable.length > MAX_ENV_VALUE_LENGTH)
    throw new Error("bad_request");

  return envVariable;
}