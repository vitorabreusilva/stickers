// Turns on-device image analysis into topics for grouping stickers. Pure functions, no DOM.

export type TopicId =
  | 'people'
  | 'dogs'
  | 'cats'
  | 'animals'
  | 'food'
  | 'cartoons'
  | 'vehicles'
  | 'fashion'
  | 'sports'
  | 'music'
  | 'tech'
  | 'nature'
  | 'places'
  | 'stuff'
  | 'other'

export const TOPICS: Record<TopicId, { name: string; emoji: string }> = {
  people: { name: 'People', emoji: '🧑' },
  dogs: { name: 'Dogs', emoji: '🐶' },
  cats: { name: 'Cats', emoji: '🐱' },
  animals: { name: 'Animals', emoji: '🐾' },
  food: { name: 'Food & drinks', emoji: '🍔' },
  cartoons: { name: 'Cartoons & art', emoji: '🎨' },
  vehicles: { name: 'Vehicles', emoji: '🚗' },
  fashion: { name: 'Fashion', emoji: '👟' },
  sports: { name: 'Sports & games', emoji: '⚽' },
  music: { name: 'Music', emoji: '🎸' },
  tech: { name: 'Tech', emoji: '💻' },
  nature: { name: 'Nature', emoji: '🌿' },
  places: { name: 'Places', emoji: '🏛️' },
  stuff: { name: 'Things', emoji: '📦' },
  other: { name: 'Other', emoji: '✨' },
}

export const TOPIC_IDS = Object.keys(TOPICS) as TopicId[]

/** What the analysis worker records about a sticker. */
export interface StickerAnalysis {
  /** Bump when the analysis itself changes, so older stickers get re-analysed. */
  version: number
  /** ImageNet classes the classifier saw, most likely first (the long tail is dropped). */
  classes: { index: number; name: string; score: number }[]
  /** Confidence of the most likely real human face, 0 if none. */
  face: number
  /** Similarity to reference cartoon drawings: around 0.1 for photos, 0.3 and up for drawings. */
  drawn: number
  /** Unit-length visual embedding; similar-looking stickers point the same way. */
  embedding: Float32Array
}

export const ANALYSIS_VERSION = 1

// Names of ImageNet object classes (indices 398–922) by topic. Objects not listed are "stuff".
const OBJECT_TOPICS: Partial<Record<TopicId, string[]>> = {
  vehicles: [
    'aircraft carrier', 'airliner', 'airship', 'ambulance', 'amphibian', 'beach wagon', 'bicycle-built-for-two',
    'bobsled', 'bullet train', 'cab', 'canoe', 'car mirror', 'car wheel', 'catamaran', 'container ship',
    'convertible', 'disk brake', 'dogsled', 'electric locomotive', 'fireboat', 'fire engine', 'forklift',
    'freight car', 'garbage truck', 'go-kart', 'golfcart', 'gondola', 'grille', 'half track', 'harvester',
    'horse cart', 'jeep', 'jinrikisha', 'lifeboat', 'limousine', 'liner', 'minibus', 'minivan', 'Model T',
    'moped', 'motor scooter', 'mountain bike', 'moving van', 'oxcart', 'paddlewheel', 'passenger car', 'pickup',
    'pirate', 'police van', 'racer', 'recreational vehicle', 'school bus', 'schooner', 'snowmobile', 'snowplow',
    'space shuttle', 'speedboat', 'sports car', 'steam locomotive', 'streetcar', 'submarine', 'tank', 'thresher',
    'tow truck', 'tractor', 'trailer truck', 'tricycle', 'trimaran', 'trolleybus', 'unicycle', 'warplane',
    'wing', 'wreck', 'yawl', 'parachute', 'balloon',
  ],
  fashion: [
    'abaya', 'academic gown', 'apron', 'backpack', 'bathing cap', 'bearskin', 'bib', 'bikini', 'bolo tie',
    'bonnet', 'bow tie', 'brassiere', 'buckle', 'cardigan', 'cloak', 'clog', 'cowboy boot', 'cowboy hat',
    'feather boa', 'fur coat', 'gown', 'hair slide', 'handkerchief', 'hoopskirt', 'jean', 'jersey', 'kimono',
    'knee pad', 'lab coat', 'Loafer', 'mailbag', 'maillot', 'military uniform', 'miniskirt', 'mitten',
    'mortarboard', 'necklace', 'overskirt', 'pajama', 'pickelhaube', 'poncho', 'purse', 'running shoe', 'sandal',
    'sarong', 'shower cap', 'ski mask', 'sock', 'sombrero', 'stole', 'suit', 'sunglass', 'sunglasses',
    'sweatshirt', 'swimming trunks', 'trench coat', 'vestment', 'wallet', 'wig', 'Windsor tie', 'velvet', 'wool',
    'lipstick', 'face powder', 'perfume', 'hair spray', 'lotion', 'sunscreen', 'digital watch', 'stopwatch',
  ],
  sports: [
    'balance beam', 'barbell', 'baseball', 'basketball', 'croquet ball', 'dumbbell', 'football helmet',
    'golf ball', 'horizontal bar', 'parallel bars', 'ping-pong ball', 'puck', 'punching bag', 'racket',
    'rugby ball', 'scoreboard', 'ski', 'soccer ball', 'tennis ball', 'volleyball', 'crash helmet', 'snorkel',
    'paddle', 'jigsaw puzzle', 'crossword puzzle', 'pool table', 'slot', 'maze', 'teddy', 'pinwheel',
  ],
  music: [
    'accordion', 'acoustic guitar', 'banjo', 'bassoon', 'cello', 'chime', 'cornet', 'drum', 'drumstick',
    'electric guitar', 'flute', 'French horn', 'gong', 'grand piano', 'harmonica', 'harp', 'maraca', 'marimba',
    'oboe', 'ocarina', 'organ', 'panpipe', 'sax', 'steel drum', 'trombone', 'upright', 'violin', 'microphone',
  ],
  tech: [
    'cassette', 'cassette player', 'CD player', 'cellular telephone', 'computer keyboard', 'desktop computer',
    'dial telephone', 'digital clock', 'hand-held computer', 'hard disc', 'home theater', 'iPod', 'joystick',
    'laptop', 'lens cap', 'loudspeaker', 'modem', 'monitor', 'mouse', 'notebook', 'oscilloscope', 'pay-phone',
    'photocopier', 'Polaroid camera', 'printer', 'projector', 'radio', 'radio telescope', 'reflex camera',
    'remote control', 'screen', 'space bar', 'switch', 'tape player', 'television', 'typewriter keyboard',
    'entertainment center', 'cash machine', 'solar dish',
  ],
  cartoons: ['comic book', 'book jacket', 'web site', 'menu', 'envelope', 'binder', 'packet'],
  places: [
    'altar', 'apiary', 'bakery', 'bannister', 'barbershop', 'barn', 'bell cote', 'boathouse', 'bookshop',
    'breakwater', 'butcher shop', 'carousel', 'castle', 'chainlink fence', 'church', 'cinema', 'cliff dwelling',
    'confectionery', 'dam', 'dock', 'dome', 'drilling platform', 'flagpole', 'fountain', 'greenhouse',
    'grocery store', 'library', 'lumbermill', 'maypole', 'megalith', 'monastery', 'mosque', 'obelisk', 'palace',
    'patio', 'pier', 'planetarium', 'prison', 'restaurant', 'shoe shop', 'steel arch bridge', 'stone wall',
    'stupa', 'suspension bridge', 'thatch', 'tile roof', 'tobacco shop', 'toyshop', 'totem pole',
    'triumphal arch', 'turnstile', 'vault', 'viaduct', 'water tower', 'worm fence', 'picket fence', 'yurt',
    'mountain tent', 'beacon', 'street sign', 'traffic light', 'gas pump', 'parking meter', 'mailbox',
    'manhole cover', 'sundial',
  ],
  food: [
    'beer bottle', 'beer glass', 'wine bottle', 'pop bottle', 'water bottle', 'coffee mug', 'coffeepot',
    'espresso maker', 'teapot', 'goblet', 'cocktail shaker', 'whiskey jug', 'pitcher', 'soup bowl',
    'frying pan', 'wok', 'Crock Pot', 'Dutch oven', 'caldron', 'mixing bowl', 'waffle iron', 'toaster',
  ],
}

let objectTopicByName: Map<string, TopicId> | undefined

/** The topic an ImageNet class belongs to. `name` is needed for the object classes (398–922). */
export function topicOfClass(index: number, name = ''): TopicId {
  if (index >= 151 && index <= 268) return 'dogs'
  if (index >= 281 && index <= 293) return 'cats'
  if (index <= 397) return 'animals'
  if (index === 987 || index === 998) return 'food' // corn, ear of corn
  if (index >= 923 && index <= 969) return index === 958 ? 'nature' : 'food' // 958 is hay
  if (index >= 970 && index <= 980) return 'nature' // landscapes
  if (index >= 981 && index <= 983) return 'people' // ballplayer, groom, scuba diver
  if (index >= 984 && index <= 998) return 'nature' // flowers, mushrooms
  if (index === 999) return 'stuff'
  if (!objectTopicByName) {
    objectTopicByName = new Map()
    for (const [topic, names] of Object.entries(OBJECT_TOPICS) as [TopicId, string[]][]) {
      for (const n of names) objectTopicByName.set(n, topic)
    }
  }
  return objectTopicByName.get(name) ?? 'stuff'
}

/** Probability mass per topic, from the classifier's classes and the face detector. */
export function topicScores(analysis: StickerAnalysis): Map<TopicId, number> {
  const scores = new Map<TopicId, number>()
  for (const { index, name, score } of analysis.classes) {
    const topic = topicOfClass(index, name)
    // "Stuff" collects hundreds of everyday classes, so it piles up small scores; make it earn it.
    const weight = topic === 'stuff' ? STUFF_WEIGHT : 1
    scores.set(topic, (scores.get(topic) ?? 0) + score * weight)
  }
  // ImageNet has no "cartoon" class, so looking like the reference drawings counts instead.
  const drawn = Math.max(0, analysis.drawn - DRAWN_BASELINE) * DRAWN_WEIGHT
  if (drawn > 0) scores.set('cartoons', (scores.get('cartoons') ?? 0) + drawn)
  // A clear real face beats whatever the person is wearing or holding.
  if (analysis.face >= FACE_CONFIDENCE) scores.set('people', (scores.get('people') ?? 0) + 1)
  return scores
}

// BlazeFace also fires on pets, clocks and cartoons at 0.6–0.75; real faces score higher.
export const FACE_CONFIDENCE = 0.85
const STUFF_WEIGHT = 0.6
// Photos score up to about this against the reference drawings; anything above counts as drawn.
const DRAWN_BASELINE = 0.2
const DRAWN_WEIGHT = 1.5
// Below this, a sticker's own evidence is too weak to name a topic.
const MIN_TOPIC_SCORE = 0.12
// Stickers at least this similar share evidence; fully at 1.0, not at all at this value.
const SIMILAR = 0.5
// How much a look-alike's evidence counts relative to the sticker's own.
const NEIGHBOR_WEIGHT = 0.6

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export interface Topicable {
  id: string
  analysis?: StickerAnalysis
  /** Set when the user moved the sticker by hand. */
  topic?: TopicId
}

/**
 * Picks a topic for every sticker. A sticker's own classifier evidence is topped up by stickers
 * that look like it, so a set of cartoons in the same style ends up together even when the
 * classifier is unsure about each one. Stickers not analysed yet come back as undefined.
 */
export function assignTopics(stickers: Topicable[]): Map<string, TopicId | undefined> {
  const own = stickers.map((s) => (s.analysis ? topicScores(s.analysis) : null))
  const result = new Map<string, TopicId | undefined>()
  stickers.forEach((sticker, i) => {
    if (sticker.topic) {
      result.set(sticker.id, sticker.topic)
      return
    }
    const mine = own[i]
    if (!mine || !sticker.analysis) {
      result.set(sticker.id, undefined)
      return
    }
    const combined = new Map(mine)
    stickers.forEach((other, j) => {
      const theirs = own[j]
      if (j === i || !theirs || !other.analysis) return
      const similarity = cosine(sticker.analysis!.embedding, other.analysis.embedding)
      if (similarity <= SIMILAR) return
      const weight = (NEIGHBOR_WEIGHT * (similarity - SIMILAR)) / (1 - SIMILAR)
      // Hand-placed look-alikes vote for where the user put them.
      if (other.topic) combined.set(other.topic, (combined.get(other.topic) ?? 0) + weight)
      else for (const [topic, score] of theirs) combined.set(topic, (combined.get(topic) ?? 0) + weight * score)
    })
    let best: TopicId = 'other'
    let bestScore = MIN_TOPIC_SCORE
    for (const [topic, score] of combined) {
      if (score > bestScore) {
        best = topic
        bestScore = score
      }
    }
    result.set(sticker.id, best)
  })
  return result
}

/** A group in the collection: a topic, or 'new' for stickers that haven't been analysed yet. */
export interface TopicGroup<T> {
  key: TopicId | 'new'
  items: T[]
}

/**
 * Groups items by their topic, keeping their order within each group. Unsorted ones come first
 * (they're the newest), then the biggest groups, with "Other" always last.
 */
export function groupByTopic<T extends { id: string }>(items: T[], topics: Map<string, TopicId | undefined>): TopicGroup<T>[] {
  const groups = new Map<TopicId | 'new', T[]>()
  for (const item of items) {
    const key = topics.get(item.id) ?? 'new'
    let group = groups.get(key)
    if (!group) groups.set(key, (group = []))
    group.push(item)
  }
  const rank = (key: TopicId | 'new') => (key === 'new' ? -1 : key === 'other' ? 1 : 0)
  return [...groups]
    .map(([key, items]) => ({ key, items }))
    .sort(
      (a, b) =>
        rank(a.key) - rank(b.key) ||
        b.items.length - a.items.length ||
        TOPIC_IDS.indexOf(a.key as TopicId) - TOPIC_IDS.indexOf(b.key as TopicId),
    )
}
