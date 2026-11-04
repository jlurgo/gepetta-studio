/** Key names as the computer in front of the kids shows them: ⌘ and ⌥ on a Mac, Ctrl and Alt elsewhere (the workshop's PCs are Windows). */
const mac = (window.gepetta?.platform ?? navigator.platform).toLowerCase().startsWith("mac") || window.gepetta?.platform === "darwin";

/** The command key: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = mac ? "⌘" : "Ctrl";
/** The option key: ⌥ on a Mac, Alt elsewhere. */
export const ALT = mac ? "⌥" : "Alt";
