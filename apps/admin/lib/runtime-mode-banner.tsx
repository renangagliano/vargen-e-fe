import "server-only";

import { getAdminRuntimeConfig, isOperationalAdminMode } from "./runtime-config";

export function RuntimeModeBanner() {
  const config = getAdminRuntimeConfig();
  if (isOperationalAdminMode(config)) {
    return <div className="admin-operational-banner" role="status"><strong>SUPABASE OPERATIONAL MODE</strong><span>Governança remota habilitada. Auto-publicação permanece desativada.</span></div>;
  }
  return <div className="admin-readonly-banner" role="status"><strong>READ-ONLY REMOTE VALIDATION MODE</strong><span>SQLite continua sendo a autoridade. Nenhuma alteração de governança é permitida.</span></div>;
}
