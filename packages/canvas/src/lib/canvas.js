/*
 * PiCanvas — thin themed wrapper around ECharts for pi canvas pages.
 * Declarative props (categories + series + tones) mapped to flat, token-themed
 * ECharts options. Requires /lib/echarts.min.js loaded before this file.
 */
window.PiCanvas = (() => {
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function palette() {
    return {
      fg: cssVar("--canvas-fg"),
      muted: cssVar("--canvas-muted"),
      surface: cssVar("--canvas-surface"),
      border: cssVar("--canvas-border"),
      series: [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--canvas-series-${i}`)),
      tones: {
        success: cssVar("--canvas-success"),
        danger: cssVar("--canvas-danger"),
        warning: cssVar("--canvas-warning"),
        info: cssVar("--canvas-info"),
        neutral: cssVar("--canvas-muted"),
      },
    };
  }

  function fmt(value, opts) {
    const n = typeof value === "number" ? value : Number(value);
    const text = Number.isInteger(n) ? String(n) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${opts.valuePrefix || ""}${text}${opts.valueSuffix || ""}`;
  }

  function assertECharts() {
    if (!window.echarts) {
      throw new Error('PiCanvas: echarts not loaded — add <script src="/lib/echarts.min.js"></script> before /lib/canvas.js');
    }
  }

  function assertMermaid() {
    if (!window.mermaid) {
      throw new Error('PiCanvas: mermaid not loaded — add <script src="/lib/mermaid.min.js"></script> before /lib/canvas.js');
    }
  }

  function resolveEl(el) {
    const node = typeof el === "string" ? document.querySelector(el) : el;
    if (!node) throw new Error(`PiCanvas: element not found: ${el}`);
    return node;
  }

  function baseOption(pal, opts) {
    const option = {
      backgroundColor: "transparent",
      textStyle: { color: pal.fg },
      color: pal.series,
      tooltip: {
        backgroundColor: pal.surface,
        borderColor: pal.border,
        borderWidth: 1,
        textStyle: { color: pal.fg, fontSize: 12 },
        valueFormatter: (v) => fmt(v, opts),
      },
      title: [],
      grid: { left: 12, right: 16, bottom: 12, containLabel: true },
    };
    if (opts.title) {
      option.title.push({
        text: opts.title,
        subtext: opts.source || "",
        left: 0,
        top: 0,
        textStyle: { color: pal.fg, fontSize: 14, fontWeight: 600 },
        subtextStyle: { color: pal.muted, fontSize: 11 },
      });
      option.grid.top = opts.source ? 56 : 40;
    } else {
      option.grid.top = 16;
    }
    return option;
  }

  function valueAxis(pal, opts, name, extra) {
    const axis = {
      type: "value",
      name: name || "",
      nameTextStyle: { color: pal.muted, fontSize: 11, align: "left" },
      axisLabel: { color: pal.muted, fontSize: 11, formatter: (v) => fmt(v, opts) },
      splitLine: { lineStyle: { color: pal.border, width: 1 } },
      axisLine: { show: false },
      axisTick: { show: false },
    };
    if (opts.yMin !== undefined) axis.min = opts.yMin;
    else if (opts.beginAtZero !== false) axis.min = 0;
    if (opts.yMax !== undefined) axis.max = opts.yMax;
    return Object.assign(axis, extra);
  }

  function categoryAxis(pal, categories, name, extra) {
    return Object.assign(
      {
        type: "category",
        data: categories,
        name: name || "",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: pal.muted, fontSize: 11 },
        axisLabel: { color: pal.muted, fontSize: 11 },
        axisLine: { lineStyle: { color: pal.border } },
        axisTick: { show: false },
      },
      extra,
    );
  }

  function referenceMarkLine(pal, opts, axisKey) {
    const lines = opts.referenceLines || [];
    if (lines.length === 0) return undefined;
    return {
      symbol: "none",
      silent: true,
      data: lines.map((line) => ({
        [axisKey]: line.value,
        lineStyle: { type: "dashed", color: line.tone ? pal.tones[line.tone] : pal.muted, width: 1 },
        label: line.label
          ? { formatter: line.label, color: line.tone ? pal.tones[line.tone] : pal.muted, fontSize: 10, position: "insideEndTop" }
          : { show: false },
      })),
    };
  }

  function legendOption(pal, count) {
    if (count <= 1) return undefined;
    return {
      bottom: 0,
      icon: "rect",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: pal.muted, fontSize: 11 },
    };
  }

  function normalizeSeries(opts) {
    if (!opts.normalized) return opts.series;
    const totals = opts.categories.map((_, i) => opts.series.reduce((sum, s) => sum + (s.data[i] || 0), 0));
    return opts.series.map((s) => ({
      ...s,
      data: s.data.map((v, i) => (totals[i] ? (v / totals[i]) * 100 : 0)),
    }));
  }

  function cartesian(el, opts, kind) {
    assertECharts();
    const node = resolveEl(el);
    if (!node.style.height) node.style.height = `${opts.height || 320}px`;
    const pal = palette();
    const horizontal = kind === "bar" && opts.horizontal === true;
    const normalized = kind === "bar" && opts.normalized === true;
    const effective = normalized ? { ...opts, valuePrefix: "", valueSuffix: "%", beginAtZero: true, yMax: 100 } : opts;
    const source = normalizeSeries({ ...opts, series: opts.series.map((s) => ({ ...s })) });

    const option = baseOption(pal, effective);
    option.tooltip.trigger = "axis";
    option.tooltip.axisPointer = { type: "line", lineStyle: { color: pal.border } };
    option.legend = legendOption(pal, source.length);
    if (option.legend) option.grid.bottom = 36;

    // Labels follow the VISUAL axes: xLabel names the horizontal axis and
    // yLabel the vertical one, regardless of bar orientation.
    const vAxis = horizontal
      ? valueAxis(pal, effective, opts.xLabel, {
          position: "top",
          nameTextStyle: { color: pal.muted, fontSize: 11, align: "right" },
        })
      : valueAxis(pal, effective, opts.yLabel, {});
    const cAxis = horizontal
      ? categoryAxis(pal, opts.categories, opts.yLabel, { inverse: true, nameLocation: "end", nameGap: 8 })
      : categoryAxis(pal, opts.categories, opts.xLabel, {});
    option.xAxis = horizontal ? vAxis : cAxis;
    option.yAxis = horizontal ? cAxis : vAxis;

    const stacked = kind === "bar" && (opts.stacked === true || normalized);
    option.series = source.map((s, i) => {
      const color = s.tone ? pal.tones[s.tone] : pal.series[i % pal.series.length];
      const item = {
        name: s.name,
        type: kind,
        data: s.data,
        itemStyle: { color },
        emphasis: { focus: "series" },
      };
      if (kind === "line") {
        item.smooth = false;
        item.symbol = "circle";
        item.symbolSize = 5;
        item.lineStyle = { width: 2, color };
        if (opts.fill) item.areaStyle = { color, opacity: 0.12 };
        if (opts.showValues) {
          item.label = { show: true, position: "top", color: pal.muted, fontSize: 10, formatter: (p) => fmt(p.value, effective) };
        }
      } else {
        if (stacked) item.stack = "total";
        if (!stacked) item.itemStyle.borderRadius = horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0];
        if (opts.showValues && !stacked) {
          item.label = {
            show: true,
            position: horizontal ? "right" : "top",
            color: pal.muted,
            fontSize: 10,
            formatter: (p) => fmt(p.value, effective),
          };
        }
      }
      return item;
    });

    const markLine = referenceMarkLine(pal, effective, horizontal ? "xAxis" : "yAxis");
    if (markLine && option.series.length > 0) option.series[0].markLine = markLine;

    const chart = window.echarts.init(node, null, { renderer: "canvas" });
    chart.setOption(option);
    window.addEventListener("resize", () => chart.resize());
    return chart;
  }

  function pieChart(el, opts) {
    assertECharts();
    const node = resolveEl(el);
    if (!node.style.height) node.style.height = `${opts.size ? opts.size + 80 : 280}px`;
    const pal = palette();
    const option = baseOption(pal, opts);
    option.tooltip.trigger = "item";
    option.legend = legendOption(pal, opts.data.length);
    if (option.legend) option.grid.bottom = 36;

    const total = opts.data.reduce((sum, d) => sum + d.value, 0);
    option.series = [
      {
        type: "pie",
        radius: opts.donut ? ["52%", "74%"] : [0, "72%"],
        center: ["50%", option.title.length > 0 ? "58%" : "50%"],
        itemStyle: { borderColor: cssVar("--canvas-bg"), borderWidth: 2 },
        label: { show: true, formatter: "{b}", color: pal.muted, fontSize: 11 },
        labelLine: { lineStyle: { color: pal.border } },
        emphasis: { scaleSize: 4 },
        data: opts.data.map((d, i) => ({
          name: d.label,
          value: d.value,
          itemStyle: { color: d.tone ? pal.tones[d.tone] : pal.series[i % pal.series.length] },
        })),
      },
    ];
    if (opts.donut) {
      option.title.push({
        text: fmt(total, opts),
        left: "center",
        top: option.title.length > 0 ? "52%" : "44%",
        textStyle: { color: pal.fg, fontSize: 18, fontWeight: 600 },
      });
    }

    const chart = window.echarts.init(node, null, { renderer: "canvas" });
    chart.setOption(option);
    window.addEventListener("resize", () => chart.resize());
    return chart;
  }

  let mermaidInitialized = false;
  let mermaidSeq = 0;

  function initMermaid() {
    if (mermaidInitialized) return;
    const pal = palette();
    const cScale = {};
    pal.series.forEach((color, i) => {
      cScale[`cScale${i}`] = color;
    });
    window.mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: Object.assign(
        {
          fontFamily: "inherit",
          background: "transparent",
          primaryColor: pal.surface,
          primaryTextColor: pal.fg,
          primaryBorderColor: pal.border,
          secondaryColor: pal.surface,
          secondaryTextColor: pal.muted,
          secondaryBorderColor: pal.border,
          tertiaryColor: pal.surface,
          tertiaryTextColor: pal.muted,
          tertiaryBorderColor: pal.border,
          lineColor: pal.muted,
          textColor: pal.fg,
          edgeLabelBackground: pal.surface,
          clusterBkg: "transparent",
          clusterBorder: pal.border,
        },
        cScale,
      ),
    });
    mermaidInitialized = true;
  }

  async function mermaid(el, opts) {
    assertMermaid();
    const node = resolveEl(el);
    initMermaid();
    const text = typeof opts === "string" ? opts : opts.diagram;
    const maxWidth = opts && typeof opts.maxWidth === "number" ? opts.maxWidth : null;
    const id = `pi-canvas-mmd-${mermaidSeq++}`;
    try {
      const { svg } = await window.mermaid.render(id, text);
      node.innerHTML = svg;
      const svgEl = node.querySelector("svg");
      if (svgEl) {
        // Render at the diagram's natural pixel size so every diagram shares
        // one font size — no responsive scaling that would shrink larger
        // diagrams (and their text) to fit the container.
        const vb = (svgEl.getAttribute("viewBox") || "").split(/[\s,]+/);
        const natW = Number(vb[2]);
        svgEl.style.maxWidth = "none";
        svgEl.style.width = Number.isFinite(natW) ? `${natW}px` : "auto";
        svgEl.style.height = "auto";
        svgEl.style.display = "block";
        svgEl.style.margin = "0 auto";
      }
      node.style.overflowX = "auto";
      node.style.maxWidth = maxWidth !== null ? `${maxWidth}px` : "";
    } catch (err) {
      node.innerHTML = "";
      node.style.overflowX = "";
      node.style.maxWidth = "";
      const msg = document.createElement("div");
      msg.className = "callout callout-danger";
      msg.textContent = `Mermaid syntax error: ${String((err && err.message) || err)}`;
      node.appendChild(msg);
    }
    return node;
  }

  return {
    lineChart: (el, opts) => cartesian(el, opts, "line"),
    barChart: (el, opts) => cartesian(el, opts, "bar"),
    pieChart,
    mermaid,
  };
})();
