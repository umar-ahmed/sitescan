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
function coverageRGBA(n: number, a: number) {
  const c = n >= 4 ? [63, 208, 168] : n >= 1 ? [255, 180, 84] : [255, 94, 94];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
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

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";

// Minimalist dark globe: flat near-black sphere, continents drawn as faint
// outlines. Regions raise/brighten on hover + select; pulsing rings encode node
// density. No photoreal texture, so it reads as a data surface, not a map.
export default function GlobeScene({
  regions = [],
  selected = [],
  onToggle,
  interactive = false,
  arcs = [],
}: {
  regions?: GlobeRegion[];
  selected?: string[];
  onToggle?: (code: string) => void;
  interactive?: boolean;
  arcs?: Arc[];
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globeRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [features, setFeatures] = useState<any[]>([]);

  // Flat, unlit dark sphere — no bright patches to fight the text.
  const globeMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#0c0a22" }),
    [],
  );

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
    let cancelled = false;
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geo) => {
        if (cancelled) return;
        const feats = (geo.features || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((f: any) => ({
            ...f,
            __region: regionForFeature(f.properties || {}),
          }))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((f: any) => f.__region);
        setFeatures(feats);
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

  const rings = interactive
    ? regions.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        coverage: r.coverage ?? 0,
      }))
    : [];

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
          // No per-country borders by default — only outline the region you're
          // hovering or have selected.
          return selected.includes(reg) || (interactive && reg === hovered)
            ? "rgba(255,255,255,0.75)"
            : "rgba(255,255,255,0)";
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
        ringsData={rings}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ringColor={(d: any) => (t: number) => coverageRGBA(d.coverage, 1 - t)}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ringMaxRadius={(d: any) => 2 + d.coverage * 0.6}
        ringPropagationSpeed={2}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ringRepeatPeriod={(d: any) => Math.max(600, 2200 - d.coverage * 260)}
        arcsData={arcs}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcStartLat={(d: any) => d.startLat}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcStartLng={(d: any) => d.startLng}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcEndLat={(d: any) => d.endLat}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arcEndLng={(d: any) => d.endLng}
        arcColor={() => ["rgba(139,155,255,0.1)", "rgba(199,184,255,0.95)"]}
        arcDashLength={0.4}
        arcDashGap={0.25}
        arcDashAnimateTime={1500}
        arcStroke={0.6}
      />
    </div>
  );
}
