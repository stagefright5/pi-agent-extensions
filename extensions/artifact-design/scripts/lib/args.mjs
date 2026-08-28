export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      out.flags[k] = v === undefined ? (argv[i + 1]?.startsWith("--") === false ? argv[++i] : true) : v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}
