/* app.json is the config. This file lets a build override the iOS bundle
   id: while builds are signed with a personal (free) Apple team, they
   register net.agorasphere.dev, so net.agorasphere.app stays unregistered
   until the paid team claims it. An App ID belongs to one team for good. */
module.exports = ({ config }) => ({
  ...config,
  ios: { ...config.ios, bundleIdentifier: process.env.APP_BUNDLE_ID || config.ios.bundleIdentifier },
});
