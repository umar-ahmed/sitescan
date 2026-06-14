import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import Globe from "react-globe.gl";

export interface GlobeRegion {
  code: string;
  name: string;
  lat: number;
  lng: number;
  coverage?: number; // approx active nodes in the region
}

export interface Arc {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

// node density → colour (teal = well covered, amber = few, red = none)
function coverageRGB(n: number): [number, number, number] {
  return n >= 4 ? [63, 208, 168] : n >= 1 ? [255, 180, 84] : [255, 94, 94];
}
function coverageRGBA(n: number, a: number) {
  const [r, g, b] = coverageRGB(n);
  return `rgba(${r},${g},${b},${a})`;
}

// Camera-facing "beacon" sprite: a soft colored halo, a crisp colored core
// with a defined edge, and a hot near-white center so each node reads as a
// clean, lit point rather than a hazy blob.
function glowTexture([r, g, b]: [number, number, number]) {
  const size = 256;
  const c = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Soft outer halo.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c);
  halo.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
  halo.addColorStop(0.3, `rgba(${r},${g},${b},0.18)`);
  halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // Crisp colored core with a faint ring of breathing room around it.
  ctx.beginPath();
  ctx.arc(c, c, 30, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${r},${g},${b},1)`;
  ctx.fill();

  // Hot near-white center for the "lit" look (kept small so the tier colour
  // still reads as a ring around it).
  const hot = ctx.createRadialGradient(c, c, 0, c, c, 18);
  hot.addColorStop(0, "rgba(255,255,255,0.95)");
  hot.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = hot;
  ctx.beginPath();
  ctx.arc(c, c, 18, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

// Map a country's Natural Earth properties to one of our coarse regions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function regionForFeature(p: any): string | null {
  const sub = p.SUBREGION || p.subregion || "";
  const cont = p.CONTINENT || p.continent || "";
  if (sub === "Northern America") return "NA";
  if (["Central America", "Caribbean", "South America"].includes(sub))
    return "LATAM";
  if (sub === "Eastern Europe") return "EU_E";
  if (["Western Europe", "Northern Europe", "Southern Europe"].includes(sub))
    return "EU_W";
  if (sub === "Western Asia" || cont === "Africa") return "MEA";
  if (
    [
      "Central Asia",
      "Southern Asia",
      "Eastern Asia",
      "South-Eastern Asia",
    ].includes(sub)
  )
    return "APAC";
  if (cont === "Oceania") return "OCEANIA";
  if (cont === "North America") return "NA";
  if (cont === "South America") return "LATAM";
  if (cont === "Europe") return "EU_W";
  if (cont === "Asia") return "APAC";
  return null;
}

// Bundled locally so the globe always has continents, even with no network
// (e.g. flaky venue wifi during a demo). Remote is only a last-resort fallback.
import countriesGeoJson from "./assets/countries-110m.json";

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRegionFeatures(geo: any) {
  return (geo?.features || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((f: any) => ({
      ...f,
      __region: regionForFeature(f.properties || {}),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((f: any) => f.__region);
}

const BUNDLED_FEATURES = toRegionFeatures(countriesGeoJson);

// Minimalist dark globe: flat near-black sphere, continents drawn as faint
// outlines. Regions raise/brighten on hover + select; pulsing rings encode node
// density. No photoreal texture, so it reads as a data surface, not a map.
export default function GlobeScene({
  regions = [],
  selected = [],
  onToggle,
  interactive = false,
  launching = false,
  arcs = [],
}: {
  regions?: GlobeRegion[];
  selected?: string[];
  onToggle?: (code: string) => void;
  interactive?: boolean;
  launching?: boolean;
  arcs?: Arc[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  // Seed from the bundled GeoJSON so continents render instantly and offline.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [features, setFeatures] = useState<any[]>(BUNDLED_FEATURES);

  // Flat, unlit dark sphere — no bright patches to fight the text.
  const globeMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#0c0a22" }),
    [],
  );

  // One glow sprite texture per coverage tier (built once).
  const glowTex = useMemo(
    () => ({
      hi: glowTexture([63, 208, 168]),
      mid: glowTexture([255, 180, 84]),
      lo: glowTexture([255, 94, 94]),
    }),
    [],
  );
  const texForCoverage = (n: number) =>
    n >= 4 ? glowTex.hi : n >= 1 ? glowTex.mid : glowTex.lo;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // We already have the bundled data; only refresh from remote if for some
    // reason the local seed came back empty.
    if (BUNDLED_FEATURES.length > 0) return;
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled) return;
        setFeatures(toRegionFeatures(geo));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const c = g.controls();
    c.enableZoom = false;
    c.enablePan = false;
    c.enableRotate = true;
    c.autoRotateSpeed = 0.5;
    g.pointOfView({ lat: 20, lng: 10, altitude: 2.5 }, 0);
  }, []);

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.controls().autoRotate = !interactive;
    if (interactive) g.pointOfView({ lat: 25, lng: 0, altitude: 2.1 }, 1600);
  }, [interactive]);

  // Cinematic launch: pull the camera back and stop spinning so the arcs fire
  // and the impact rings land in a held, composed frame.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    if (launching) {
      g.controls().autoRotate = false;
      g.pointOfView({ lat: 15, lng: 0, altitude: 2.8 }, 900);
    } else if (!interactive) {
      g.controls().autoRotate = true;
    }
  }, [launching, interactive]);

  // Steady colored dot + pulsing ring per region, always visible so the
  // green/amber/red node-density legend reads at a glance.
  const markers = regions.map((r) => ({
    lat: r.lat,
    lng: r.lng,
    coverage: r.coverage ?? 0,
    burst: false,
  }));

  // During launch, add a bright "impact" ring at each targeted region on top of
  // the steady density pulses.
  const impacts = launching
    ? regions
        .filter((r) => selected.includes(r.code))
        .map((r) => ({
          lat: r.lat,
          lng: r.lng,
          coverage: r.coverage ?? 0,
          burst: true,
        }))
    : [];
  const ringData = [...markers, ...impacts];

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        globeMaterial={globeMaterial}
        showAtmosphere
        atmosphereColor="#6c7bd6"
        atmosphereAltitude={0.16}
        polygonsData={features}
        polygonAltitude={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          if (interactive && reg === hovered) return 0.07;
          if (selected.includes(reg)) return 0.05;
          return 0.006;
        }}
        polygonCapColor={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          if (selected.includes(reg)) return "rgba(124,73,183,0.55)";
          if (interactive && reg === hovered) return "rgba(255,255,255,0.3)";
          return "rgba(150,160,235,0.06)";
        }}
        polygonSideColor={() => "rgba(124,73,183,0.12)"}
        polygonStrokeColor={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          // Faint region outline always on; brightens on hover / select.
          return selected.includes(reg) || (interactive && reg === hovered)
            ? "rgba(255,255,255,0.75)"
            : "rgba(150,162,235,0.3)";
        }}
        polygonsTransitionDuration={250}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPolygonHover={(f: any) => {
          if (!interactive) return;
          setHovered(f ? f.__region : null);
          if (wrapRef.current)
            wrapRef.current.style.cursor = f ? "pointer" : "grab";
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPolygonClick={(f: any) => interactive && f && onToggle?.(f.__region)}
        customLayerData={markers}
        customThreeObject={(d: object) => {
          const cov = (d as { coverage: number }).coverage;
          const mat = new THREE.SpriteMaterial({
            map: texForCoverage(cov),
            transparent: true,
            depthWrite: false,
          });
          const sprite = new THREE.Sprite(mat);
          const s = 8;
          sprite.scale.set(s, s, 1);
          return sprite;
        }}
        customThreeObjectUpdate={(obj: object, d: object) => {
          const m = d as { lat: number; lng: number };
          const coords = globeRef.current?.getCoords(m.lat, m.lng, 0.02);
          if (coords)
            (obj as THREE.Object3D).position.set(coords.x, coords.y, coords.z);
        }}
        ringsData={ringData}
        ringColor={(d: object) => {
          const r = d as { coverage: number; burst: boolean };
          return r.burst
            ? (t: number) => `rgba(214,205,255,${0.9 * (1 - t)})`
            : (t: number) => coverageRGBA(r.coverage, 0.42 * (1 - t));
        }}
        ringMaxRadius={(d: object) => {
          const r = d as { coverage: number; burst: boolean };
          return r.burst ? 7 : 2.4 + r.coverage * 0.4;
        }}
        ringPropagationSpeed={(d: object) =>
          (d as { burst: boolean }).burst ? 5 : 1.5
        }
        ringRepeatPeriod={(d: object) => {
          const r = d as { coverage: number; burst: boolean };
          return r.burst ? 450 : Math.max(1100, 2600 - r.coverage * 260);
        }}
        arcsData={arcs}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcStartLat={(d: any) => d.startLat}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcStartLng={(d: any) => d.startLng}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcEndLat={(d: any) => d.endLat}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcEndLng={(d: any) => d.endLng}
        arcColor={() =>
          launching
            ? ["rgba(139,155,255,0.2)", "rgba(224,216,255,1)"]
            : ["rgba(139,155,255,0.1)", "rgba(199,184,255,0.95)"]
        }
        arcDashLength={0.4}
        arcDashGap={0.25}
        arcDashAnimateTime={launching ? 700 : 1500}
        arcStroke={launching ? 0.9 : 0.6}
      />
    </div>
  );
}
