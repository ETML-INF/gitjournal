import { createRequire } from "module";
const require = createRequire(import.meta.url);
export const VERSION = require("../package.json").version;
