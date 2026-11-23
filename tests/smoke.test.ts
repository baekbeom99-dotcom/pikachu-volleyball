import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('033 sprite manifest', () => {
  it('loads copied actions_manifest.json with required volleyball actions', () => {
    const raw = readFileSync(resolve('public/sprites/033/actions_manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    expect(manifest.character_id).toBe('033');
    for (const key of ['idle', 'walk', 'run', 'jump_launch', 'air_float', 'spike', 'slide', 'hurt', 'attack']) {
      expect(manifest.actions[key]).toBeDefined();
      expect(existsSync(resolve('public/sprites/033', manifest.actions[key].sheet))).toBe(true);
    }
  });
});
