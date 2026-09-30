/**
 * Everything a canvas run needs registered: every block's implementation and the hooks that act when a
 * run finishes (monitors). Import this wherever runs start, execute or are listed.
 */
import "./canvas/executors";
import "./monitors";

export { availableTypes } from "./canvas/engine";
