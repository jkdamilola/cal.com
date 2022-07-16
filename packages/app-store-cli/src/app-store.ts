import chokidar from "chokidar";
import fs from "fs";
import { debounce } from "lodash";
import path from "path";

let isInWatchMode = false;
if (process.argv[2] === "--watch") {
  isInWatchMode = true;
}

const APP_STORE_PATH = path.join(__dirname, "..", "..", "app-store");
type App = {
  name: string;
  path: string;
};
function getAppName(candidatePath) {
  function isValidAppName(candidatePath) {
    if (
      !candidatePath.startsWith("_") &&
      candidatePath !== "ee" &&
      !candidatePath.includes("/") &&
      !candidatePath.includes("\\")
    ) {
      return candidatePath;
    }
  }
  if (isValidAppName(candidatePath)) {
    // Already a dirname of an app
    return candidatePath;
  }
  // Get dirname of app from full path
  const dirName = path.relative(APP_STORE_PATH, candidatePath);
  return isValidAppName(dirName) ? dirName : null;
}

function generateFiles() {
  const browserOutput = [`import dynamic from "next/dynamic"`];
  const serverOutput = [];
  const appDirs: App[] = [];

  fs.readdirSync(`${APP_STORE_PATH}`).forEach(function (dir) {
    if (dir === "ee") {
      fs.readdirSync(path.join(APP_STORE_PATH, dir)).forEach(function (eeDir) {
        if (fs.statSync(path.join(APP_STORE_PATH, dir, eeDir)).isDirectory()) {
          if (!getAppName(path.resolve(eeDir))) {
            appDirs.push({
              name: eeDir,
              path: path.join(dir, eeDir),
            });
          }
        }
      });
    } else {
      if (fs.statSync(path.join(APP_STORE_PATH, dir)).isDirectory()) {
        if (!getAppName(dir)) {
          return;
        }
        appDirs.push({
          name: dir,
          path: dir,
        });
      }
    }
  });

  function forEachAppDir(callback: (arg: App) => void) {
    for (let i = 0; i < appDirs.length; i++) {
      callback(appDirs[i]);
    }
  }

  function getObjectExporter(
    objectName,
    {
      fileToBeImported,
      importBuilder,
      entryBuilder,
    }: {
      fileToBeImported: string;
      importBuilder: (arg: App) => string;
      entryBuilder: (arg: App) => string;
    }
  ) {
    const output = [];
    forEachAppDir((app) => {
      if (fs.existsSync(path.join(APP_STORE_PATH, app.path, fileToBeImported))) {
        output.push(importBuilder(app));
      }
    });

    output.push(`export const ${objectName} = {`);

    forEachAppDir((app) => {
      if (fs.existsSync(path.join(APP_STORE_PATH, app.path, fileToBeImported))) {
        output.push(entryBuilder(app));
      }
    });

    output.push(`};`);
    return output;
  }

  serverOutput.push(
    ...getObjectExporter("apiHandlers", {
      fileToBeImported: "api/index.ts",
      importBuilder: (app) => `const ${app.name}_api = import("./${app.path}/api");`,
      entryBuilder: (app) => `${app.name}:${app.name}_api,`,
    })
  );

  browserOutput.push(
    ...getObjectExporter("appStoreMetadata", {
      fileToBeImported: "_metadata.ts",
      importBuilder: (app) => `import { metadata as ${app.name}_meta } from "./${app.path}/_metadata";`,
      entryBuilder: (app) => `${app.name}:${app.name}_meta,`,
    })
  );

  browserOutput.push(
    ...getObjectExporter("InstallAppButtonMap", {
      fileToBeImported: "components/InstallAppButton.tsx",
      importBuilder: (app) =>
        `const ${app.name}_installAppButton = dynamic(() =>import("./${app.path}/components/InstallAppButton"));`,
      entryBuilder: (app) => `${app.name}:${app.name}_installAppButton,`,
    })
  );
  const banner = `/**
    This file is autogenerated using the command \`yarn app-store:build --watch\`.
    Don't modify this file manually.
**/
`;
  // fs.writeFileSync(`${APP_STORE_PATH}/apps.server.generated.ts`, `${banner}${serverOutput.join("\n")}`);
  // fs.writeFileSync(`${APP_STORE_PATH}/apps.browser.generated.tsx`, `${banner}${browserOutput.join("\n")}`);
  console.log("Generated `apps.server.generated.ts` and `apps.browser.generated.tsx`");
}

const debouncedGenerateFiles = debounce(generateFiles);

if (isInWatchMode) {
  chokidar
    .watch(APP_STORE_PATH)
    .on("addDir", (dirPath) => {
      const appName = getAppName(dirPath);
      if (appName) {
        console.log(`Added ${appName}`);
        debouncedGenerateFiles();
      }
    })
    .on("change", (filePath) => {
      if (filePath.endsWith("config.json")) {
        console.log("Config file changed");
        debouncedGenerateFiles();
      }
    })
    .on("unlinkDir", (dirPath) => {
      const appName = getAppName(dirPath);
      if (appName) {
        console.log(`Removed ${appName}`);
        debouncedGenerateFiles();
      }
    });
} else {
  generateFiles();
}
