/**
 * Single source of truth for the plugin version exposed by `comfyui_status`.
 *
 * The npm manifest carries the same number; keeping it here lets the status tool
 * report the code actually running, which is what matters after a hot reload.
 */
export const PLUGIN_VERSION = '1.0.0'
