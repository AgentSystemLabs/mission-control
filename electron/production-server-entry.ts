import * as path from "node:path";

const SERVER_ENTRY_RELATIVE_PATH = path.join("dist", "server", "server.js");
const LEGACY_SERVER_ENTRY_RELATIVE_PATH = path.join("dist-server", "server", "server.js");

type ProductionServerEntryOptions = {
  appPath: string;
  resourcesPath: string;
  mainDirname: string;
  exists: (filePath: string) => boolean;
};

export function getProductionServerEntryCandidates({
  appPath,
  resourcesPath,
  mainDirname,
}: Omit<ProductionServerEntryOptions, "exists">): string[] {
  return [
    path.join(appPath, SERVER_ENTRY_RELATIVE_PATH),
    path.join(resourcesPath, "app", SERVER_ENTRY_RELATIVE_PATH),
    path.join(mainDirname, "..", "..", SERVER_ENTRY_RELATIVE_PATH),
    path.join(appPath, LEGACY_SERVER_ENTRY_RELATIVE_PATH),
    path.join(resourcesPath, "app", LEGACY_SERVER_ENTRY_RELATIVE_PATH),
    path.join(mainDirname, "..", "..", LEGACY_SERVER_ENTRY_RELATIVE_PATH),
  ];
}

export function resolveProductionServerEntry(
  options: ProductionServerEntryOptions,
): { entry: string; checkedPaths: string[] } {
  const checkedPaths = getProductionServerEntryCandidates(options);
  const entry = checkedPaths.find(options.exists);
  return { entry: entry ?? checkedPaths[0], checkedPaths };
}
