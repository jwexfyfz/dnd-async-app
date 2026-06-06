export const ABILITY_DESCRIPTIONS: Record<string, string> = {
  STR: 'Strength represents your character\'s raw physical power during play. It determines how effectively you lift, push, break, and overpower obstacles and enemies through sheer force.',
  DEX: 'Dexterity represents your character\'s agility, reflexes, and fine motor control during play. It determines how effectively you dodge danger, move without being noticed, and perform tasks that require a steady hand.',
  CON: 'Constitution represents your character\'s endurance, stamina, and physical resilience during play. It determines how much punishment you can absorb and how long you can sustain effort under pressure.',
  INT: 'Intelligence represents your character\'s logic, memory, and academic knowledge during play. It determines how effectively you recall ancient lore, look for hidden clues, and analyze the magical or natural world around you.',
  WIS: 'Wisdom represents your character\'s awareness, intuition, and perceptiveness during play. It determines how well you notice what others miss, read people and situations accurately, and act with sound judgment.',
  CHA: 'Charisma represents your character\'s force of personality, social influence, and presence during play. It determines how effectively you persuade, deceive, inspire, or intimidate those around you.',
};

export const ABILITY_PASSIVE_NOTES: Record<string, string> = {
  CON: 'Constitution has no active skills — it works passively to set your hit points, help you maintain concentration on spells while taking damage, and resist exhaustion and environmental hazards.',
};

// Maps each skill name to its governing ability (short form)
export const SKILL_ABILITY: Record<string, string> = {
  Athletics:        'STR',
  Acrobatics:       'DEX',
  'Sleight of Hand': 'DEX',
  Stealth:          'DEX',
  Arcana:           'INT',
  History:          'INT',
  Investigation:    'INT',
  Nature:           'INT',
  Religion:         'INT',
  'Animal Handling': 'WIS',
  Insight:          'WIS',
  Medicine:         'WIS',
  Perception:       'WIS',
  Survival:         'WIS',
  Deception:        'CHA',
  Intimidation:     'CHA',
  Performance:      'CHA',
  Persuasion:       'CHA',
};

export const SKILL_DESCRIPTIONS: Record<string, string> = {
  Athletics:         'Used to climb walls, swim against currents, jump across gaps, grapple enemies, or break through physical barriers.',
  Acrobatics:        'Used to keep your balance, tumble safely, perform acrobatic maneuvers, or escape grapples through agile movement.',
  'Sleight of Hand': 'Used to pickpocket, palm small objects, plant items on others, or perform feats of manual dexterity without being noticed.',
  Stealth:           'Used to move silently, hide from view, follow someone unseen, or approach a target without triggering their awareness.',
  Arcana:            'Used to identify strange magical glyphs, active spells, or planar rifts, and to recall knowledge about magic items, constructs, and the arcane.',
  History:           'Used to recall information about historical events, legendary figures, ancient civilizations, or the significance of ruins and artifacts.',
  Investigation:     'Used to search a location for hidden clues, deduce what happened in a scene, spot a concealed door, or piece together a puzzle.',
  Nature:            'Used to identify plants, predict weather, track animals, or recall knowledge about terrain, ecosystems, and natural creatures.',
  Religion:          'Used to recall lore about gods, religious rites, undead creatures, holy or unholy symbols, and the planes of divine power.',
  'Animal Handling': 'Used to calm a frightened animal, steer a mount under pressure, predict an animal\'s behavior, or bond with a creature.',
  Insight:           'Used to read a person\'s true intentions, detect when someone is lying, or sense the emotional undercurrent of a conversation.',
  Medicine:          'Used to stabilize a dying ally, diagnose a disease or poison, or assess whether an injury is treatable in the field.',
  Perception:        'Used to notice details others miss — a sound in the dark, movement in the shadows, a trip wire, or someone trying to hide.',
  Survival:          'Used to track creatures through wilderness, forage for food and water, navigate terrain, or predict natural hazards.',
  Deception:         'Used to lie convincingly, disguise your true motives, bluff your way past guards, or mislead someone about your identity.',
  Intimidation:      'Used to frighten someone into compliance, extract information through menace, or make an enemy hesitate through sheer force of will.',
  Performance:       'Used to entertain an audience, maintain a convincing disguise through acting, or convey emotion and story through art.',
  Persuasion:        'Used to negotiate favorable terms, earn someone\'s trust, appeal to their better nature, or diplomatically change a mind.',
};
