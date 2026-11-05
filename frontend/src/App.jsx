import React, { useState, useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import * as THREE from "three";
import gsap from "gsap";
import * as d3 from "d3";
import DeckGL from "@deck.gl/react";
import { PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";

const GLOBE_RADIUS = 5;

// Helper: Convert GPS coordinates to 3D Cartesian vectors
function latLngToVector3(lat, lng, radius = GLOBE_RADIUS) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

// Global 3D Space View with Density Heatmap Halo Toggle
function SurveillanceGlobe({ outbreaks, focusedOutbreak, onSelectOutbreak, setTopologyReady, heatmapMode }) {
  const { camera } = useThree();
  const controlsRef = useRef();

  useEffect(() => {
    if (focusedOutbreak && controlsRef.current) {
      setTopologyReady(false);
      const targetPos = latLngToVector3(focusedOutbreak.latitude, focusedOutbreak.longitude, GLOBE_RADIUS + 2.2);
      const surfacePos = latLngToVector3(focusedOutbreak.latitude, focusedOutbreak.longitude, GLOBE_RADIUS);
      
      gsap.to(camera.position, { x: targetPos.x, y: targetPos.y, z: targetPos.z, duration: 2.2, ease: "power3.inOut" });
      gsap.to(controlsRef.current.target, {
        x: surfacePos.x, y: surfacePos.y, z: surfacePos.z, duration: 2.2, ease: "power3.inOut",
        onUpdate: () => controlsRef.current.update(),
        onComplete: () => setTopologyReady(true)
      });
    }
  }, [focusedOutbreak, camera, setTopologyReady]);

  return (
    <>
      <OrbitControls ref={controlsRef} enablePan={false} minDistance={5.8} maxDistance={18} />
      <ambientLight intensity={0.4} />
      <pointLight position={[15, 15, 15]} intensity={1.5} color="#dc143c" />
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <meshStandardMaterial color="#090a0f" roughness={0.7} metalness={0.3} />
      </mesh>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS + 0.02, 36, 36]} />
        <meshBasicMaterial color="#dc143c" wireframe transparent opacity={0.18} />
      </mesh>
      {outbreaks.map((item, idx) => {
        const pos = latLngToVector3(item.latitude, item.longitude, GLOBE_RADIUS + 0.08);
        return (
          <group key={item.id || idx} position={pos} onClick={() => onSelectOutbreak(item)}>
            <mesh>
              <sphereGeometry args={[0.14, 16, 16]} />
              <meshBasicMaterial color="#ff003c" />
            </mesh>
            {heatmapMode && (
              <mesh>
                <sphereGeometry args={[0.55, 16, 16]} />
                <meshBasicMaterial color="#dc143c" transparent opacity={0.25} />
              </mesh>
            )}
          </group>
        );
      })}
    </>
  );
}

// Localized Deck.gl OpenStreetMap Topological Layer + Dynamic PostGIS Buffer Ring
function HospitalTopologyLayer({ outbreak, isReady, dynamicRadiusMeters }) {
  const [buildings, setBuildings] = useState([]);
  const [loadingMap, setLoadingMap] = useState(false);
  const [statusLabel, setStatusLabel] = useState("");

  useEffect(() => {
    if (!outbreak || !isReady) return;
    let isActive = true;
    setLoadingMap(true);

    const lat = parseFloat(outbreak.latitude);
    const lng = parseFloat(outbreak.longitude);

    const generateCampusFallback = (centerLat, centerLng) => {
      const campus = [];
      const offsets = [-0.0012, 0, 0.0012];
      offsets.forEach((dLat, i) => {
        offsets.forEach((dLng, j) => {
          if (i === 0 && j === 2) return;
          const w = 0.00045;
          const h = 0.00045;
          const bLat = centerLat + dLat;
          const bLng = centerLng + dLng;
          const isCenter = (i === 1 && j === 1);
          const height = isCenter ? 65 : (20 + (i * 7 + j * 11) % 25);

          campus.push({
            polygon: [
              [bLng - w, bLat - h],
              [bLng + w, bLat - h],
              [bLng + w, bLat + h],
              [bLng - w, bLat + h],
              [bLng - w, bLat - h]
            ],
            height: height
          });
        });
      });
      return campus;
    };

    const fetchOSMBuildings = async () => {
      const query = `[out:json][timeout:5];(way["building"](around:400,${lat},${lng}););out geom;`;
      const endpoints = [
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`
      ];

      let fetchedPolygons = [];

      for (const url of endpoints) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3500);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            if (data.elements && data.elements.length > 0) {
              data.elements.forEach(el => {
                if (el.geometry && el.geometry.length > 2) {
                  const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
                  const height = el.tags && el.tags.height ? parseFloat(el.tags.height) : (18 + Math.random() * 45);
                  fetchedPolygons.push({ polygon: coords, height });
                }
              });
            }
          }
          if (fetchedPolygons.length > 0) break;
        } catch {
          // Fall through to next endpoint or fallback
        }
      }

      if (!isActive) return;

      if (fetchedPolygons.length > 0) {
        setBuildings(fetchedPolygons);
        setStatusLabel(`REAL-WORLD GEOMETRY ACQUIRED // ${fetchedPolygons.length} BUILDINGS EXTRUDED`);
      } else {
        setBuildings(generateCampusFallback(lat, lng));
        setStatusLabel("TACTICAL CAMPUS MATRIX // 8 COMPLEX STRUCTURES EXTRUDED");
      }
      setLoadingMap(false);
    };

    fetchOSMBuildings();
    return () => { isActive = false; };
  }, [outbreak, isReady]);

  if (!outbreak || !isReady) return null;

  const buildingLayer = new PolygonLayer({
    id: 'osm-hospital-floorplan',
    data: buildings,
    pickable: true,
    stroked: true,
    filled: true,
    extruded: true,
    wireframe: true,
    getPolygon: d => d.polygon,
    getElevation: d => d.height,
    getFillColor: [220, 20, 60, 45],
    getLineColor: [255, 30, 70, 255],
    getLineWidth: 2,
  });

  const activeRadius = dynamicRadiusMeters || 500;
  const radiusLayer = new ScatterplotLayer({
    id: 'quarantine-radius-ring',
    data: [{ position: [parseFloat(outbreak.longitude), parseFloat(outbreak.latitude)] }],
    getPosition: d => d.position,
    getRadius: activeRadius,
    getFillColor: [220, 20, 60, 20],
    getLineColor: [255, 0, 60, 230],
    lineWidthMinPixels: 2,
    stroked: true,
    filled: true,
  });

  const initialViewState = {
    longitude: parseFloat(outbreak.longitude),
    latitude: parseFloat(outbreak.latitude),
    zoom: 15.8,
    pitch: 58,
    bearing: -25
  };

  return (
    <div className="absolute inset-0 z-30 pointer-events-none transition-opacity duration-1000 ease-in-out opacity-100">
      <DeckGL
        initialViewState={initialViewState}
        controller={true}
        layers={[buildingLayer, radiusLayer]}
        style={{ pointerEvents: 'auto', background: 'radial-gradient(circle, rgba(4,5,8,0.85) 0%, rgba(4,5,8,1) 100%)' }}
      />
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 mt-20 text-center pointer-events-none z-50">
         <div className="bg-[#dc143c]/20 text-[#dc143c] text-xs px-3 py-1 font-mono border border-[#dc143c]/50 backdrop-blur-md mb-2 shadow-[0_0_15px_rgba(220,20,60,0.3)]">
           TOPOLOGICAL ISOLATION: {outbreak.hospital_or_site}
         </div>
         {loadingMap ? (
           <div className="text-[10px] text-[#dc143c] font-bold animate-pulse tracking-widest uppercase">Fetching OSM Building Geometry...</div>
         ) : (
           <div className="text-[10px] text-gray-400 tracking-widest uppercase font-mono">{statusLabel}</div>
         )}
      </div>
    </div>
  );
}

// Option 3: D3 AMR Phylogenetic Mutation Lineage Tree Component
function PhylogeneticTreeWidget({ geneName }) {
  const svgRef = useRef();
  const [treeData, setTreeData] = useState(null);

  useEffect(() => {
    if (!geneName) return;
    const fetchTree = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/phylogeny/${encodeURIComponent(geneName)}`);
        if (res.ok) {
          const data = await res.json();
          setTreeData(data);
        }
      } catch (e) {
        console.error("Phylogeny fetch error:", e);
      }
    };
    fetchTree();
  }, [geneName]);

  useEffect(() => {
    if (!treeData) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 270;
    const height = 150;
    const margin = { top: 15, right: 40, bottom: 15, left: 40 };

    const root = d3.hierarchy(treeData);
    const treeLayout = d3.tree().size([height - margin.top - margin.bottom, width - margin.left - margin.right]);
    treeLayout(root);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    // Links / Branches
    g.selectAll(".link")
      .data(root.links())
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", d => d.target.data.highlight ? "#dc143c" : "#4b5563")
      .attr("stroke-width", d => d.target.data.highlight ? 2 : 1)
      .attr("d", d3.linkHorizontal().x(d => d.y).y(d => d.x));

    // Nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .enter()
      .append("g")
      .attr("transform", d => `translate(${d.y},${d.x})`);

    node.append("circle")
      .attr("r", d => d.data.highlight ? 4.5 : 3)
      .attr("fill", d => d.data.highlight ? "#dc143c" : "#9ca3af")
      .attr("stroke", d => d.data.highlight ? "#ffffff" : "#1f2937")
      .attr("stroke-width", 1.5);

    node.append("text")
      .attr("dy", "0.31em")
      .attr("x", d => d.children ? -8 : 8)
      .attr("text-anchor", d => d.children ? "end" : "start")
      .text(d => d.data.name)
      .attr("fill", d => d.data.highlight ? "#dc143c" : "#d1d5db")
      .style("font-size", "9px")
      .style("font-weight", d => d.data.highlight ? "bold" : "normal");

  }, [treeData]);

  if (!geneName) return null;

  return (
    <div className="w-full p-4 rounded-xl backdrop-blur-md bg-stone-900/80 border border-[#dc143c]/40 shadow-2xl space-y-2 text-xs">
      <div className="flex justify-between items-center border-b border-stone-800 pb-2">
        <h3 className="text-[#dc143c] font-bold uppercase tracking-widest text-[11px]">AMR Mutation Lineage</h3>
        <span className="text-[9px] font-mono text-gray-400">D3 CLADE TREE</span>
      </div>
      <svg ref={svgRef} width={270} height={150} />
    </div>
  );
}

// D3 Real-Time SEIR Transmission Projection Chart Widget
function SEIREpidemiologicalChart({ focusedOutbreak }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!focusedOutbreak || !focusedOutbreak.seir) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const data = focusedOutbreak.seir.projection;
    const margin = { top: 10, right: 15, bottom: 25, left: 35 };
    const width = 280 - margin.left - margin.right;
    const height = 110 - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([1, 14]).range([0, width]);
    const maxVal = d3.max(data, d => Math.max(d.infectious, d.exposed));
    const y = d3.scaleLinear().domain([0, maxVal * 1.15]).range([height, 0]);

    const lineI = d3.line().x(d => x(d.day)).y(d => y(d.infectious)).curve(d3.curveMonotoneX);
    const lineE = d3.line().x(d => x(d.day)).y(d => y(d.exposed)).curve(d3.curveMonotoneX);

    g.append("path").datum(data).attr("fill", "none").attr("stroke", "#eab308").attr("stroke-width", 1.8).attr("stroke-dasharray", "4,4").attr("d", lineE);
    g.append("path").datum(data).attr("fill", "none").attr("stroke", "#dc143c").attr("stroke-width", 2.5).attr("d", lineI);

    g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(7)).attr("color", "#6b7280").style("font-size", "9px");
    g.append("g").call(d3.axisLeft(y).ticks(4)).attr("color", "#6b7280").style("font-size", "9px");
  }, [focusedOutbreak]);

  if (!focusedOutbreak || !focusedOutbreak.seir) return null;

  const { r0 } = focusedOutbreak.seir;

  return (
    <div className="w-full p-4 rounded-xl backdrop-blur-md bg-stone-900/80 border border-[#dc143c]/40 shadow-2xl">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[#dc143c]">SEIR Transmission (14D)</h3>
        <span className="text-[10px] font-mono font-bold bg-[#dc143c]/20 text-[#dc143c] px-2 py-0.5 rounded border border-[#dc143c]/40">
          R0 = {r0}
        </span>
      </div>
      <svg ref={svgRef} width={270} height={110} />
      <div className="flex justify-around items-center mt-2 border-t border-stone-800 pt-2 text-[10px]">
        <span className="flex items-center text-yellow-500"><span className="h-1.5 w-1.5 rounded-full bg-yellow-500 mr-1.5"></span>Exposed</span>
        <span className="flex items-center text-[#dc143c]"><span className="h-1.5 w-1.5 rounded-full bg-[#dc143c] mr-1.5"></span>Infectious</span>
      </div>
    </div>
  );
}

// Containment & Clinical Strain Dashboard Widget
function ContainmentDashboard({ focusedOutbreak, onRadiusChange }) {
  const [lockdown, setLockdown] = useState(0.0);
  const [icuBeds, setIcuBeds] = useState(120);
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    if (!focusedOutbreak || !focusedOutbreak.seir) return;
    const r0 = focusedOutbreak.seir.r0;
    const peakInfected = Math.max(...focusedOutbreak.seir.projection.map(d => d.infectious));

    const fetchSimulation = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/containment/simulate?r0=${r0}&peak_infected=${peakInfected}&total_icu_beds=${icuBeds}&lockdown_factor=${lockdown}`);
        if (res.ok) {
          const data = await res.json();
          setMetrics(data);
          if (onRadiusChange) {
            onRadiusChange(data.recommended_quarantine_radius_m);
          }
        }
      } catch (err) {
        console.error("Containment Simulation Error:", err);
      }
    };

    fetchSimulation();
  }, [focusedOutbreak, lockdown, icuBeds, onRadiusChange]);

  if (!focusedOutbreak || !metrics) return null;

  return (
    <div className="w-full p-4 rounded-xl backdrop-blur-md bg-stone-900/80 border border-[#dc143c]/50 shadow-2xl space-y-3 text-xs">
      <div className="flex justify-between items-center border-b border-[#dc143c]/30 pb-2">
        <h3 className="text-[#dc143c] font-bold uppercase tracking-widest">Containment Protocol</h3>
        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${
          metrics.risk_level.includes("CRITICAL") ? "bg-red-950 text-red-500 border-red-700 animate-pulse" : "bg-emerald-950 text-emerald-400 border-emerald-700"
        }`}>
          {metrics.risk_level}
        </span>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-gray-400 mb-1">
            <span>Lockdown Intervention</span>
            <span className="font-mono text-white font-bold">{Math.round(lockdown * 100)}%</span>
          </div>
          <input 
            type="range" min="0" max="0.8" step="0.05" 
            value={lockdown} 
            onChange={e => setLockdown(parseFloat(e.target.value))}
            className="w-full accent-[#dc143c] bg-stone-800 rounded h-1 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-gray-400 mb-1">
            <span>Available Regional ICU Beds</span>
            <span className="font-mono text-white font-bold">{icuBeds}</span>
          </div>
          <input 
            type="range" min="30" max="300" step="10" 
            value={icuBeds} 
            onChange={e => setIcuBeds(parseInt(e.target.value))}
            className="w-full accent-[#dc143c] bg-stone-800 rounded h-1 cursor-pointer"
          />
        </div>
      </div>

      <div className="space-y-2 pt-1 border-t border-stone-800">
        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-gray-300">ICU Saturation ({metrics.icu_demand} / {metrics.total_icu_beds})</span>
            <span className="font-mono font-bold text-gray-200">{metrics.icu_saturation_pct}%</span>
          </div>
          <div className="w-full bg-stone-950 h-2 rounded-full overflow-hidden border border-stone-800">
            <div 
              className={`h-full transition-all duration-500 ${metrics.icu_saturation_pct > 90 ? 'bg-[#dc143c]' : 'bg-yellow-500'}`} 
              style={{ width: `${Math.min(100, metrics.icu_saturation_pct)}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-gray-300">Ventilator Saturation ({metrics.ventilator_demand} / {metrics.total_ventilators})</span>
            <span className="font-mono font-bold text-gray-200">{metrics.ventilator_saturation_pct}%</span>
          </div>
          <div className="w-full bg-stone-950 h-2 rounded-full overflow-hidden border border-stone-800">
            <div 
              className="h-full bg-cyan-500 transition-all duration-500" 
              style={{ width: `${Math.min(100, metrics.ventilator_saturation_pct)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center border-t border-stone-800 pt-2 text-[10px] text-gray-400 font-mono">
        <span>Effective R<sub>e</sub>: <strong className="text-white">{metrics.effective_r0}</strong></span>
        <span>Perimeter: <strong className="text-[#dc143c]">{metrics.recommended_quarantine_radius_m}m</strong></span>
      </div>
    </div>
  );
}

// WHO / CDC Diagnostic Report Exporter Widget Component
function ReportExporterWidget({ outbreakId }) {
  const downloadReport = async (endpoint, filename) => {
    try {
      const res = await fetch(`http://localhost:8000/api/reports/${endpoint}?outbreak_id=${outbreakId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    } catch {
      alert("Error generating report export.");
    }
  };

  return (
    <div className="w-full p-4 rounded-xl backdrop-blur-md bg-stone-900/80 border border-[#dc143c]/40 shadow-2xl space-y-2 text-xs">
      <h3 className="text-[#dc143c] font-bold uppercase tracking-widest text-[11px]">WHO / CDC Report Exporter</h3>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button 
          onClick={() => downloadReport("export-geojson", `WHO_AMR_Spatial_${outbreakId}.geojson`)}
          className="px-2.5 py-2 bg-stone-800 hover:bg-stone-700 border border-[#dc143c]/40 text-[#dc143c] rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
        >
          Download GeoJSON
        </button>
        <button 
          onClick={() => downloadReport("export-dossier", `Clinical_Dossier_${outbreakId}.json`)}
          className="px-2.5 py-2 bg-[#dc143c] hover:bg-red-700 text-white rounded text-[10px] font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(220,20,60,0.3)] transition-colors"
        >
          Export Clinical Dossier
        </button>
      </div>
    </div>
  );
}

// Option 2: Alert Webhook Configuration Modal
function AlertConfigModal({ isOpen, onClose }) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [r0Thresh, setR0Thresh] = useState(2.5);
  const [icuThresh, setIcuThresh] = useState(80.0);
  const [testStatus, setTestStatus] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const fetchConfig = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/alerts/config");
        if (res.ok) {
          const data = await res.json();
          setWebhookUrl(data.webhook_url || "");
          setR0Thresh(data.r0_threshold || 2.5);
          setIcuThresh(data.icu_threshold_pct || 80.0);
        }
      } catch (e) {
        console.error("Config fetch error:", e);
      }
    };
    fetchConfig();
  }, [isOpen]);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("http://localhost:8000/api/alerts/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhook_url: webhookUrl,
          r0_threshold: parseFloat(r0Thresh),
          icu_threshold_pct: parseFloat(icuThresh),
          auto_alert_enabled: true
        })
      });
      if (res.ok) {
        setTestStatus("Configuration saved successfully.");
        setTimeout(() => { setTestStatus(""); onClose(); }, 1500);
      }
    } catch {
      setTestStatus("Error saving configuration.");
    }
  };

  const handleTestAlert = async () => {
    setTestStatus("Sending test alert payload...");
    try {
      const res = await fetch(`http://localhost:8000/api/alerts/test?webhook_url=${encodeURIComponent(webhookUrl)}`, { method: "POST" });
      if (res.ok) {
        setTestStatus("Test Alert Dispatched Successfully!");
      } else {
        setTestStatus("Dispatch failed. Check URL.");
      }
    } catch {
      setTestStatus("Network Error dispatching test alert.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-50">
      <form onSubmit={handleSave} className="bg-stone-900 border border-[#dc143c]/50 p-6 rounded-xl w-[440px] space-y-4 shadow-[0_0_40px_rgba(220,20,60,0.2)] text-xs">
        <h2 className="text-sm font-bold text-[#dc143c] uppercase tracking-widest border-b border-stone-800 pb-2">
          Automated Emergency Alert Webhook Engine
        </h2>
        
        <div>
          <label className="block text-gray-400 mb-1 font-mono">Slack / Discord / Custom Webhook URL</label>
          <input 
            type="url" 
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full bg-black/50 border border-gray-700 rounded p-2.5 text-gray-200 font-mono text-xs focus:border-[#dc143c] outline-none"
            required 
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-gray-400 mb-1 font-mono">R0 Trigger Threshold</label>
            <input 
              type="number" step="0.1" 
              value={r0Thresh}
              onChange={e => setR0Thresh(e.target.value)}
              className="w-full bg-black/50 border border-gray-700 rounded p-2 text-gray-200 font-mono text-xs focus:border-[#dc143c] outline-none"
            />
          </div>
          <div>
            <label className="block text-gray-400 mb-1 font-mono">ICU Strain Trigger %</label>
            <input 
              type="number" step="1" 
              value={icuThresh}
              onChange={e => setIcuThresh(e.target.value)}
              className="w-full bg-black/50 border border-gray-700 rounded p-2 text-gray-200 font-mono text-xs focus:border-[#dc143c] outline-none"
            />
          </div>
        </div>

        {testStatus && <div className="text-[11px] text-[#dc143c] font-mono animate-pulse">{testStatus}</div>}

        <div className="flex justify-between items-center pt-2 border-t border-stone-800">
          <button type="button" onClick={handleTestAlert} className="px-3 py-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-gray-300 rounded font-bold uppercase tracking-wider text-[10px]">
            Test Dispatch
          </button>
          <div className="space-x-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-gray-400 font-bold text-[10px]">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-[#dc143c] hover:bg-red-700 text-white rounded font-bold uppercase tracking-wider text-[10px]">Save Config</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// Main Interface Component
export default function App() {
  const [outbreaks, setOutbreaks] = useState([]);
  const [focusedOutbreak, setFocusedOutbreak] = useState(null);
  const [topologyReady, setTopologyReady] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false); // Option 2 Alert Modal State
  const [heatmapMode, setHeatmapMode] = useState(false);
  const [showCommandBar, setShowCommandBar] = useState(false);
  const [nlQueryText, setNlQueryText] = useState("");
  const [nlQueryResult, setNlQueryResult] = useState(null);
  const [dynamicRadiusMeters, setDynamicRadiusMeters] = useState(500);
  const [formData, setFormData] = useState({ file: null, pathogen_name: "", site_name: "", latitude: "", longitude: "" });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandBar(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/outbreaks");
        if (res.ok) {
          const data = await res.json();
          setOutbreaks(data);
        }
      } catch (err) {
        console.error("Error loading historical telemetry:", err);
      }
    };
    fetchHistory();

    const ws = new WebSocket("ws://localhost:8000/ws/alerts");
    ws.onopen = () => setWsConnected(true);
    ws.onmessage = (event) => {
      const newAlert = JSON.parse(event.data);
      setOutbreaks(prev => {
        if (prev.some(item => item.id === newAlert.id)) return prev;
        return [newAlert, ...prev];
      });
      setFocusedOutbreak(newAlert);
    };
    ws.onclose = () => setWsConnected(false);
    return () => ws.close();
  }, []);

  const handleNLQuerySubmit = async (e) => {
    e.preventDefault();
    if (!nlQueryText.trim()) return;
    try {
      setStatusMsg("Executing PostGIS Natural Language Query...");
      const res = await fetch(`http://localhost:8000/api/outbreaks/nl-query?query=${encodeURIComponent(nlQueryText)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setNlQueryResult(data.parsed_query);
      if (data.results && data.results.length > 0) {
        setOutbreaks(data.results);
        setFocusedOutbreak(data.results[0]);
      } else {
        alert("No spatial records matched the query parameters.");
      }
      setShowCommandBar(false);
      setTimeout(() => setStatusMsg(""), 4000);
    } catch {
      setStatusMsg("NL Spatial Query Error");
      setTimeout(() => setStatusMsg(""), 4000);
    }
  };

  const handleRealUpload = async (e) => {
    e.preventDefault();
    if (!formData.file) return;
    setStatusMsg("Uploading sequence to alignment engine...");
    setShowUploadModal(false);

    const data = new FormData();
    Object.keys(formData).forEach(key => data.append(key, formData[key]));

    try {
      const res = await fetch("http://localhost:8000/api/upload-fasta", {
        method: "POST", headers: { Authorization: "Bearer aegis-admin-token" }, body: data,
      });
      if (!res.ok) throw new Error();
      setStatusMsg("Sequence queued for live CARD BLAST...");
      setTimeout(() => setStatusMsg(""), 4000);
    } catch {
      setStatusMsg("Pipeline Error. Ensure backend stack is healthy.");
      setTimeout(() => setStatusMsg(""), 4000);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-stone-950 text-white overflow-hidden font-sans">
      
      {/* Global Space View */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${topologyReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <Canvas camera={{ position: [0, 0, 14], fov: 45 }}>
          <Stars radius={100} depth={50} count={4000} factor={4} fade />
          <SurveillanceGlobe outbreaks={outbreaks} focusedOutbreak={focusedOutbreak} onSelectOutbreak={setFocusedOutbreak} setTopologyReady={setTopologyReady} heatmapMode={heatmapMode} />
        </Canvas>
      </div>

      {/* Local OSM Topological + Dynamic PostGIS Isolation View */}
      <HospitalTopologyLayer outbreak={focusedOutbreak} isReady={topologyReady} dynamicRadiusMeters={dynamicRadiusMeters} />

      {/* Glassmorphic UI Header */}
      <header className="absolute top-6 left-6 right-6 flex justify-between items-center pointer-events-none z-50">
        <div className="backdrop-blur-md bg-stone-900/60 border border-[#dc143c]/40 px-5 py-3 rounded-xl pointer-events-auto flex items-center space-x-3">
          <h1 className="text-xl font-bold tracking-wider text-[#dc143c]">AEGIS // MASTER SURVEILLANCE</h1>
          {nlQueryResult && (
            <span className="text-[10px] bg-[#dc143c]/20 text-[#dc143c] border border-[#dc143c]/40 px-2 py-1 rounded font-mono">
              FILTER: {nlQueryResult.detected_location} ({nlQueryResult.matched_count} MATCHED)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3 pointer-events-auto">
          {statusMsg && <span className="text-xs text-[#dc143c] bg-black/60 px-3 py-1.5 rounded-lg border border-[#dc143c]/30">{statusMsg}</span>}
          
          <button 
            onClick={() => setHeatmapMode(prev => !prev)} 
            className={`px-3 py-2.5 text-xs font-bold uppercase rounded-lg border transition-colors ${
              heatmapMode ? "bg-[#dc143c] text-white border-[#dc143c]" : "bg-stone-800 hover:bg-stone-700 text-gray-300 border-gray-700"
            }`}
          >
            {heatmapMode ? "Heatmap: ON" : "Heatmap: OFF"}
          </button>

          <button 
            onClick={() => setShowCommandBar(true)} 
            className="px-3.5 py-2.5 bg-stone-900 hover:bg-stone-800 text-xs font-mono font-bold text-gray-300 border border-[#dc143c]/40 rounded-lg flex items-center space-x-2"
          >
            <span>Query Engine</span>
            <kbd className="bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-[#dc143c]">Ctrl+K</kbd>
          </button>

          {/* Option 2: Alert Webhook Modal Trigger */}
          <button 
            onClick={() => setShowAlertModal(true)} 
            className="px-3 py-2.5 bg-stone-900 hover:bg-stone-800 border border-stone-700 text-xs font-bold uppercase rounded-lg text-gray-300"
          >
            Alert Hooks
          </button>

          {topologyReady && (
            <button onClick={() => { setFocusedOutbreak(null); setTopologyReady(false); }} className="px-4 py-2.5 bg-stone-800 hover:bg-stone-700 text-xs font-bold uppercase rounded-lg border border-gray-600">
              Return to Global
            </button>
          )}

          <button onClick={() => setShowUploadModal(true)} className="px-4 py-2.5 bg-[#dc143c] hover:bg-red-700 text-xs font-bold uppercase rounded-lg shadow-[0_0_15px_rgba(220,20,60,0.4)]">
            + Map Pathogen DNA
          </button>
        </div>
      </header>

      {/* Option 2: Alert Webhook Configuration Modal */}
      <AlertConfigModal isOpen={showAlertModal} onClose={() => setShowAlertModal(false)} />

      {/* Option 3: Natural Language Spatial Query Command Bar Modal */}
      {showCommandBar && (
        <div className="absolute inset-0 flex items-start justify-center pt-24 bg-black/75 backdrop-blur-md z-50">
          <div className="bg-stone-900 border border-[#dc143c]/60 p-5 rounded-xl w-[520px] shadow-[0_0_50px_rgba(220,20,60,0.25)] space-y-4">
            <div className="flex justify-between items-center border-b border-stone-800 pb-3">
              <h2 className="text-sm font-bold text-[#dc143c] uppercase tracking-widest flex items-center">
                <span className="h-2 w-2 rounded-full bg-[#dc143c] mr-2 animate-ping" />
                PostGIS Natural Language Spatial Engine
              </h2>
              <button onClick={() => setShowCommandBar(false)} className="text-xs text-gray-500 hover:text-white font-mono">ESC</button>
            </div>
            <form onSubmit={handleNLQuerySubmit} className="space-y-3">
              <input 
                type="text"
                value={nlQueryText}
                onChange={e => setNlQueryText(e.target.value)}
                placeholder="e.g. 'Show all NDM-1 outbreaks within 100km of Vadodara'"
                className="w-full bg-black/60 border border-gray-700 rounded-lg p-3 text-sm text-gray-100 focus:border-[#dc143c] outline-none font-mono"
                autoFocus
              />
              <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono">
                <span>Try: "NDM-1 in Vadodara", "MCR outbreaks within 50km of Delhi"</span>
                <button type="submit" className="px-4 py-2 bg-[#dc143c] hover:bg-red-700 text-white rounded font-bold uppercase tracking-wider">Execute Query</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-50">
          <form onSubmit={handleRealUpload} className="bg-stone-900 border border-[#dc143c]/50 p-6 rounded-xl w-96 space-y-4 shadow-[0_0_40px_rgba(220,20,60,0.15)]">
            <h2 className="text-lg font-bold text-[#dc143c] uppercase tracking-widest">Submit Sequence Data</h2>
            {["pathogen_name", "site_name"].map(field => (
              <div key={field}>
                <label className="block text-xs text-gray-400 mb-1 capitalize">{field.replace('_', ' ')}</label>
                <input type="text" onChange={e => setFormData({ ...formData, [field]: e.target.value })} className="w-full text-sm bg-black/50 border border-gray-700 rounded p-2 text-gray-200 focus:border-[#dc143c] outline-none" required />
              </div>
            ))}
            <div className="flex space-x-4">
              {["latitude", "longitude"].map(field => (
                <div key={field} className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1 capitalize">{field}</label>
                  <input type="number" step="any" onChange={e => setFormData({ ...formData, [field]: e.target.value })} className="w-full text-sm bg-black/50 border border-gray-700 rounded p-2 text-gray-200 focus:border-[#dc143c] outline-none" required />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Raw Sequence (.fasta)</label>
              <input type="file" accept=".fasta,.fa" onChange={e => setFormData({ ...formData, file: e.target.files[0] })} className="w-full text-sm bg-black/50 border border-gray-700 rounded p-2 text-gray-200" required />
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button type="button" onClick={() => setShowUploadModal(false)} className="px-4 py-2 text-xs font-bold text-gray-400">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-[#dc143c] text-xs font-bold uppercase rounded text-white">Run BLAST</button>
            </div>
          </form>
        </div>
      )}

      {/* Live Telemetry Left Sidebar */}
      <aside className="absolute top-28 left-6 bottom-6 w-80 backdrop-blur-md bg-stone-900/60 border border-[#dc143c]/30 rounded-xl p-4 flex flex-col z-40">
        <div className="flex items-center justify-between border-b border-[#dc143c]/20 pb-3 mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-300">Live Telemetry</span>
          <span className={`h-2.5 w-2.5 rounded-full ${wsConnected ? "bg-[#dc143c] animate-ping" : "bg-gray-700"}`} />
        </div>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {outbreaks.map((item, idx) => (
            <div key={item.id || idx} onClick={() => { setFocusedOutbreak(item); setTopologyReady(false); }} className="p-3 rounded-lg bg-stone-950/40 border border-[#dc143c]/30 cursor-pointer hover:border-[#dc143c] transition-colors">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-[#dc143c] px-2 py-0.5 rounded bg-[#dc143c]/10 border border-[#dc143c]/40">{item.amr_gene}</span>
                <span className="text-[11px] text-gray-400">E-val: {item.e_value ? item.e_value.toExponential(1) : "N/A"}</span>
              </div>
              <p className="text-sm font-medium mt-1.5 italic text-gray-100">{item.pathogen_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{item.hospital_or_site}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Unified Non-Overlapping Right Column Container */}
      {focusedOutbreak && (
        <aside className="absolute top-28 right-6 bottom-6 w-80 overflow-y-auto space-y-3 pr-1 flex flex-col z-40">
          
          {/* Alignment Details Panel */}
          <div className="w-full p-4 rounded-xl backdrop-blur-md bg-stone-900/80 border border-[#dc143c]/60 shadow-[0_0_30px_rgba(220,20,60,0.2)] text-xs space-y-3">
            <div className="flex items-center justify-between border-b border-[#dc143c]/30 pb-2">
              <h3 className="text-[#dc143c] font-bold uppercase tracking-widest">Alignment Result</h3>
              <span className="text-[9px] bg-[#dc143c]/20 text-[#dc143c] px-2 py-0.5 rounded font-bold tracking-wider animate-pulse">MATCH LOCKED</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center"><span className="text-gray-400 uppercase">Target Gene</span> <span className="font-mono text-[#dc143c] font-bold">{focusedOutbreak.amr_gene}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 uppercase">Pathogen</span> <span className="italic text-gray-100">{focusedOutbreak.pathogen_name}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 uppercase">E-Value</span> <span className="font-mono text-gray-200">{focusedOutbreak.e_value ? focusedOutbreak.e_value.toExponential(2) : "0.00"}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 uppercase">Bit Score</span> <span className="font-mono text-gray-200">{focusedOutbreak.bit_score}</span></div>
              <div className="flex justify-between items-center border-t border-stone-800 pt-2"><span className="text-gray-400 uppercase">Location</span> <span className="text-gray-200 text-right text-xs w-32 truncate" title={focusedOutbreak.hospital_or_site}>{focusedOutbreak.hospital_or_site}</span></div>
              <div className="flex justify-between items-center"><span className="text-gray-400 uppercase">Coordinates</span> <span className="font-mono text-gray-200">{Number(focusedOutbreak.latitude).toFixed(4)}°, {Number(focusedOutbreak.longitude).toFixed(4)}°</span></div>
            </div>
          </div>

          {/* Option 3: D3 AMR Phylogenetic Mutation Lineage Widget */}
          <PhylogeneticTreeWidget geneName={focusedOutbreak.amr_gene} />

          {/* Containment Protocol Widget */}
          <ContainmentDashboard focusedOutbreak={focusedOutbreak} onRadiusChange={setDynamicRadiusMeters} />

          {/* SEIR Transmission Projection Widget */}
          <SEIREpidemiologicalChart focusedOutbreak={focusedOutbreak} />

          {/* WHO / CDC Report Exporter Widget */}
          <ReportExporterWidget outbreakId={focusedOutbreak.id} />
        </aside>
      )}

    </div>
  );
}