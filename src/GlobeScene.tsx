import { useEffect, useRef, useState } from "react";
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

// Photoreal globe. When `interactive`, whole regions become clickable, hover-
// highlighting polygons; pulsing rings encode node density; otherwise it slowly
// auto-rotates as a background. `arcs` draws animated deployment beams.
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

  // Cinematic camera: glide in when the picker becomes interactive.
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
  const polygons = interactive ? features : [];

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Globe
        ref={globeRef}
        width={dims.w}
        height={dims.h}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        showAtmosphere
        atmosphereColor="#8b9bff"
        atmosphereAltitude={0.2}
        polygonsData={polygons}
        polygonAltitude={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          if (reg === hovered) return 0.09;
          if (selected.includes(reg)) return 0.06;
          return 0.008;
        }}
        polygonCapColor={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          if (selected.includes(reg)) return "rgba(124,73,183,0.6)";
          if (reg === hovered) return "rgba(255,255,255,0.35)";
          return "rgba(139,155,255,0.05)";
        }}
        polygonSideColor={() => "rgba(124,73,183,0.18)"}
        polygonStrokeColor={(f: object) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reg = (f as any).__region;
          return selected.includes(reg) || reg === hovered
            ? "rgba(255,255,255,0.7)"
            : "rgba(255,255,255,0.12)";
        }}
        polygonsTransitionDuration={250}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPolygonHover={(f: any) => {
          setHovered(f ? f.__region : null);
          if (wrapRef.current)
            wrapRef.current.style.cursor = f ? "pointer" : "grab";
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onPolygonClick={(f: any) => f && onToggle?.(f.__region)}
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
