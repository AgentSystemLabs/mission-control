const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);

if (major !== 24) {
  console.error(
    `Mission Control requires Node 24.x. Current runtime: ${process.version}. ` +
      "Switch to Node 24 before installing, building, or running project scripts.",
  );
  process.exit(1);
}
