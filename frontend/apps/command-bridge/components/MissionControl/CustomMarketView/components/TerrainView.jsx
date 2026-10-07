import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const TerrainView = ({ data, width, height, predictions }) => {
    const svgRef = useRef(null);

    // View State
    const [visibleCount, setVisibleCount] = useState(100);
    const [threshold, setThreshold] = useState(null);

    // Zoom Handler (Scroll Wheel)
    const handleWheel = (e) => {
        e.stopPropagation();
        const delta = e.deltaY;

        setVisibleCount(prev => {
            const zoomFactor = 0.1;
            const change = Math.ceil(prev * zoomFactor);
            const newCount = prev + (delta > 0 ? change : -change);
            return Math.max(20, Math.min(newCount, data.length));
        });
    };

    useEffect(() => {
        if (!svgRef.current || !data || data.length < 2 || !width || !height) return;

        // Slice data based on zoom level
        const visibleData = data.slice(-visibleCount);

        // Determine max length of any prediction to set x-domain
        const predictionLength = predictions ? Math.max(...predictions.map(p => p.data.length), 0) : 0;
        const totalPoints = visibleData.length + predictionLength;

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear previous render

        // --- LAYOUT ---
        const domWidth = 40; // Space for the Liquidity Rail (DOM)
        const chartWidth = width - domWidth;
        const chartHeight = height;

        // --- SCALES ---
        const x = d3.scaleLinear()
            .domain([0, totalPoints - 1])
            .range([0, chartWidth]);

        // Calculate Y Domain with padding
        const minPrice = d3.min(visibleData, d => d.low ?? d.close) || 0;
        const maxPrice = d3.max(visibleData, d => d.high ?? d.close) || 100;

        // Check prediction range if exists to keep line in bounds
        let yMinCalc = minPrice;
        let yMaxCalc = maxPrice;
        if (predictions) {
            predictions.forEach(p => {
                yMinCalc = Math.min(yMinCalc, ...p.data);
                yMaxCalc = Math.max(yMaxCalc, ...p.data);
            });
        }

        const priceRange = yMaxCalc - yMinCalc;
        const isZoomedIn = visibleCount < 100;
        const padding = priceRange * (isZoomedIn ? 0.05 : 0.2);

        const currentThreshold = threshold !== null ? threshold : (minPrice + maxPrice) / 2;

        const yMin = Math.min(yMinCalc, currentThreshold) - padding;
        const yMax = Math.max(yMaxCalc, currentThreshold) + padding;

        const y = d3.scaleLinear()
            .domain([yMin, yMax])
            .range([chartHeight, 0]);

        // Volume Scale (Underlay)
        const maxVol = d3.max(visibleData, d => d.volume) || 1000;
        const yVol = d3.scaleLinear()
            .domain([0, maxVol])
            .range([chartHeight, chartHeight * 0.75]); // Volume occupies bottom 25%

        const thresholdY = y(currentThreshold);

        // --- GRADIENT DEFINITIONS ---
        const defs = svg.append("defs");

        // Diverging Gradient for Terrain
        const splitGradientId = "terrain-diverging-gradient";
        const splitGradient = defs.append("linearGradient")
            .attr("id", splitGradientId)
            .attr("gradientUnits", "userSpaceOnUse")
            .attr("x1", 0).attr("y1", 0)
            .attr("x2", 0).attr("y2", height);

        const rawPct = thresholdY / height;
        const tPct = Number.isFinite(rawPct) ? Math.max(0, Math.min(1, rawPct)) : 0.5;

        splitGradient.append("stop").attr("offset", "0%").attr("stop-color", "#ff00ff").attr("stop-opacity", 0.9);
        splitGradient.append("stop").attr("offset", Math.max(0, tPct - 0.05)).attr("stop-color", "#d946ef").attr("stop-opacity", 0.8);
        splitGradient.append("stop").attr("offset", tPct).attr("stop-color", "#8b5cf6").attr("stop-opacity", 0.5);
        splitGradient.append("stop").attr("offset", Math.min(1, tPct + 0.05)).attr("stop-color", "#6366f1").attr("stop-opacity", 0.8);
        splitGradient.append("stop").attr("offset", "100%").attr("stop-color", "#312e81").attr("stop-opacity", 0.95);

        // Volume Gradients
        const bullVolGrad = defs.append("linearGradient").attr("id", "vol-underlay-bull").attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
        bullVolGrad.append("stop").attr("offset", "0%").attr("stop-color", "#ff00ff").attr("stop-opacity", 0.3);
        bullVolGrad.append("stop").attr("offset", "100%").attr("stop-color", "#ff00ff").attr("stop-opacity", 0.05);

        const bearVolGrad = defs.append("linearGradient").attr("id", "vol-underlay-bear").attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", 1);
        bearVolGrad.append("stop").attr("offset", "0%").attr("stop-color", "#00ffff").attr("stop-opacity", 0.3);
        bearVolGrad.append("stop").attr("offset", "100%").attr("stop-color", "#00ffff").attr("stop-opacity", 0.05);

        // Filters
        const filter = defs.append("filter").attr("id", "glow");
        filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "coloredBlur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        const predFilter = defs.append("filter").attr("id", "pred-glow");
        predFilter.append("feGaussianBlur").attr("stdDeviation", "2").attr("result", "blur");
        const predMerge = predFilter.append("feMerge");
        predMerge.append("feMergeNode").attr("in", "blur");
        predMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // --- DRAWING LAYERS ---

        // 1. VOLUME UNDERLAY (Background)
        const bandWidth = chartWidth / visibleData.length;
        svg.selectAll(".vol-bar")
            .data(visibleData)
            .enter()
            .append("rect")
            .attr("x", (_, i) => x(i))
            .attr("y", d => yVol(d.volume))
            .attr("width", bandWidth * 0.8)
            .attr("height", d => chartHeight - yVol(d.volume))
            .attr("fill", d => d.close >= d.open ? "url(#vol-underlay-bull)" : "url(#vol-underlay-bear)")
            .attr("transform", `translate(${bandWidth * 0.1}, 0)`); // Center align

        // 2. TERRAIN AREA
        const area = d3.area()
            .curve(d3.curveMonotoneX)
            .x((_, i) => x(i))
            .y0(height)
            .y1(d => y(d.close));

        svg.append("path")
            .datum(visibleData)
            .attr("fill", `url(#${splitGradientId})`)
            .attr("d", area)
            .attr("stroke", "none");

        // 3. RIDGE LINE
        const line = d3.line()
            .curve(d3.curveMonotoneX)
            .x((_, i) => x(i))
            .y(d => y(d.close));

        svg.append("path")
            .datum(visibleData)
            .attr("fill", "none")
            .attr("stroke", "#e2e8f0")
            .attr("stroke-width", 1.5)
            .attr("d", line)
            .style("opacity", 0.8)
            .style("filter", "url(#glow)");

        // 4. PREDICTION GHOST TRACKS
        if (predictions && predictions.length > 0) {
            const historyContextCount = 4;
            const historyContext = visibleData.slice(-historyContextCount).map((d, i) => ({
                xVal: visibleData.length - historyContextCount + i,
                price: d.close,
                isPrediction: false
            }));

            predictions.forEach(scenario => {
                let color = "#22d3ee"; // Average (Cyan)
                if (scenario.type === 'SAFE') color = "#facc15"; // Neon Yellow
                if (scenario.type === 'BREAKOUT') color = "#4ade80"; // Neon Green
                if (scenario.type === 'DROP') color = "#f87171"; // Neon Red

                const futurePoints = scenario.data.map((p, i) => ({
                    xVal: visibleData.length + i,
                    price: p,
                    isPrediction: true
                }));

                const predData = [...historyContext, ...futurePoints];
                const predLine = d3.line()
                    .curve(d3.curveMonotoneX)
                    .x(d => x(d.xVal))
                    .y(d => y(d.price));

                svg.append("path")
                    .datum(predData)
                    .attr("fill", "none")
                    .attr("stroke", color)
                    .attr("stroke-width", scenario.type === 'AVERAGE' ? 2 : 1.5)
                    .attr("stroke-dasharray", "3,3")
                    .attr("d", predLine)
                    .style("opacity", 0.8)
                    .style("filter", "url(#pred-glow)");

                const endPred = futurePoints[futurePoints.length - 1];
                svg.append("circle")
                    .attr("cx", x(endPred.xVal))
                    .attr("cy", y(endPred.price))
                    .attr("r", 3)
                    .attr("fill", color)
                    .style("filter", "url(#pred-glow)");

                svg.append("text")
                    .attr("x", x(endPred.xVal) + 5)
                    .attr("y", y(endPred.price))
                    .attr("dy", "0.3em")
                    .attr("fill", color)
                    .attr("font-size", "9px")
                    .attr("font-family", "monospace")
                    .text(scenario.type);
            });
        }

        // 5. LIQUIDITY RAIL (DOM)
        const domG = svg.append("g")
            .attr("transform", `translate(${chartWidth}, 0)`);

        // Background for DOM
        domG.append("rect")
            .attr("width", domWidth)
            .attr("height", chartHeight)
            .attr("fill", "#020617")
            .attr("opacity", 0.5);

        // Generate buckets matching the price scale
        const bucketCount = 40;
        const bucketHeight = chartHeight / bucketCount;
        // Map buckets to current Y view
        const liquidityBuckets = Array.from({ length: bucketCount }, (_, i) => {
            const yPos = i * bucketHeight;
            const price = y.invert(yPos + bucketHeight / 2);
            // Simulated volume profile with a "bell curve" around current price + noise
            const dist = Math.abs(price - visibleData[visibleData.length - 1].close);
            const baseVol = Math.exp(-dist * 0.05) * 1000;
            return {
                y: yPos,
                width: Math.min(domWidth, (baseVol + Math.random() * 500) / 1500 * domWidth),
                color: price > visibleData[visibleData.length - 1].close ? "#ff00ff" : "#00ffff"
            };
        });

        domG.selectAll(".liq-bar")
            .data(liquidityBuckets)
            .enter()
            .append("rect")
            .attr("x", 0)
            .attr("y", d => d.y + 1)
            .attr("width", d => d.width)
            .attr("height", bucketHeight - 2)
            .attr("fill", d => d.color)
            .attr("opacity", 0.4)
            .style("filter", "drop-shadow(0 0 2px currentColor)");

        domG.append("line")
            .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", chartHeight)
            .attr("stroke", "#1e293b").attr("stroke-width", 1);


        // 6. THRESHOLD INTERACTIVE LINE
        const dragGroup = svg.append("g")
            .attr("class", "threshold-group")
            .style("cursor", "ns-resize");

        dragGroup.append("line")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", thresholdY)
            .attr("y2", thresholdY)
            .attr("stroke", "#00ffff")
            .attr("stroke-width", 2)
            .style("opacity", 1)
            .style("filter", "drop-shadow(0 0 5px #00ffff)");

        dragGroup.append("text")
            .attr("x", chartWidth - 10)
            .attr("y", thresholdY - 8)
            .attr("text-anchor", "end")
            .attr("fill", "#00ffff")
            .attr("font-size", "11px")
            .attr("font-family", "monospace")
            .attr("font-weight", "bold")
            .style("pointer-events", "none")
            .style("text-shadow", "0 0 8px #00ffff")
            .text(currentThreshold.toFixed(2));

        dragGroup.append("rect")
            .attr("x", 0)
            .attr("width", width)
            .attr("y", thresholdY - 20)
            .attr("height", 40)
            .attr("fill", "transparent");

        const drag = d3.drag()
            .on("drag", (event) => {
                const clampedY = Math.max(0, Math.min(height, event.y));
                const newPrice = y.invert(clampedY);
                setThreshold(newPrice);
            });

        dragGroup.call(drag);

    }, [data, width, height, visibleCount, threshold, predictions]);

    return (
        <div className="w-full h-full relative select-none" onWheel={handleWheel}>
            <svg ref={svgRef} width={width} height={height} className="overflow-visible block" />
            <div className="absolute top-4 right-4 text-[10px] text-slate-500 font-mono tracking-widest pointer-events-none bg-black/50 px-2 py-1 rounded backdrop-blur-sm border border-slate-900">
                SCALE: {visibleCount < 100 ? 'MICRO' : visibleCount < 500 ? 'MESO' : 'MACRO'} ({visibleCount})
            </div>
            <div className="absolute bottom-4 left-4 flex flex-col gap-1 pointer-events-none">
                <div className="text-[10px] text-slate-600 font-mono tracking-widest opacity-70">
                    TERRAIN + FLOW SYNTHESIS
                </div>
                <div className="text-[9px] text-slate-700 font-mono opacity-50">
                    SCROLL TO SCALE TIME • RIGHT RAIL: LIQUIDITY
                </div>
            </div>
        </div>
    );
};

export default TerrainView;
