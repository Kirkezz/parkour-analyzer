import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, AreaChart, Area, BarChart, Bar,
} from "recharts";

const COLORS = [
  "#4ade80", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa",
  "#fb923c", "#22d3ee", "#e879f9", "#34d399", "#f87171",
  "#94a3b8", "#c084fc",
];

// --- Tauri detection ---
const isTauri = () => {
  try { return !!window.__TAURI_INTERNALS__; } catch { return false; }
};

let tauriListen = null;
let tauriInvoke = null;
const tauriReady = isTauri()
  ? Promise.all([
      import("@tauri-apps/api/event").then((m) => { tauriListen = m.listen; }),
      import("@tauri-apps/api/core").then((m) => { tauriInvoke = m.invoke; }),
    ])
  : Promise.resolve();

// --- Parser ---
function parseLogs(raw) {
  const lines = raw.split("\n");
  let username = null;
  const games = [];
  let cur = null;

  for (const line of lines) {
    const um = line.match(/Setting user:\s*(\S+)/);
    if (um) username = um[1];

    if (
      line.includes("[CHAT]") &&
      /Parkour Duels/.test(line) &&
      !line.includes("Winstreak") &&
      !line.includes("TITLE") &&
      !line.includes("CHECKPOINT") &&
      !line.includes("COMPLETED")
    ) {
      const after = line.slice(line.indexOf("[CHAT]") + 6).trim().replace(/§./g, "");
      if (/Parkour Duels/.test(after) && after.length < 40) {
        if (cur && Object.keys(cur.players).length > 0) games.push(cur);
        cur = { players: {}, opponents: "" };
      }
    }

    if (cur && line.includes("Opponents:")) {
      let t = line.slice(line.indexOf("[CHAT]") + 6).trim().replace(/§./g, "");
      t = t.replace(/^Opponents:\s*/, "");
      cur.opponents += (cur.opponents ? " " : "") + t;
    }

    if (!cur) continue;

    const youCp = line.match(
      /\[CHAT\].*?CHECKPOINT!\s+You\s+reached checkpoint\s+(\d+)\s+in\s+([\d:.]+)!/
    );
    if (youCp && username) {
      if (!cur.players[username]) cur.players[username] = [];
      const cp = parseInt(youCp[1]);
      if (!cur.players[username].some((e) => e.cp === cp))
        cur.players[username].push({ cp, time: youCp[2], type: "checkpoint" });
    }

    const otherCp = line.match(
      /\[CHAT\].*?CHECKPOINT!\s+(.+?)\s+reached checkpoint\s+(\d+)\s+in\s+([\d:.]+)!/
    );
    if (otherCp) {
      const name = otherCp[1].replace(/§./g, "").replace(/\[.*?\]\s*/g, "").trim();
      if (name === "You") continue;
      if (!cur.players[name]) cur.players[name] = [];
      const cp = parseInt(otherCp[2]);
      if (!cur.players[name].some((e) => e.cp === cp))
        cur.players[name].push({ cp, time: otherCp[3], type: "checkpoint" });
    }

    const youFin = line.match(
      /\[CHAT\].*?COMPLETED!\s+You\s+completed the parkour in\s+([\d:.]+)!/
    );
    if (youFin && username) {
      if (!cur.players[username]) cur.players[username] = [];
      if (!cur.players[username].some((e) => e.type === "finish"))
        cur.players[username].push({ cp: 9999, time: youFin[1], type: "finish" });
    }

    const otherFin = line.match(
      /\[CHAT\].*?COMPLETED!\s+(.+?)\s+completed the parkour in\s+([\d:.]+)!/
    );
    if (otherFin) {
      const name = otherFin[1].replace(/§./g, "").replace(/\[.*?\]\s*/g, "").trim();
      if (name === "You") continue;
      if (!cur.players[name]) cur.players[name] = [];
      if (!cur.players[name].some((e) => e.type === "finish"))
        cur.players[name].push({ cp: 9999, time: otherFin[2], type: "finish" });
    }
  }
  if (cur && Object.keys(cur.players).length > 0) games.push(cur);
  for (const g of games)
    for (const p of Object.keys(g.players))
      g.players[p].sort((a, b) => a.cp - b.cp);
  return { games, username };
}

const toSec = (s) => {
  const [m, r] = s.replace(/[()+ ]/g, "").split(":");
  return parseFloat(m) * 60 + parseFloat(r);
};
const fmtShort = (s) => {
  if (s == null || isNaN(s)) return "--";
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
const fmtFull = (s) => {
  if (s == null || isNaN(s)) return "--";
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s % 60).toFixed(3).padStart(6, "0")}`;
};

function sortPlayers(game) {
  return Object.keys(game.players).sort((a, b) => {
    const af = game.players[a].find((e) => e.type === "finish");
    const bf = game.players[b].find((e) => e.type === "finish");
    if (af && bf) return toSec(af.time) - toSec(bf.time);
    if (af) return -1;
    if (bf) return 1;
    return game.players[b].length - game.players[a].length;
  });
}

// --- Charts ---
function Charts({ game, players, username }) {
  const [tab, setTab] = useState("race");

  const { chartData, segData } = useMemo(() => {
    const allCps = new Set();
    for (const p of players)
      if (game.players[p])
        for (const e of game.players[p]) allCps.add(e.cp);
    const sorted = [...allCps].sort((a, b) => a - b);

    const cd = sorted.map((cp) => {
      const row = { name: cp === 9999 ? "Finish" : `CP${cp}`, cp };
      for (const p of players) {
        const e = game.players[p]?.find((x) => x.cp === cp);
        row[p] = e ? toSec(e.time) : null;
      }
      return row;
    });

    const sd = cd.map((d, i) => {
      const row = { ...d };
      for (const p of players)
        row[`${p}_s`] =
          i === 0
            ? d[p]
            : d[p] != null && cd[i - 1][p] != null
            ? d[p] - cd[i - 1][p]
            : null;
      return row;
    });

    return { chartData: cd, segData: sd };
  }, [game, players]);

  const diffData = useMemo(() => {
    if (players.length !== 2) return null;
    const [a, b] = players;
    return chartData.map((d) => ({
      ...d,
      diff: d[a] != null && d[b] != null ? d[a] - d[b] : null,
    }));
  }, [chartData, players]);

  const Tip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#1a1a2e", border: "1px solid #444", borderRadius: 8, padding: "10px 14px" }}>
        <p style={{ color: "#aaa", margin: 0, fontSize: 13, fontWeight: 600 }}>{label}</p>
        {payload.filter((p) => p.value != null).map((p, i) => (
          <p key={i} style={{ color: p.color, margin: "4px 0 0", fontSize: 13 }}>
            {p.name.replace("_s", "")}: {fmtFull(p.value)}
          </p>
        ))}
      </div>
    );
  };

  const GapTip = ({ active, payload, label }) => {
    if (!active || !payload?.length || !diffData) return null;
    const v = payload[0]?.value;
    if (v == null) return null;
    return (
      <div style={{ background: "#1a1a2e", border: "1px solid #444", borderRadius: 8, padding: "10px 14px" }}>
        <p style={{ color: "#aaa", margin: 0, fontSize: 13, fontWeight: 600 }}>{label}</p>
        <p style={{ color: v > 0 ? "#f87171" : "#4ade80", margin: "4px 0 0", fontSize: 13 }}>
          {v > 0 ? `${players[1]} ahead` : `${players[0]} ahead`} by{" "}
          {Math.abs(v).toFixed(3)}s
        </p>
      </div>
    );
  };

  const SegTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: "#1a1a2e", border: "1px solid #444", borderRadius: 8, padding: "10px 14px" }}>
        <p style={{ color: "#aaa", margin: 0, fontSize: 13, fontWeight: 600 }}>{label}</p>
        {payload.filter((p) => p.value != null).map((p, i) => (
          <p key={i} style={{ color: p.color, margin: "4px 0 0", fontSize: 13 }}>
            {p.dataKey.replace("_s", "")}: {p.value.toFixed(3)}s
          </p>
        ))}
      </div>
    );
  };

  const tabs = [{ id: "race", label: "Progress" }];
  if (players.length === 2) tabs.push({ id: "diff", label: "Gap" });
  tabs.push({ id: "segments", label: "Segments" });

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {players.map((p, i) => {
          const fin = game.players[p].find((e) => e.type === "finish");
          const cps = game.players[p].filter((e) => e.type === "checkpoint").length;
          return (
            <div key={p} style={{ background: "#1a1a2e", borderRadius: 8, padding: "8px 14px", borderLeft: `3px solid ${COLORS[i % COLORS.length]}`, flex: "1 1 140px", minWidth: 140 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: COLORS[i % COLORS.length] }}>
                {p}{" "}
                {p === username && (
                  <span style={{ color: "#666", fontSize: 11 }}>(you)</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                {fin ? (
                  <span style={{ color: "#4ade80" }}>{fmtFull(toSec(fin.time))}</span>
                ) : (
                  <span style={{ color: "#f87171" }}>{cps} checkpoints</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "7px 16px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            background: tab === t.id ? "#4ade80" : "#1a1a2e",
            color: tab === t.id ? "#0f0f1a" : "#aaa",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: "#1a1a2e", borderRadius: 12, padding: "16px 8px 8px" }}>
        {tab === "race" && (
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={50} />
              <YAxis tickFormatter={fmtShort} tick={{ fill: "#888", fontSize: 11 }} />
              <Tooltip content={<Tip />} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {players.map((p, i) => (
                <Line key={p} type="monotone" dataKey={p} stroke={COLORS[i % COLORS.length]} strokeWidth={2.5} dot={{ r: 3, fill: COLORS[i % COLORS.length] }} activeDot={{ r: 5 }} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        {tab === "diff" && diffData && (
          <ResponsiveContainer width="100%" height={380}>
            <AreaChart data={diffData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={50} />
              <YAxis tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}s`} tick={{ fill: "#888", fontSize: 11 }} />
              <Tooltip content={<GapTip />} />
              <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
              <defs>
                <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                  <stop offset="50%" stopColor="#333" stopOpacity={0.05} />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="diff" stroke="#fbbf24" strokeWidth={2} fill="url(#dg)" dot={{ r: 3, fill: "#fbbf24" }} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {tab === "segments" && (
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={segData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3e" />
              <XAxis dataKey="name" tick={{ fill: "#888", fontSize: 11 }} angle={-45} textAnchor="end" height={50} />
              <YAxis tickFormatter={(v) => `${v.toFixed(0)}s`} tick={{ fill: "#888", fontSize: 11 }} />
              <Tooltip content={<SegTip />} />
              <Legend formatter={(v) => v.replace("_s", "")} wrapperStyle={{ fontSize: 13 }} />
              {players.map((p, i) => (
                <Bar key={p} dataKey={`${p}_s`} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// --- Path Settings Modal ---
function PathSettings({ logPath, onClose }) {
  const [customPath, setCustomPath] = useState(logPath || "");
  const [validating, setValidating] = useState(false);
  const [pathError, setPathError] = useState("");
  const [defaults, setDefaults] = useState([]);

  useEffect(() => {
    if (tauriInvoke) {
      tauriInvoke("get_default_paths").then(setDefaults).catch(() => {});
    }
  }, []);

  const handleApply = async () => {
    if (!customPath.trim()) return;
    setValidating(true);
    setPathError("");
    try {
      const valid = await tauriInvoke("validate_path", { path: customPath });
      if (valid) {
        await tauriInvoke("watch_path", { path: customPath });
        onClose();
      } else {
        setPathError("File not found");
      }
    } catch (e) {
      setPathError(String(e));
    }
    setValidating(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={onClose}>
      <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, width: "90%", maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, color: "#fff" }}>Log File Path</h2>

        <div style={{ marginBottom: 12 }}>
          <input
            value={customPath}
            onChange={(e) => { setCustomPath(e.target.value); setPathError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
            placeholder="/path/to/latest.log"
            style={{
              width: "100%", padding: "10px 12px", background: "#0f0f1a",
              border: pathError ? "1px solid #f87171" : "1px solid #2a2a3e",
              borderRadius: 8, color: "#ccc", fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box",
            }}
          />
          {pathError && <div style={{ color: "#f87171", fontSize: 12, marginTop: 4 }}>{pathError}</div>}
        </div>

        {defaults.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>Common paths:</div>
            {defaults.map((d, i) => (
              <button key={i} onClick={() => setCustomPath(d)} style={{
                display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
                background: customPath === d ? "#4ade8018" : "transparent",
                border: customPath === d ? "1px solid #4ade80" : "1px solid #2a2a3e",
                borderRadius: 6, color: customPath === d ? "#4ade80" : "#888",
                fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                cursor: "pointer", marginBottom: 4, boxSizing: "border-box",
              }}>
                {d}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: 6, border: "1px solid #333",
            background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 13,
          }}>
            Cancel
          </button>
          <button onClick={handleApply} disabled={validating || !customPath.trim()} style={{
            padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 600,
            background: customPath.trim() ? "#4ade80" : "#2a2a3e",
            color: customPath.trim() ? "#0f0f1a" : "#555",
          }}>
            {validating ? "Checking..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [logs, setLogs] = useState("");
  const [parsed, setParsed] = useState(null);
  const [gameIdx, setGameIdx] = useState(0);
  const [selected, setSelected] = useState([]);
  const [view, setView] = useState("input");
  const [error, setError] = useState("");
  const [logPath, setLogPath] = useState(null);
  const [watching, setWatching] = useState(false);
  const [mode, setMode] = useState(isTauri() ? "live" : "paste");
  const [showSettings, setShowSettings] = useState(false);
  const lastGameCountRef = useRef(0);
  const autoSelectRef = useRef(true);

  // Tauri live mode
  useEffect(() => {
    if (!isTauri() || mode !== "live") return;
    let unlisteners = [];

    const setup = async () => {
      await tauriReady;
      if (!tauriListen) return;

      const u1 = await tauriListen("log-update", (event) => {
        const content = event.payload;
        const result = parseLogs(content);
        if (result.games.length > 0) {
          setParsed((prev) => {
            if (prev && prev.games.length === result.games.length) {
              const lastOld = prev.games[prev.games.length - 1];
              const lastNew = result.games[result.games.length - 1];
              const oldTotal = Object.values(lastOld.players).reduce((s, a) => s + a.length, 0);
              const newTotal = Object.values(lastNew.players).reduce((s, a) => s + a.length, 0);
              if (oldTotal === newTotal) return prev;
            }
            return result;
          });
          setView("chart");
          setError("");

          if (result.games.length !== lastGameCountRef.current || autoSelectRef.current) {
            const gi = result.games.length - 1;
            setGameIdx(gi);
            const sorted = sortPlayers(result.games[gi]);
            setSelected(sorted.slice(0, Math.min(4, sorted.length)));
            lastGameCountRef.current = result.games.length;
            autoSelectRef.current = false;
          }
        }
      });
      unlisteners.push(u1);

      const u2 = await tauriListen("log-location", (event) => {
        setLogPath(event.payload);
        setWatching(true);
        setError("");
      });
      unlisteners.push(u2);

      const u3 = await tauriListen("log-error", (event) => {
        setError(event.payload);
        setWatching(false);
      });
      unlisteners.push(u3);
    };

    setup();
    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [mode]);

  const handleParse = useCallback(() => {
    const r = parseLogs(logs);
    if (r.games.length === 0) {
      setError("No Parkour Duels games found.");
      return;
    }
    setError("");
    setParsed(r);
    const gi = r.games.length - 1;
    setGameIdx(gi);
    setSelected(
      sortPlayers(r.games[gi]).slice(
        0,
        Math.min(4, Object.keys(r.games[gi].players).length)
      )
    );
    setView("chart");
  }, [logs]);

  const game = parsed?.games[gameIdx];
  const allP = game ? sortPlayers(game) : [];

  const selectGame = (i) => {
    setGameIdx(i);
    setSelected(
      sortPlayers(parsed.games[i]).slice(
        0,
        Math.min(4, Object.keys(parsed.games[i].players).length)
      )
    );
  };

  const toggle = (p) =>
    setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  return (
    <div style={{ background: "#0f0f1a", minHeight: "100vh", padding: "20px 16px", fontFamily: "'Inter', system-ui, sans-serif", color: "#e0e0e0" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #4ade80, #22d3ee)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "#0f0f1a" }}>
            P
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: "#fff" }}>
              Parkour Analyzer
            </h1>
            <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
              {watching && logPath ? (
                <>
                  Watching{" "}
                  <span style={{ color: "#4ade80" }}>{logPath}</span>
                </>
              ) : (
                "Compare Parkour Duels checkpoint times"
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {isTauri() && (
              <>
                <div style={{ display: "flex", background: "#1a1a2e", borderRadius: 6, overflow: "hidden" }}>
                  <button onClick={() => { setMode("live"); autoSelectRef.current = true; }} style={{
                    padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500,
                    background: mode === "live" ? "#4ade8030" : "transparent",
                    color: mode === "live" ? "#4ade80" : "#666",
                  }}>
                    Live
                  </button>
                  <button onClick={() => setMode("paste")} style={{
                    padding: "6px 12px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500,
                    background: mode === "paste" ? "#4ade8030" : "transparent",
                    color: mode === "paste" ? "#4ade80" : "#666",
                  }}>
                    Paste
                  </button>
                </div>
                {mode === "live" && (
                  <button onClick={() => setShowSettings(true)} style={{
                    padding: "6px 10px", borderRadius: 6, border: "1px solid #333",
                    background: "transparent", color: "#888", cursor: "pointer", fontSize: 14,
                  }}>
                    ⚙
                  </button>
                )}
              </>
            )}
            {view === "chart" && mode === "paste" && (
              <button onClick={() => { setView("input"); setError(""); }} style={{
                padding: "6px 14px", borderRadius: 6, border: "1px solid #333",
                background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 12,
              }}>
                New Import
              </button>
            )}
          </div>
        </div>

        {/* Settings modal */}
        {showSettings && (
          <PathSettings logPath={logPath} onClose={() => setShowSettings(false)} />
        )}

        {/* Live status */}
        {mode === "live" && watching && (
          <div style={{ background: "#1a1a2e", borderRadius: 8, padding: "8px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", animation: "pulse 2s infinite" }} />
            <span style={{ fontSize: 12, color: "#888" }}>
              Monitoring —{" "}
              {parsed
                ? `${parsed.games.length} game${parsed.games.length !== 1 ? "s" : ""} found`
                : "Waiting for parkour games..."}
            </span>
            <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
          </div>
        )}

        {mode === "live" && !watching && !parsed && (
          <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>🔍</div>
            <div style={{ color: "#888", fontSize: 14 }}>
              Looking for Minecraft log file...
            </div>
            {error && (
              <div style={{ color: "#f87171", fontSize: 13, marginTop: 8 }}>
                {error}
              </div>
            )}
            <div style={{ color: "#555", fontSize: 12, marginTop: 8 }}>
              Make sure Minecraft is installed or click ⚙ to set path manually
            </div>
            <button onClick={() => setShowSettings(true)} style={{
              marginTop: 12, padding: "8px 20px", borderRadius: 6, border: "1px solid #333",
              background: "transparent", color: "#aaa", cursor: "pointer", fontSize: 13,
            }}>
              Set Path Manually
            </button>
          </div>
        )}

        {/* Paste input */}
        {mode === "paste" && view === "input" && (
          <div>
            <textarea value={logs} onChange={(e) => { setLogs(e.target.value); setError(""); }}
              placeholder={"Paste your Minecraft client logs here...\n\nThe parser detects Parkour Duels games, extracts\ncheckpoint times for all players, and lets you\ncompare them on interactive charts."}
              style={{
                width: "100%", minHeight: 300, background: "#1a1a2e",
                border: "1px solid #2a2a3e", borderRadius: 10, padding: 16, color: "#ccc",
                fontSize: 13, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.5,
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <button onClick={handleParse} disabled={!logs.trim()} style={{
                padding: "10px 28px", borderRadius: 8, border: "none",
                cursor: logs.trim() ? "pointer" : "default", fontSize: 14, fontWeight: 600,
                background: logs.trim() ? "#4ade80" : "#2a2a3e",
                color: logs.trim() ? "#0f0f1a" : "#555",
              }}>
                Analyze Logs
              </button>
              {error && (
                <span style={{ color: "#f87171", fontSize: 13 }}>{error}</span>
              )}
            </div>
          </div>
        )}

        {/* Charts */}
        {view === "chart" && game && (
          <div>
            {parsed.games.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                  Select Game ({parsed.games.length} found)
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {parsed.games.map((g, i) => {
                    const pc = Object.keys(g.players).length;
                    const w = sortPlayers(g)[0];
                    const wf = g.players[w]?.find((e) => e.type === "finish");
                    return (
                      <button key={i} onClick={() => selectGame(i)} style={{
                        padding: "6px 14px", borderRadius: 6, cursor: "pointer",
                        fontSize: 12, textAlign: "left",
                        border: gameIdx === i ? "1px solid #4ade80" : "1px solid #2a2a3e",
                        background: gameIdx === i ? "#4ade8018" : "#1a1a2e",
                        color: gameIdx === i ? "#4ade80" : "#aaa",
                      }}>
                        Game {i + 1} — {pc}p{wf ? ` — ${w} won` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                Players ({selected.length} selected)
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {allP.map((p, idx) => {
                  const on = selected.includes(p);
                  const ci = on ? selected.indexOf(p) : idx;
                  const fin = game.players[p].find((e) => e.type === "finish");
                  const cps = game.players[p].filter((e) => e.type === "checkpoint").length;
                  return (
                    <button key={p} onClick={() => toggle(p)} style={{
                      padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                      fontSize: 12, display: "flex", alignItems: "center", gap: 6,
                      border: on ? `1px solid ${COLORS[ci % COLORS.length]}` : "1px solid #2a2a3e",
                      background: on ? `${COLORS[ci % COLORS.length]}18` : "#1a1a2e",
                      color: on ? COLORS[ci % COLORS.length] : "#666",
                    }}>
                      <span style={{ fontWeight: 600 }}>{p}</span>
                      {p === parsed.username && (
                        <span style={{ fontSize: 10, opacity: 0.6 }}>(you)</span>
                      )}
                      <span style={{ fontSize: 10, opacity: 0.7 }}>
                        {fin ? fmtFull(toSec(fin.time)) : `${cps} cp`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selected.length >= 2 ? (
              <Charts game={game} players={selected} username={parsed?.username} />
            ) : (
              <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 40, textAlign: "center", color: "#666" }}>
                Select at least 2 players to compare
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
