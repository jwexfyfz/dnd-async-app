import { describe, it, expect } from 'vitest';
import { extractAvailableStances, extractExplorationFlags, extractExitInfo } from '../poi-context-helpers';

describe('extractAvailableStances', () => {
  it('returns empty array for null input', () => {
    expect(extractAvailableStances(null)).toEqual([]);
  });

  it('returns empty array for array input', () => {
    expect(extractAvailableStances([])).toEqual([]);
  });

  it('extracts resulting_stance values from non-reserved keys', () => {
    const props = {
      crouch: { resulting_stance: 'crouching' },
      lean: { resulting_stance: 'leaning' },
    };
    const result = extractAvailableStances(props);
    expect(result).toContain('crouching');
    expect(result).toContain('leaning');
  });

  it('excludes reserved keys (items, poi_type, visibility, etc.)', () => {
    const props = {
      items: { resulting_stance: 'should-be-excluded' },
      poi_type: { resulting_stance: 'also-excluded' },
      lean: { resulting_stance: 'leaning' },
    };
    const result = extractAvailableStances(props);
    expect(result).toEqual(['leaning']);
  });

  it('excludes entries without resulting_stance', () => {
    const props = { action1: { description: 'no stance here' } };
    expect(extractAvailableStances(props)).toEqual([]);
  });
});

describe('extractExplorationFlags', () => {
  it('null → all false', () => {
    expect(extractExplorationFlags(null)).toEqual({ examined: false, interacted: false, destroyed: false });
  });

  it('examined=true is preserved', () => {
    const result = extractExplorationFlags({ examined: true });
    expect(result.examined).toBe(true);
    expect(result.interacted).toBe(false);
  });

  it('all three flags together', () => {
    const result = extractExplorationFlags({ examined: true, interacted: true, destroyed: true });
    expect(result).toEqual({ examined: true, interacted: true, destroyed: true });
  });

  it('truthy non-boolean values are coerced to false (strict === true check)', () => {
    const result = extractExplorationFlags({ examined: 1, interacted: 'yes' });
    expect(result.examined).toBe(false);
    expect(result.interacted).toBe(false);
  });
});

describe('extractExitInfo', () => {
  it('non-exit POI returns isExit=false', () => {
    const result = extractExitInfo({ poi_type: 'container' });
    expect(result.isExit).toBe(false);
    expect(result.targetRoomTemplateId).toBeNull();
  });

  it('exit POI with enter.target_room_template_id returns isExit=true', () => {
    const props = { enter: { target_room_template_id: 'room-tmpl-99' } };
    const result = extractExitInfo(props);
    expect(result.isExit).toBe(true);
    expect(result.targetRoomTemplateId).toBe('room-tmpl-99');
  });

  it('null input returns isExit=false', () => {
    expect(extractExitInfo(null)).toEqual({ isExit: false, targetRoomTemplateId: null });
  });

  it('enter key without target_room_template_id returns isExit=false', () => {
    const result = extractExitInfo({ enter: { label: 'Go north' } });
    expect(result.isExit).toBe(false);
  });
});
