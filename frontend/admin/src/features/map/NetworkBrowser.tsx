import { useEffect, useMemo, useState } from "react";
import type { Building, Pathway, RouteNode } from "../../types";

export type NetworkBrowserSelection = { type: "pathway" | "node"; id: string } | null;

type NetworkBrowserProps = {
  pathways: readonly Pathway[];
  nodes: readonly RouteNode[];
  buildings: readonly Building[];
  selected: NetworkBrowserSelection;
  onSelect: (selection: NonNullable<NetworkBrowserSelection>) => void;
  onDismiss: () => void;
  onImportWalkingNetwork?: () => void;
  className?: string;
};

const uniqueValues = (values: readonly string[]) => [...new Set(values.filter(Boolean))].sort();
const pathwayFilterOptions = {
  status: ["Active", "Closed"],
  type: ["Walkway", "Road"],
  direction: ["Two-way", "One-way"],
  shade: ["Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded", "Unknown"],
} as const;
const knownAndObservedValues = (known: readonly string[], observed: readonly string[]) => [
  ...known,
  ...uniqueValues(observed.filter((value) => !known.includes(value))),
];
const nodeStatus = (node: RouteNode) => node.status ?? "Active";

export function NetworkBrowser({ pathways, nodes, buildings, selected, onSelect, onDismiss, onImportWalkingNetwork, className = "" }: NetworkBrowserProps) {
  const [tab, setTab] = useState<"pathways" | "nodes">("pathways");
  const [query, setQuery] = useState("");
  const [pathStatus, setPathStatus] = useState("all");
  const [pathType, setPathType] = useState("all");
  const [pathDirection, setPathDirection] = useState("all");
  const [pathShade, setPathShade] = useState("all");
  const [nodeStatusFilter, setNodeStatusFilter] = useState("all");
  const [nodeType, setNodeType] = useState("all");
  const [buildingId, setBuildingId] = useState("all");

  useEffect(() => {
    if (selected?.type === "pathway") setTab("pathways");
    if (selected?.type === "node") setTab("nodes");
  }, [selected]);

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const buildingById = useMemo(() => new Map(buildings.map((building) => [building.id, building])), [buildings]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPathways = useMemo(() => pathways.filter((pathway) => {
    const endpoints = [nodeById.get(pathway.sourceNodeId)?.name, nodeById.get(pathway.destinationNodeId)?.name].filter(Boolean).join(" ");
    const matchesQuery = !normalizedQuery || `${pathway.id} ${pathway.name} ${endpoints}`.toLowerCase().includes(normalizedQuery);
    return matchesQuery
      && (pathStatus === "all" || pathway.status === pathStatus)
      && (pathType === "all" || pathway.type === pathType)
      && (pathDirection === "all" || pathway.direction === pathDirection)
      && (pathShade === "all" || pathway.shade === pathShade);
  }), [nodeById, normalizedQuery, pathDirection, pathShade, pathStatus, pathType, pathways]);
  const filteredNodes = useMemo(() => nodes.filter((node) => {
    const building = node.associatedPlaceId ? buildingById.get(node.associatedPlaceId) : undefined;
    const matchesQuery = !normalizedQuery || `${node.id} ${node.name} ${node.nodeType} ${building?.name ?? ""} ${building?.code ?? ""}`.toLowerCase().includes(normalizedQuery);
    const association = node.associatedPlaceId ?? "unassociated";
    return matchesQuery
      && (nodeStatusFilter === "all" || nodeStatus(node) === nodeStatusFilter)
      && (nodeType === "all" || node.nodeType === nodeType)
      && (buildingId === "all" || association === buildingId);
  }), [buildingById, buildingId, nodeStatusFilter, nodeType, nodes, normalizedQuery]);

  return <aside className={`absolute left-4 top-4 bottom-4 z-[1000] flex w-[min(22rem,calc(100%-2rem))] flex-col overflow-hidden rounded-[22px] border border-white/70 bg-white/85 shadow-2xl backdrop-blur-xl ${className}`} aria-label="Walking Network browser">
    <div className="flex items-start justify-between border-b border-[#dbe6df] px-4 pb-3 pt-4">
      <div><p className="text-[10px] font-extrabold tracking-[0.14em] text-[#426257]">WALKING NETWORK</p><h2 className="text-sm font-extrabold text-[#191c1d]">Browse walking network</h2></div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss Walking Network browser" className="rounded-lg px-2 py-1 text-lg leading-none text-[#365047] outline-none hover:bg-[#edf3ef] focus-visible:ring-2 focus-visible:ring-[#005931]">×</button>
    </div>
    <div role="tablist" aria-label="Walking Network entities" className="m-3 grid grid-cols-2 rounded-xl bg-[#edf3ef] p-1">
      <button type="button" role="tab" aria-selected={tab === "pathways"} onClick={() => setTab("pathways")} className={`rounded-lg px-2 py-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#005931] ${tab === "pathways" ? "bg-white text-[#005931] shadow-sm" : "text-[#52655c]"}`}>Pathways</button>
      <button type="button" role="tab" aria-selected={tab === "nodes"} onClick={() => setTab("nodes")} className={`rounded-lg px-2 py-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#005931] ${tab === "nodes" ? "bg-white text-[#005931] shadow-sm" : "text-[#52655c]"}`}>Route Nodes</button>
    </div>
    <div className="space-y-2 border-b border-[#dbe6df] px-3 pb-3">
      <label className="sr-only" htmlFor="network-browser-search">Search {tab === "pathways" ? "Pathways" : "Route Nodes"}</label>
      <input id="network-browser-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "pathways" ? "Search Pathways" : "Search Route Nodes"} className="w-full rounded-xl border border-[#cbd9d1] bg-white/90 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#005931]" />
      {tab === "pathways" && onImportWalkingNetwork && <button type="button" onClick={onImportWalkingNetwork} className="w-full rounded-xl border border-[#005931] bg-[#005931] px-3 py-2 text-left text-xs font-extrabold text-white outline-none hover:bg-[#004727] focus-visible:ring-2 focus-visible:ring-[#005931]">Import Walking Network</button>}
      {tab === "pathways" ? <div className="grid grid-cols-2 gap-2">
        <Filter label="Status" value={pathStatus} onChange={setPathStatus} values={knownAndObservedValues(pathwayFilterOptions.status, pathways.map((pathway) => pathway.status))} />
        <Filter label="Type" value={pathType} onChange={setPathType} values={knownAndObservedValues(pathwayFilterOptions.type, pathways.map((pathway) => pathway.type))} />
        <Filter label="Direction" value={pathDirection} onChange={setPathDirection} values={knownAndObservedValues(pathwayFilterOptions.direction, pathways.map((pathway) => pathway.direction))} />
        <Filter label="Shade" value={pathShade} onChange={setPathShade} values={knownAndObservedValues(pathwayFilterOptions.shade, pathways.map((pathway) => pathway.shade))} />
      </div> : <div className="grid grid-cols-2 gap-2">
        <Filter label="Filter Route Nodes by lifecycle status" value={nodeStatusFilter} onChange={setNodeStatusFilter} values={uniqueValues(nodes.map(nodeStatus))} />
        <Filter label="Filter Route Nodes by type" value={nodeType} onChange={setNodeType} values={uniqueValues(nodes.map((node) => node.nodeType))} />
        <Filter label="Filter Route Nodes by Building" value={buildingId} onChange={setBuildingId} values={["unassociated", ...buildings.map((building) => building.id), ...nodes.flatMap((node) => node.associatedPlaceId ? [node.associatedPlaceId] : [])]} names={Object.fromEntries([...buildings.map((building) => [building.id, `${building.name}${building.code ? ` (${building.code})` : ""}`]), ...nodes.flatMap((node) => node.associatedPlaceId && !buildingById.has(node.associatedPlaceId) ? [[node.associatedPlaceId, `Building ${node.associatedPlaceId}`]] : [])])} />
      </div>}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p role="status" aria-label={`${tab === "pathways" ? "Pathway" : "Route Node"} results`} className="mb-2 text-[11px] font-bold text-[#52655c]">{tab === "pathways" ? `${filteredPathways.length} Pathway${filteredPathways.length === 1 ? "" : "s"}` : `${filteredNodes.length} Route Node${filteredNodes.length === 1 ? "" : "s"}`}</p>
      <div className="space-y-1.5">
        {tab === "pathways" ? filteredPathways.map((pathway) => <button key={pathway.id} type="button" aria-pressed={selected?.type === "pathway" && selected.id === pathway.id} onClick={() => onSelect({ type: "pathway", id: pathway.id })} className="w-full rounded-xl border border-transparent bg-white/75 p-3 text-left outline-none hover:border-[#9fc7b1] hover:bg-white focus-visible:ring-2 focus-visible:ring-[#005931] aria-pressed:border-[#005931] aria-pressed:bg-[#e7f3eb]"><strong className="block text-xs text-[#191c1d]">{pathway.name}</strong><span className="mt-1 block text-[11px] text-[#52655c]">{pathway.status} · {pathway.type} · {pathway.direction} · {pathway.shade} · {pathway.distance}</span></button>) : filteredNodes.map((node) => <button key={node.id} type="button" aria-pressed={selected?.type === "node" && selected.id === node.id} onClick={() => onSelect({ type: "node", id: node.id })} className="w-full rounded-xl border border-transparent bg-white/75 p-3 text-left outline-none hover:border-[#9fc7b1] hover:bg-white focus-visible:ring-2 focus-visible:ring-[#005931] aria-pressed:border-[#005931] aria-pressed:bg-[#e7f3eb]"><strong className="block text-xs text-[#191c1d]">{node.name}</strong><span className="mt-1 block text-[11px] text-[#52655c]">{nodeStatus(node)} · {node.nodeType} · {node.associatedPlaceId ? buildingById.get(node.associatedPlaceId)?.name ?? "Building association" : "No Building association"}</span></button>)}
      </div>
    </div>
  </aside>;
}

function Filter({ label, value, onChange, values, names = {} }: { label: string; value: string; onChange: (value: string) => void; values: readonly string[]; names?: Record<string, string> }) {
  return <label className="grid min-w-0 gap-1 text-[10px] font-bold text-[#52655c]">{label}<select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-[#cbd9d1] bg-white px-2 py-1.5 text-[11px] font-normal text-[#191c1d] outline-none focus:ring-2 focus:ring-[#005931]"><option value="all">All</option>{uniqueValues(values).map((item) => <option key={item} value={item}>{names[item] ?? item}</option>)}</select></label>;
}
