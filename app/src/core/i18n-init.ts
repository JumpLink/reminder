// Side-effect module: imported first by index.ts so the catalogue is bound before the CLI command
// objects (whose `describe` strings are translated at build time) are evaluated.
import { initI18n } from './i18n.ts';

initI18n();
