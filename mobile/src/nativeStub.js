/* Stands in for a native package in Expo Go (see metro.config.js). It
   must load cleanly: Metro reports a module that throws while loading
   after startup as a crash rather than throwing it to the caller. So it
   loads, and the first thing the loader calls on it throws instead,
   inside the loader's try. */
module.exports = {
  registerGlobals() {
    throw new Error("This native module is not available in Expo Go.");
  },
};
