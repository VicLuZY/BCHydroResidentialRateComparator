import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const fileName of ["index.html", "styles.css", "app.js"]) {
  await cp(path.join(root, fileName), path.join(dist, fileName));
}

await writeFile(path.join(dist, ".nojekyll"), "");

console.log(`Built static Pages artifact at ${path.relative(root, dist)}`);
