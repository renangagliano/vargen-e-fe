import fs from "node:fs/promises";
import type { AvailabilityStatus } from "../shared/types.js";

export async function checkLocalAvailability(filePath: string): Promise<AvailabilityStatus> {
  try {
    const handle = await fs.open(filePath, "r");
    await handle.close();
    return "LOCAL_AVAILABLE";
  } catch (error) {
    const text = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (text.includes("cloud") || text.includes("offline") || text.includes("recall")) {
      return "NOT_LOCALLY_AVAILABLE";
    }
    return "ACCESS_ERROR";
  }
}
