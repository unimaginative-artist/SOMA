import React, { useMemo } from 'react';

/**
 * Procedural 16-bit pixel art avatar generator.
 * Supports both humanoid and kawaii animal types.
 * Deterministic: same seed always produces the same character.
 * 12x12 grid, symmetric for face-like appearance.
 */

function mulberry32(seed) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ── HUMANOID PARTS ──
const HAIR = [
  [[2,0],[3,0],[4,0],[5,0],[2,1],[3,1],[4,1],[5,1],[1,1],[1,2]],
  [[2,0],[3,0],[4,0],[5,0],[1,0],[1,1],[2,1],[3,1],[4,1],[5,1]],
  [[4,0],[5,0],[4,1],[5,1],[3,0],[3,1]],
  [[2,0],[4,0],[5,0],[1,1],[3,1],[5,1],[2,1]],
  [[3,0],[4,0]],
  [[2,0],[3,0],[4,0],[5,0],[1,0],[1,1],[1,2],[1,3],[2,1],[3,1],[4,1],[5,1]],
  [[1,0],[1,1],[2,1],[3,1],[4,1],[5,0],[5,1]],
  [[1,0],[3,0],[5,0],[2,1],[3,1],[4,1],[5,1],[1,1]],
];

const H_EYES = [ [[3,4],[3,5]], [[3,4],[2,4],[3,5],[2,5]], [[3,4]], [[3,4],[2,5]], [[2,4],[3,5]] ];
const H_MOUTH = [ [[3,8],[4,7]], [[3,7],[4,7]], [[3,7],[4,7],[3,8]], [[3,7],[4,7],[5,7],[3,8]], [[4,7],[5,7]] ];
const H_BODY = [
  [[3,9],[4,9],[3,10],[4,10],[3,11],[4,11]],
  [[2,9],[3,9],[4,9],[5,9],[3,10],[4,10],[3,11],[4,11]],
  [[2,9],[3,9],[4,9],[5,9],[2,10],[3,10],[4,10],[5,10],[3,11],[4,11]],
  [[2,9],[3,9],[4,9],[5,9],[1,10],[2,10],[3,10],[4,10],[5,10],[2,11],[3,11],[4,11],[5,11]],
];
const H_ACCESSORY = [ [], [[2,4],[2,5],[3,4],[3,5]], [[1,5],[2,6]], [[2,7],[2,8]], [[0,5]], [[2,6],[3,6],[4,6],[3,7],[4,7]] ];

// ── ANIMAL TEMPLATES ──
// Each animal has: ears, face, eyes, nose, mouth, body, extras

const ANIMALS = {
  cat: {
    ears: [[2,0],[1,1],[2,1]],
    face: () => { const f = []; for (let y=2; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyes: [[3,4]],
    nose: [[4,5]],
    mouth: [[3,6],[4,6],[5,6]],
    whiskers: [[1,5],[0,4],[1,6],[0,7]],
    body: [[3,8],[4,8],[3,9],[4,9],[2,9],[5,9],[3,10],[4,10]],
    tail: [[0,9],[0,10],[1,10]],
  },
  bear: {
    ears: [[1,0],[2,0],[1,1]],
    face: () => { const f = []; for (let y=1; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyes: [[3,3]],
    nose: [[4,5],[3,5]],
    mouth: [[3,6],[4,6]],
    body: [[2,8],[3,8],[4,8],[5,8],[2,9],[3,9],[4,9],[5,9],[3,10],[4,10],[2,10],[5,10],[3,11],[4,11]],
  },
  rabbit: {
    ears: [[3,0],[3,1],[3,2],[2,0],[2,1]],
    face: () => { const f = []; for (let y=3; y<=8; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyes: [[3,5]],
    nose: [[4,6]],
    mouth: [[3,7],[4,7],[5,7]],
    body: [[3,9],[4,9],[2,9],[5,9],[3,10],[4,10],[3,11],[4,11]],
  },
  fox: {
    ears: [[1,0],[2,0],[2,1],[1,1]],
    face: () => { const f = []; for (let y=2; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); f.push([5,8]); return f; },
    eyes: [[3,4]],
    nose: [[5,6]],
    mouth: [[4,7],[5,7]],
    body: [[3,8],[4,8],[3,9],[4,9],[2,9],[5,9],[3,10],[4,10]],
    tail: [[0,8],[0,9],[1,9],[0,10]],
  },
  owl: {
    ears: [[1,1],[2,1]],
    face: () => { const f = []; for (let y=2; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyes: [[3,3],[3,4],[2,3],[2,4]], // Big owl eyes
    nose: [[4,5]],
    mouth: [[4,6]],
    body: [[3,8],[4,8],[2,8],[5,8],[3,9],[4,9],[2,9],[5,9],[3,10],[4,10]],
    wings: [[1,7],[1,8],[0,8],[0,9]],
  },
  penguin: {
    face: () => { const f = []; for (let y=1; y<=6; y++) for (let x=3; x<=4; x++) f.push([x,y]); return f; },
    eyes: [[3,3]],
    nose: [[4,4],[5,4]],
    mouth: [],
    body: [[2,4],[2,5],[2,6],[2,7],[2,8],[5,4],[5,5],[5,6],[5,7],[5,8],[3,7],[4,7],[3,8],[4,8],[3,9],[4,9],[3,10],[4,10]],
    belly: [[3,5],[4,5],[3,6],[4,6]],
  },
  panda: {
    ears: [[1,0],[2,0],[1,1]],
    face: () => { const f = []; for (let y=1; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyePatches: [[2,3],[3,3],[2,4],[3,4]], // Dark patches around eyes
    eyes: [[3,3]],
    nose: [[4,5]],
    mouth: [[4,6],[3,6]],
    body: [[2,8],[3,8],[4,8],[5,8],[2,9],[3,9],[4,9],[5,9],[3,10],[4,10],[2,10],[5,10]],
  },
  dragon: {
    horns: [[1,0],[0,1]],
    face: () => { const f = []; for (let y=2; y<=7; y++) for (let x=2; x<=5; x++) f.push([x,y]); return f; },
    eyes: [[3,4]],
    nose: [[5,6]],
    mouth: [[4,7],[5,7],[5,8]],
    body: [[3,8],[4,8],[2,8],[5,8],[3,9],[4,9],[2,9],[3,10],[4,10]],
    wings: [[0,5],[0,6],[1,6],[0,7],[1,7]],
    tail: [[0,10],[0,11],[1,11]],
    spikes: [[5,2],[5,3]],
  },
};

const ANIMAL_TYPES = Object.keys(ANIMALS);

const PixelAvatar = ({ seed = 'soma', colors = {}, size = 48, className = '', creatureType = null }) => {
  const avatar = useMemo(() => {
    const h = hashString(seed);
    const rng = mulberry32(h);
    const gridSize = 12;
    const pixels = [];

    // Determine if animal or humanoid (creature type or random from seed)
    const isAnimal = creatureType || (rng() > 0.4);
    const animalType = creatureType || ANIMAL_TYPES[Math.floor(rng() * ANIMAL_TYPES.length)];

    // Colors
    const skinHue = Math.floor(rng() * 360);
    const hairHue = Math.floor(rng() * 360);
    const skinColor = colors.skin || `hsl(${skinHue}, 35%, 72%)`;
    const hairColor = colors.hair || `hsl(${hairHue}, 55%, 45%)`;
    const eyeColor = colors.eye || `hsl(${(hairHue + 180) % 360}, 70%, 50%)`;
    const bodyColor = colors.body || `hsl(${(skinHue + 120) % 360}, 40%, 35%)`;
    const accentColor = colors.accessory || `hsl(${(hairHue + 90) % 360}, 60%, 60%)`;
    const noseColor = `hsl(${skinHue}, 30%, 40%)`;
    const bellyColor = `hsl(${skinHue}, 20%, 85%)`;

    const addMirrored = (coords, color) => {
      for (const [x, y] of coords) {
        pixels.push({ x, y, color });
        const mx = gridSize - 1 - x;
        if (mx !== x) pixels.push({ x: mx, y, color });
      }
    };

    if (isAnimal && ANIMALS[animalType]) {
      const animal = ANIMALS[animalType];

      // Face
      if (animal.face) addMirrored(animal.face(), skinColor);

      // Ears
      if (animal.ears) addMirrored(animal.ears, hairColor);
      if (animal.horns) addMirrored(animal.horns, accentColor);

      // Eye patches (panda)
      if (animal.eyePatches) addMirrored(animal.eyePatches, '#1a1a2e');

      // Eyes
      if (animal.eyes) addMirrored(animal.eyes, eyeColor);

      // Nose
      if (animal.nose) addMirrored(animal.nose, noseColor);

      // Mouth
      if (animal.mouth) addMirrored(animal.mouth, noseColor);

      // Whiskers
      if (animal.whiskers) addMirrored(animal.whiskers, `hsl(${skinHue}, 15%, 55%)`);

      // Body
      if (animal.body) addMirrored(animal.body, bodyColor);

      // Belly
      if (animal.belly) addMirrored(animal.belly, bellyColor);

      // Wings
      if (animal.wings) addMirrored(animal.wings, accentColor);

      // Tail
      if (animal.tail) {
        for (const [x, y] of animal.tail) pixels.push({ x, y, color: hairColor });
      }

      // Spikes (dragon)
      if (animal.spikes) addMirrored(animal.spikes, accentColor);
    } else {
      // Humanoid
      const hairIdx = Math.floor(rng() * HAIR.length);
      const eyeIdx = Math.floor(rng() * H_EYES.length);
      const mouthIdx = Math.floor(rng() * H_MOUTH.length);
      const bodyIdx = Math.floor(rng() * H_BODY.length);
      const accIdx = Math.floor(rng() * H_ACCESSORY.length);

      const faceCoords = [];
      for (let y = 2; y <= 8; y++) for (let x = 2; x <= 5; x++) faceCoords.push([x, y]);
      addMirrored(faceCoords, skinColor);
      addMirrored(HAIR[hairIdx], hairColor);
      addMirrored(H_EYES[eyeIdx], eyeColor);
      addMirrored(H_MOUTH[mouthIdx], `hsl(0, 55%, 55%)`);
      addMirrored(H_BODY[bodyIdx], bodyColor);
      if (H_ACCESSORY[accIdx].length > 0) addMirrored(H_ACCESSORY[accIdx], accentColor);
    }

    return { pixels, gridSize, animalType: isAnimal ? animalType : 'humanoid' };
  }, [seed, colors, creatureType]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${avatar.gridSize} ${avatar.gridSize}`}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    >
      {avatar.pixels.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={1} height={1} fill={p.color} />
      ))}
    </svg>
  );
};

export default PixelAvatar;
