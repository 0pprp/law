/**
 * تطبيق CORS على باكت R2 مرة واحدة:
 *   npx tsx --env-file=.env.local scripts/apply-r2-cors.ts
 */
import { applyR2CorsPolicy } from '../lib/r2-storage'

await applyR2CorsPolicy()
console.log('R2 CORS applied.')
