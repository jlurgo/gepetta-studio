// Builds the bundled sound-effects library (public/sfx) from downloaded CC0
// packs, unzipped side by side in one folder (each in a folder named like its
// zip): node scripts/sfx-library.mjs <packs-folder>
//
// Each pack's sounds are grouped in families (the same sound in a few
// takes: footstep_grass_000…004), and each family gets a category and a name
// in Spanish. Families not listed here are left out.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const CATEGORIES = [
  ["dibujito", "Dibujito"],
  ["golpes", "Golpes y choques"],
  ["pasos", "Pasos"],
  ["animales", "Animales"],
  ["naturaleza", "Naturaleza y lugares"],
  ["casa", "Casa y cosas"],
  ["vehiculos", "Vehículos y máquinas"],
  ["magia", "Magia, rayos y espacio"],
  ["botones", "Botones y avisos"],
  ["musica", "Música"],
  ["voces", "Voces (en inglés)"],
];

/** Family of a file: its path in the pack without the take number. */
const stem = (rel) => rel.replace(/\.(ogg|wav|mp3|flac)$/i, "").replace(/[ _-]*\(?\d+\)?$/, "");

const PACKS = [
  {
    dir: "kenney_impact-sounds",
    short: "kenney-golpes",
    credit: "Kenney (kenney.nl), «Impact Sounds»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      footstep_carpet: ["pasos", "Pasos en alfombra"],
      footstep_concrete: ["pasos", "Pasos en cemento"],
      footstep_grass: ["pasos", "Pasos en pasto"],
      footstep_snow: ["pasos", "Pasos en nieve"],
      footstep_wood: ["pasos", "Pasos en madera"],
      impactBell_heavy: ["golpes", "Campanazo"],
      impactGeneric_light: ["golpes", "Golpecito"],
      impactGlass_heavy: ["golpes", "Vidrio, golpe fuerte"],
      impactGlass_medium: ["golpes", "Vidrio, golpe"],
      impactGlass_light: ["golpes", "Vidrio, golpecito"],
      impactMetal_heavy: ["golpes", "Metal, golpe fuerte"],
      impactMetal_medium: ["golpes", "Metal, golpe"],
      impactMetal_light: ["golpes", "Metal, golpecito"],
      impactMining: ["golpes", "Pico contra la piedra"],
      impactPlank_medium: ["golpes", "Tablón"],
      impactPlate_heavy: ["golpes", "Chapa, golpe fuerte"],
      impactPlate_medium: ["golpes", "Chapa, golpe"],
      impactPlate_light: ["golpes", "Chapa, golpecito"],
      impactPunch_heavy: ["golpes", "Piña fuerte"],
      impactPunch_medium: ["golpes", "Piña"],
      impactSoft_heavy: ["golpes", "Golpe blando fuerte"],
      impactSoft_medium: ["golpes", "Golpe blando"],
      impactTin_medium: ["golpes", "Lata"],
      impactWood_heavy: ["golpes", "Madera, golpe fuerte"],
      impactWood_medium: ["golpes", "Madera, golpe"],
      impactWood_light: ["golpes", "Madera, golpecito"],
    },
  },
  {
    dir: "100-CC0-SFX_0",
    short: "cc0-100",
    credit: "rubberduck (opengameart.org), «100 CC0 SFX»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      bell: ["casa", "Campanita"],
      dishes: ["casa", "Platos"],
      door: ["casa", "Puerta"],
      door_close: ["casa", "Cerrar la puerta"],
      door_open: ["casa", "Abrir la puerta"],
      explosion: ["golpes", "Explosión"],
      glass: ["casa", "Vasos y vidrios"],
      gong: ["golpes", "Gong"],
      hit: ["golpes", "Golpe seco"],
      key_open: ["casa", "Llave en la cerradura"],
      machine: ["vehiculos", "Máquina"],
      metal: ["golpes", "Metal"],
      microwave_door_close: ["casa", "Microondas, cerrar"],
      microwave_door_open: ["casa", "Microondas, abrir"],
      noise: ["magia", "Ruido raro"],
      other: ["dibujito", "Sorpresas"],
      paper: ["casa", "Papel"],
      plop: ["dibujito", "Plop"],
      pot: ["casa", "Olla"],
      shot: ["golpes", "Disparo"],
      slam: ["golpes", "Portazo"],
      splash: ["dibujito", "Splash"],
      spring: ["dibujito", "Resorte (boing)"],
      switch: ["casa", "Interruptor de luz"],
      toilet: ["casa", "Inodoro"],
      tools: ["casa", "Herramientas"],
      weird: ["dibujito", "Raros"],
      wooded_box_open: ["casa", "Abrir un cajón"],
      wooden: ["golpes", "Madera"],
    },
  },
  {
    dir: "kenney_rpg-audio",
    short: "kenney-rpg",
    credit: "Kenney (kenney.nl), «RPG Audio»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      beltHandle: ["casa", "Hebilla"],
      bookClose: ["casa", "Cerrar un libro"],
      bookFlip: ["casa", "Pasar las páginas"],
      bookOpen: ["casa", "Abrir un libro"],
      bookPlace: ["casa", "Apoyar un libro"],
      chop: ["casa", "Hachazo"],
      cloth: ["casa", "Ropa"],
      clothBelt: ["casa", "Cinturón"],
      creak: ["casa", "Crujido"],
      doorClose: ["casa", "Puerta vieja, cerrar"],
      doorOpen: ["casa", "Puerta vieja, abrir"],
      drawKnife: ["casa", "Sacar un cuchillo"],
      dropLeather: ["casa", "Bolsa que cae"],
      footstep: ["pasos", "Pasos"],
      handleCoins: ["casa", "Monedas"],
      handleSmallLeather: ["casa", "Bolsita"],
      knifeSlice: ["casa", "Cortar"],
      metalClick: ["casa", "Clic de metal"],
      metalLatch: ["casa", "Pestillo"],
      metalPot: ["casa", "Olla de metal"],
    },
  },
  {
    dir: "kenney_digital-audio",
    short: "kenney-digital",
    credit: "Kenney (kenney.nl), «Digital Audio»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      highDown: ["magia", "Baja (agudo)"],
      highUp: ["magia", "Sube (agudo)"],
      laser: ["magia", "Láser"],
      lowDown: ["magia", "Baja (grave)"],
      lowRandom: ["magia", "Bip bop"],
      lowThreeTone: ["magia", "Tres tonos graves"],
      pepSound: ["magia", "Pip"],
      phaseJump: ["magia", "Salto"],
      phaserDown: ["magia", "Rayo que baja"],
      phaserUp: ["magia", "Rayo que sube"],
      powerUp: ["magia", "Poder"],
      spaceTrash: ["magia", "Chatarra espacial"],
      threeTone: ["magia", "Tres tonos"],
      tone: ["magia", "Tono"],
      twoTone: ["magia", "Dos tonos"],
      zap: ["magia", "Zap"],
      zapThreeToneDown: ["magia", "Zap que baja"],
      zapThreeToneUp: ["magia", "Zap que sube"],
      zapTwoTone: ["magia", "Zap doble"],
    },
  },
  {
    dir: "kenney_interface-sounds",
    short: "kenney-interfaz",
    credit: "Kenney (kenney.nl), «Interface Sounds»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      back: ["botones", "Volver"],
      bong: ["botones", "Bong"],
      click: ["botones", "Clic"],
      close: ["botones", "Cerrar"],
      confirmation: ["botones", "¡Bien!"],
      drop: ["botones", "Soltar"],
      error: ["botones", "Error"],
      glass: ["botones", "Cristalito"],
      glitch: ["magia", "Falla eléctrica"],
      maximize: ["botones", "Agrandar"],
      minimize: ["botones", "Achicar"],
      open: ["botones", "Abrir"],
      pluck: ["dibujito", "Pellizco"],
      question: ["botones", "¿Pregunta?"],
      scratch: ["botones", "Raspar"],
      scroll: ["botones", "Rueda"],
      select: ["botones", "Elegir"],
      switch: ["botones", "Botón"],
      tick: ["botones", "Tic"],
      toggle: ["botones", "Llave"],
    },
  },
  {
    dir: "kenney_ui-audio",
    short: "kenney-ui",
    credit: "Kenney (kenney.nl), «UI Audio»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      click: ["botones", "Clic suave"],
      mouseclick: ["botones", "Clic del mouse"],
      mouserelease: ["botones", "Soltar el mouse"],
      rollover: ["botones", "Pasar por encima"],
      switch: ["botones", "Interruptor"],
    },
  },
  {
    dir: "kenney_music-jingles",
    short: "kenney-jingles",
    credit: "Kenney (kenney.nl), «Music Jingles»",
    family: (rel) => stem(path.basename(rel)),
    names: {
      jingles_NES: ["musica", "Jingle de videojuego"],
      jingles_HIT: ["musica", "Jingle con golpes"],
      jingles_PIZZI: ["musica", "Jingle de cuerdas (pizzicato)"],
      jingles_SAX: ["musica", "Jingle de saxo"],
      jingles_STEEL: ["musica", "Jingle de tambor de acero"],
    },
  },
  {
    dir: "kenney_voiceover-pack",
    short: "kenney-voces",
    credit: "Kenney (kenney.nl), «Voiceover Pack»",
    // The same words said by a man and by a woman are takes of one family.
    family: (rel) => path.basename(rel).replace(/\.ogg$/, ""),
    names: {
      1: ["voces", "One (uno)"],
      2: ["voces", "Two (dos)"],
      3: ["voces", "Three (tres)"],
      4: ["voces", "Four (cuatro)"],
      5: ["voces", "Five (cinco)"],
      6: ["voces", "Six (seis)"],
      7: ["voces", "Seven (siete)"],
      8: ["voces", "Eight (ocho)"],
      9: ["voces", "Nine (nueve)"],
      10: ["voces", "Ten (diez)"],
      congratulations: ["voces", "Congratulations (felicitaciones)"],
      correct: ["voces", "Correct (correcto)"],
      final_round: ["voces", "Final round (última vuelta)"],
      game_over: ["voces", "Game over (fin del juego)"],
      go: ["voces", "Go! (¡ya!)"],
      hold: ["voces", "Hold (esperá)"],
      hurry_up: ["voces", "Hurry up (apurate)"],
      its_a_tie: ["voces", "It's a tie (empate)"],
      level: ["voces", "Level (nivel)"],
      level_up: ["voces", "Level up (subiste de nivel)"],
      mission_completed: ["voces", "Mission completed (misión cumplida)"],
      mission_failed: ["voces", "Mission failed (misión fallida)"],
      new_highscore: ["voces", "New high score (récord)"],
      objective_achieved: ["voces", "Objective achieved (objetivo logrado)"],
      power_up: ["voces", "Power up (poder)"],
      ready: ["voces", "Ready (listos)"],
      round: ["voces", "Round (vuelta)"],
      set: ["voces", "Set (preparados)"],
      time_over: ["voces", "Time over (se acabó el tiempo)"],
      wrong: ["voces", "Wrong (incorrecto)"],
      you_lose: ["voces", "You lose (perdiste)"],
      you_win: ["voces", "You win (ganaste)"],
    },
  },
];

const from = process.argv[2];
if (!from) throw new Error("usage: node scripts/sfx-library.mjs <packs-folder>");
const out = path.join(import.meta.dirname, "..", "public", "sfx");
rmSync(out, { recursive: true, force: true });

function walk(dir, rel = "") {
  return readdirSync(path.join(dir, rel)).flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    return statSync(path.join(dir, r)).isDirectory() ? walk(dir, r) : [r];
  });
}

const sounds = new Map(CATEGORIES.map(([id]) => [id, []]));
const credits = [];
for (const pack of PACKS) {
  const dir = path.join(from, pack.dir);
  if (!existsSync(dir)) throw new Error(`missing pack ${pack.dir}`);
  const families = new Map();
  for (const rel of walk(dir).filter((r) => /\.(ogg|wav|mp3|flac)$/i.test(r)).sort()) {
    const fam = pack.family(rel);
    if (!pack.names[fam]) continue;
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push(rel);
  }
  for (const fam of Object.keys(pack.names)) if (!families.has(fam)) throw new Error(`${pack.dir}: no files for ${fam}`);
  mkdirSync(path.join(out, pack.short), { recursive: true });
  for (const [fam, rels] of families) {
    const [cat, name] = pack.names[fam];
    const files = rels.map((rel) => {
      const file = `${pack.short}/${rel.replaceAll("/", "_").replace(/[^\w.-]+/g, "_")}`;
      copyFileSync(path.join(dir, rel), path.join(out, file));
      return file;
    });
    sounds.get(cat).push({ name, files });
  }
  credits.push(`- ${pack.credit}: carpeta ${pack.short}`);
}

const catalog = {
  categories: CATEGORIES.map(([id, name]) => ({ id, name, sounds: sounds.get(id).sort((a, b) => a.name.localeCompare(b.name, "es")) })).filter((c) => c.sounds.length),
};
writeFileSync(path.join(out, "catalogo.json"), JSON.stringify(catalog));
writeFileSync(
  path.join(out, "LICENCIAS.txt"),
  `Efectos de sonido incluidos en Gepetta Studio.\n\nTodos tienen licencia CC0 (dominio público,\nhttps://creativecommons.org/publicdomain/zero/1.0/): se pueden usar,\nmodificar y repartir sin pedir permiso ni nombrar a sus autores. Igual\nlos nombramos, con gracias:\n\n${credits.join("\n")}\n`,
);
const count = catalog.categories.reduce((n, c) => n + c.sounds.length, 0);
const takes = catalog.categories.reduce((n, c) => n + c.sounds.reduce((m, s) => m + s.files.length, 0), 0);
console.log(`${count} sounds (${takes} takes) in ${catalog.categories.length} categories`);
