import { loadConfig } from "../config/index.js";
import { catalogStatus, estimateCatalogStorage, runCatalog, writeCatalogManifest, type CatalogOperation } from "../catalog/pipeline.js";

function option(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function options(args: string[], operation: CatalogOperation) {
  const limit = option(args, "limit");
  return {
    operation,
    limit: limit ? Number(limit) : undefined,
    collection: option(args, "collection"),
    song: option(args, "song"),
    assetIds: option(args, "assets")?.split(",").map((item) => item.trim()).filter(Boolean),
    resume: option(args, "resume") !== "false",
    dryRun: args.includes("--dry-run"),
  };
}

export async function runCatalogFactoryCommand(command: string | undefined, args: string[]): Promise<boolean> {
  const config = loadConfig();
  const operation = command?.replace("catalog:", "") as CatalogOperation;
  if (["analyze", "generate", "validate", "editorial"].includes(operation)) {
    console.log(JSON.stringify(await runCatalog(options(args, operation), config), null, 2));
    return true;
  }
  if (command === "catalog:status") {
    console.log(JSON.stringify(await catalogStatus(config), null, 2));
    return true;
  }
  if (command === "catalog:manifest") {
    console.log(JSON.stringify(await writeCatalogManifest(config), null, 2));
    return true;
  }
  if (command === "catalog:storage") {
    const expected = Number(option(args, "assets") ?? "78");
    console.log(JSON.stringify(await estimateCatalogStorage(expected, config), null, 2));
    return true;
  }
  return false;
}
