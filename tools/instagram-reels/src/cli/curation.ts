import { loadConfig } from "../config/index.js";
import { curationStatus, runCuration, writeCurationManifest } from "../curation/engine.js";

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith("--" + name + "="))?.slice(name.length + 3);
}

function curationOptions(args: string[], sample: boolean) {
  return {
    sample,
    persist: !args.includes("--no-persist"),
    assetIds: option(args, "assets")?.split(",").map((value) => value.trim()).filter(Boolean),
  };
}

export async function runCurationCommand(command: string | undefined, args: string[]): Promise<boolean> {
  if (!command?.startsWith("curation:")) return false;
  const config = loadConfig();
  if (command === "curation:sample") {
    const result = await runCuration(curationOptions(args, true), config);
    await writeCurationManifest(config, true);
    console.log(JSON.stringify(result, null, 2));
    if (!result.sampleDiscriminative) throw new Error("CALIBRATION_NOT_DISCRIMINATIVE");
    return true;
  }
  if (command === "curation:run") {
    const calibration = await runCuration(curationOptions(args, true), config);
    await writeCurationManifest(config, true);
    if (!calibration.sampleDiscriminative) {
      console.log(JSON.stringify({ calibration }, null, 2));
      throw new Error("CALIBRATION_NOT_DISCRIMINATIVE");
    }
    const portfolio = await runCuration(curationOptions(args, false), config);
    const manifest = await writeCurationManifest(config, false);
    console.log(JSON.stringify({ calibration, portfolio, manifest }, null, 2));
    return true;
  }
  if (command === "curation:status") {
    console.log(JSON.stringify(await curationStatus(config), null, 2));
    return true;
  }
  if (command === "curation:manifest") {
    console.log(JSON.stringify(await writeCurationManifest(config, false), null, 2));
    return true;
  }
  return false;
}
