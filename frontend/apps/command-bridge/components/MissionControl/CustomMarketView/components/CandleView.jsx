import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const CandleView = ({ data, width, height, predictions }) => {
    const svgRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(60); // Default zoom
    const [hoverInfo, setHoverInfo] = useState(null);

    // Handle Scroll Zoom
    const handleWheel = (e) => {
        e.stopPropagation();
        const delta = e.deltaY;
        setVisibleCount(prev => {
            // Zoom speed proportional to current count
            const change = Math.ceil(prev * 0.1);
            const newCount = prev + (delta > 0 ? change : -change);
            return Math.max(10, Math.min(newCount, data.length));
        });
    };

    useEffect(() => {
        if (!svgRef.current || data.length === 0) return;

        const visibleData = data.slice(-visibleCount);
        const predictionLength = predictions ? Math.max(...predictions.map(p => p.data.length), 0) : 0;

        // Clear previous
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // Layout margins
        const margin = { top: 20, right: 60, bottom: 30, left: 10 };
        const chartWidth = width - margin.left - margin.right;
        const chartHeight = height - margin.top - margin.bottom;

        const g = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // --- DEFINITIONS (Glow Filters) ---
        const defs = svg.append("defs");
        const filter = defs.append("filter").attr("id", "candle-glow");
        filter.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "coloredBlur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // --- SCALES ---
        const timeDomain = visibleData.map(d => d.time.toString());
        const predDomain = predictionLength > 0 ? Array.from({ length: predictionLength }, (_, i) => `PRED-${i}`) : [];
        const fullDomain = [...timeDomain, ...predDomain];

        const x = d3.scaleBand()
            .domain(fullDomain)
            .range([0, chartWidth])
            .padding(0.3);

        // Calculate Y domain
        let minPrice = d3.min(visibleData, d => d.low) || 0;
        let maxPrice = d3.max(visibleData, d => d.high) || 0;

        if (predictions) {
            predictions.forEach(p => {
                minPrice = Math.min(minPrice, ...p.data);
                maxPrice = Math.max(maxPrice, ...p.data);
            });
        }

        const padding = (maxPrice - minPrice) * 0.1;

        const y = d3.scaleLinear()
            .domain([minPrice - padding, maxPrice + padding])
            .range([chartHeight, 0]);

        // --- GRID ---
        const yAxisGrid = d3.axisRight(y)
            .tickSize(chartWidth)
            .tickFormat(() => "")
            .ticks(5);

        g.append("g")
            .attr("class", "grid-lines")
            .call(yAxisGrid)
            .select(".domain").remove();

        g.selectAll(".tick line")
            .attr("stroke", "#1e293b")
            .attr("stroke-dasharray", "4,4")
            .attr("stroke-opacity", 0.5);

        // --- CANDLES ---
        const candleGroup = g.selectAll(".candle-group")
            .data(visibleData)
            .enter()
            .append("g")
            .attr("transform", d => `translate(${x(d.time.toString()) || 0},0)`);

        // Wicks
        candleGroup.append("line")
            .attr("y1", d => y(d.high))
            .attr("y2", d => y(d.low))
            .attr("x1", x.bandwidth() / 2)
            .attr("x2", x.bandwidth() / 2)
            .attr("stroke", d => d.close >= d.open ? "#ff00ff" : "#00ffff")
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.9);

        // Bodies
        candleGroup.append("rect")
            .attr("x", 0)
            .attr("y", d => y(Math.max(d.open, d.close)))
            .attr("width", x.bandwidth())
            .attr("height", d => Math.max(1.5, Math.abs(y(d.open) - y(d.close))))
            .attr("fill", d => d.close >= d.open ? "#ff00ff" : "#0f0720")
            .attr("stroke", d => d.close >= d.open ? "none" : "#00ffff")
            .attr("stroke-width", 1.5)
            .style("filter", "url(#candle-glow)");

        // --- PREDICTION GHOST TRACKS ---
        if (predictions && predictions.length > 0) {
            const bandwidthCenter = x.bandwidth() / 2;

            // Grab context for smoothness
            const contextSize = 3;
            const historyContext = visibleData.slice(-contextSize).map((d, i) => ({
                x: (x(d.time.toString()) || 0) + bandwidthCenter,
                y: y(d.close)
            }));

            predictions.forEach(scenario => {
                let color = "#22d3ee";
                if (scenario.type === 'SAFE') color = "#facc15"; // Neon Yellow
                if (scenario.type === 'BREAKOUT') color = "#4ade80"; // Neon Green
                if (scenario.type === 'DROP') color = "#f87171"; // Neon Red

                const futurePoints = scenario.data.map((p, i) => ({
                    x: (x(`PRED-${i}`) || 0) + bandwidthCenter,
                    y: y(p)
                }));

                // Combine for smooth spline
                const predData = [...historyContext, ...futurePoints];

                const predLine = d3.line()
                    .curve(d3.curveMonotoneX)
                    .x(d => d.x)
                    .y(d => d.y);

                g.append("path")
                    .datum(predData)
                    .attr("fill", "none")
                    .attr("stroke", color)
                    .attr("stroke-width", 2)
                    .attr("stroke-dasharray", "3,3")
                    .attr("d", predLine)
                    .style("opacity", 0.7)
                    .style("filter", `drop-shadow(0 0 4px ${color})`);

                // Ghost dots (Future only)
                g.selectAll(`.pred-dot-${scenario.type}`)
                    .data(futurePoints)
                    .enter()
                    .append("circle")
                    .attr("cx", d => d.x)
                    .attr("cy", d => d.y)
                    .attr("r", 2)
                    .attr("fill", color);
            });
        }

        // --- AXIS LABELS ---
        const axisLabels = g.append("g")
            .attr("transform", `translate(${chartWidth + 10}, 0)`);

        y.ticks(6).forEach(tick => {
            axisLabels.append("text")
                .attr("y", y(tick))
                .attr("dy", "0.32em")
                .attr("fill", "#64748b")
                .attr("font-family", "monospace")
                .attr("font-size", "10px")
                .text(tick.toFixed(1));
        });

        // --- INTERACTION ---
        svg.append("rect")
            .attr("class", "overlay")
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "transparent")
            .on("mousemove", (event) => {
                const [mx] = d3.pointer(event);
                const relativeX = mx - margin.left;
                const eachBand = x.step();
                const index = Math.floor(relativeX / eachBand);

                if (index >= 0 && index < visibleData.length) {
                    setHoverInfo(visibleData[index]);
                } else {
                    setHoverInfo(null);
                }
            })
            .on("mouseleave", () => setHoverInfo(null));

    }, [data, width, height, visibleCount, predictions]);

    return (
        <div className="w-full h-full relative group" onWheel={handleWheel}>
            <svg ref={svgRef} width={width} height={height} className="overflow-visible block" />
            <div className="absolute top-4 left-4 pointer-events-none">
                <div className="flex flex-col gap-1">
                    <div className="text-[9px] text-slate-500 font-mono tracking-widest mb-1 uppercase">
                        Scanner :: {visibleCount < 100 ? 'Micro' : 'Macro'} Scope
                    </div>

                    {hoverInfo ? (
                        <div className="bg-slate-900/80 backdrop-blur border-l-2 border-fuchsia-500 p-3 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                            <div className="flex gap-4 text-xs font-mono">
                                <div className="flex flex-col">
                                    <span className="text-slate-500 text-[9px]">OPEN</span>
                                    <span className="text-slate-200">{hoverInfo.open.toFixed(2)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-slate-500 text-[9px]">HIGH</span>
                                    <span className="text-slate-200">{hoverInfo.high.toFixed(2)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-slate-500 text-[9px]">LOW</span>
                                    <span className="text-slate-200">{hoverInfo.low.toFixed(2)}</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-slate-500 text-[9px]">CLOSE</span>
                                    <span className={hoverInfo.close >= hoverInfo.open ? "text-fuchsia-500 drop-shadow-[0_0_5px_rgba(255,0,255,0.8)]" : "text-cyan-400 drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]"}>
                                        {hoverInfo.close.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="h-[58px] flex items-center">
                            <span className="text-[10px] text-slate-700 font-mono animate-pulse">
                                &lt; HOVER TO DECRYPT &gt;
                            </span>
                        </div>
                    )}
                </div>
            </div>
            <div className="absolute bottom-4 right-4 text-[9px] text-slate-600 font-mono tracking-widest pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                SCROLL TO ZOOM // MOUSE TO SCAN
            </div>
        </div>
    );
};

export default CandleView;
