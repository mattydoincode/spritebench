/**
 * Side-effect import that loads `.env` and `.env.local`, for entrypoints Next
 * does not start: the worker, the migrator. Imported first so the files are
 * read before any module reaches for a variable at import time.
 */
import { loadEnvDefaults } from "./env";

loadEnvDefaults();
