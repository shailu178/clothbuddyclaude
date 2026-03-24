import { useState, useEffect, useRef, useCallback } from "react";

// ─── GOOGLE CLIENT ID ─────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "995973297845-ss1q55o65p7kh0jj6hg4augngdkkfe5n.apps.googleusercontent.com";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg:"#0F0D0B", surface:"#1A1714", card:"#221F1B", border:"#2E2A25",
  accent:"#C9956A", gold:"#D4AF6E", rose:"#C4847A", purple:"#9B8EC4",
  text:"#F5F0E8", muted:"#8A7E72", success:"#7AB89A", error:"#C47A7A",
};

// ─── API ──────────────────────────────────────────────────────────────────────
async function askClaude(system, userText, maxTokens = 800) {
  const res = await fetch("/api/chat", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:maxTokens, system, messages:[{role:"user",content:userText}] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const d = await res.json();
  return d.content?.[0]?.text || "";
}

async function streamClaude(messages, system, onChunk) {
  const res = await fetch("/api/chat", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, stream:true, system, messages }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    buf += dec.decode(value,{stream:true});
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith("data: ")) { try { const j=JSON.parse(line.slice(6)); if(j.type==="content_block_delta"&&j.delta?.text) onChunk(j.delta.text); } catch {} }
    }
  }
}

function safeJSON(text) { try { return JSON.parse(text.replace(/```json|```/g,"").trim()); } catch { return null; } }

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
const LS = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del: (key) => { try { localStorage.removeItem(key); } catch {} },
};

// ─── DEFAULT WARDROBE ─────────────────────────────────────────────────────────
const DEFAULT_WARDROBE = [
  {id:1,name:"Silk Cream Blouse",category:"Tops",colorName:"Cream",occasions:["Work","Casual"],wears:12,price:89,img:"👚",section:"active"},
  {id:2,name:"Wide Leg Trousers",category:"Bottoms",colorName:"Charcoal",occasions:["Work","Formal"],wears:8,price:145,img:"👖",section:"active"},
  {id:3,name:"Camel Blazer",category:"Outerwear",colorName:"Camel",occasions:["Work","Formal"],wears:15,price:210,img:"🧥",section:"active"},
  {id:4,name:"Linen Midi Dress",category:"Dresses",colorName:"Sand",occasions:["Casual","Date Night"],wears:5,price:120,img:"👗",section:"active"},
  {id:5,name:"White Sneakers",category:"Shoes",colorName:"White",occasions:["Casual","Sport"],wears:30,price:95,img:"👟",section:"active"},
  {id:6,name:"Pointed Mules",category:"Shoes",colorName:"Tan",occasions:["Work","Formal","Date Night"],wears:7,price:175,img:"👠",section:"active"},
  {id:7,name:"Gold Chain Necklace",category:"Accessories",colorName:"Gold",occasions:["All"],wears:22,price:65,img:"📿",section:"active"},
  {id:8,name:"Black Turtleneck",category:"Tops",colorName:"Black",occasions:["Casual","Work","Date Night"],wears:18,price:75,img:"👕",section:"active"},
  {id:9,name:"Silk Slip Skirt",category:"Bottoms",colorName:"Mauve",occasions:["Date Night","Casual"],wears:3,price:98,img:"🩱",section:"active"},
  {id:10,name:"Leather Belt",category:"Accessories",colorName:"Brown",occasions:["All"],wears:25,price:55,img:"🪢",section:"active"},
  {id:11,name:"Cashmere Sweater",category:"Tops",colorName:"Wheat",occasions:["Casual","Work"],wears:9,price:185,img:"🧶",section:"trunk"},
  {id:12,name:"Ankle Boots",category:"Shoes",colorName:"Dark Brown",occasions:["Casual","Work"],wears:14,price:220,img:"👢",section:"active"},
];

function fmt(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const today = new Date();
const INIT_LOG = {
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-1))]:{items:[3,2,6],note:"Client meeting"},
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-3))]:{items:[8,9,7],note:"Dinner out"},
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-5))]:{items:[11,5,10],note:"Weekend"},
};

// ─── BUILD SYSTEM PROMPT ──────────────────────────────────────────────────────
function buildSys(profile, wardrobe) {
  const w = (wardrobe || DEFAULT_WARDROBE).filter(i=>i.section==="active");
  const WS = w.map(i=>`${i.name} (${i.category}, ${i.colorName}, ${i.occasions.join("/")})`).join("; ");
  const gender = profile?.gender || "Female";
  const age = profile?.age || "";
  const shape = profile?.bodyShape || "";
  const season = profile?.colorSeason || "Autumn";
  const vibe = profile?.styleVibe || "Classic";
  const loc = profile?.location || "Dubai";
  const goals = profile?.goals?.join(", ") || "";
  return `You are ClothBuddy, a warm expert personal stylist AI.
User profile: ${gender}${age?`, ${age} years old`:""}${shape?`, ${shape} body shape`:""}, ${season} color season, ${vibe} style archetype, based in ${loc}.${goals?` Style goals: ${goals}.`:""}
Active wardrobe: ${WS}.
Rules: reference specific item names, tailor advice to gender/body shape, be concise (2-4 sentences), use occasional tasteful emojis.`;
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const Spin = ({s=20}) => <div style={{width:s,height:s,borderRadius:"50%",border:`2px solid ${C.border}`,borderTopColor:C.accent,animation:"spin 0.8s linear infinite",flexShrink:0}}/>;
const AIBadge = () => <span style={{background:`${C.accent}22`,color:C.accent,fontSize:10,padding:"2px 8px",borderRadius:20,fontWeight:700}}>✦ AI</span>;
const Err = ({msg,onRetry}) => <div onClick={onRetry} style={{background:`${C.error}18`,border:`1px solid ${C.error}44`,borderRadius:12,padding:"10px 14px",color:C.error,fontSize:12,marginTop:8,cursor:onRetry?"pointer":"default"}}>{msg}{onRetry?" Tap to retry.":""}</div>;
const Tag = ({label,color}) => <span style={{background:`${color||C.accent}18`,color:color||C.accent,fontSize:10,padding:"3px 9px",borderRadius:20,fontWeight:600}}>{label}</span>;

const Ico = ({d,s=20}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {(Array.isArray(d)?d:[d]).map((p,i)=><path key={i} d={p}/>)}
  </svg>
);
const IC = {
  home:["M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z","M9 22V12h6v10"],
  hanger:["M12 3a2 2 0 100 4","M12 7v2","M5 21h14l-7-12-7 12z"],
  spark:["M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z","M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75L19 13z"],
  user2:["M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2","M12 11a4 4 0 100-8 4 4 0 000 8z"],
  cal:["M3 4h18v18H3z","M16 2v4","M8 2v4","M3 10h18"],
  tryon:["M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z","M4 22v-1a8 8 0 0116 0v1"],
  gap:["M12 20V10","M18 20V4","M6 20v-6"],
  compass:["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z","M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"],
  send:["M22 2L11 13","M22 2L15 22l-4-9-9-4 22-7z"],
  refresh:["M23 4v6h-6","M1 20v-6h6","M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"],
  edit:["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7","M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"],
  logout:["M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4","M16 17l5-5-5-5","M21 12H9"],
  crown:["M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"],
  swipe:["M7 16l-4-4 4-4","M3 12h18","M17 8l4 4-4 4"],
  box:["M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"],
  archive:["M21 8v13H3V8","M1 3h22v5H1z","M10 12h4"],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 1. GOOGLE LOGIN SCREEN ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function GoogleLoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true;
    script.onload = () => {
      if (!window.google) return;
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential, auto_select: false });
      window.google.accounts.id.renderButton(document.getElementById("google-btn"), { theme:"filled_black", size:"large", width:320, text:"continue_with", shape:"pill" });
    };
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  const handleCredential = (response) => {
    setLoading(true); setErr(null);
    try {
      const payload = JSON.parse(atob(response.credential.split(".")[1]));
      onLogin({ id:payload.sub, name:payload.name, email:payload.email, picture:payload.picture, token:response.credential });
    } catch { setErr("Login failed. Please try again."); }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:28,background:C.bg}}>
      <div style={{marginBottom:40,textAlign:"center"}}>
        <div style={{fontSize:72,marginBottom:16}}>🛍️</div>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:44,color:C.text,fontWeight:400,lineHeight:1.1,marginBottom:8}}>ClothBuddy</h1>
        <p style={{color:C.muted,fontSize:15,lineHeight:1.6}}>Your AI personal stylist,<br/>powered by Claude.</p>
      </div>
      <div style={{width:"100%",maxWidth:340,marginBottom:36,display:"flex",flexDirection:"column",gap:10}}>
        {[["✨","AI Outfit Generator","Claude styles from your closet"],["📅","Outfit Calendar","Track & log what you wear"],["🕵️","Gap Analysis","Find exactly what's missing"],["👗","Tinder Swipe","Pick today's outfit with a swipe"]].map(([icon,title,sub])=>(
          <div key={title} style={{display:"flex",alignItems:"center",gap:14,background:C.card,borderRadius:16,padding:"12px 16px",border:`1px solid ${C.border}`}}>
            <span style={{fontSize:22,flexShrink:0}}>{icon}</span>
            <div><p style={{color:C.text,fontSize:13,fontWeight:600}}>{title}</p><p style={{color:C.muted,fontSize:11}}>{sub}</p></div>
          </div>
        ))}
      </div>
      <div style={{width:"100%",maxWidth:340}}>
        {loading ? <div style={{display:"flex",justifyContent:"center",padding:20}}><Spin s={28}/></div> : <div id="google-btn" style={{display:"flex",justifyContent:"center",minHeight:44}}/>}
        {err && <Err msg={err}/>}
        <p style={{color:C.muted,fontSize:11,textAlign:"center",marginTop:16,lineHeight:1.6}}>By continuing, you agree to our Terms of Service.<br/>Your data stays on your device.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 2. CAMERA PERMISSION SCREEN ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function CameraPermissionScreen({ onNext }) {
  const [status, setStatus] = useState("idle"); // idle | granted | denied

  const request = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true });
      setStatus("granted");
      setTimeout(() => onNext("granted"), 800);
    } catch {
      setStatus("denied");
    }
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:C.bg,textAlign:"center"}}>
      <div style={{fontSize:80,marginBottom:24}}>📸</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400,marginBottom:12}}>Allow Camera Access</h2>
      <p style={{color:C.muted,fontSize:14,lineHeight:1.7,marginBottom:36,maxWidth:300}}>ClothBuddy uses your camera to scan outfit photos from social media and identify individual clothing pieces instantly.</p>
      <div style={{width:"100%",maxWidth:320,display:"flex",flexDirection:"column",gap:12}}>
        {[["📷","Scan outfit photos","Identify any piece from a photo"],["🔍","Outfit Scanner","Paste TikTok or Instagram links"],["✨","Wardrobe matching","See if you own something similar"]].map(([icon,title,sub])=>(
          <div key={title} style={{display:"flex",gap:14,background:C.card,borderRadius:14,padding:"12px 16px",border:`1px solid ${C.border}`,textAlign:"left",alignItems:"center"}}>
            <span style={{fontSize:20,flexShrink:0}}>{icon}</span>
            <div><p style={{color:C.text,fontSize:12,fontWeight:600}}>{title}</p><p style={{color:C.muted,fontSize:11}}>{sub}</p></div>
          </div>
        ))}
      </div>
      <div style={{marginTop:36,width:"100%",maxWidth:320}}>
        {status === "granted" && <div style={{background:`${C.success}22`,border:`1px solid ${C.success}44`,borderRadius:14,padding:14,color:C.success,fontWeight:600,marginBottom:12}}>✓ Camera access granted!</div>}
        {status === "denied" && <div style={{background:`${C.error}18`,border:`1px solid ${C.error}44`,borderRadius:14,padding:12,color:C.error,fontSize:12,marginBottom:12}}>Camera denied — you can enable it in Settings later.</div>}
        <button onClick={status==="denied"?()=>onNext("denied"):request}
          style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:10}}>
          {status==="denied" ? "Continue Anyway →" : "Allow Camera Access"}
        </button>
        <button onClick={()=>onNext("skipped")} style={{width:"100%",background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer",padding:8}}>Not now, skip</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 3. IMPROVED ONBOARDING (9 steps) ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
const COLOR_PALETTES = [
  { id:"Spring", label:"Spring", emoji:"🌸", colors:["#F4C2C2","#FFD59E","#B5EAD7","#FFDAC1"], desc:"Warm, clear, light" },
  { id:"Summer", label:"Summer", emoji:"🌊", colors:["#C9D6E3","#E8C4C4","#B8D4C8","#D4B8C8"], desc:"Cool, soft, muted" },
  { id:"Autumn", label:"Autumn", emoji:"🍁", colors:["#C9956A","#D4AF6E","#8B6355","#C4847A"], desc:"Warm, rich, earthy" },
  { id:"Winter", label:"Winter", emoji:"❄️", colors:["#2C3E6B","#C41E3A","#1A1A2E","#F0F0F0"], desc:"Cool, clear, deep" },
];

const STYLE_VIBES_FEMALE = [
  {id:"Minimalist",emoji:"🤍",desc:"Clean lines, neutral tones"},
  {id:"Classic",emoji:"🌹",desc:"Timeless, polished looks"},
  {id:"Bohemian",emoji:"🌿",desc:"Flowy, earthy, free-spirited"},
  {id:"Edgy",emoji:"⚡",desc:"Bold, unexpected, dark"},
  {id:"Romantic",emoji:"🌸",desc:"Soft, feminine, delicate"},
  {id:"Streetwear",emoji:"🔥",desc:"Urban, casual, sporty"},
];
const STYLE_VIBES_MALE = [
  {id:"Classic",emoji:"🎩",desc:"Sharp, timeless, refined"},
  {id:"Smart Casual",emoji:"👔",desc:"Polished but relaxed"},
  {id:"Streetwear",emoji:"🔥",desc:"Urban, bold, street-ready"},
  {id:"Minimalist",emoji:"⬛",desc:"Clean, simple, understated"},
  {id:"Sporty",emoji:"🏀",desc:"Athletic, functional, fresh"},
  {id:"Business",emoji:"💼",desc:"Boardroom-ready, sharp"},
];

function OnboardingScreen({ user, onDone }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({ gender:null, ageGroup:null, bodyShape:null, location:"Dubai", colorSeason:null, styleVibe:null, goals:[], painPoints:[], howYouWantToFeel:null });

  const STEPS = [
    "gender","ageGroup","bodyShape","goals","painPoints","howYouWantToFeel","colorSeason","styleVibe","location"
  ];
  const s = STEPS[step];
  const total = STEPS.length;

  const canNext = () => {
    if (s==="gender") return !!data.gender;
    if (s==="ageGroup") return !!data.ageGroup;
    if (s==="bodyShape") return !!data.bodyShape;
    if (s==="goals") return data.goals.length > 0;
    if (s==="painPoints") return data.painPoints.length > 0;
    if (s==="howYouWantToFeel") return !!data.howYouWantToFeel;
    if (s==="colorSeason") return !!data.colorSeason;
    if (s==="styleVibe") return !!data.styleVibe;
    if (s==="location") return !!data.location.trim();
    return true;
  };

  const next = () => { if (step < total-1) setStep(s=>s+1); else onDone(data); };
  const back = () => { if (step > 0) setStep(s=>s-1); };
  const toggle = (key, val) => setData(d=>({ ...d, [key]: d[key].includes(val) ? d[key].filter(x=>x!==val) : [...d[key], val] }));

  const FEMALE_SHAPES = [{id:"Hourglass",emoji:"⌛",desc:"Balanced bust & hips, defined waist"},{id:"Pear",emoji:"🍐",desc:"Hips wider than shoulders"},{id:"Apple",emoji:"🍎",desc:"Fuller midsection, narrower hips"},{id:"Rectangle",emoji:"📏",desc:"Similar bust, waist & hips"},{id:"Inverted Triangle",emoji:"🔺",desc:"Broader shoulders, narrower hips"}];
  const MALE_SHAPES = [{id:"Athletic",emoji:"💪",desc:"Broad shoulders, narrow waist"},{id:"Rectangle",emoji:"📏",desc:"Similar chest, waist & hips"},{id:"Triangle",emoji:"🔻",desc:"Wider waist, narrower shoulders"},{id:"Oval",emoji:"⭕",desc:"Fuller midsection"},{id:"Trapezoid",emoji:"🏠",desc:"Broad chest, tapered waist"}];
  const shapes = data.gender==="Male" ? MALE_SHAPES : FEMALE_SHAPES;
  const vibes = data.gender==="Male" ? STYLE_VIBES_MALE : STYLE_VIBES_FEMALE;

  const AGE_GROUPS = ["Under 18","18–24","25–34","35–44","45–54","55+"];
  const GOALS = ["Build a capsule wardrobe","Stop buying things I don't wear","Look more put-together daily","Dress better for my body","Find my personal style","Save money on clothes"];
  const PAIN_POINTS = ["I have nothing to wear","I repeat the same outfits","I don't know what suits me","My wardrobe feels chaotic","I buy impulsively","I struggle with occasions"];
  const FEELINGS = [{id:"Confident",emoji:"💪"},{id:"Effortless",emoji:"✨"},{id:"Polished",emoji:"💎"},{id:"Creative",emoji:"🎨"},{id:"Comfortable",emoji:"☁️"},{id:"Powerful",emoji:"⚡"}];

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{padding:"20px 24px 0",display:"flex",alignItems:"center",gap:12}}>
        {user?.picture && <img src={user.picture} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover"}}/>}
        <p style={{color:C.muted,fontSize:12}}>{user?.name?.split(" ")[0]}'s style profile</p>
        <p style={{color:C.muted,fontSize:12,marginLeft:"auto"}}>{step+1}/{total}</p>
      </div>
      {/* Progress bar */}
      <div style={{height:3,background:C.border,margin:"12px 24px 0"}}>
        <div style={{height:"100%",width:`${((step+1)/total)*100}%`,background:`linear-gradient(90deg,${C.accent},${C.gold})`,borderRadius:2,transition:"width 0.4s ease"}}/>
      </div>

      <div style={{flex:1,padding:"24px 24px 0",display:"flex",flexDirection:"column",overflowY:"auto"}}>

        {/* GENDER */}
        {s==="gender" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>How do you identify?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Personalises every style recommendation</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[{id:"Female",emoji:"👩",label:"Female"},{id:"Male",emoji:"👨",label:"Male"},{id:"Non-binary",emoji:"🧑",label:"Non-binary"},{id:"Prefer not to say",emoji:"🤍",label:"Prefer not to say"}].map(g=>(
              <button key={g.id} onClick={()=>setData(d=>({...d,gender:g.id,bodyShape:null}))}
                style={{background:data.gender===g.id?`${C.accent}22`:C.card,border:`2px solid ${data.gender===g.id?C.accent:C.border}`,borderRadius:18,padding:"22px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                <span style={{fontSize:38}}>{g.emoji}</span>
                <span style={{color:data.gender===g.id?C.accent:C.text,fontSize:14,fontWeight:600}}>{g.label}</span>
              </button>
            ))}
          </div>
        </>}

        {/* AGE GROUP */}
        {s==="ageGroup" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>Your age group?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Helps tailor age-appropriate style advice</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {AGE_GROUPS.map(a=>(
              <button key={a} onClick={()=>setData(d=>({...d,ageGroup:a}))}
                style={{background:data.ageGroup===a?`${C.accent}22`:C.card,border:`2px solid ${data.ageGroup===a?C.accent:C.border}`,borderRadius:14,padding:"16px 20px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:data.ageGroup===a?C.accent:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{a}</span>
                {data.ageGroup===a && <span style={{color:C.accent,fontSize:18}}>✓</span>}
              </button>
            ))}
          </div>
        </>}

        {/* BODY SHAPE */}
        {s==="bodyShape" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>Your body shape?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Claude styles to flatter your proportions</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {shapes.map(sh=>(
              <button key={sh.id} onClick={()=>setData(d=>({...d,bodyShape:sh.id}))}
                style={{background:data.bodyShape===sh.id?`${C.accent}22`:C.card,border:`2px solid ${data.bodyShape===sh.id?C.accent:C.border}`,borderRadius:16,padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:14,textAlign:"left"}}>
                <span style={{fontSize:28,flexShrink:0}}>{sh.emoji}</span>
                <div style={{flex:1}}><p style={{color:data.bodyShape===sh.id?C.accent:C.text,fontSize:15,fontWeight:600,marginBottom:2}}>{sh.id}</p><p style={{color:C.muted,fontSize:12}}>{sh.desc}</p></div>
                {data.bodyShape===sh.id && <span style={{color:C.accent,fontSize:18,flexShrink:0}}>✓</span>}
              </button>
            ))}
          </div>
        </>}

        {/* GOALS */}
        {s==="goals" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>What are your goals?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Select all that apply</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {GOALS.map(g=>{
              const sel = data.goals.includes(g);
              return(<button key={g} onClick={()=>toggle("goals",g)}
                style={{background:sel?`${C.accent}22`:C.card,border:`2px solid ${sel?C.accent:C.border}`,borderRadius:14,padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                <span style={{color:sel?C.accent:C.text,fontSize:14}}>{g}</span>
                <div style={{width:22,height:22,borderRadius:"50%",border:`2px solid ${sel?C.accent:C.border}`,background:sel?C.accent:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {sel&&<span style={{color:"#0F0D0B",fontSize:12,fontWeight:700}}>✓</span>}
                </div>
              </button>);
            })}
          </div>
        </>}

        {/* PAIN POINTS */}
        {s==="painPoints" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>What makes outfit building hard?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Select all that apply</p>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {PAIN_POINTS.map(p=>{
              const sel = data.painPoints.includes(p);
              return(<button key={p} onClick={()=>toggle("painPoints",p)}
                style={{background:sel?`${C.rose}18`:C.card,border:`2px solid ${sel?C.rose:C.border}`,borderRadius:14,padding:"14px 18px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
                <span style={{color:sel?C.rose:C.text,fontSize:14}}>{p}</span>
                <div style={{width:22,height:22,borderRadius:"50%",border:`2px solid ${sel?C.rose:C.border}`,background:sel?C.rose:"transparent",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {sel&&<span style={{color:"#0F0D0B",fontSize:12,fontWeight:700}}>✓</span>}
                </div>
              </button>);
            })}
          </div>
        </>}

        {/* HOW YOU WANT TO FEEL */}
        {s==="howYouWantToFeel" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>How do you want to feel?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>When you get dressed in the morning</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {FEELINGS.map(f=>(
              <button key={f.id} onClick={()=>setData(d=>({...d,howYouWantToFeel:f.id}))}
                style={{background:data.howYouWantToFeel===f.id?`${C.gold}22`:C.card,border:`2px solid ${data.howYouWantToFeel===f.id?C.gold:C.border}`,borderRadius:18,padding:"20px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
                <span style={{fontSize:34}}>{f.emoji}</span>
                <span style={{color:data.howYouWantToFeel===f.id?C.gold:C.text,fontSize:14,fontWeight:600}}>{f.id}</span>
              </button>
            ))}
          </div>
        </>}

        {/* COLOR PALETTE PICKER */}
        {s==="colorSeason" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>Your color season?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:24}}>Filters colors that look best on you</p>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {COLOR_PALETTES.map(p=>(
              <button key={p.id} onClick={()=>setData(d=>({...d,colorSeason:p.id}))}
                style={{background:data.colorSeason===p.id?`${C.accent}18`:C.card,border:`2px solid ${data.colorSeason===p.id?C.accent:C.border}`,borderRadius:18,padding:"16px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,textAlign:"left"}}>
                <span style={{fontSize:30,flexShrink:0}}>{p.emoji}</span>
                <div style={{flex:1}}>
                  <p style={{color:data.colorSeason===p.id?C.accent:C.text,fontSize:15,fontWeight:600,marginBottom:4}}>{p.label}</p>
                  <p style={{color:C.muted,fontSize:11,marginBottom:8}}>{p.desc}</p>
                  {/* Color swatches */}
                  <div style={{display:"flex",gap:6}}>
                    {p.colors.map((col,i)=><div key={i} style={{width:22,height:22,borderRadius:"50%",background:col,border:`1px solid ${C.border}`}}/>)}
                  </div>
                </div>
                {data.colorSeason===p.id && <span style={{color:C.accent,fontSize:20,flexShrink:0}}>✓</span>}
              </button>
            ))}
          </div>
        </>}

        {/* STYLE VIBE */}
        {s==="styleVibe" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>Your style vibe?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:24}}>Defines your personal aesthetic</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {vibes.map(v=>(
              <button key={v.id} onClick={()=>setData(d=>({...d,styleVibe:v.id}))}
                style={{background:data.styleVibe===v.id?`${C.accent}22`:C.card,border:`2px solid ${data.styleVibe===v.id?C.accent:C.border}`,borderRadius:18,padding:"18px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                <span style={{fontSize:32}}>{v.emoji}</span>
                <span style={{color:data.styleVibe===v.id?C.accent:C.text,fontSize:13,fontWeight:600,textAlign:"center"}}>{v.id}</span>
                <span style={{color:C.muted,fontSize:10,textAlign:"center",lineHeight:1.3}}>{v.desc}</span>
              </button>
            ))}
          </div>
        </>}

        {/* LOCATION */}
        {s==="location" && <>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,color:C.text,fontWeight:400,marginBottom:6}}>Where are you based?</h2>
          <p style={{color:C.muted,fontSize:14,marginBottom:28}}>Climate shapes every outfit suggestion</p>
          <input value={data.location} onChange={e=>setData(d=>({...d,location:e.target.value}))} placeholder="City, Country"
            style={{width:"100%",background:C.card,border:`2px solid ${C.border}`,borderRadius:16,padding:"16px 20px",color:C.text,fontSize:18,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:16}}/>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {["Dubai 🇦🇪","London 🇬🇧","New York 🇺🇸","Paris 🇫🇷","Sydney 🇦🇺","Singapore 🇸🇬","Toronto 🇨🇦","Mumbai 🇮🇳"].map(loc=>(
              <button key={loc} onClick={()=>setData(d=>({...d,location:loc.split(" ")[0]}))}
                style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"8px 14px",color:C.muted,fontSize:12,cursor:"pointer"}}>{loc}</button>
            ))}
          </div>
        </>}
      </div>

      {/* Navigation */}
      <div style={{padding:"16px 24px 32px",display:"flex",gap:10,flexShrink:0}}>
        {step > 0 && <button onClick={back} style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:16,cursor:"pointer",fontSize:15}}>← Back</button>}
        <button onClick={next} disabled={!canNext()}
          style={{flex:2,background:canNext()?C.accent:C.border,color:canNext()?"#0F0D0B":C.muted,border:"none",borderRadius:14,padding:16,fontWeight:700,cursor:canNext()?"pointer":"default",fontSize:15}}>
          {step===total-1 ? "Build My Profile ✦" : "Next →"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 4. LOADING SCREEN — BUILDING PROFILE ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function BuildingProfileScreen({ onDone }) {
  const [progress, setProgress] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const MSGS = [
    "Analysing your style vibe…",
    "Mapping your color season…",
    "Studying your body shape…",
    "Calibrating outfit formulas…",
    "Curating your personal AI…",
    "Almost there…",
    "ClothBuddy is ready ✦",
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(p => {
        const next = Math.min(p + (100 / (MSGS.length * 8)), 100);
        return next;
      });
      setMsgIdx(i => Math.min(Math.floor(progress / (100/MSGS.length)), MSGS.length-1));
    }, 120);
    const done = setTimeout(() => { clearInterval(interval); onDone(); }, MSGS.length * 120 * 8 + 200);
    return () => { clearInterval(interval); clearTimeout(done); };
  }, [progress]);

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:C.bg,textAlign:"center"}}>
      <div style={{fontSize:72,marginBottom:32,animation:"float 2s ease-in-out infinite"}}>🛍️</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:C.text,fontWeight:400,marginBottom:8}}>Building your profile</h2>
      <p style={{color:C.accent,fontSize:14,marginBottom:40,minHeight:20,transition:"opacity 0.3s"}}>{MSGS[msgIdx]}</p>
      {/* Progress bar */}
      <div style={{width:"100%",maxWidth:320,height:6,background:C.border,borderRadius:3,overflow:"hidden",marginBottom:16}}>
        <div style={{height:"100%",width:`${progress}%`,background:`linear-gradient(90deg,${C.accent},${C.gold})`,borderRadius:3,transition:"width 0.12s ease"}}/>
      </div>
      <p style={{color:C.muted,fontSize:12}}>{Math.round(progress)}%</p>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 5. SUBSCRIPTION PAYWALL ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function PaywallScreen({ onSubscribe, onSkip }) {
  const [selected, setSelected] = useState("annual");
  const PLANS = [
    { id:"weekly", label:"Weekly", price:"$X.XX", sub:"per week", badge:null },
    { id:"monthly", label:"Monthly", price:"$X.XX", sub:"per month", badge:null },
    { id:"annual", label:"Annual", price:"$XX.XX", sub:"per year", badge:"Best Value 🔥" },
  ];
  const FEATURES = [
    "✨ Unlimited AI outfit generation",
    "📊 Full gap analysis",
    "🧍 Try-on studio",
    "💬 Unlimited style chat",
    "📅 Outfit calendar + insights",
    "🔄 Sync across all devices",
    "👗 Tinder outfit swiper",
    "📸 Outfit scanner (camera)",
  ];
  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column"}}>
      {/* Hero */}
      <div style={{background:`linear-gradient(160deg,${C.accent}22,${C.gold}11,${C.bg})`,padding:"60px 28px 32px",textAlign:"center"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:8,background:`${C.gold}22`,border:`1px solid ${C.gold}44`,borderRadius:20,padding:"6px 16px",marginBottom:20}}>
          <Ico d={IC.crown} s={14}/>
          <span style={{color:C.gold,fontSize:12,fontWeight:700,letterSpacing:1}}>CLOTHBUDDY PRO</span>
        </div>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,color:C.text,fontWeight:400,lineHeight:1.2,marginBottom:12}}>Dress your best,<br/><em style={{color:C.accent}}>every single day.</em></h1>
        <p style={{color:C.muted,fontSize:14,lineHeight:1.6}}>Your full AI wardrobe stylist, unlocked.</p>
      </div>

      <div style={{flex:1,padding:"0 24px 32px",overflowY:"auto"}}>
        {/* Features */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:24}}>
          {FEATURES.map(f=>(
            <div key={f} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{color:C.text,fontSize:13}}>{f}</span>
            </div>
          ))}
        </div>

        {/* Plans */}
        <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Choose your plan</p>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
          {PLANS.map(p=>(
            <button key={p.id} onClick={()=>setSelected(p.id)}
              style={{background:selected===p.id?`${C.accent}22`:C.card,border:`2px solid ${selected===p.id?C.accent:C.border}`,borderRadius:16,padding:"16px 20px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",textAlign:"left"}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                  <span style={{color:selected===p.id?C.accent:C.text,fontSize:15,fontWeight:600}}>{p.label}</span>
                  {p.badge && <span style={{background:`${C.gold}22`,color:C.gold,fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{p.badge}</span>}
                </div>
                <span style={{color:C.muted,fontSize:12}}>{p.sub}</span>
              </div>
              <div style={{textAlign:"right"}}>
                <p style={{color:selected===p.id?C.accent:C.text,fontSize:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>{p.price}</p>
              </div>
            </button>
          ))}
        </div>

        {/* CTA */}
        <button onClick={()=>onSubscribe(selected)}
          style={{width:"100%",background:`linear-gradient(135deg,${C.accent},${C.gold})`,color:"#0F0D0B",border:"none",borderRadius:16,padding:18,fontWeight:700,fontSize:16,cursor:"pointer",marginBottom:12}}>
          Start Free Trial →
        </button>
        <button onClick={onSkip} style={{width:"100%",background:"none",border:"none",color:C.muted,fontSize:13,cursor:"pointer",padding:8}}>
          Maybe later — continue free
        </button>
        <p style={{color:C.muted,fontSize:10,textAlign:"center",marginTop:12,lineHeight:1.6}}>Cancel anytime. Prices shown are placeholders.</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── 6. TINDER OUTFIT SWIPER ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function OutfitSwiperScreen({ profile, wardrobe, onClose }) {
  const [outfits, setOutfits] = useState([]);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [wornToday, setWornToday] = useState(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const cardRef = useRef(null);

  useEffect(() => {
    const generate = async () => {
      setLoading(true);
      const sys = buildSys(profile, wardrobe);
      try {
        const raw = await askClaude(sys,
          `Generate 6 complete outfit suggestions for today. Return ONLY JSON array:\n[{"name":"creative outfit name","items":["exact item name 1","exact item name 2","exact item name 3"],"vibe":"3 word vibe","occasion":"best occasion","score":88}]`, 600);
        const p = safeJSON(raw);
        if (p && p.length) setOutfits(p);
      } catch {}
      setLoading(false);
    };
    generate();
  }, []);

  const onDragStart = (clientX) => { startX.current = clientX; setDragging(true); };
  const onDragMove = (clientX) => { if (!dragging) return; setDragX(clientX - startX.current); };
  const onDragEnd = () => {
    if (Math.abs(dragX) > 100) {
      if (dragX > 0) handleWear(); else handleSkip();
    } else setDragX(0);
    setDragging(false);
  };

  const handleWear = () => {
    setWornToday(outfits[idx]);
  };
  const handleSkip = () => {
    setDragX(0);
    setIdx(i => i + 1);
  };

  const active = wardrobe.filter(w=>w.section==="active");
  const getEmojis = (outfit) => outfit.items.map(n => {
    const f = active.find(w=>w.name.toLowerCase().includes(n.toLowerCase().split(" ").slice(-1)[0]));
    return f?.img || "👔";
  });

  if (wornToday) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
      <div style={{fontSize:80,marginBottom:20}}>🎉</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400,marginBottom:8}}>Outfit locked in!</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:32}}>{wornToday.name}</p>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:24,marginBottom:32,width:"100%",maxWidth:320}}>
        <div style={{display:"flex",justifyContent:"center",gap:12,fontSize:44,marginBottom:16}}>{getEmojis(wornToday).map((e,i)=><span key={i}>{e}</span>)}</div>
        {wornToday.items.map((item,i)=><p key={i} style={{color:C.text,fontSize:13,padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>{item}</p>)}
        <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center"}}>
          <span style={{background:`${C.accent}18`,color:C.accent,fontSize:11,padding:"4px 12px",borderRadius:20}}>{wornToday.vibe}</span>
          <span style={{background:`${C.gold}18`,color:C.gold,fontSize:11,padding:"4px 12px",borderRadius:20}}>{wornToday.occasion}</span>
        </div>
      </div>
      <button onClick={onClose} style={{width:"100%",maxWidth:320,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:"pointer"}}>Let's Go! ✨</button>
    </div>
  );

  if (loading) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <Spin s={36}/><p style={{color:C.muted,fontSize:14}}>Claude is styling your outfits…</p>
    </div>
  );

  if (idx >= outfits.length) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
      <div style={{fontSize:64,marginBottom:20}}>😅</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:C.text,fontWeight:400,marginBottom:8}}>You've seen them all!</h2>
      <p style={{color:C.muted,fontSize:14,marginBottom:24}}>No outfit caught your eye today?</p>
      <button onClick={()=>{setIdx(0);setOutfits([]);setLoading(true);}} style={{background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:"14px 28px",fontWeight:700,cursor:"pointer",marginBottom:10}}>Generate New Outfits</button>
      <button onClick={onClose} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13}}>Back to Home</button>
    </div>
  );

  const outfit = outfits[idx];
  const emojis = getEmojis(outfit);
  const rotation = dragX * 0.08;
  const opacity = Math.max(0, 1 - Math.abs(dragX) / 300);
  const swipeLeft = dragX < -60;
  const swipeRight = dragX > 60;

  return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:"column"}}>
      {/* Header */}
      <div style={{padding:"60px 24px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:26,color:C.text,fontWeight:400}}>Today's Outfits</h1><p style={{color:C.muted,fontSize:12}}>{idx+1} of {outfits.length}</p></div>
        <button onClick={onClose} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"8px 14px",color:C.muted,cursor:"pointer",fontSize:13}}>Done</button>
      </div>

      {/* Card */}
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",padding:"0 24px",position:"relative"}}>
        {/* Next card peek */}
        {idx+1 < outfits.length && (
          <div style={{position:"absolute",top:16,width:"calc(100% - 48px)",maxWidth:380,background:C.card,border:`1px solid ${C.border}`,borderRadius:24,height:400,transform:"scale(0.95)",opacity:0.5,zIndex:0}}/>
        )}

        {/* Main card */}
        <div ref={cardRef}
          onMouseDown={e=>onDragStart(e.clientX)}
          onMouseMove={e=>onDragMove(e.clientX)}
          onMouseUp={onDragEnd}
          onMouseLeave={()=>dragging&&onDragEnd()}
          onTouchStart={e=>onDragStart(e.touches[0].clientX)}
          onTouchMove={e=>onDragMove(e.touches[0].clientX)}
          onTouchEnd={onDragEnd}
          style={{width:"100%",maxWidth:380,background:C.card,border:`1px solid ${C.border}`,borderRadius:24,padding:28,zIndex:1,transform:`translateX(${dragX}px) rotate(${rotation}deg)`,transition:dragging?"none":"transform 0.3s ease",cursor:"grab",userSelect:"none",position:"relative"}}>

          {/* Swipe indicators */}
          {swipeRight && <div style={{position:"absolute",top:20,left:20,background:`${C.success}EE`,borderRadius:12,padding:"8px 16px",border:`2px solid ${C.success}`,zIndex:10}}><span style={{color:C.success,fontWeight:700,fontSize:16}}>WEAR TODAY ✓</span></div>}
          {swipeLeft && <div style={{position:"absolute",top:20,right:20,background:`${C.error}EE`,borderRadius:12,padding:"8px 16px",border:`2px solid ${C.error}`,zIndex:10}}><span style={{color:C.error,fontWeight:700,fontSize:16}}>SKIP ✗</span></div>}

          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:68,marginBottom:16}}>🧍‍♀️</div>
            <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:16,fontSize:36}}>
              {emojis.map((e,i)=><span key={i}>{e}</span>)}
            </div>
            <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:C.text,fontWeight:600,marginBottom:8}}>{outfit.name}</h2>
            <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:16}}>
              <Tag label={outfit.vibe} color={C.accent}/>
              <Tag label={outfit.occasion} color={C.gold}/>
              <Tag label={`✦ ${outfit.score}`} color={C.purple}/>
            </div>
          </div>
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16}}>
            {outfit.items.map((item,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<outfit.items.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:20}}>{emojis[i]}</span>
                <span style={{color:C.text,fontSize:13}}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div style={{display:"flex",gap:20,marginTop:24,justifyContent:"center"}}>
          <button onClick={handleSkip} style={{width:64,height:64,borderRadius:"50%",background:C.card,border:`2px solid ${C.error}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:26}}>✗</button>
          <button onClick={handleWear} style={{width:64,height:64,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.gold})`,border:"none",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:26}}>✓</button>
        </div>
        <p style={{color:C.muted,fontSize:11,marginTop:12,textAlign:"center"}}>← Skip · Wear Today →</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── WEATHER CARD ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function WeatherCard({ profile, wardrobe }) {
  const [data,setData]=useState(null);const [loading,setLoading]=useState(false);const [err,setErr]=useState(null);
  const loc = profile?.location || "Dubai";
  const load=useCallback(async()=>{
    setLoading(true);setErr(null);setData(null);
    const sys = buildSys(profile, wardrobe);
    try{const t=await askClaude(sys,`It's hot and sunny in ${loc} today. Recommend ONE outfit from my wardrobe. Return ONLY JSON: {"outfit":"items","tip":"short why"}`,200);setData(safeJSON(t)||{outfit:t,tip:""});}
    catch{setErr("Couldn't load.");}
    setLoading(false);
  },[profile]);
  useEffect(()=>{load();},[]);
  return(
    <div style={{background:`linear-gradient(135deg,${C.accent}18,${C.gold}0A)`,border:`1px solid ${C.border}`,borderRadius:20,padding:"18px 20px",marginBottom:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
        <div><p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{loc} · Today ☀️</p><span style={{fontSize:38,fontFamily:"'Cormorant Garamond',serif",color:C.text,lineHeight:1}}>38°C</span></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}><AIBadge/><button onClick={load} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",padding:4}}><Ico d={IC.refresh} s={14}/></button></div>
      </div>
      {loading&&<div style={{display:"flex",gap:10,alignItems:"center"}}><Spin s={14}/><span style={{color:C.muted,fontSize:13}}>Styling for today…</span></div>}
      {data&&<><p style={{color:C.text,fontSize:13,fontWeight:600,marginBottom:4}}>{data.outfit}</p>{data.tip&&<p style={{color:C.muted,fontSize:12,fontStyle:"italic"}}>{data.tip}</p>}</>}
      {err&&<Err msg={err} onRetry={load}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function HomeScreen({ setScreen, profile, wardrobe, user, onOpenSwiper }) {
  const firstName = user?.name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  const active = wardrobe.filter(w=>w.section==="active");
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:28}}>
      <p style={{color:C.muted,fontSize:11,letterSpacing:3,textTransform:"uppercase"}}>{greeting}</p>
      <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:36,color:C.text,margin:"4px 0 0",fontWeight:400,lineHeight:1.1}}>Hey, {firstName} 👋<br/><em style={{color:C.accent}}>Style it your way.</em></h1>
      {profile?.bodyShape && <p style={{color:C.muted,fontSize:12,marginTop:8}}>{profile.gender} · {profile.bodyShape} · {profile.colorSeason} · {profile.location}</p>}
    </div>
    {/* Swiper CTA */}
    <button onClick={onOpenSwiper} style={{width:"100%",background:`linear-gradient(135deg,${C.accent},${C.gold})`,color:"#0F0D0B",border:"none",borderRadius:18,padding:"16px 20px",marginBottom:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{textAlign:"left"}}>
        <p style={{fontWeight:700,fontSize:15,marginBottom:2}}>👗 What am I wearing today?</p>
        <p style={{fontSize:12,opacity:0.8}}>Swipe to pick your outfit</p>
      </div>
      <span style={{fontSize:28}}>→</span>
    </button>
    <WeatherCard profile={profile} wardrobe={wardrobe}/>
    <div style={{display:"flex",gap:12,marginBottom:20}}>
      {[{l:"Items",v:active.length},{l:"Outfits",v:3},{l:"Unworn",v:active.filter(w=>w.wears<3).length}].map(s=>(
        <div key={s.l} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:"16px 12px",textAlign:"center"}}>
          <p style={{fontSize:24,fontFamily:"'Cormorant Garamond',serif",color:C.accent,fontWeight:600}}>{s.v}</p>
          <p style={{color:C.muted,fontSize:11,marginTop:2}}>{s.l}</p>
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
      {[{icon:"✨",label:"Generate Outfit",screen:"generator",accent:true},{icon:"💬",label:"Ask Stylist",screen:"chat",accent:false},{icon:"📅",label:"Outfit Calendar",screen:"calendar",accent:false},{icon:"🕵️",label:"Gap Analysis",screen:"gap",accent:false},{icon:"🧍",label:"Try-On Studio",screen:"tryon",accent:false},{icon:"🔍",label:"Scan Outfit",screen:"discover",accent:false}].map(({icon,label,screen,accent})=>(
        <button key={screen} onClick={()=>setScreen(screen)} style={{background:accent?C.accent:C.card,color:accent?"#0F0D0B":C.text,border:`1px solid ${accent?C.accent:C.border}`,borderRadius:16,padding:"14px 12px",fontSize:13,fontWeight:accent?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{icon}</span>{label}</button>
      ))}
    </div>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20}}>
      <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Active Wardrobe</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>{active.map(i=><span key={i.id} style={{fontSize:28}}>{i.img}</span>)}</div>
      <button onClick={()=>setScreen("closet")} style={{marginTop:14,color:C.accent,background:"none",border:"none",fontSize:13,cursor:"pointer"}}>View all {active.length} items →</button>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOSET SCREEN (with Trunk + Retired sections) ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ClosetScreen({ setAddItem, wardrobe, setWardrobe }) {
  const [filter,setFilter]=useState("All");
  const [section,setSection]=useState("active");
  const [sel,setSel]=useState(null);
  const cats=["All","Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
  const sectionItems = wardrobe.filter(w=>w.section===section);
  const filtered = filter==="All" ? sectionItems : sectionItems.filter(w=>w.category===filter);

  const moveItem = (id, newSection) => {
    setWardrobe(prev => prev.map(w=>w.id===id ? {...w, section:newSection} : w));
    setSel(null);
  };

  const SECTIONS = [
    {id:"active", label:"Active", emoji:"👗", desc:"In rotation"},
    {id:"trunk", label:"Trunk", emoji:"📦", desc:"Seasonal storage"},
    {id:"retired", label:"Retired", emoji:"🗃️", desc:"No longer worn"},
  ];

  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
      <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>My Closet</h1>
      <button onClick={()=>setAddItem(true)} style={{background:C.accent,color:"#0F0D0B",border:"none",borderRadius:12,width:40,height:40,fontSize:22,cursor:"pointer"}}>+</button>
    </div>

    {/* Section tabs */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
      {SECTIONS.map(s=>(
        <button key={s.id} onClick={()=>setSection(s.id)}
          style={{background:section===s.id?`${C.accent}22`:C.card,border:`2px solid ${section===s.id?C.accent:C.border}`,borderRadius:14,padding:"10px 8px",cursor:"pointer",textAlign:"center"}}>
          <div style={{fontSize:20,marginBottom:2}}>{s.emoji}</div>
          <p style={{color:section===s.id?C.accent:C.text,fontSize:12,fontWeight:600}}>{s.label}</p>
          <p style={{color:C.muted,fontSize:9}}>{wardrobe.filter(w=>w.section===s.id).length} items</p>
        </button>
      ))}
    </div>

    {/* Section description */}
    {section==="trunk" && <div style={{background:`${C.gold}12`,border:`1px solid ${C.gold}33`,borderRadius:12,padding:"10px 16px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}><span style={{fontSize:18}}>📦</span><p style={{color:C.muted,fontSize:12}}>Seasonal items stored away. Move back to Active when the season changes.</p></div>}
    {section==="retired" && <div style={{background:`${C.error}10`,border:`1px solid ${C.error}22`,borderRadius:12,padding:"10px 16px",marginBottom:16,display:"flex",gap:10,alignItems:"center"}}><span style={{fontSize:18}}>🗃️</span><p style={{color:C.muted,fontSize:12}}>Items you no longer wear. Consider selling or donating.</p></div>}

    <div style={{display:"flex",gap:8,marginBottom:20,overflowX:"auto",paddingBottom:4}}>
      {cats.map(c=><button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?C.accent:C.card,color:filter===c?"#0F0D0B":C.muted,border:`1px solid ${filter===c?C.accent:C.border}`,borderRadius:20,padding:"7px 16px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",fontWeight:filter===c?700:400}}>{c}</button>)}
    </div>

    {filtered.length===0 ? (
      <div style={{textAlign:"center",padding:"40px 20px"}}>
        <p style={{fontSize:48,marginBottom:12}}>{SECTIONS.find(s=>s.id===section)?.emoji}</p>
        <p style={{color:C.muted,fontSize:14}}>No {filter==="All"?"":filter+" "}items in {section}</p>
      </div>
    ) : (
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {filtered.map(item=>(
          <div key={item.id} onClick={()=>setSel(item)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:16,cursor:"pointer",opacity:section!=="active"?0.7:1}}>
            <div style={{fontSize:44,textAlign:"center",marginBottom:12,background:C.surface,borderRadius:12,padding:"16px 0"}}>{item.img}</div>
            <p style={{color:C.text,fontSize:12,fontWeight:500,marginBottom:4}}>{item.name}</p>
            <p style={{color:C.muted,fontSize:11}}>Worn {item.wears}× · ${(item.price/item.wears).toFixed(1)}/wear</p>
          </div>
        ))}
      </div>
    )}

    {sel&&(
      <div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:100,display:"flex",alignItems:"flex-end"}} onClick={()=>setSel(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxWidth:430,margin:"0 auto"}}>
          <div style={{textAlign:"center",fontSize:64,marginBottom:12}}>{sel.img}</div>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:C.text,marginBottom:4}}>{sel.name}</h2>
          <p style={{color:C.muted,fontSize:13,marginBottom:20}}>{sel.category} · {sel.colorName}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>
            {[["Worn",`${sel.wears}×`],["Paid",`$${sel.price}`],["Per Wear",`$${(sel.price/sel.wears).toFixed(1)}`]].map(([l,v])=>(
              <div key={l} style={{background:C.card,borderRadius:12,padding:12,textAlign:"center"}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif"}}>{v}</p><p style={{color:C.muted,fontSize:11}}>{l}</p></div>
            ))}
          </div>
          {/* Move actions */}
          <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Move to</p>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[{id:"active",label:"Active 👗"},{id:"trunk",label:"Trunk 📦"},{id:"retired",label:"Retired 🗃️"}].filter(s=>s.id!==sel.section).map(s=>(
              <button key={s.id} onClick={()=>moveItem(sel.id,s.id)}
                style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:10,color:C.text,cursor:"pointer",fontSize:12,fontWeight:600}}>{s.label}</button>
            ))}
          </div>
          <button onClick={()=>setSel(null)} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.muted,cursor:"pointer"}}>Close</button>
        </div>
      </div>
    )}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── OUTFIT GENERATOR ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function OutfitGenerator({ profile, wardrobe }) {
  const [occ,setOcc]=useState(null);const [loading,setLoading]=useState(false);const [results,setResults]=useState(null);const [err,setErr]=useState(null);
  const occs=["Work 💼","Casual 🌅","Date Night 🌙","Formal 🎩","Travel ✈️","Sport 🏋️","Beach 🌊","Party 🎉"];
  const active = wardrobe.filter(w=>w.section==="active");
  const go=async(o)=>{
    setOcc(o);setLoading(true);setErr(null);setResults(null);
    const sys = buildSys(profile, wardrobe);
    try{const raw=await askClaude(sys,`3 outfit suggestions for "${o}" using ONLY my active wardrobe. Tailor for my body shape and style profile. Return ONLY JSON array: [{"name":"name","items":["item name"],"score":90,"why":"one sentence"}]`,600);const p=safeJSON(raw);if(!p)throw 0;setResults(p);}
    catch{setErr("Couldn't generate outfits.");}
    setLoading(false);
  };
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Outfit Generator</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Pick an occasion — Claude styles from your closet</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>{occs.map(o=><button key={o} onClick={()=>go(o)} style={{background:occ===o?`${C.accent}22`:C.card,border:`1.5px solid ${occ===o?C.accent:C.border}`,borderRadius:14,padding:"14px 10px",color:occ===o?C.accent:C.muted,fontSize:13,cursor:"pointer",fontWeight:occ===o?700:400}}>{o}</button>)}</div>
      {loading&&<div style={{textAlign:"center",padding:40}}><Spin s={32}/><p style={{color:C.muted,fontSize:14,marginTop:16}}>Claude is styling your look…</p></div>}
      {err&&<Err msg={err} onRetry={()=>occ&&go(occ)}/>}
      {results&&results.map((r,i)=>{
        const em=r.items.map(n=>{const f=active.find(w=>w.name.toLowerCase().includes(n.toLowerCase().split(" ").pop()));return f?.img||"👔";});
        return(<div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}><h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,color:C.text,fontWeight:600}}>{r.name}</h3><div style={{background:`${C.accent}22`,borderRadius:20,padding:"4px 12px"}}><span style={{color:C.accent,fontSize:12,fontWeight:700}}>✦ {r.score}</span></div></div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>{r.items.map((item,j)=><div key={j} style={{background:C.surface,borderRadius:10,padding:"8px 12px",display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:18}}>{em[j]}</span><span style={{color:C.text,fontSize:12}}>{item}</span></div>)}</div>
          <p style={{color:C.muted,fontSize:12,lineHeight:1.5,fontStyle:"italic"}}>✦ {r.why}</p>
        </div>);
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CHAT SCREEN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ChatScreen({ setScreen, profile, wardrobe }) {
  const [msgs,setMsgs]=useState([{role:"assistant",text:`Hi ${profile?.gender==="Male"?"man":""}! I'm your ClothBuddy stylist ✨ Ask me what to wear, how to style a piece, or request a full wardrobe analysis. I know your closet inside out.`}]);
  const [input,setInput]=useState("");const [loading,setLoading]=useState(false);const bottomRef=useRef(null);
  const starters=["What should I wear to a rooftop dinner tonight?","Build me a 5-day capsule for a work trip","What goes with my camel blazer?","Which items in my closet are underused?"];
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[msgs]);
  const send=async(text)=>{
    const ut=(text||input).trim();if(!ut||loading)return;setInput("");
    const nm=[...msgs,{role:"user",text:ut}];setMsgs(nm);setLoading(true);
    setMsgs(prev=>[...prev,{role:"assistant",text:""}]);let s="";
    const sys = buildSys(profile, wardrobe);
    try{await streamClaude(nm.map(m=>({role:m.role,content:m.text})),sys,c=>{s+=c;setMsgs(prev=>{const cp=[...prev];cp[cp.length-1]={role:"assistant",text:s};return cp;});});}
    catch{setMsgs(prev=>{const cp=[...prev];cp[cp.length-1]={role:"assistant",text:"Connection issue, try again!"};return cp;});}
    setLoading(false);
  };
  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.bg,maxWidth:430,margin:"0 auto"}}>
      <div style={{padding:"60px 20px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:28,color:C.text,fontWeight:400}}>Style Chat</h1><AIBadge/></div>
        <p style={{color:C.muted,fontSize:12}}>Powered by Claude · Knows your full wardrobe</p>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"20px 20px 0",display:"flex",flexDirection:"column",gap:14}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",alignItems:"flex-start",gap:10}}>
            {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.rose})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,marginTop:2}}>✦</div>}
            <div style={{maxWidth:"78%",background:m.role==="user"?C.accent:C.card,color:m.role==="user"?"#0F0D0B":C.text,border:m.role==="assistant"?`1px solid ${C.border}`:"none",borderRadius:m.role==="user"?"18px 18px 4px 18px":"18px 18px 18px 4px",padding:"12px 16px",fontSize:14,lineHeight:1.6}}>
              {m.text||(loading&&i===msgs.length-1?<span style={{color:C.muted}}>● ● ●</span>:"")}
            </div>
          </div>
        ))}
        <div ref={bottomRef}/>
        {msgs.length===1&&<div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>{starters.map(s=><button key={s} onClick={()=>send(s)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",color:C.muted,fontSize:12,cursor:"pointer",textAlign:"left"}}>{s}</button>)}</div>}
      </div>
      <div style={{padding:"12px 16px 28px",borderTop:`1px solid ${C.border}`,display:"flex",gap:10,background:C.bg,flexShrink:0}}>
        <button onClick={()=>setScreen("home")} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"0 14px",color:C.muted,cursor:"pointer",fontSize:18}}>←</button>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} disabled={loading} placeholder="Ask your stylist anything…" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"12px 16px",color:C.text,fontSize:14,outline:"none"}}/>
        <button onClick={()=>send()} disabled={!input.trim()||loading} style={{background:input.trim()&&!loading?C.accent:C.card,color:input.trim()&&!loading?"#0F0D0B":C.muted,border:"none",borderRadius:14,width:48,height:48,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          {loading?<Spin s={16}/>:<Ico d={IC.send} s={18}/>}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CALENDAR SCREEN ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function CalendarScreen({ profile, wardrobe }) {
  const [log,setLog]=useState(INIT_LOG);const [selectedDay,setSelectedDay]=useState(null);const [logMode,setLogMode]=useState(false);const [selItems,setSelItems]=useState([]);const [note,setNote]=useState("");const [insight,setInsight]=useState(null);const [insightLoading,setInsightLoading]=useState(false);
  const year=today.getFullYear(),month=today.getMonth();
  const dim=new Date(year,month+1,0).getDate();const fd=new Date(year,month,1).getDay();
  const mName=today.toLocaleString("default",{month:"long"});
  const active = wardrobe.filter(w=>w.section==="active");
  const loadInsight=useCallback(async()=>{
    setInsightLoading(true);setInsight(null);
    const summary=Object.entries(log).slice(-6).map(([d,e])=>`${d}: ${e.items.map(id=>active.find(w=>w.id===id)?.name||"?").join(", ")}`).join("\n");
    const sys = buildSys(profile, wardrobe);
    try{const t=await askClaude(sys,`My recent outfit logs:\n${summary}\n\nGive 2 short pattern insights. Return ONLY JSON: {"insight1":"...","insight2":"..."}`,300);const p=safeJSON(t);if(p)setInsight(p);}catch{}
    setInsightLoading(false);
  },[log,profile]);
  useEffect(()=>{loadInsight();},[]);
  const logOutfit=()=>{if(!selItems.length)return;const key=fmt(today);setLog(prev=>({...prev,[key]:{items:selItems,note}}));setLogMode(false);setSelItems([]);setNote("");};
  const getDay=d=>{const key=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;return log[key]||null;};
  const allWorn=Object.values(log).flatMap(e=>e.items);const wc={};allWorn.forEach(id=>{wc[id]=(wc[id]||0)+1;});
  const mwId=Object.entries(wc).sort((a,b)=>b[1]-a[1])[0]?.[0];const mw=active.find(w=>w.id===+mwId);
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Outfit Calendar</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Log what you wear · get AI pattern insights</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>{[["Days Logged",Object.keys(log).length],["Most Worn",mw?.img||"—"],["This Month",Object.keys(log).filter(d=>d.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).length]].map(([l,v])=>(<div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 10px",textAlign:"center"}}><p style={{color:C.accent,fontSize:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{v}</p><p style={{color:C.muted,fontSize:10,marginTop:2}}>{l}</p></div>))}</div>
      {(insightLoading||insight)&&(<div style={{background:`${C.accent}12`,border:`1px solid ${C.accent}33`,borderRadius:16,padding:16,marginBottom:20}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><p style={{color:C.accent,fontSize:12,fontWeight:700}}>✦ AI Pattern Insights</p><button onClick={loadInsight} style={{background:"none",border:"none",color:C.muted,cursor:"pointer"}}><Ico d={IC.refresh} s={13}/></button></div>{insightLoading?<div style={{display:"flex",gap:10,alignItems:"center"}}><Spin s={14}/><span style={{color:C.muted,fontSize:13}}>Analysing wearing patterns…</span></div>:(<div style={{display:"flex",flexDirection:"column",gap:8}}>{[insight?.insight1,insight?.insight2].filter(Boolean).map((ins,i)=><p key={i} style={{color:C.text,fontSize:13,lineHeight:1.6,paddingLeft:12,borderLeft:`2px solid ${C.accent}`}}>{ins}</p>)}</div>)}</div>)}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:16,marginBottom:20}}>
        <p style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:12,textAlign:"center"}}>{mName} {year}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>{["S","M","T","W","T","F","S"].map((d,i)=><p key={i} style={{textAlign:"center",color:C.muted,fontSize:10,fontWeight:600}}>{d}</p>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {Array(fd).fill(null).map((_,i)=><div key={`e${i}`}/>)}
          {Array(dim).fill(null).map((_,i)=>{const d=i+1;const entry=getDay(d);const isToday=d===today.getDate();const isSel=selectedDay===d;return(<div key={d} onClick={()=>setSelectedDay(isSel?null:d)} style={{aspectRatio:"1",borderRadius:10,background:isSel?`${C.accent}22`:entry?`${C.success}18`:isToday?`${C.accent}18`:C.surface,border:`1.5px solid ${isSel?C.accent:entry?C.success:isToday?C.accent:C.border}`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1}}><span style={{fontSize:11,color:isToday?C.accent:entry?C.success:C.muted,fontWeight:isToday?700:400}}>{d}</span>{entry&&<span style={{fontSize:10}}>{active.find(w=>w.id===entry.items[0])?.img||"👗"}</span>}</div>);})}
        </div>
      </div>
      <button onClick={()=>setLogMode(true)} style={{width:"100%",background:`linear-gradient(135deg,${C.accent},${C.gold})`,color:"#0F0D0B",border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:16}}>👗 Log Today's Outfit</button>
      {logMode&&(<div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:100,display:"flex",alignItems:"flex-end"}}><div style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxWidth:430,margin:"0 auto",maxHeight:"80vh",overflowY:"auto"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:C.text}}>Log Today's Outfit</h2><button onClick={()=>setLogMode(false)} style={{background:C.card,border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.muted,fontSize:18}}>×</button></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>{active.map(item=><div key={item.id} onClick={()=>setSelItems(prev=>prev.includes(item.id)?prev.filter(i=>i!==item.id):[...prev,item.id])} style={{background:selItems.includes(item.id)?`${C.accent}22`:C.card,border:`1.5px solid ${selItems.includes(item.id)?C.accent:C.border}`,borderRadius:12,padding:"10px 6px",textAlign:"center",cursor:"pointer"}}><div style={{fontSize:26,marginBottom:4}}>{item.img}</div><p style={{color:selItems.includes(item.id)?C.accent:C.muted,fontSize:9}}>{item.name.split(" ").slice(0,2).join(" ")}</p></div>)}</div><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a note (e.g. office, dinner)" style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",color:C.text,fontSize:13,outline:"none",marginBottom:16,boxSizing:"border-box"}}/><button onClick={logOutfit} disabled={!selItems.length} style={{width:"100%",background:selItems.length?C.accent:C.border,color:selItems.length?"#0F0D0B":C.muted,border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:selItems.length?"pointer":"not-allowed",fontSize:15}}>Save Outfit ✦</button></div></div>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TRY-ON SCREEN ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function TryOnScreen({ profile, wardrobe }) {
  const [sel,setSel]=useState([3,2,6]);const [generating,setGenerating]=useState(false);const [result,setResult]=useState(null);const [err,setErr]=useState(null);const [tab,setTab]=useState("items");
  const active = wardrobe.filter(w=>w.section==="active");
  const gender = profile?.gender || "Female";
  const mannequin = gender==="Male" ? "🧍‍♂️" : "🧍‍♀️";
  const toggle=id=>{setResult(null);setSel(prev=>prev.includes(id)?prev.filter(i=>i!==id):[...prev,id]);};
  const generate=async()=>{if(!sel.length)return;setGenerating(true);setErr(null);setResult(null);const items=sel.map(id=>active.find(w=>w.id===id)).filter(Boolean);const il=items.map(i=>`${i.name} (${i.colorName})`).join(", ");const sys=buildSys(profile,wardrobe);try{const raw=await askClaude(sys,`Virtual try-on for: ${il}\nAnalyse this outfit on a ${profile?.bodyShape||"average"} body. Return ONLY JSON:\n{"overall":"vibe in 3 words","colorHarmony":8,"silhouette":"how it looks","highlight":"best element","tweak":"one improvement tip","occasionFit":"best occasion","styleScore":88}`,350);const p=safeJSON(raw);if(!p)throw 0;setResult(p);setTab("outfit");}catch{setErr("Try-on analysis failed.");}setGenerating(false);};
  const picked=active.filter(w=>sel.includes(w.id));
  const Bar=({label,value,max=10})=>(<div style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:C.muted,fontSize:12}}>{label}</span><span style={{color:C.accent,fontSize:12,fontWeight:700}}>{value}/{max}</span></div><div style={{background:C.border,borderRadius:10,height:6}}><div style={{background:`linear-gradient(90deg,${C.accent},${C.gold})`,borderRadius:10,height:6,width:`${(value/max)*100}%`,transition:"width 0.8s ease"}}/></div></div>);
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Try-On Studio</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Select items → Claude scores the full look</p></div>
      <div style={{display:"flex",gap:10,marginBottom:20}}>{[["items","👗 Select Items"],["outfit","✦ AI Analysis"]].map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?C.accent:C.card,color:tab===id?"#0F0D0B":C.muted,border:`1px solid ${tab===id?C.accent:C.border}`,borderRadius:12,padding:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>{label}</button>)}</div>
      {tab==="items"&&(<><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:24,marginBottom:20,textAlign:"center",minHeight:180,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>{!sel.length?(<><div style={{fontSize:64,opacity:0.3,marginBottom:8}}>{mannequin}</div><p style={{color:C.muted,fontSize:13}}>Select pieces below</p></>):(<><div style={{position:"relative",marginBottom:16}}><div style={{fontSize:72}}>{mannequin}</div><div style={{position:"absolute",bottom:-8,right:-12,display:"flex",gap:4}}>{picked.slice(0,3).map(i=><span key={i.id} style={{fontSize:20}}>{i.img}</span>)}</div></div><div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",maxWidth:280}}>{picked.map(i=><div key={i.id} style={{background:C.surface,borderRadius:8,padding:"5px 10px",display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:14}}>{i.img}</span><span style={{color:C.text,fontSize:11}}>{i.name.split(" ").slice(0,2).join(" ")}</span><button onClick={()=>toggle(i.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12,padding:0}}>×</button></div>)}</div></>)}</div>
      <button onClick={generate} disabled={generating||!sel.length} style={{width:"100%",background:sel.length&&!generating?C.accent:C.border,color:sel.length&&!generating?"#0F0D0B":C.muted,border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:sel.length&&!generating?"pointer":"not-allowed",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>{generating?<><Spin s={18}/><span>Claude is analysing your look…</span></>:"✨ Generate AI Try-On Analysis"}</button>
      {err&&<Err msg={err} onRetry={generate}/>}
      <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Active Wardrobe</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{active.map(item=><div key={item.id} onClick={()=>toggle(item.id)} style={{background:sel.includes(item.id)?`${C.accent}22`:C.card,border:`1.5px solid ${sel.includes(item.id)?C.accent:C.border}`,borderRadius:14,padding:"12px 8px",textAlign:"center",cursor:"pointer"}}><div style={{fontSize:30,marginBottom:4}}>{item.img}</div><p style={{color:sel.includes(item.id)?C.accent:C.muted,fontSize:10}}>{item.name.split(" ").slice(0,2).join(" ")}</p></div>)}</div></>)}
      {tab==="outfit"&&(<>{!result&&!generating&&<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:52,marginBottom:16,opacity:0.4}}>✨</div><p style={{color:C.muted,fontSize:14}}>Select items and generate an analysis</p><button onClick={()=>setTab("items")} style={{marginTop:20,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:"12px 24px",fontWeight:700,cursor:"pointer"}}>Select Items →</button></div>}{generating&&<div style={{textAlign:"center",padding:"60px 20px"}}><Spin s={40}/><p style={{color:C.muted,fontSize:14,marginTop:20}}>Claude is analysing your look…</p></div>}{result&&(<div><div style={{background:`linear-gradient(135deg,${C.accent}18,${C.gold}0A)`,border:`1px solid ${C.accent}33`,borderRadius:20,padding:28,textAlign:"center",marginBottom:20}}><div style={{fontSize:80,marginBottom:12}}>{mannequin}</div><div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:12}}>{picked.map(i=><span key={i.id} style={{fontSize:28}}>{i.img}</span>)}</div><p style={{color:C.accent,fontSize:20,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:8}}>{result.overall}</p><div style={{background:`${C.accent}22`,borderRadius:20,padding:"4px 16px",display:"inline-block"}}><span style={{color:C.accent,fontSize:14,fontWeight:700}}>✦ Style Score: {result.styleScore}/100</span></div></div><div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:16}}><p style={{color:C.text,fontSize:15,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:16}}>Look Analysis</p><Bar label="Color Harmony" value={result.colorHarmony} max={10}/><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16}}>{[["👁️ Silhouette",result.silhouette],["✨ Highlight",result.highlight],["💡 Tweak",result.tweak],["📍 Best For",result.occasionFit]].map(([l,v])=>(<div key={l} style={{background:C.surface,borderRadius:12,padding:12}}><p style={{color:C.accent,fontSize:10,fontWeight:700,marginBottom:4}}>{l}</p><p style={{color:C.text,fontSize:12,lineHeight:1.4}}>{v}</p></div>))}</div></div><div style={{display:"flex",gap:10}}><button onClick={()=>setTab("items")} style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:14,cursor:"pointer"}}>← Change Items</button><button onClick={generate} style={{flex:1,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer"}}>Re-analyse ✦</button></div></div>)}</>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GAP ANALYSIS ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function GapAnalysisScreen({ profile, wardrobe }) {
  const [analysis,setAnalysis]=useState(null);const [loading,setLoading]=useState(false);const [err,setErr]=useState(null);const [budget,setBudget]=useState(300);const [expanded,setExpanded]=useState(null);
  const active = wardrobe.filter(w=>w.section==="active");
  const tv=active.reduce((s,i)=>s+i.price,0);const tw=active.reduce((s,i)=>s+i.wears,0);
  const cats={};active.forEach(i=>{cats[i.category]=(cats[i.category]||0)+1;});
  const run=useCallback(async()=>{setLoading(true);setErr(null);setAnalysis(null);const cs=Object.entries(cats).map(([k,v])=>`${k}:${v}`).join(", ");const cols=[...new Set(active.map(i=>i.colorName))].join(", ");const lw=active.filter(i=>i.wears<5).map(i=>i.name).join(", ");const sys=buildSys(profile,wardrobe);try{const raw=await askClaude(sys,`Categories: ${cs}\nColors: ${cols}\nRarely worn: ${lw}\nValue: $${tv}, Wears: ${tw}\nBudget: $${budget}\n\nDeep gap analysis for my gender and body shape. Return ONLY JSON:\n{"summary":"2 sentences","outfitCombosNow":number,"gaps":[{"item":"name","category":"cat","why":"sentence","impact":"X new combos","estimatedPrice":number,"priority":"High|Medium|Low","colorsItWorks":"colors"}],"balanceScore":number,"biggestWeakness":"sentence","capsuleRecommendation":"3 sentences"}`,700);const p=safeJSON(raw);if(!p)throw 0;setAnalysis(p);}catch{setErr("Gap analysis failed.");}setLoading(false);},[budget,profile,wardrobe]);
  useEffect(()=>{run();},[]);
  const pc={High:C.rose,Medium:C.gold,Low:C.success};
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Gap Analysis</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Claude finds exactly what your wardrobe is missing</p></div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginBottom:20}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><p style={{color:C.text,fontSize:14,fontWeight:600}}>Shopping Budget</p><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>${budget}</p></div><input type="range" min={50} max={1000} step={50} value={budget} onChange={e=>setBudget(+e.target.value)} style={{width:"100%",accentColor:C.accent,cursor:"pointer"}}/><button onClick={run} style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:12,padding:"11px",fontWeight:700,cursor:"pointer",marginTop:14,fontSize:14}}>✦ Analyse for ${budget} Budget</button></div>
      {loading&&<div style={{textAlign:"center",padding:"40px 20px"}}><Spin s={36}/><p style={{color:C.muted,fontSize:14,marginTop:16}}>Claude is deep-diving your wardrobe…</p></div>}
      {err&&<Err msg={err} onRetry={run}/>}
      {analysis&&(<div><div style={{background:`${C.accent}14`,border:`1px solid ${C.accent}33`,borderRadius:18,padding:20,marginBottom:20}}><p style={{color:C.accent,fontSize:12,fontWeight:700,marginBottom:8}}>✦ Overall Assessment</p><p style={{color:C.text,fontSize:14,lineHeight:1.6,marginBottom:16}}>{analysis.summary}</p><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{[["Combos Now",analysis.outfitCombosNow],["Balance",`${analysis.balanceScore}/10`],["Categories",Object.keys(cats).length]].map(([l,v])=>(<div key={l} style={{background:C.card,borderRadius:12,padding:"12px 8px",textAlign:"center"}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>{v}</p><p style={{color:C.muted,fontSize:10}}>{l}</p></div>))}</div></div>
      <div style={{background:`${C.rose}18`,border:`1px solid ${C.rose}33`,borderRadius:14,padding:16,marginBottom:20}}><p style={{color:C.rose,fontSize:12,fontWeight:700,marginBottom:4}}>⚠️ Biggest Weakness</p><p style={{color:C.text,fontSize:13,lineHeight:1.5}}>{analysis.biggestWeakness}</p></div>
      <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Missing Pieces — Ranked by Impact</p>
      {analysis.gaps?.map((gap,i)=>(<div key={i} onClick={()=>setExpanded(expanded===i?null:i)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,padding:18,marginBottom:12,cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}><div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>#{i+1} {gap.item}</span><span style={{background:`${pc[gap.priority]||C.muted}22`,color:pc[gap.priority]||C.muted,fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{gap.priority}</span></div><p style={{color:C.muted,fontSize:12,lineHeight:1.4}}>{gap.why}</p></div><div style={{textAlign:"right",marginLeft:12,flexShrink:0}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>${gap.estimatedPrice}</p><p style={{color:C.success,fontSize:11}}>{gap.impact}</p></div></div>{expanded===i&&(<div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}><p style={{color:C.muted,fontSize:12,marginBottom:12}}>🎨 Pairs with: <span style={{color:C.text}}>{gap.colorsItWorks}</span></p><button style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:10,padding:"10px",fontWeight:700,cursor:"pointer",fontSize:12}} onClick={e=>e.stopPropagation()}>Shop This →</button></div>)}</div>))}
      <div style={{background:`${C.gold}12`,border:`1px solid ${C.gold}33`,borderRadius:16,padding:18,marginTop:8}}><p style={{color:C.gold,fontSize:12,fontWeight:700,marginBottom:8}}>💛 Capsule Wardrobe Tip</p><p style={{color:C.text,fontSize:13,lineHeight:1.6}}>{analysis.capsuleRecommendation}</p></div></div>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DISCOVER SCREEN ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function DiscoverScreen({ wardrobe }) {
  const [tab,setTab]=useState("inspo");
  const [query,setQuery]=useState("");const [loading,setLoading]=useState(false);const [results,setResults]=useState(null);const [err,setErr]=useState(null);
  const active = wardrobe.filter(w=>w.section==="active");
  const WS = active.map(i=>`${i.name} (${i.category}, ${i.colorName})`).join("; ");
  const looks=[{title:"Clean Girl Aesthetic",tags:["Minimal","Neutral"],emoji:"🤍",desc:"Slicked bun, gold hoops, linen everything."},{title:"Parisian Workday",tags:["Classic","Chic"],emoji:"🗼",desc:"Striped top, tailored trousers, loafers."},{title:"Desert Luxe",tags:["Boho","Warm"],emoji:"🏜️",desc:"Flowing silks, earthy tones, layered gold."},{title:"The Boardroom",tags:["Power","Formal"],emoji:"💼",desc:"Sharp blazer, wide leg, pointed toe."},{title:"Sunday Softness",tags:["Cozy","Casual"],emoji:"☁️",desc:"Oversized knit, straight jeans, white kicks."},{title:"Night Out Edit",tags:["Evening","Bold"],emoji:"🌙",desc:"Silk slip, leather jacket, barely-there heels."}];
  const exs=["Black wide-leg jeans, oversized white shirt, chunky boots","Blazer, silk slip dress, pointed mules","Linen co-ord set, sandals, gold jewellery"];
  const scan=async(q)=>{const t=(q||query).trim();if(!t)return;setLoading(true);setErr(null);setResults(null);try{const raw=await askClaude("Fashion identifier.",`Outfit: "${t}"\nReturn ONLY JSON array: [{"item":"name","category":"Tops|Bottoms|Shoes|Accessories|Outerwear|Dress","color":"color","shop":"store","inCloset":false}]\ninCloset=true if similar to: ${WS}`,500);const p=safeJSON(raw);if(!p)throw 0;setResults(p);}catch{setErr("Couldn't identify items.");}setLoading(false);};
  const CE={Tops:"👕",Bottoms:"👖",Shoes:"👟",Accessories:"📿",Outerwear:"🧥",Dress:"👗"};
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:20}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400,marginBottom:16}}>Discover</h1><div style={{display:"flex",gap:10}}>{[["inspo","Inspiration"],["scan","📸 Scanner"]].map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?C.accent:C.card,color:tab===id?"#0F0D0B":C.muted,border:`1px solid ${tab===id?C.accent:C.border}`,borderRadius:12,padding:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>{label}</button>)}</div></div>
    {tab==="inspo"?<div style={{display:"flex",flexDirection:"column",gap:14}}>{looks.map(d=><div key={d.title} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,display:"flex",gap:16,alignItems:"center"}}><div style={{fontSize:36,background:C.surface,borderRadius:14,width:64,height:64,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{d.emoji}</div><div style={{flex:1}}><h3 style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:4}}>{d.title}</h3><p style={{color:C.muted,fontSize:12,marginBottom:8}}>{d.desc}</p><div style={{display:"flex",gap:6}}>{d.tags.map(t=><span key={t} style={{background:`${C.accent}18`,color:C.accent,fontSize:10,padding:"3px 8px",borderRadius:20}}>{t}</span>)}</div></div></div>)}</div>:
    <div><div style={{display:"flex",gap:10,marginBottom:12}}><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Describe an outfit to identify…" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"11px 14px",color:C.text,fontSize:13,outline:"none"}}/><button onClick={()=>scan()} style={{background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:"0 16px",fontWeight:700,cursor:"pointer",fontSize:13}}>Scan</button></div><div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>{exs.map(ex=><button key={ex} onClick={()=>{setQuery(ex);scan(ex);}} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",color:C.muted,fontSize:11,cursor:"pointer",textAlign:"left"}}>"{ex}"</button>)}</div>{loading&&<div style={{display:"flex",gap:10,alignItems:"center",padding:"16px 0"}}><Spin s={18}/><span style={{color:C.muted,fontSize:13}}>Identifying items…</span></div>}{err&&<Err msg={err}/>}{results&&results.map((item,i)=>(<div key={i} style={{background:C.card,border:`1px solid ${item.inCloset?C.success:C.border}`,borderRadius:16,padding:16,marginBottom:12,display:"flex",gap:14,alignItems:"center"}}><div style={{fontSize:32,background:C.surface,borderRadius:10,width:52,height:52,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{CE[item.category]||"👗"}</div><div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}><p style={{color:C.text,fontSize:14,fontWeight:500}}>{item.item}</p>{item.inCloset&&<span style={{background:`${C.success}22`,color:C.success,fontSize:9,padding:"2px 6px",borderRadius:10}}>In Closet ✓</span>}</div><p style={{color:C.muted,fontSize:12}}>{item.color} · {item.shop}</p></div><button style={{background:"transparent",color:C.accent,border:`1px solid ${C.accent}`,borderRadius:8,padding:"5px 10px",fontSize:10,cursor:"pointer"}}>Shop →</button></div>))}</div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function AddItemModal({ onClose }) {
  const [step,setStep]=useState(1);const [desc,setDesc]=useState("");const [loading,setLoading]=useState(false);const [result,setResult]=useState(null);const [err,setErr]=useState(null);
  const analyze=async()=>{if(!desc.trim())return;setLoading(true);setErr(null);try{const raw=await askClaude("Fashion classifier.",`Classify: "${desc}"\nReturn ONLY JSON: {"category":"Tops|Bottoms|Shoes|Accessories|Outerwear|Dress","subcategory":"type","colorName":"color","pattern":"solid|striped|floral|checked","material":"fabric","seasons":["Spring"],"occasions":["Casual"]}`,300);const p=safeJSON(raw);if(!p)throw 0;setResult(p);setStep(3);}catch{setErr("Couldn't classify.");}setLoading(false);};
  return(<div style={{position:"fixed",inset:0,background:"#000000DD",zIndex:200,display:"flex",alignItems:"flex-end"}}>
    <div style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}><div style={{display:"flex",gap:10,alignItems:"center"}}><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:C.text}}>Add to Closet</h2><AIBadge/></div><button onClick={onClose} style={{background:C.card,border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.muted,fontSize:18}}>×</button></div>
      {step===1&&<div style={{textAlign:"center"}}><div style={{border:`2px dashed ${C.border}`,borderRadius:20,padding:40,marginBottom:20}}><div style={{fontSize:52,marginBottom:12}}>📷</div><p style={{color:C.text,fontSize:15,marginBottom:4}}>Describe your clothing item</p><p style={{color:C.muted,fontSize:12}}>Claude auto-classifies it</p></div><button onClick={()=>setStep(2)} style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Describe Item →</button></div>}
      {step===2&&<div><textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Dark forest green wide-leg linen trousers, high waist, side pockets" style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,color:C.text,fontSize:14,resize:"none",height:110,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>{err&&<Err msg={err}/>}<button onClick={analyze} disabled={loading||!desc.trim()} style={{width:"100%",background:loading?C.border:C.accent,color:loading?C.muted:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",marginTop:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>{loading?<><Spin s={16}/><span>Analysing…</span></>:"✨ Analyse with Claude"}</button></div>}
      {step===3&&result&&<div><div style={{background:`${C.success}18`,border:`1px solid ${C.success}44`,borderRadius:12,padding:"10px 14px",marginBottom:20,color:C.success,fontSize:13}}>✓ Claude classified your item</div>{[["Category",result.category],["Type",result.subcategory],["Color",result.colorName],["Pattern",result.pattern],["Material",result.material],["Seasons",result.seasons?.join(", ")],["Occasions",result.occasions?.join(", ")]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"13px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:13}}>{l}</span><span style={{color:C.text,fontSize:13,fontWeight:500,textAlign:"right",maxWidth:"60%"}}>{v}</span></div>)}<div style={{display:"flex",gap:10,marginTop:20}}><button onClick={()=>setStep(2)} style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:14,cursor:"pointer"}}>Edit</button><button onClick={onClose} style={{flex:2,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer"}}>Save to Closet ✓</button></div></div>}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileScreen({ setScreen, profile, user, wardrobe, onEditProfile, onLogout, onShowPaywall }) {
  const active = wardrobe.filter(w=>w.section==="active");
  const tv=active.reduce((s,i)=>s+i.price,0);const tw=active.reduce((s,i)=>s+i.wears,0);
  const palette = COLOR_PALETTES.find(p=>p.id===profile?.colorSeason);
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:24}}>
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:20}}>
        {user?.picture?<img src={user.picture} alt="" style={{width:68,height:68,borderRadius:"50%",objectFit:"cover",border:`2px solid ${C.accent}`,flexShrink:0}}/>:<div style={{width:68,height:68,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.rose})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}}>👤</div>}
        <div style={{flex:1}}>
          <h2 style={{color:C.text,fontSize:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{user?.name||"Your Profile"}</h2>
          <p style={{color:C.muted,fontSize:12,marginTop:2}}>{user?.email}</p>
          <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
            {profile?.gender&&<Tag label={profile.gender} color={C.accent}/>}
            {profile?.ageGroup&&<Tag label={profile.ageGroup} color={C.muted}/>}
            {profile?.styleVibe&&<Tag label={profile.styleVibe} color={C.rose}/>}
          </div>
        </div>
      </div>

      {/* Color palette display */}
      {palette && (
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:16,marginBottom:16}}>
          <p style={{color:C.muted,fontSize:11,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Your Color Season</p>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <span style={{fontSize:28}}>{palette.emoji}</span>
            <div style={{flex:1}}>
              <p style={{color:C.text,fontSize:15,fontWeight:600,marginBottom:4}}>{palette.label} — {palette.desc}</p>
              <div style={{display:"flex",gap:6}}>{palette.colors.map((col,i)=><div key={i} style={{width:24,height:24,borderRadius:"50%",background:col,border:`1px solid ${C.border}`}}/>)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:20}}>
        {[["Value",`$${tv}`],["Wears",tw],["Active",active.length],["CPW",tw>0?`$${(tv/tw).toFixed(1)}`:"—"]].map(([l,v])=>(
          <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 8px",textAlign:"center"}}>
            <p style={{color:C.accent,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{v}</p>
            <p style={{color:C.muted,fontSize:10}}>{l}</p>
          </div>
        ))}
      </div>

      {/* Profile details */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:20}}>
        {[["Gender",profile?.gender||"—"],["Age Group",profile?.ageGroup||"—"],["Body Shape",profile?.bodyShape||"—"],["Location",profile?.location||"—"],["Color Season",profile?.colorSeason||"—"],["Style Vibe",profile?.styleVibe||"—"],["Goals",profile?.goals?.length?`${profile.goals.length} set`:"None set"],["Feel",profile?.howYouWantToFeel||"—"]].map(([l,v],i,arr)=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 18px",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{color:C.muted,fontSize:13}}>{l}</span><span style={{color:C.text,fontSize:13,fontWeight:500}}>{v}</span>
          </div>
        ))}
      </div>

      {/* Pro upgrade */}
      <button onClick={onShowPaywall} style={{width:"100%",background:`linear-gradient(135deg,${C.gold}22,${C.accent}18)`,border:`1px solid ${C.gold}44`,borderRadius:16,padding:16,marginBottom:16,cursor:"pointer",display:"flex",alignItems:"center",gap:12,textAlign:"left"}}>
        <Ico d={IC.crown} s={20}/>
        <div><p style={{color:C.gold,fontSize:14,fontWeight:700}}>Upgrade to Pro</p><p style={{color:C.muted,fontSize:12}}>Unlock all features · Placeholder pricing</p></div>
        <span style={{color:C.gold,marginLeft:"auto",fontSize:18}}>→</span>
      </button>

      {/* Quick nav */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
        {[{icon:"📅",label:"Calendar",screen:"calendar"},{icon:"🕵️",label:"Gap Analysis",screen:"gap"},{icon:"🧍",label:"Try-On",screen:"tryon"},{icon:"💬",label:"Style Chat",screen:"chat"}].map(({icon,label,screen})=>(
          <button key={screen} onClick={()=>setScreen(screen)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.text,cursor:"pointer",display:"flex",gap:8,alignItems:"center"}}><span style={{fontSize:20}}>{icon}</span><span style={{fontSize:12}}>{label}</span></button>
        ))}
      </div>

      {/* Actions */}
      <div style={{display:"flex",gap:10}}>
        <button onClick={onEditProfile} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.text,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13,fontWeight:600}}>
          <Ico d={IC.edit} s={16}/>Edit Profile
        </button>
        <button onClick={onLogout} style={{flex:1,background:`${C.error}18`,border:`1px solid ${C.error}44`,borderRadius:14,padding:14,color:C.error,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,fontSize:13,fontWeight:600}}>
          <Ico d={IC.logout} s={16}/>Sign Out
        </button>
      </div>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function BottomNav({screen,setScreen}) {
  const tabs=[{id:"home",icon:"home",label:"Home"},{id:"closet",icon:"hanger",label:"Closet"},{id:"generator",icon:"spark",label:"Style"},{id:"tryon",icon:"tryon",label:"Try-On"},{id:"calendar",icon:"cal",label:"Calendar"},{id:"gap",icon:"gap",label:"Gaps"},{id:"discover",icon:"compass",label:"Discover"},{id:"profile",icon:"user2",label:"Profile"}];
  return(<div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:`${C.surface}F2`,borderTop:`1px solid ${C.border}`,display:"flex",backdropFilter:"blur(20px)",zIndex:50,overflowX:"auto"}}>
    {tabs.map(t=><button key={t.id} onClick={()=>setScreen(t.id)} style={{flex:"0 0 auto",minWidth:54,padding:"10px 0 20px",background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:t.id===screen?C.accent:C.muted,transition:"color 0.2s"}}><Ico d={IC[t.icon]} s={t.id===screen?21:19}/><span style={{fontSize:8,letterSpacing:0.3,fontWeight:t.id===screen?700:400,whiteSpace:"nowrap"}}>{t.label}</span></button>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ROOT ─────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export default function ClothBuddy() {
  const [screen, setScreen] = useState("home");
  const [addItem, setAddItem] = useState(false);
  const [showSwiper, setShowSwiper] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  // App flow state
  const [appStage, setAppStage] = useState("login"); // login | camera | onboarding | building | paywall | app

  const [user, setUser] = useState(() => LS.get("cb_user"));
  const [profile, setProfile] = useState(() => LS.get("cb_profile"));
  const [wardrobe, setWardrobe] = useState(() => LS.get("cb_wardrobe") || DEFAULT_WARDROBE);

  const CSS=`*{margin:0;padding:0;box-sizing:border-box}body{background:#0F0D0B}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}textarea,input{font-family:inherit}::-webkit-scrollbar{display:none}input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:${C.border}}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:${C.accent};cursor:pointer}`;
  const fonts=<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>;

  // Determine initial stage on mount
  useEffect(() => {
    if (!user) { setAppStage("login"); return; }
    if (profile?.setupDone) { setAppStage("app"); return; }
    setAppStage("camera");
  }, []);

  const handleLogin = (googleUser) => {
    LS.set("cb_user", googleUser);
    setUser(googleUser);
    const saved = LS.get(`cb_profile_${googleUser.id}`);
    if (saved?.setupDone) { setProfile(saved); setAppStage("app"); }
    else setAppStage("camera");
  };

  const handleCameraNext = () => setAppStage("onboarding");

  const handleOnboardingDone = (data) => {
    const p = { ...data, setupDone: true, userId: user?.id, updatedAt: new Date().toISOString() };
    setProfile(p);
    LS.set(`cb_profile_${user?.id}`, p);
    LS.set("cb_profile", p);
    setAppStage("building");
  };

  const handleBuildingDone = () => setAppStage("paywall");

  const handleSubscribe = (plan) => {
    // Placeholder — integrate RevenueCat/Stripe here
    LS.set("cb_pro", { plan, since: new Date().toISOString() });
    setAppStage("app");
  };

  const handlePaywallSkip = () => setAppStage("app");

  const handleLogout = () => {
    LS.del("cb_user"); LS.del("cb_profile");
    setUser(null); setProfile(null);
    setAppStage("login");
    if (window.google) window.google.accounts.id.disableAutoSelect();
  };

  const handleEditProfileDone = (data) => {
    const p = { ...data, setupDone: true, userId: user?.id, updatedAt: new Date().toISOString() };
    setProfile(p);
    LS.set(`cb_profile_${user?.id}`, p);
    LS.set("cb_profile", p);
    setEditingProfile(false);
  };

  const wrap = (children) => <>{fonts}<style>{CSS}</style><div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter',system-ui,sans-serif",position:"relative",overflowX:"hidden"}}>{children}</div></>;

  // ── FLOW ──────────────────────────────────────────────────────────────────
  if (appStage === "login") return wrap(<GoogleLoginScreen onLogin={handleLogin}/>);
  if (appStage === "camera") return wrap(<CameraPermissionScreen onNext={handleCameraNext}/>);
  if (appStage === "onboarding" || editingProfile) return wrap(<OnboardingScreen user={user} onDone={editingProfile ? handleEditProfileDone : handleOnboardingDone}/>);
  if (appStage === "building") return wrap(<BuildingProfileScreen onDone={handleBuildingDone}/>);
  if (appStage === "paywall" || showPaywall) return wrap(<PaywallScreen onSubscribe={handleSubscribe} onSkip={()=>{setShowPaywall(false);if(appStage==="paywall")setAppStage("app");}}/>);

  // Tinder swiper (full screen overlay)
  if (showSwiper) return wrap(<OutfitSwiperScreen profile={profile} wardrobe={wardrobe} onClose={()=>setShowSwiper(false)}/>);

  // Chat (full screen)
  if (screen === "chat") return <>{fonts}<style>{CSS}</style><ChatScreen setScreen={setScreen} profile={profile} wardrobe={wardrobe}/></>;

  // Main app
  return wrap(
    <>
      {screen==="home" && <HomeScreen setScreen={setScreen} profile={profile} wardrobe={wardrobe} user={user} onOpenSwiper={()=>setShowSwiper(true)}/>}
      {screen==="closet" && <ClosetScreen setAddItem={setAddItem} wardrobe={wardrobe} setWardrobe={setWardrobe}/>}
      {screen==="generator" && <OutfitGenerator profile={profile} wardrobe={wardrobe}/>}
      {screen==="tryon" && <TryOnScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="calendar" && <CalendarScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="gap" && <GapAnalysisScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="discover" && <DiscoverScreen wardrobe={wardrobe}/>}
      {screen==="profile" && <ProfileScreen setScreen={setScreen} profile={profile} user={user} wardrobe={wardrobe} onEditProfile={()=>setEditingProfile(true)} onLogout={handleLogout} onShowPaywall={()=>setShowPaywall(true)}/>}
      <BottomNav screen={screen} setScreen={setScreen}/>
      {addItem && <AddItemModal onClose={()=>setAddItem(false)}/>}
    </>
  );
}
