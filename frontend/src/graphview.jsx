import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";

// nodes: [{id,label,color,size,shape}], edges: [{source,target,w}]. `sig` changes => re-render graph.
export default function GraphView({ nodes, edges, sig, height = 340, onTap }) {
  const box = useRef();
  useEffect(() => {
    if (!box.current) return;
    const cy = cytoscape({ container: box.current, wheelSensitivity: 0.3,
      elements: [...nodes.map((n) => ({ data: n })), ...edges.map((e, i) => ({ data: { id: "e" + i, ...e } }))],
      style: [{ selector: "node", style: { width: "data(size)", height: "data(size)", "background-color": "data(color)", shape: "data(shape)", label: "data(label)", color: "#94a3b8", "font-size": 8, "text-valign": "bottom", "text-margin-y": 3 } },
        { selector: "edge", style: { width: "data(w)", "line-color": "#2b4474", "target-arrow-color": "#2b4474", "target-arrow-shape": "triangle", "curve-style": "bezier", "arrow-scale": 0.7 } }],
      layout: { name: "cose", animate: false, nodeRepulsion: 9000, idealEdgeLength: 70 } });
    if (onTap) cy.on("tap", "node", (e) => onTap(e.target.id()));
    return () => cy.destroy();
  }, [sig]); // eslint-disable-line
  return <div ref={box} style={{ height }} className="rounded bg-navy-950" />;
}
