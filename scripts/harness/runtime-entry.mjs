export function runtimeEntrySource(cliPackageName) {
  return `if (process.env.ELECTRON_RUN_AS_NODE !== "1") {
  throw new Error("Minke staged Harness entry requires embedded Node mode");
}

function report(error, seen = new Set(), indent = "") {
  if (error !== null && typeof error === "object") {
    if (seen.has(error)) return;
    seen.add(error);
  }
  const rendered = error instanceof Error ? error.stack || error.message : String(error);
  console.error(\`\${indent}\${rendered}\`);
  if (error instanceof AggregateError) {
    for (const nested of error.errors) report(nested, seen, \`\${indent}  \`);
  }
  if (error instanceof Error && error.cause !== undefined) {
    report(error.cause, seen, \`\${indent}  caused by: \`);
  }
}

try {
  await import("${cliPackageName}/lib/bin.js");
} catch (error) {
  report(error);
  process.exitCode = 1;
}
`;
}
