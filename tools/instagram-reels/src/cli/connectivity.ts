import {
  formatInstagramConnectivityResult,
  loadInstagramConnectivityConfig,
  MetaInstagramConnectivityValidator,
} from "../publishing/connectivity.js";

export async function runInstagramConnectivityCommand(command: string | undefined): Promise<boolean> {
  if (command !== "instagram:connectivity") return false;
  const result = await new MetaInstagramConnectivityValidator(loadInstagramConnectivityConfig()).validate();
  console.log(formatInstagramConnectivityResult(result));
  if (!result.readyForControlledTest) process.exitCode = 1;
  return true;
}
