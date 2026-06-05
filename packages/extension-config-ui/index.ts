import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openConfigPopup } from "./popup.ts";
import { clearConfigItems, registerConfigItems } from "@htwang-contrib/common";

const INSTALL_GUARD = Symbol.for("pi-extensions.extension-config-ui.installed");

export default function initConfigUI(pi: ExtensionAPI): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[INSTALL_GUARD]) return;
  guard[INSTALL_GUARD] = true;

  pi.registerCommand("config", {
    description: "Browse and edit extension configurations",
    handler: async (_args, ctx) => {
      await openConfigPopup(pi, ctx);
    },
  });

  pi.registerCommand("config:demo", {
    description: "Open demo config UI with sample settings of all types",
    handler: async (_args, ctx) => {
      clearConfigItems("demo-boolean-ext");
      clearConfigItems("demo-string-ext");
      clearConfigItems("demo-number-ext");
      clearConfigItems("demo-select-ext");
      clearConfigItems("demo-multiselect-ext");
      clearConfigItems("demo-color-ext");
      clearConfigItems("demo-mixed-ext");

      registerConfigItems("demo-boolean-ext", [
        {
          key: "enabled",
          type: "boolean",
          label: "Enabled",
          defaultValue: true,
          description: "Whether the demo extension is active",
        },
        {
          key: "verbose",
          type: "boolean",
          label: "Verbose Logging",
          defaultValue: false,
          description: "Enable verbose debug output to console",
        },
      ]);

      registerConfigItems("demo-string-ext", [
        {
          key: "name",
          type: "string",
          label: "Display Name",
          defaultValue: "My Extension",
          description: "Name shown in the UI header",
        },
        {
          key: "apiKey",
          type: "string",
          label: "API Key",
          defaultValue: "",
          description: "Secret key for external service",
          secret: true,
        },
        {
          key: "template",
          type: "string",
          label: "Output Template",
          defaultValue: "Hello, {name}!",
          description: "Template string for output formatting",
        },
      ]);

      registerConfigItems("demo-number-ext", [
        {
          key: "timeout",
          type: "number",
          label: "Timeout (ms)",
          defaultValue: 5000,
          description: "Request timeout in milliseconds",
          min: 100,
          max: 60000,
        },
        {
          key: "retries",
          type: "number",
          label: "Retry Count",
          defaultValue: 3,
          description: "Number of retry attempts on failure",
        },
        {
          key: "ratio",
          type: "number",
          label: "Compression Ratio",
          defaultValue: 0.85,
          description: "Target compression ratio (0.0 - 1.0)",
        },
      ]);

      registerConfigItems("demo-select-ext", [
        {
          key: "theme",
          type: "select",
          label: "Color Theme",
          defaultValue: "dark",
          description: "UI color scheme",
          options: [
            { label: "Dark", value: "dark" },
            { label: "Light", value: "light" },
            { label: "Solarized", value: "solarized" },
            { label: "Nord", value: "nord" },
          ],
        },
        {
          key: "logLevel",
          type: "select",
          label: "Log Level",
          defaultValue: "info",
          description: "Minimum log level to display",
          options: [
            { label: "Debug", value: "debug" },
            { label: "Info", value: "info" },
            { label: "Warn", value: "warn" },
            { label: "Error", value: "error" },
          ],
        },
      ]);

      registerConfigItems("demo-multiselect-ext", [
        {
          key: "features",
          type: "multiselect",
          label: "Enabled Features",
          defaultValue: ["autocomplete", "syntax"],
          description: "Select which editor features to enable",
          options: [
            { label: "Autocomplete", value: "autocomplete" },
            { label: "Syntax Highlighting", value: "syntax" },
            { label: "Linting", value: "linting" },
            { label: "Formatting", value: "formatting" },
            { label: "Code Actions", value: "codeActions" },
          ],
        },
        {
          key: "languages",
          type: "multiselect",
          label: "Language Servers",
          defaultValue: ["typescript"],
          description: "Which language servers to activate",
          options: [
            { label: "TypeScript", value: "typescript" },
            { label: "Python", value: "python" },
            { label: "Rust", value: "rust" },
            { label: "Go", value: "go" },
            { label: "C/C++", value: "cpp" },
          ],
        },
      ]);

      registerConfigItems("demo-color-ext", [
        {
          key: "accentColor",
          type: "color",
          label: "Accent Color",
          defaultValue: "#ff6600",
          description: "Primary accent color for highlights",
        },
        {
          key: "backgroundColor",
          type: "color",
          label: "Background Color",
          defaultValue: "#1a1a2e",
          description: "Default background color",
        },
      ]);

      registerConfigItems("demo-mixed-ext", [
        {
          key: "outputDir",
          type: "string",
          label: "Output Directory",
          defaultValue: "~/output",
          description: "Directory for generated files",
          order: 1,
        },
        {
          key: "concurrency",
          type: "number",
          label: "Concurrency",
          defaultValue: 4,
          description: "Number of parallel workers",
          order: 2,
        },
        {
          key: "autoSave",
          type: "boolean",
          label: "Auto Save",
          defaultValue: true,
          description: "Save changes automatically",
          order: 3,
        },
        {
          key: "format",
          type: "select",
          label: "Output Format",
          defaultValue: "json",
          description: "File format for output",
          options: [
            { label: "JSON", value: "json" },
            { label: "YAML", value: "yaml" },
            { label: "TOML", value: "toml" },
            { label: "XML", value: "xml" },
          ],
          order: 4,
        },
        {
          key: "plugins",
          type: "multiselect",
          label: "Plugins",
          defaultValue: ["core"],
          description: "Active plugins for processing",
          order: 5,
          options: [
            { label: "Core", value: "core" },
            { label: "Extended", value: "extended" },
            { label: "Experimental", value: "experimental" },
          ],
        },
      ]);

      await openConfigPopup(pi, ctx);
    },
  });
}
