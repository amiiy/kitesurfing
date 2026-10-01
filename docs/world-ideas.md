# World ideas: Kite Runner

## 1. Making the run feel like progress (biome sequence)
Current setup: `createShoreline` repeats one seeded layout across 3 tiles. The group snaps to `Math.round(x/SHORE_TILE)*SHORE_TILE`, so you see the same beach forever.
**Core change (small):** use the tile index `ti = Math.round(target.x/SHORE_TILE)` to choose a biome, `BIOMES[floor(ti / tilesPerBiome) % n]`. Keep one InstancedMesh per model per biome. When the biome changes, set `mesh.count = 0` on the outgoing biome's meshes; don't rebuild them. The layout is seeded per biome, so it stays deterministic. All of this is render-only, so sim:check is unaffected.

| # | Biome | Props (instanceProp) | Set piece / landmark | Fit with the code |
|---|---|---|---|---|
| 1 | Open sea / start beach | the existing palms, huts, lifeguard | start flag / inflatable arch | today's layout, as is |
| 2 | Reef | rocks, coral heads poking out of shallow water, buoys | a shipwreck hull that peeks out of the water | `y` just below 0; water `uShallow` lightened for this biome |
| 3 | Pier | pier pylons and deck (one instanced segment ×N), beach bar | the long pier running out to sea; you pass its end | instanced deck along X at z≈−10; a hero mesh at one tile index |
| 4 | Harbour | moored boats (reuse sailboat), cranes, containers, harbour wall | lighthouse at the harbour mouth | lighthouse = `loadProp` single instance, placed when the biome starts |
| 5 | Lagoon / finish | mangroves, overwater bungalows, flamingo floats | finish arch plus a crowd on the beach | flat calm: lower wave amplitude only in the shader (render only) |

- **Distance markers:** a buoy every 100 m with the number on it (sprite or CanvasTexture). This is the cheapest progress cue there is.
- **Hero landmark on the horizon** (e.g. a volcano or lighthouse at x = course end) that grows as you approach. Gives you Alto-style anticipation.
- Keep the course fixed. Set pieces are tied to x, so every run looks the same, which suits a deterministic game.

## 2. Background life
Prompt prefix for all of these: *"stylized low-poly cartoon, flat toon shading, chunky silhouette, palette navy #1D1D28, hot pink #FF3D6E, cyan #22C3FF, turquoise #2EC4B6 accents, no texture noise, game-ready"*

| Entity | Meshy prompt (after the prefix) | Tri budget | Animation |
|---|---|---|---|
| Seagull | "seagull, wings spread in a glide, white body, navy wingtips, pink beak" | 300–600 | Procedural: InstancedMesh flock flying on sine paths; flap = vertex-shader bend on |x| of the wing (no rig) |
| Distant kiter | "kitesurfer on board with small pink/cyan kite, simplified" (or reuse the rider glb with a lower-LOD decimate) | 1.5–3k | Procedural: move along a lane with a bob; kite on a sine figure-8 |
| Dolphin | "cartoon dolphin leaping, turquoise-grey with pink belly stripe" | 800–1.5k | Procedural: parabolic leap arc plus pitch-follow-velocity; pod of 3 timed by x |
| Motorboat / yacht | "small speedboat, white hull, navy stripe, pink seats" | 1–2k | Procedural: constant drift, a bob and a foam wake strip |
| Jet-ski | "jet ski with rider, cyan and pink" | 1.5–2.5k | Procedural: slalom sine and a spray particle burst |
| Parasailer (bonus) | "parasail canopy pink/cyan with tiny figure" | 600 | Procedural pendulum |

None of these need a Meshy rig: everything stays small on screen, so shader or transform animation is enough. Spawn them deterministically from x thresholds, not Math.random.

## 3. Time-of-day and weather presets
Keys map straight onto the code: `SKY {zenith,horizon,sun}`, Hemisphere {sky,ground,intensity}, Directional {color,intensity}, water {uSunColor,uDeep,uMid,uShallow,uLight,uFoam}, plus scene fog.

| Key | Sunrise | Noon (current) | Sunset | Storm |
|---|---|---|---|---|
| zenith | #5B6FB8 | #1E8CF0 | #2A2350 | #3A4452 |
| horizon | #FFC7A8 | #BFE9FF | #FF7A6E | #8A97A3 |
| sun | #FFE2B0 | #FFF3C4 | #FFB15C | #D8DEE4 |
| hemi sky / ground / int | #C9B8FF / #2A8FA0 / 1.6 | #A8D8FF / #22A5B0 / 1.9 | #FF9AA8 / #1D1D28 / 1.4 | #9AA8B5 / #1E3A44 / 1.3 |
| dir light col / int | #FFC89A / 2.0 | #FFE4BD / 2.6 | #FF8C5A / 2.2 | #CFD8E0 / 0.8 |
| uSunColor | #FFD9A8 | #FFFBE6 | #FF9E6B | #C8D2DA |
| uDeep | #1D2A5A | #0B4A6E | #1D1D28 | #18303A |
| uMid | #2E6F9E | #0F86A8 | #3A2E5E | #2A5560 |
| uShallow | #4FA9C4 | #1FB9C8 | #B3456E | #3E7478 |
| uLight | #FFC7B0 | #6FE3E6 | #FF3D6E | #7FA3A6 |
| uFoam | #FFF4EC | #F4FCFF | #FFE6EE | #E6ECEF |
| fog | #FFD2B8 | #BFE9FF | #C25A70 | #6E7C88 |

For storm, also lower the shadow intensity, raise the wave amplitude and darken the foam ratio. Add a rain line-sprite layer and a lightning flash (hemi intensity spike for 80 ms). All render-only.
Cycle presets by biome (sunrise at the start → noon → sunset in the lagoon). Over one run that reads as a journey.

## 4. Inspiration (unverified; from memory, no links)
| Game | What builds sense of place | Takeaway for us |
|---|---|---|
| Alto's Odyssey | biome bands (dunes, canyons, temples); dynamic time-of-day and weather on layered parallax silhouettes | biome sequence plus time-of-day cycling is the main thing to copy |
| Tiny Wings | one-button; each "island" ends with a visible goal; day turns to night as a timer | island/biome boundaries as checkpoints; sun-setting pressure |
| Riptide GP | water-heavy hydro tracks with industrial/harbour landmarks and spray | harbour set pieces; spectacle in the water's spray and wake |
| Wave Race 64 | named courses with a distinct identity (Sunny Beach, Drake Lake, Port Blue); buoys as course markers; dolphin rides | buoy markers, dolphins, a named harbour area |
| Subway Surfers | endless runner reskinned per city (World Tour), with recurring chunks | swap the prop palette per biome instead of building new systems |

## 5. Shortlist: top 5 by impact vs cost
| Rank | Item | Meshy credits (~21/asset) | Code effort |
|---|---|---|---|
| 1 | Time-of-day presets (sunrise to sunset over the run) | 0 | S: preset table plus a lerp of existing uniforms, about 60 lines |
| 2 | Distance buoys plus a finish arch | 2 assets ≈ 42 | S: instanced along x |
| 3 | Seagull flock plus dolphin pod | 2 ≈ 42 | S–M: procedural animation |
| 4 | Biome swap (reef → pier → harbour) via the tile index | ~6 (rock, coral, pier segment, crane, container, wreck) ≈ 126 | M: per-biome layouts in createShoreline |
| 5 | Hero landmark (lighthouse) plus distant kiters and jet-ski | 3 ≈ 63 | S |

All five: about 13 assets, roughly 273 credits. Ranks 1–3 only: about 84 credits and around a day of work.