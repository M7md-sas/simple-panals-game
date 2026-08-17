import { useRef, useReducer, useEffect, useState, useCallback } from "react";

/* ── palette pulled from a real protection-panel room ───────────── */
const C = {
  room: "#0A0E12",
  steel: "#161C24",
  steelHi: "#1E2630",
  edge: "#2A3543",
  plate: "#8A97A6",
  red: "#FF3B30",
  redDim: "#4A1512",
  hazard: "#F5C518",
  green: "#3DDC97",
};

const CODES = [
  "+8L1A", "+8L2A", "+8L3A",
  "T1-380", "T2-380", "BC-01",
  "R-PV1", "R-PV2", "CAP-1",
];

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const newCells = () =>
  CODES.map((code, id) => ({ id, code, type: null, spawnAt: 0, life: 0, fx: null }));

const newGame = () => ({
  cells: newCells(),
  score: 0,
  lives: 3,
  combo: 0,
  hits: 0,
  level: 1,
  nextSpawn: 0,
  log: [],
  t: 0,
  seq: 1,
  over: false,
  ended: false,
});

export default function TripGame() {
  const [phase, setPhase] = useState("menu");
  const [best, setBest] = useState(0);
  const [haptics, setHaptics] = useState(true);
  const hapticsRef = useRef(true);
  const g = useRef(newGame());
  const [, paint] = useReducer((x) => x + 1, 0);

  useEffect(() => { hapticsRef.current = haptics; }, [haptics]);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("trip:best");
        if (r && r.value) setBest(Number(r.value) || 0);
      } catch { /* first run, nothing stored */ }
    })();
  }, []);

  const buzz = (p) => {
    if (!hapticsRef.current) return;
    try { navigator.vibrate && navigator.vibrate(p); } catch { /* unsupported */ }
  };

  const push = (s, text, tone) => {
    s.log = [{ n: s.seq++, text, tone }, ...s.log].slice(0, 4);
  };

  const finish = useCallback(async (s) => {
    setPhase("over");
    if (s.score > best) {
      setBest(s.score);
      try { await window.storage.set("trip:best", String(s.score)); } catch { /* ignore */ }
    }
  }, [best]);

  /* ── frame loop ─────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== "play") return;
    let raf;
    const loop = () => {
      const s = g.current;
      const t = performance.now();
      s.t = t;

      if (!s.over) {
        for (const c of s.cells) {
          if (!c.type) continue;
          if (t - c.spawnAt < c.life) continue;
          if (c.type === "fault") {
            s.lives -= 1;
            s.combo = 0;
            c.fx = { kind: "miss", at: t };
            push(s, `BREAKER FAILURE  ${c.code}`, "bad");
            buzz([70, 50, 70]);
            if (s.lives <= 0) s.over = true;
          } else {
            s.score += 5;
            c.fx = { kind: "safe", at: t };
            push(s, `LOCKOUT HELD  ${c.code}`, "ok");
          }
          c.type = null;
        }

        if (!s.over && t >= s.nextSpawn) {
          const idle = s.cells.filter((c) => !c.type);
          const cap = s.level >= 14 ? 6 : 5;
          if (idle.length && 9 - idle.length < cap) {
            const c = idle[(Math.random() * idle.length) | 0];
            const lockChance = Math.min(0.16 + s.level * 0.018, 0.4);
            c.type = Math.random() < lockChance ? "lock" : "fault";
            c.spawnAt = t;
            c.life = c.type === "fault"
              ? Math.max(2300 - (s.level - 1) * 140, 720)
              : Math.max(1500 - (s.level - 1) * 55, 800) + Math.random() * 600;
            c.fx = null;
          }
          s.nextSpawn = t + Math.max(1050 - (s.level - 1) * 70, 300) + Math.random() * 220;
        }
      }

      if (s.over && !s.ended) { s.ended = true; finish(s); }
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, finish]);

  const tap = (c) => {
    const s = g.current;
    if (s.over || phase !== "play") return;
    const t = performance.now();

    if (c.type === "fault") {
      const frac = Math.max(0, 1 - (t - c.spawnAt) / c.life);
      const prev = s.level;
      s.combo += 1;
      s.hits += 1;
      s.level = 1 + Math.floor(s.hits / 4);
      const mult = Math.min(1 + Math.floor(s.combo / 4), 5);
      s.score += Math.round((10 + frac * 12) * mult);
      c.type = null;
      c.fx = { kind: "hit", at: t };
      push(s, `TRIP  ${c.code}  x${mult}`, "ok");
      buzz(14);
      if (s.level > prev) { push(s, `SPEED UP  LVL ${s.level}`, "warn"); buzz([12, 60, 12]); }
    } else if (c.type === "lock") {
      s.lives -= 1;
      s.combo = 0;
      c.type = null;
      c.fx = { kind: "bad", at: t };
      push(s, `LOCKOUT VIOLATED  ${c.code}`, "bad");
      buzz([50, 40, 50]);
      if (s.lives <= 0) s.over = true;
    } else {
      s.combo = 0;
      s.score = Math.max(0, s.score - 5);
      c.fx = { kind: "bad", at: t };
      push(s, `FALSE TRIP  ${c.code}`, "warn");
      buzz(25);
    }
    paint();
  };

  const start = () => {
    g.current = newGame();
    g.current.nextSpawn = performance.now() + 600;
    setPhase("play");
  };

  const s = g.current;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          `radial-gradient(120% 60% at 50% 0%, #131A22 0%, ${C.room} 60%)`,
        color: C.plate,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        display: "flex",
        justifyContent: "center",
        padding: "14px 12px 18px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 12 }}>

        {/* engraved labelplate header */}
        <div
          style={{
            background: `linear-gradient(180deg, ${C.steelHi}, ${C.steel})`,
            border: `1px solid ${C.edge}`,
            borderRadius: 4,
            padding: "9px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
          }}
        >
          <div dir="ltr" style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, color: "#5E6B7A" }}>
            380kV &nbsp;PROTECTION PANEL
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: i < s.lives ? C.green : "#232C36",
                  boxShadow: i < s.lives ? `0 0 8px ${C.green}` : "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* score row */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div dir="ltr" style={{ fontFamily: MONO, fontSize: 40, lineHeight: 1, color: "#E7EDF3", letterSpacing: -1 }}>
            {String(s.score).padStart(4, "0")}
          </div>
          <div dir="ltr" style={{ display: "flex", gap: 8, fontFamily: MONO, fontSize: 11 }}>
            <span style={{ border: `1px solid ${C.edge}`, borderRadius: 3, padding: "3px 7px" }}>
              LVL {s.level}
            </span>
            <span
              style={{
                border: `1px solid ${s.combo >= 4 ? C.hazard : C.edge}`,
                color: s.combo >= 4 ? C.hazard : C.plate,
                borderRadius: 3, padding: "3px 7px",
              }}
            >
              x{Math.min(1 + Math.floor(s.combo / 4), 5)}
            </span>
          </div>
        </div>

        {/* busbar + drop stubs */}
        <div style={{ position: "relative", height: 14, marginBottom: -6 }}>
          <div style={{ position: "absolute", top: 3, left: 6, right: 6, height: 2, background: C.edge }} />
          {[16.6, 50, 83.3].map((p) => (
            <div key={p} style={{ position: "absolute", top: 3, left: `${p}%`, width: 2, height: 11, background: C.edge }} />
          ))}
        </div>

        {/* bay grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {s.cells.map((c) => (
            <Bay key={c.id} c={c} t={s.t} onTap={() => tap(c)} />
          ))}
        </div>

        {/* annunciator log */}
        <div
          dir="ltr"
          style={{
            background: "#0D1218",
            border: `1px solid ${C.edge}`,
            borderRadius: 4,
            padding: "8px 10px",
            fontFamily: MONO,
            fontSize: 10.5,
            lineHeight: 1.75,
            minHeight: 82,
          }}
        >
          {s.log.length === 0 && <div style={{ color: "#3B4756" }}>-- NO EVENTS --</div>}
          {s.log.map((l, i) => (
            <div
              key={l.n}
              style={{
                color: l.tone === "bad" ? C.red : l.tone === "warn" ? C.hazard : C.green,
                opacity: 1 - i * 0.22,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {String(l.n).padStart(3, "0")} &nbsp;{l.text}
            </div>
          ))}
        </div>

        <button
          onClick={() => setHaptics((h) => !h)}
          style={{
            alignSelf: "center", background: "transparent", border: "none",
            color: "#4E5B6A", fontSize: 12, padding: 4, cursor: "pointer",
          }}
        >
          {haptics ? "الاهتزاز مفعّل" : "الاهتزاز مطفي"}
        </button>
      </div>

      {phase !== "play" && (
        <Overlay
          phase={phase}
          score={s.score}
          level={s.level}
          best={best}
          onStart={start}
        />
      )}
    </div>
  );
}

/* ── one bay ────────────────────────────────────────────────────── */
function Bay({ c, t, onTap }) {
  const live = !!c.type;
  const frac = live ? Math.max(0, 1 - (t - c.spawnAt) / c.life) : 0;
  const fxAge = c.fx ? t - c.fx.at : 1e9;
  const fxOn = fxAge < 300;
  const strobe = 0.55 + 0.45 * Math.sin(t / 90);

  let border = C.edge;
  let face = `linear-gradient(180deg, ${C.steelHi}, ${C.steel})`;
  let glow = "none";
  if (c.type === "fault") {
    border = C.red;
    face = `linear-gradient(180deg, #2A1013, ${C.redDim})`;
    glow = `0 0 20px rgba(255,59,48,${0.25 + 0.3 * strobe})`;
  } else if (c.type === "lock") {
    border = C.hazard;
    face = "linear-gradient(180deg, #1C1A10, #14130C)";
  }

  const wash =
    fxOn && c.fx
      ? c.fx.kind === "hit" || c.fx.kind === "safe"
        ? `rgba(61,220,151,${0.35 * (1 - fxAge / 300)})`
        : `rgba(255,59,48,${0.45 * (1 - fxAge / 300)})`
      : "transparent";

  return (
    <button
      onPointerDown={(e) => { e.preventDefault(); onTap(); }}
      style={{
        position: "relative",
        aspectRatio: "1 / 1.15",
        background: face,
        border: `1px solid ${border}`,
        borderRadius: 3,
        boxShadow: glow,
        padding: 0,
        overflow: "hidden",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      {/* hazard tape cross — the out-of-service marking */}
      {c.type === "lock" && [34, -34].map((deg) => (
        <span
          key={deg}
          style={{
            position: "absolute", top: "50%", left: "-25%", width: "150%", height: 10,
            transform: `translateY(-50%) rotate(${deg}deg)`,
            background: `repeating-linear-gradient(45deg, ${C.hazard} 0 7px, #14130C 7px 14px)`,
            opacity: 0.95,
          }}
        />
      ))}

      {/* bay code plate */}
      <span
        dir="ltr"
        style={{
          position: "absolute", top: 6, left: 0, right: 0,
          fontFamily: MONO, fontSize: 9.5, letterSpacing: 0.5,
          color: c.type === "fault" ? "#FFB3AE" : "#6D7A89",
        }}
      >
        {c.code}
      </span>

      {/* status lamp */}
      <span
        style={{
          position: "absolute", top: "46%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: 13, height: 13, borderRadius: "50%",
          background: c.type === "fault" ? C.red : c.type === "lock" ? "#14130C" : "#20303B",
          border: c.type === "lock" ? `2px solid ${C.hazard}` : "none",
          opacity: c.type === "fault" ? strobe : 1,
          boxShadow: c.type === "fault" ? `0 0 14px ${C.red}` : "none",
        }}
      />

      {/* legend */}
      {live && (
        <span
          dir="ltr"
          style={{
            position: "absolute", bottom: 12, left: 0, right: 0,
            fontFamily: MONO, fontSize: 8.5, letterSpacing: 1.2,
            color: c.type === "fault" ? C.red : C.hazard,
          }}
        >
          {c.type === "fault" ? "FAULT" : "LOCKED"}
        </span>
      )}

      {/* depleting timer bar */}
      {live && (
        <span
          style={{
            position: "absolute", bottom: 0, left: 0, height: 3,
            width: `${frac * 100}%`,
            background: c.type === "fault" ? C.red : C.hazard,
          }}
        />
      )}

      <span style={{ position: "absolute", inset: 0, background: wash, pointerEvents: "none" }} />
    </button>
  );
}

/* ── menu / game over ───────────────────────────────────────────── */
function Overlay({ phase, score, level, best, onStart }) {
  const over = phase === "over";
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(6,9,12,.93)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div dir="rtl" style={{ width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div dir="ltr" style={{ fontFamily: MONO, fontSize: 46, letterSpacing: 6, color: C.red, textShadow: `0 0 24px ${C.red}` }}>
          TRIP
        </div>
        <div style={{ color: "#5E6B7A", fontSize: 13, marginTop: 4 }}>
          لوحة حماية — افصل الأعطال قبل ما تكبر
        </div>

        {over ? (
          <div dir="ltr" style={{ fontFamily: MONO, margin: "26px 0", color: "#E7EDF3" }}>
            <div style={{ fontSize: 44, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 11, color: "#5E6B7A", marginTop: 8 }}>
              LEVEL {level} &nbsp;·&nbsp; BEST {Math.max(best, score)}
            </div>
          </div>
        ) : (
          <div
            style={{
              margin: "24px 0", textAlign: "right", fontSize: 13.5, lineHeight: 2,
              background: C.steel, border: `1px solid ${C.edge}`, borderRadius: 4, padding: "12px 14px",
            }}
          >
            <div>المربع الأحمر عطل — اضغطه قبل ما يخلص الشريط</div>
            <div>المربع المخطط بالأصفر تحت الصيانة — لا تلمسه</div>
            <div>الضغط على مربع فاضي يكسر لك المضاعف</div>
            <div>عندك 3 محاولات بس</div>
          </div>
        )}

        <button
          onClick={onStart}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 4,
            background: C.red, border: "none", color: "#0A0E12",
            fontSize: 16, fontWeight: 700, cursor: "pointer",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {over ? "مرة ثانية" : "ابدأ الوردية"}
        </button>
      </div>
    </div>
  );
}
