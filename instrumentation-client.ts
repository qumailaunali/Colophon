// No runtime polyfills are needed by the audited client code on Safari 16.0.
// Add only specific core-js/actual imports here if the dependency audit changes.
import { installClientErrorReporter } from "@/lib/clientErrors";

installClientErrorReporter();
