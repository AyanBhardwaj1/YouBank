import type { PremiumFeature } from "./types";

/**
 * Premium features: 3D maps and geospatial AI (the maps work owns this file).
 *
 * Free for everyone, and so not listed here: the 3D globe and terrain, sun lighting, 3D buildings, site
 * models and flare stacks, the digital twin's models from lidar and OpenStreetMap, the change heatmap of
 * an existing finding, and glTF export of a twin. What is listed costs us per use (the ML service on
 * Modal, Planet's tiles) or is heavy enough to be a plan's perk; each runs only when a person starts it.
 *
 * Costs per use, worked from list prices on 5 October 2026:
 * - maps.ai-change: geo.embed_change on Modal, 1 core and 2 GiB for 30 to 60 s, plus start-up and the
 *   60 s idle tail: about $0.003.
 * - maps.footprints: geo.footprints on Modal (SAM 2.1 automatic masks), 2 cores and 7 GiB for 60 to
 *   120 s, plus start-up and idle: about $0.012.
 * - maps.planet-drape: Planet's XYZ tiles of one scene over a site, counted against the Planet
 *   contract's area quota (a few km² per drape); $0.25 is a deliberately cautious figure for a
 *   pay-as-you-go contract.
 * - maps.lidar, maps.scene and maps.export read free public data with a few seconds of our own
 *   functions: perks, not metered.
 */
export const MAPS_FEATURES: PremiumFeature[] = [
  {
    id: "maps.lidar", area: "maps", name: "Lidar digital twin",
    description: "Stream USGS 3DEP lidar as a 3D point cloud of a US site, up to 800,000 points, lined up with the terrain and models.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
  },
  {
    id: "maps.scene", area: "maps", name: "3D scene analysis",
    description: "Land use classified by machine learning as 3D blocks, and two years of satellite change stacked month by month into a 3D time-lapse.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
  },
  {
    id: "maps.ai-change", area: "maps", name: "AI change from satellite embeddings",
    description: "Google DeepMind's AlphaEarth embeddings compared across two years, drawn as an extruded 3D change heatmap.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.003,
  },
  {
    id: "maps.footprints", area: "maps", name: "AI footprint detection",
    description: "Segment Anything outlines the tanks, buildings and pads in the newest aerial photo and stands them up in 3D.",
    minPlan: "pro", metered: true, costPerUseUsd: 0.012,
  },
  {
    id: "maps.export", area: "maps", name: "High-resolution 3D time-lapse export",
    description: "Record a site's month-by-month satellite time-lapse at 1,024 pixels, draped on the 3D terrain, as a video file.",
    minPlan: "pro", metered: false, costPerUseUsd: 0,
  },
  {
    id: "maps.planet-drape", area: "maps", name: "Planet imagery in 3D",
    description: "Drape a recent 3 m PlanetScope or 50 cm SkySat scene over the 3D terrain and site models.",
    minPlan: "team", metered: true, costPerUseUsd: 0.25,
  },
];
