// Compiles src/VozzMiningPass.sol with solc-js and writes build/VozzMiningPass.json ({ abi, bytecode }).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const solc = require("solc");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function compile() {
  const file = "VozzMiningPass.sol";
  const input = {
    language: "Solidity",
    sources: { [file]: { content: fs.readFileSync(path.join(ROOT, "src", file), "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const findImports = (p) => {
    const full = path.join(ROOT, "node_modules", p);
    return fs.existsSync(full) ? { contents: fs.readFileSync(full, "utf8") } : { error: "Not found: " + p };
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (out.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const c = out.contracts[file].VozzMiningPass;
  const artifact = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
  fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "build", "VozzMiningPass.json"), JSON.stringify(artifact, null, 2));
  return artifact;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bytecode } = compile();
  console.log(`Compiled VozzMiningPass (${(bytecode.length - 2) / 2} bytes) -> build/VozzMiningPass.json`);
}
