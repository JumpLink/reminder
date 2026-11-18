/**
 * `gi://Secret`, loaded on first use. A static import throws at module load on a host without
 * libsecret's typelib and takes the whole app with it; loaded lazily it becomes an
 * `unavailable` answer from the store.
 */

import { optionalNamespace } from './optional.ts';

export const secret = optionalNamespace('Secret', async () => (await import('gi://Secret?version=1')).default);
