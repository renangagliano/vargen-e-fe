import { loadConfig, type MediaConfig } from "../config/index.js";
import { clearPersonalMicrosoftCache, PersonalMicrosoftAuthService } from "../publishing/personal-microsoft-auth.js";

function printStatus(status: Awaited<ReturnType<PersonalMicrosoftAuthService["status"]>>): void {
  console.log(`Authenticated: ${status.authenticated ? "YES" : "NO"}`);
  console.log(`Drive type: ${status.driveType ?? "UNKNOWN"}`);
  console.log(`Files.ReadWrite: ${status.filesReadWriteAvailable ? "available" : "unavailable"}`);
  console.log(`Provider readiness: ${status.providerReadiness}`);
  if (status.error) console.log(`Status: ${status.error}`);
}

export async function runPersonalMicrosoftCommand(command: string | undefined, config: MediaConfig = loadConfig()): Promise<boolean> {
  if (!command || !["onedrive:login", "onedrive:status", "onedrive:logout"].includes(command)) return false;
  if (command === "onedrive:logout" && !config.microsoftPersonalClientId) {
    await clearPersonalMicrosoftCache(config);
    console.log("Authentication cache: CLEARED");
    return true;
  }
  const service = new PersonalMicrosoftAuthService(config);
  if (command === "onedrive:login") {
    printStatus(await service.login());
    return true;
  }
  if (command === "onedrive:logout") {
    await service.logout();
    console.log("Authentication cache: CLEARED");
    return true;
  }
  printStatus(await service.status());
  return true;
}
