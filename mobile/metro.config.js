/* Metro, with two switches. Expo Go carries no native modules: with
   EXPO_GO=1 (npm run start:go) the LiveKit packages resolve to a stub
   that throws on require, which loadLiveKit catches, so nothing native
   lands in the bundle and Expo Go can open the project. The real build
   (expo run:ios, EAS) runs without the switch and gets the modules.

   And the website's amphitheater scene (src/components/agora in the site)
   is imported by the app's DOM component as it is: Metro watches that
   folder, and the site file's `react` resolves to the app's copy so the
   web view runs one React. */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

const SITE_SCENE = path.resolve(__dirname, "..", "src", "components", "agora");
/* The scene's one package, three.js, from the site's node_modules. */
config.watchFolders = [...(config.watchFolders ?? []), SITE_SCENE, path.resolve(__dirname, "..", "node_modules", "three")];

const stubbed = process.env.EXPO_GO === "1" ? new Set(["@livekit/react-native", "@livekit/react-native-webrtc"]) : new Set();
const stub = path.resolve(__dirname, "src/nativeStub.js");
const appOwned = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client"]);
const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (stubbed.has(moduleName)) return { type: "sourceFile", filePath: stub };
  if (appOwned.has(moduleName) && context.originModulePath.startsWith(SITE_SCENE)) {
    const fromApp = { ...context, originModulePath: path.resolve(__dirname, "package.json") };
    return previous ? previous(fromApp, moduleName, platform) : context.resolveRequest(fromApp, moduleName, platform);
  }
  return previous ? previous(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
