import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidateSourceDirs = [
  resolve(rootDir, "vendor/excalidraw/dist/prod"),
  resolve(rootDir, "node_modules/@excalidraw/excalidraw/dist/prod"),
];
const sourceDir = candidateSourceDirs.find((dir) => existsSync(dir));
const targetDir = resolve(rootDir, "public/excalidraw-assets");

if (!sourceDir) {
  console.warn(
    `Excalidraw assets not found yet. Looked in: ${candidateSourceDirs.join(
      ", ",
    )}. Skipping sync.`,
  );
  process.exit(0);
}

mkdirSync(resolve(rootDir, "public"), { recursive: true });
rmSync(targetDir, { force: true, recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.info(`Synced Excalidraw assets to ${targetDir}`);
