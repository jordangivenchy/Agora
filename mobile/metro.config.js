/* Metro, with one switch. Expo Go carries no native modules: with
   EXPO_GO=1 (npm run start:go) the LiveKit packages resolve to a stub
   that throws on require, which loadLiveKit catches, so nothing native
   lands in the bundle and Expo Go can open the project. The real build
   (expo run:ios, EAS) runs without the switch and gets the modules. */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

if (process.env.EXPO_GO === "1") {
  const stub = path.resolve(__dirname, "src/nativeStub.js");
  const stubbed = new Set(["@livekit/react-native", "@livekit/react-native-webrtc"]);
  const previous = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (stubbed.has(moduleName)) return { type: "sourceFile", filePath: stub };
    return previous ? previous(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
