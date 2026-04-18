import { createHash } from 'node:crypto';

export function computeVkHash(vk: string): string {
  return createHash('sha256').update(vk).digest('hex');
}
