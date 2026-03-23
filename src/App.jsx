import { useState, useEffect, useRef, useCallback } from "react";

// ─── GOOGLE CLIENT ID ─────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = "995973297845-ss1q55o65p7kh0jj6hg4augngdkkfe5n.apps.googleusercontent.com";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const C = {
  bg:"#0F0D0B", surface:"#1A1714", card:"#221F1B", border:"#2E2A25",
  accent:"#C9956A", gold:"#D4AF6E", rose:"#C4847A",
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

// ─── LOCAL STORAGE HELPERS ────────────────────────────────────────────────────
const LS = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  del: (key) => { try { localStorage.removeItem(key); } catch {} },
};

// ─── DEFAULT WARDROBE ─────────────────────────────────────────────────────────
const DEFAULT_WARDROBE = [
  {id:1,name:"Silk Cream Blouse",category:"Tops",colorName:"Cream",occasions:["Work","Casual"],wears:12,price:89,img:"👚"},
  {id:2,name:"Wide Leg Trousers",category:"Bottoms",colorName:"Charcoal",occasions:["Work","Formal"],wears:8,price:145,img:"👖"},
  {id:3,name:"Camel Blazer",category:"Outerwear",colorName:"Camel",occasions:["Work","Formal"],wears:15,price:210,img:"🧥"},
  {id:4,name:"Linen Midi Dress",category:"Dresses",colorName:"Sand",occasions:["Casual","Date Night"],wears:5,price:120,img:"👗"},
  {id:5,name:"White Sneakers",category:"Shoes",colorName:"White",occasions:["Casual","Sport"],wears:30,price:95,img:"👟"},
  {id:6,name:"Pointed Mules",category:"Shoes",colorName:"Tan",occasions:["Work","Formal","Date Night"],wears:7,price:175,img:"👠"},
  {id:7,name:"Gold Chain Necklace",category:"Accessories",colorName:"Gold",occasions:["All"],wears:22,price:65,img:"📿"},
  {id:8,name:"Black Turtleneck",category:"Tops",colorName:"Black",occasions:["Casual","Work","Date Night"],wears:18,price:75,img:"👕"},
  {id:9,name:"Silk Slip Skirt",category:"Bottoms",colorName:"Mauve",occasions:["Date Night","Casual"],wears:3,price:98,img:"🩱"},
  {id:10,name:"Leather Belt",category:"Accessories",colorName:"Brown",occasions:["All"],wears:25,price:55,img:"🪢"},
  {id:11,name:"Cashmere Sweater",category:"Tops",colorName:"Wheat",occasions:["Casual","Work"],wears:9,price:185,img:"🧶"},
  {id:12,name:"Ankle Boots",category:"Shoes",colorName:"Dark Brown",occasions:["Casual","Work"],wears:14,price:220,img:"👢"},
];

function fmt(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const today = new Date();
const INIT_LOG = {
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-1))]:{items:[3,2,6],note:"Client meeting"},
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-3))]:{items:[8,9,7],note:"Dinner out"},
  [fmt(new Date(today.getFullYear(),today.getMonth(),today.getDate()-5))]:{items:[11,5,10],note:"Weekend"},
};

// ─── BUILD SYSTEM PROMPT FROM PROFILE ────────────────────────────────────────
function buildSys(profile, wardrobe) {
  const w = wardrobe || DEFAULT_WARDROBE;
  const WS = w.map(i=>`${i.name} (${i.category}, ${i.colorName}, ${i.occasions.join("/")})`).join("; ");
  const gender = profile?.gender || "Female";
  const age = profile?.age || "";
  const shape = profile?.bodyShape || "";
  const season = profile?.colorSeason || "Autumn";
  const vibe = profile?.styleVibe || "Classic";
  const loc = profile?.location || "Dubai";
  return `You are ClothBuddy, a warm expert personal stylist AI.
User profile: ${gender}${age ? `, ${age} years old` : ""}${shape ? `, ${shape} body shape` : ""}, ${season} color season, ${vibe} style archetype, based in ${loc} (hot climate 35-42°C).
Wardrobe: ${WS}.
Rules: reference specific item names, tailor advice to gender and body shape, be concise (2-4 sentences), suggest shopping only if truly needed, use occasional tasteful emojis.`;
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const Spin = ({s=20}) => <div style={{width:s,height:s,borderRadius:"50%",border:`2px solid ${C.border}`,borderTopColor:C.accent,animation:"spin 0.8s linear infinite",flexShrink:0}}/>;
const AIBadge = () => <span style={{background:`${C.accent}22`,color:C.accent,fontSize:10,padding:"2px 8px",borderRadius:20,fontWeight:700}}>✦ AI</span>;
const Err = ({msg,onRetry}) => <div onClick={onRetry} style={{background:`${C.error}18`,border:`1px solid ${C.error}44`,borderRadius:12,padding:"10px 14px",color:C.error,fontSize:12,marginTop:8,cursor:onRetry?"pointer":"default"}}>{msg}{onRetry?" Tap to retry.":""}</div>;

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
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GOOGLE LOGIN SCREEN ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function GoogleLoginScreen({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    // Load Google Identity Services script
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => initGoogle();
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  const initGoogle = () => {
    if (!window.google) return;
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
    });
    window.google.accounts.id.renderButton(
      document.getElementById("google-btn"),
      { theme: "filled_black", size: "large", width: 340, text: "continue_with", shape: "pill" }
    );
  };

  const handleCredential = async (response) => {
    setLoading(true); setErr(null);
    try {
      // Decode the JWT to get user info (no backend needed)
      const payload = JSON.parse(atob(response.credential.split(".")[1]));
      const user = {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
        token: response.credential,
      };
      onLogin(user);
    } catch(e) {
      setErr("Login failed. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,background:C.bg}}>
      {/* Logo */}
      <div style={{marginBottom:48,textAlign:"center"}}>
        <div style={{fontSize:72,marginBottom:16}}>🛍️</div>
        <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:42,color:C.text,fontWeight:400,lineHeight:1.1,marginBottom:8}}>ClothBuddy</h1>
        <p style={{color:C.muted,fontSize:15,lineHeight:1.6}}>Your AI personal stylist,<br/>powered by Claude.</p>
      </div>

      {/* Features */}
      <div style={{width:"100%",maxWidth:340,marginBottom:40,display:"flex",flexDirection:"column",gap:12}}>
        {[
          ["✨","AI Outfit Generator","Claude styles from your closet"],
          ["📅","Outfit Calendar","Track & log what you wear"],
          ["🕵️","Gap Analysis","Find exactly what's missing"],
          ["🧍","Try-On Studio","See how combos look on you"],
        ].map(([icon,title,sub])=>(
          <div key={title} style={{display:"flex",alignItems:"center",gap:14,background:C.card,borderRadius:16,padding:"12px 16px",border:`1px solid ${C.border}`}}>
            <span style={{fontSize:24,flexShrink:0}}>{icon}</span>
            <div><p style={{color:C.text,fontSize:13,fontWeight:600}}>{title}</p><p style={{color:C.muted,fontSize:11}}>{sub}</p></div>
          </div>
        ))}
      </div>

      {/* Google button */}
      <div style={{width:"100%",maxWidth:340}}>
        {loading ? (
          <div style={{display:"flex",justifyContent:"center",padding:20}}><Spin s={28}/></div>
        ) : (
          <div id="google-btn" style={{display:"flex",justifyContent:"center",minHeight:44}}/>
        )}
        {err && <Err msg={err}/>}
        <p style={{color:C.muted,fontSize:11,textAlign:"center",marginTop:16,lineHeight:1.6}}>
          By continuing, you agree to our Terms of Service.<br/>Your data stays on your device.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROFILE SETUP SCREEN ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileSetupScreen({ user, existingProfile, onDone }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({
    gender: existingProfile?.gender || null,
    age: existingProfile?.age || "",
    bodyShape: existingProfile?.bodyShape || null,
    location: existingProfile?.location || "Dubai",
    colorSeason: existingProfile?.colorSeason || null,
    styleVibe: existingProfile?.styleVibe || null,
  });

  const isEditing = !!existingProfile;

  const GENDERS = [
    { id:"Female", emoji:"👩", label:"Female" },
    { id:"Male", emoji:"👨", label:"Male" },
    { id:"Non-binary", emoji:"🧑", label:"Non-binary" },
    { id:"Prefer not to say", emoji:"🤍", label:"Prefer not to say" },
  ];

  const FEMALE_SHAPES = [
    { id:"Hourglass", emoji:"⌛", desc:"Balanced bust & hips, defined waist" },
    { id:"Pear", emoji:"🍐", desc:"Hips wider than shoulders" },
    { id:"Apple", emoji:"🍎", desc:"Fuller midsection, narrower hips" },
    { id:"Rectangle", emoji:"📏", desc:"Similar bust, waist & hips" },
    { id:"Inverted Triangle", emoji:"🔺", desc:"Broader shoulders, narrower hips" },
  ];

  const MALE_SHAPES = [
    { id:"Athletic", emoji:"💪", desc:"Broad shoulders, narrow waist" },
    { id:"Rectangle", emoji:"📏", desc:"Similar chest, waist & hips" },
    { id:"Triangle", emoji:"🔻", desc:"Wider waist, narrower shoulders" },
    { id:"Oval", emoji:"⭕", desc:"Fuller midsection" },
    { id:"Trapezoid", emoji:"🏠", desc:"Broad chest, narrow waist" },
  ];

  const SEASONS = ["Spring 🌸","Summer 🌊","Autumn 🍁","Winter ❄️"];
  const VIBES_FEMALE = ["Minimalist 🤍","Classic 🌹","Bohemian 🌿","Edgy ⚡","Romantic 🌸","Streetwear 🔥"];
  const VIBES_MALE = ["Classic 🎩","Smart Casual 👔","Streetwear 🔥","Minimalist ⬛","Sporty 🏀","Business 💼"];

  const shapes = data.gender === "Male" ? MALE_SHAPES : FEMALE_SHAPES;
  const vibes = data.gender === "Male" ? VIBES_MALE : VIBES_FEMALE;

  const steps = [
    { key:"gender", title:"What's your\ngender?", sub:"Personalises style recommendations for you" },
    { key:"age", title:"How old\nare you?", sub:"Helps tailor age-appropriate style advice" },
    { key:"bodyShape", title:"Your body\nshape?", sub:"Claude styles to flatter your proportions" },
    { key:"location", title:"Where are\nyou based?", sub:"Climate shapes every outfit suggestion" },
    { key:"colorSeason", title:"Your color\nseason?", sub:"Filters colors that look best on you" },
    { key:"styleVibe", title:"Your style\nvibe?", sub:"Defines your personal aesthetic" },
  ];

  const s = steps[step];
  const canNext = () => {
    if (s.key === "gender") return !!data.gender;
    if (s.key === "age") return data.age === "" || (parseInt(data.age) >= 13 && parseInt(data.age) <= 99);
    if (s.key === "bodyShape") return !!data.bodyShape;
    if (s.key === "location") return !!data.location.trim();
    if (s.key === "colorSeason") return !!data.colorSeason;
    if (s.key === "styleVibe") return !!data.styleVibe;
    return true;
  };

  const next = () => {
    if (step < steps.length - 1) setStep(step + 1);
    else finish();
  };

  const finish = () => {
    const profile = {
      ...data,
      age: data.age ? parseInt(data.age) : null,
      setupDone: true,
      updatedAt: new Date().toISOString(),
    };
    onDone(profile);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:C.bg}}>
      {/* Header */}
      <div style={{padding:"20px 24px 0",display:"flex",alignItems:"center",gap:12}}>
        {user?.picture && <img src={user.picture} alt="" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover"}}/>}
        <div>
          <p style={{color:C.text,fontSize:13,fontWeight:600}}>{user?.name}</p>
          <p style={{color:C.muted,fontSize:11}}>{isEditing ? "Editing profile" : "Setting up your profile"}</p>
        </div>
      </div>

      {/* Progress dots */}
      <div style={{display:"flex",justifyContent:"center",gap:6,padding:"20px 0 0"}}>
        {steps.map((_,i)=>(
          <div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?C.accent:i<step?`${C.accent}66`:C.border,transition:"all 0.3s"}}/>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,padding:"24px 24px 32px",display:"flex",flexDirection:"column"}}>
        <div style={{marginBottom:32}}>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:36,color:C.text,fontWeight:400,whiteSpace:"pre-line",lineHeight:1.2,marginBottom:8}}>{s.title}</h1>
          <p style={{color:C.muted,fontSize:14,lineHeight:1.5}}>{s.sub}</p>
        </div>

        {/* GENDER */}
        {s.key === "gender" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,flex:1}}>
            {GENDERS.map(g=>(
              <button key={g.id} onClick={()=>setData(d=>({...d,gender:g.id,bodyShape:null}))}
                style={{background:data.gender===g.id?`${C.accent}22`:C.card,border:`2px solid ${data.gender===g.id?C.accent:C.border}`,borderRadius:18,padding:"20px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                <span style={{fontSize:36}}>{g.emoji}</span>
                <span style={{color:data.gender===g.id?C.accent:C.text,fontSize:14,fontWeight:600}}>{g.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* AGE */}
        {s.key === "age" && (
          <div style={{flex:1}}>
            <input type="number" value={data.age} onChange={e=>setData(d=>({...d,age:e.target.value}))}
              placeholder="e.g. 28"
              min={13} max={99}
              style={{width:"100%",background:C.card,border:`2px solid ${C.border}`,borderRadius:16,padding:"18px 20px",color:C.text,fontSize:28,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,outline:"none",boxSizing:"border-box",textAlign:"center"}}/>
            <p style={{color:C.muted,fontSize:12,textAlign:"center",marginTop:12}}>Optional — tap Next to skip</p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:20}}>
              {["18-24","25-34","35-44","45-54","55+"].map(range=>(
                <button key={range} onClick={()=>setData(d=>({...d,age:range.split("-")[0]}))}
                  style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"8px 16px",color:C.muted,fontSize:12,cursor:"pointer"}}>
                  {range}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* BODY SHAPE */}
        {s.key === "bodyShape" && (
          <div style={{display:"flex",flexDirection:"column",gap:10,flex:1,overflowY:"auto"}}>
            {shapes.map(sh=>(
              <button key={sh.id} onClick={()=>setData(d=>({...d,bodyShape:sh.id}))}
                style={{background:data.bodyShape===sh.id?`${C.accent}22`:C.card,border:`2px solid ${data.bodyShape===sh.id?C.accent:C.border}`,borderRadius:16,padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:14,textAlign:"left"}}>
                <span style={{fontSize:28,flexShrink:0}}>{sh.emoji}</span>
                <div>
                  <p style={{color:data.bodyShape===sh.id?C.accent:C.text,fontSize:15,fontWeight:600,marginBottom:2}}>{sh.id}</p>
                  <p style={{color:C.muted,fontSize:12}}>{sh.desc}</p>
                </div>
                {data.bodyShape===sh.id && <span style={{marginLeft:"auto",color:C.accent,fontSize:18,flexShrink:0}}>✓</span>}
              </button>
            ))}
          </div>
        )}

        {/* LOCATION */}
        {s.key === "location" && (
          <div style={{flex:1}}>
            <input value={data.location} onChange={e=>setData(d=>({...d,location:e.target.value}))}
              placeholder="City, Country"
              style={{width:"100%",background:C.card,border:`2px solid ${C.border}`,borderRadius:16,padding:"18px 20px",color:C.text,fontSize:18,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>
              {["Dubai 🇦🇪","London 🇬🇧","New York 🇺🇸","Paris 🇫🇷","Sydney 🇦🇺","Singapore 🇸🇬"].map(loc=>(
                <button key={loc} onClick={()=>setData(d=>({...d,location:loc.split(" ")[0]}))}
                  style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"8px 14px",color:C.muted,fontSize:12,cursor:"pointer"}}>
                  {loc}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* COLOR SEASON */}
        {s.key === "colorSeason" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,flex:1}}>
            {SEASONS.map(season=>{
              const [name,emoji] = season.split(" ");
              return(
                <button key={name} onClick={()=>setData(d=>({...d,colorSeason:name}))}
                  style={{background:data.colorSeason===name?`${C.accent}22`:C.card,border:`2px solid ${data.colorSeason===name?C.accent:C.border}`,borderRadius:18,padding:"20px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <span style={{fontSize:36}}>{emoji}</span>
                  <span style={{color:data.colorSeason===name?C.accent:C.text,fontSize:14,fontWeight:600}}>{name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* STYLE VIBE */}
        {s.key === "styleVibe" && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,flex:1}}>
            {vibes.map(vibe=>{
              const parts = vibe.split(" ");
              const emoji = parts.pop();
              const name = parts.join(" ");
              return(
                <button key={name} onClick={()=>setData(d=>({...d,styleVibe:name}))}
                  style={{background:data.styleVibe===name?`${C.accent}22`:C.card,border:`2px solid ${data.styleVibe===name?C.accent:C.border}`,borderRadius:18,padding:"18px 12px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
                  <span style={{fontSize:32}}>{emoji}</span>
                  <span style={{color:data.styleVibe===name?C.accent:C.text,fontSize:13,fontWeight:600,textAlign:"center"}}>{name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Navigation */}
        <div style={{display:"flex",gap:10,marginTop:24,flexShrink:0}}>
          {step > 0 && (
            <button onClick={()=>setStep(step-1)}
              style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:16,cursor:"pointer",fontSize:15}}>
              ← Back
            </button>
          )}
          <button onClick={next} disabled={!canNext()}
            style={{flex:2,background:canNext()?C.accent:C.border,color:canNext()?"#0F0D0B":C.muted,border:"none",borderRadius:14,padding:16,fontWeight:700,cursor:canNext()?"pointer":"default",fontSize:15}}>
            {step === steps.length-1 ? (isEditing ? "Save Changes ✓" : "Enter ClothBuddy ✦") : "Next →"}
          </button>
        </div>
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
// ─── OUTFIT GENERATOR ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function OutfitGenerator({ profile, wardrobe }) {
  const [occ,setOcc]=useState(null);const [loading,setLoading]=useState(false);const [results,setResults]=useState(null);const [err,setErr]=useState(null);
  const occs=["Work 💼","Casual 🌅","Date Night 🌙","Formal 🎩","Travel ✈️","Sport 🏋️","Beach 🌊","Party 🎉"];
  const go=async(o)=>{
    setOcc(o);setLoading(true);setErr(null);setResults(null);
    const sys = buildSys(profile, wardrobe);
    try{const raw=await askClaude(sys,`3 outfit suggestions for "${o}" using ONLY my wardrobe items. Tailor specifically for my body shape and style profile. Return ONLY JSON array: [{"name":"name","items":["item name"],"score":90,"why":"one sentence"}]`,600);const p=safeJSON(raw);if(!p)throw 0;setResults(p);}
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
        const em=r.items.map(n=>{const f=wardrobe.find(w=>w.name.toLowerCase().includes(n.toLowerCase().split(" ").pop()));return f?.img||"👔";});
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
// ─── OUTFIT SCANNER ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function OutfitScanner({ wardrobe }) {
  const [query,setQuery]=useState("");const [loading,setLoading]=useState(false);const [results,setResults]=useState(null);const [err,setErr]=useState(null);
  const WS = wardrobe.map(i=>`${i.name} (${i.category}, ${i.colorName})`).join("; ");
  const exs=["Black wide-leg jeans, oversized white shirt, chunky boots","Blazer, silk slip dress, pointed mules","Linen co-ord set, sandals, gold jewellery"];
  const scan=async(q)=>{const t=(q||query).trim();if(!t)return;setLoading(true);setErr(null);setResults(null);
    try{const raw=await askClaude("Fashion identifier for ClothBuddy.",`Outfit: "${t}"\nIdentify items. Return ONLY JSON array: [{"item":"name","category":"Tops|Bottoms|Shoes|Accessories|Outerwear|Dress","color":"color","shop":"store","inCloset":false}]\ninCloset=true if similar to: ${WS}`,500);const p=safeJSON(raw);if(!p)throw 0;setResults(p);}
    catch{setErr("Couldn't identify items.");}
    setLoading(false);};
  const CE={Tops:"👕",Bottoms:"👖",Shoes:"👟",Accessories:"📿",Outerwear:"🧥",Dress:"👗"};
  return(<div>
    <div style={{display:"flex",gap:10,marginBottom:12}}>
      <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&scan()} placeholder="Describe an outfit to identify…" style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"11px 14px",color:C.text,fontSize:13,outline:"none"}}/>
      <button onClick={()=>scan()} style={{background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:"0 16px",fontWeight:700,cursor:"pointer",fontSize:13}}>Scan</button>
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>{exs.map(ex=><button key={ex} onClick={()=>{setQuery(ex);scan(ex);}} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",color:C.muted,fontSize:11,cursor:"pointer",textAlign:"left"}}>"{ex}"</button>)}</div>
    {loading&&<div style={{display:"flex",gap:10,alignItems:"center",padding:"16px 0"}}><Spin s={18}/><span style={{color:C.muted,fontSize:13}}>Identifying items…</span></div>}
    {err&&<Err msg={err}/>}
    {results&&results.map((item,i)=>(
      <div key={i} style={{background:C.card,border:`1px solid ${item.inCloset?C.success:C.border}`,borderRadius:16,padding:16,marginBottom:12,display:"flex",gap:14,alignItems:"center"}}>
        <div style={{fontSize:32,background:C.surface,borderRadius:10,width:52,height:52,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{CE[item.category]||"👗"}</div>
        <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}><p style={{color:C.text,fontSize:14,fontWeight:500}}>{item.item}</p>{item.inCloset&&<span style={{background:`${C.success}22`,color:C.success,fontSize:9,padding:"2px 6px",borderRadius:10}}>In Closet ✓</span>}</div><p style={{color:C.muted,fontSize:12}}>{item.color} · {item.shop}</p></div>
        <button style={{background:"transparent",color:C.accent,border:`1px solid ${C.accent}`,borderRadius:8,padding:"5px 10px",fontSize:10,cursor:"pointer"}}>Shop →</button>
      </div>
    ))}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CHAT SCREEN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ChatScreen({ setScreen, profile, wardrobe }) {
  const [msgs,setMsgs]=useState([{role:"assistant",text:`Hi ${profile?.name?.split(" ")[0] || ""}! I'm your ClothBuddy stylist ✨ Ask me what to wear, how to style a piece, or request a full wardrobe analysis. I know your closet inside out.`}]);
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
    setLoading(false);};
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
  const [log,setLog]=useState(INIT_LOG);
  const [selectedDay,setSelectedDay]=useState(null);
  const [logMode,setLogMode]=useState(false);
  const [selItems,setSelItems]=useState([]);
  const [note,setNote]=useState("");
  const [insight,setInsight]=useState(null);
  const [insightLoading,setInsightLoading]=useState(false);
  const [repeatWarn,setRepeatWarn]=useState(null);

  const year=today.getFullYear(),month=today.getMonth();
  const dim=new Date(year,month+1,0).getDate();
  const fd=new Date(year,month,1).getDay();
  const mName=today.toLocaleString("default",{month:"long"});

  const loadInsight=useCallback(async()=>{
    setInsightLoading(true);setInsight(null);
    const summary=Object.entries(log).slice(-6).map(([d,e])=>`${d}: ${e.items.map(id=>wardrobe.find(w=>w.id===id)?.name||"?").join(", ")}`).join("\n");
    const sys = buildSys(profile, wardrobe);
    try{const t=await askClaude(sys,`My recent outfit logs:\n${summary}\n\nGive 2 short pattern insights. Return ONLY JSON: {"insight1":"...","insight2":"..."}`,300);const p=safeJSON(t);if(p)setInsight(p);}catch{}
    setInsightLoading(false);
  },[log,profile]);

  useEffect(()=>{loadInsight();},[]);

  const logOutfit=async()=>{
    if(!selItems.length)return;
    const key=fmt(today);
    setLog(prev=>({...prev,[key]:{items:selItems,note}}));
    setLogMode(false);setSelItems([]);setNote("");
  };

  const getDay=d=>{const key=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;return log[key]||null;};
  const allWorn=Object.values(log).flatMap(e=>e.items);
  const wc={};allWorn.forEach(id=>{wc[id]=(wc[id]||0)+1;});
  const mwId=Object.entries(wc).sort((a,b)=>b[1]-a[1])[0]?.[0];
  const mw=wardrobe.find(w=>w.id===+mwId);

  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Outfit Calendar</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Log what you wear · get AI pattern insights</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
        {[["Days Logged",Object.keys(log).length],["Most Worn",mw?.img||"—"],["This Month",Object.keys(log).filter(d=>d.startsWith(`${year}-${String(month+1).padStart(2,"0")}`)).length]].map(([l,v])=>(
          <div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 10px",textAlign:"center"}}>
            <p style={{color:C.accent,fontSize:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{v}</p><p style={{color:C.muted,fontSize:10,marginTop:2}}>{l}</p>
          </div>
        ))}
      </div>
      {(insightLoading||insight)&&(
        <div style={{background:`${C.accent}12`,border:`1px solid ${C.accent}33`,borderRadius:16,padding:16,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><p style={{color:C.accent,fontSize:12,fontWeight:700}}>✦ AI Pattern Insights</p><button onClick={loadInsight} style={{background:"none",border:"none",color:C.muted,cursor:"pointer"}}><Ico d={IC.refresh} s={13}/></button></div>
          {insightLoading?<div style={{display:"flex",gap:10,alignItems:"center"}}><Spin s={14}/><span style={{color:C.muted,fontSize:13}}>Analysing wearing patterns…</span></div>:(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[insight?.insight1,insight?.insight2].filter(Boolean).map((ins,i)=><p key={i} style={{color:C.text,fontSize:13,lineHeight:1.6,paddingLeft:12,borderLeft:`2px solid ${C.accent}`}}>{ins}</p>)}
            </div>
          )}
        </div>
      )}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:16,marginBottom:20}}>
        <p style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:12,textAlign:"center"}}>{mName} {year}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>{["S","M","T","W","T","F","S"].map((d,i)=><p key={i} style={{textAlign:"center",color:C.muted,fontSize:10,fontWeight:600}}>{d}</p>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
          {Array(fd).fill(null).map((_,i)=><div key={`e${i}`}/>)}
          {Array(dim).fill(null).map((_,i)=>{
            const d=i+1;const entry=getDay(d);const isToday=d===today.getDate();const isSel=selectedDay===d;
            return(<div key={d} onClick={()=>setSelectedDay(isSel?null:d)} style={{aspectRatio:"1",borderRadius:10,background:isSel?`${C.accent}22`:entry?`${C.success}18`:isToday?`${C.accent}18`:C.surface,border:`1.5px solid ${isSel?C.accent:entry?C.success:isToday?C.accent:C.border}`,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1}}>
              <span style={{fontSize:11,color:isToday?C.accent:entry?C.success:C.muted,fontWeight:isToday?700:400}}>{d}</span>
              {entry&&<span style={{fontSize:10}}>{wardrobe.find(w=>w.id===entry.items[0])?.img||"👗"}</span>}
            </div>);
          })}
        </div>
      </div>
      {selectedDay&&(()=>{const entry=getDay(selectedDay);return(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:20}}>
          <p style={{color:C.muted,fontSize:12,marginBottom:12}}>{mName} {selectedDay}</p>
          {entry?(<div>
            <div style={{display:"flex",gap:8,marginBottom:8}}>{entry.items.map(id=>{const item=wardrobe.find(w=>w.id===id);return item?<span key={id} style={{fontSize:28,background:C.surface,borderRadius:10,width:44,height:44,display:"flex",alignItems:"center",justifyContent:"center"}}>{item.img}</span>:null;})}</div>
            {entry.note&&<p style={{color:C.muted,fontSize:12,fontStyle:"italic"}}>"{entry.note}"</p>}
          </div>):(<button onClick={()=>setLogMode(true)} style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:12,padding:12,fontWeight:700,cursor:"pointer"}}>+ Log Outfit for This Day</button>)}
        </div>
      );})()}
      <button onClick={()=>setLogMode(true)} style={{width:"100%",background:`linear-gradient(135deg,${C.accent},${C.gold})`,color:"#0F0D0B",border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:"pointer",marginBottom:16}}>👗 Log Today's Outfit</button>
      {logMode&&(
        <div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:100,display:"flex",alignItems:"flex-end"}}>
          <div style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxWidth:430,margin:"0 auto",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:C.text}}>Log Today's Outfit</h2><button onClick={()=>setLogMode(false)} style={{background:C.card,border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.muted,fontSize:18}}>×</button></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
              {wardrobe.map(item=><div key={item.id} onClick={()=>setSelItems(prev=>prev.includes(item.id)?prev.filter(i=>i!==item.id):[...prev,item.id])} style={{background:selItems.includes(item.id)?`${C.accent}22`:C.card,border:`1.5px solid ${selItems.includes(item.id)?C.accent:C.border}`,borderRadius:12,padding:"10px 6px",textAlign:"center",cursor:"pointer"}}><div style={{fontSize:26,marginBottom:4}}>{item.img}</div><p style={{color:selItems.includes(item.id)?C.accent:C.muted,fontSize:9}}>{item.name.split(" ").slice(0,2).join(" ")}</p></div>)}
            </div>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a note (e.g. office, dinner)" style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",color:C.text,fontSize:13,outline:"none",marginBottom:16,boxSizing:"border-box"}}/>
            <button onClick={logOutfit} disabled={!selItems.length} style={{width:"100%",background:selItems.length?C.accent:C.border,color:selItems.length?"#0F0D0B":C.muted,border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:selItems.length?"pointer":"not-allowed",fontSize:15}}>Save Outfit ✦</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TRY-ON SCREEN ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function TryOnScreen({ profile, wardrobe }) {
  const [sel,setSel]=useState([3,2,6]);
  const [generating,setGenerating]=useState(false);
  const [result,setResult]=useState(null);
  const [err,setErr]=useState(null);
  const [tab,setTab]=useState("items");
  const gender = profile?.gender || "Female";
  const mannequin = gender === "Male" ? "🧍‍♂️" : "🧍‍♀️";

  const toggle=id=>{setResult(null);setSel(prev=>prev.includes(id)?prev.filter(i=>i!==id):[...prev,id]);};
  const generate=async()=>{
    if(!sel.length)return;setGenerating(true);setErr(null);setResult(null);
    const items=sel.map(id=>wardrobe.find(w=>w.id===id)).filter(Boolean);
    const il=items.map(i=>`${i.name} (${i.colorName})`).join(", ");
    const sys = buildSys(profile, wardrobe);
    try{const raw=await askClaude(sys,`Virtual try-on for: ${il}\nAnalyse this outfit on a ${profile?.bodyShape||"average"} body shape. Return ONLY JSON:\n{"overall":"vibe in 3 words","colorHarmony":8,"silhouette":"how it looks","highlight":"best element","tweak":"one improvement tip","occasionFit":"best occasion","styleScore":88}`,350);const p=safeJSON(raw);if(!p)throw 0;setResult(p);setTab("outfit");}
    catch{setErr("Try-on analysis failed.");}
    setGenerating(false);
  };
  const picked=wardrobe.filter(w=>sel.includes(w.id));
  const Bar=({label,value,max=10})=>(
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{color:C.muted,fontSize:12}}>{label}</span><span style={{color:C.accent,fontSize:12,fontWeight:700}}>{value}/{max}</span></div>
      <div style={{background:C.border,borderRadius:10,height:6}}><div style={{background:`linear-gradient(90deg,${C.accent},${C.gold})`,borderRadius:10,height:6,width:`${(value/max)*100}%`,transition:"width 0.8s ease"}}/></div>
    </div>
  );
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Try-On Studio</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Select items → Claude scores the full look</p></div>
      <div style={{display:"flex",gap:10,marginBottom:20}}>{[["items","👗 Select Items"],["outfit","✦ AI Analysis"]].map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?C.accent:C.card,color:tab===id?"#0F0D0B":C.muted,border:`1px solid ${tab===id?C.accent:C.border}`,borderRadius:12,padding:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>{label}</button>)}</div>
      {tab==="items"&&(<>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:24,marginBottom:20,textAlign:"center",minHeight:180,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
          {!sel.length?(<><div style={{fontSize:64,opacity:0.3,marginBottom:8}}>{mannequin}</div><p style={{color:C.muted,fontSize:13}}>Select pieces below</p></>):(
            <><div style={{position:"relative",marginBottom:16}}><div style={{fontSize:72}}>{mannequin}</div><div style={{position:"absolute",bottom:-8,right:-12,display:"flex",gap:4}}>{picked.slice(0,3).map(i=><span key={i.id} style={{fontSize:20}}>{i.img}</span>)}</div></div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",maxWidth:280}}>{picked.map(i=><div key={i.id} style={{background:C.surface,borderRadius:8,padding:"5px 10px",display:"flex",gap:6,alignItems:"center"}}><span style={{fontSize:14}}>{i.img}</span><span style={{color:C.text,fontSize:11}}>{i.name.split(" ").slice(0,2).join(" ")}</span><button onClick={()=>toggle(i.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12,padding:0}}>×</button></div>)}</div></>
          )}
        </div>
        <button onClick={generate} disabled={generating||!sel.length} style={{width:"100%",background:sel.length&&!generating?C.accent:C.border,color:sel.length&&!generating?"#0F0D0B":C.muted,border:"none",borderRadius:16,padding:16,fontWeight:700,fontSize:15,cursor:sel.length&&!generating?"pointer":"not-allowed",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
          {generating?<><Spin s={18}/><span>Claude is analysing your look…</span></>:"✨ Generate AI Try-On Analysis"}
        </button>
        {err&&<Err msg={err} onRetry={generate}/>}
        <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Your Wardrobe</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>{wardrobe.map(item=><div key={item.id} onClick={()=>toggle(item.id)} style={{background:sel.includes(item.id)?`${C.accent}22`:C.card,border:`1.5px solid ${sel.includes(item.id)?C.accent:C.border}`,borderRadius:14,padding:"12px 8px",textAlign:"center",cursor:"pointer"}}><div style={{fontSize:30,marginBottom:4}}>{item.img}</div><p style={{color:sel.includes(item.id)?C.accent:C.muted,fontSize:10}}>{item.name.split(" ").slice(0,2).join(" ")}</p></div>)}</div>
      </>)}
      {tab==="outfit"&&(<>
        {!result&&!generating&&<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{fontSize:52,marginBottom:16,opacity:0.4}}>✨</div><p style={{color:C.muted,fontSize:14}}>Select items and generate an analysis</p><button onClick={()=>setTab("items")} style={{marginTop:20,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:"12px 24px",fontWeight:700,cursor:"pointer"}}>Select Items →</button></div>}
        {generating&&<div style={{textAlign:"center",padding:"60px 20px"}}><Spin s={40}/><p style={{color:C.muted,fontSize:14,marginTop:20}}>Claude is analysing your look…</p></div>}
        {result&&(<div>
          <div style={{background:`linear-gradient(135deg,${C.accent}18,${C.gold}0A)`,border:`1px solid ${C.accent}33`,borderRadius:20,padding:28,textAlign:"center",marginBottom:20}}>
            <div style={{fontSize:80,marginBottom:12}}>{mannequin}</div>
            <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:12}}>{picked.map(i=><span key={i.id} style={{fontSize:28}}>{i.img}</span>)}</div>
            <p style={{color:C.accent,fontSize:20,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:8}}>{result.overall}</p>
            <div style={{background:`${C.accent}22`,borderRadius:20,padding:"4px 16px",display:"inline-block"}}><span style={{color:C.accent,fontSize:14,fontWeight:700}}>✦ Style Score: {result.styleScore}/100</span></div>
          </div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,marginBottom:16}}>
            <p style={{color:C.text,fontSize:15,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:16}}>Look Analysis</p>
            <Bar label="Color Harmony" value={result.colorHarmony} max={10}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:16}}>
              {[["👁️ Silhouette",result.silhouette],["✨ Highlight",result.highlight],["💡 Tweak",result.tweak],["📍 Best For",result.occasionFit]].map(([l,v])=>(
                <div key={l} style={{background:C.surface,borderRadius:12,padding:12}}><p style={{color:C.accent,fontSize:10,fontWeight:700,marginBottom:4}}>{l}</p><p style={{color:C.text,fontSize:12,lineHeight:1.4}}>{v}</p></div>
              ))}
            </div>
          </div>
          <div style={{display:"flex",gap:10}}><button onClick={()=>setTab("items")} style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:14,cursor:"pointer"}}>← Change Items</button><button onClick={generate} style={{flex:1,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer"}}>Re-analyse ✦</button></div>
        </div>)}
      </>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── GAP ANALYSIS ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function GapAnalysisScreen({ profile, wardrobe }) {
  const [analysis,setAnalysis]=useState(null);const [loading,setLoading]=useState(false);const [err,setErr]=useState(null);const [budget,setBudget]=useState(300);const [expanded,setExpanded]=useState(null);
  const tv=wardrobe.reduce((s,i)=>s+i.price,0);const tw=wardrobe.reduce((s,i)=>s+i.wears,0);
  const cats={};wardrobe.forEach(i=>{cats[i.category]=(cats[i.category]||0)+1;});
  const run=useCallback(async()=>{
    setLoading(true);setErr(null);setAnalysis(null);
    const cs=Object.entries(cats).map(([k,v])=>`${k}:${v}`).join(", ");
    const cols=[...new Set(wardrobe.map(i=>i.colorName))].join(", ");
    const lw=wardrobe.filter(i=>i.wears<5).map(i=>i.name).join(", ");
    const sys = buildSys(profile, wardrobe);
    try{const raw=await askClaude(sys,
      `Wardrobe: Categories: ${cs}\nColors: ${cols}\nRarely worn: ${lw}\nValue: $${tv}, Wears: ${tw}\nBudget: $${budget}\n\nDeep gap analysis tailored to my gender and body shape. Return ONLY JSON:\n{"summary":"2 sentences","outfitCombosNow":number,"gaps":[{"item":"name","category":"cat","why":"sentence","impact":"X new combos","estimatedPrice":number,"priority":"High|Medium|Low","colorsItWorks":"colors"}],"balanceScore":number,"biggestWeakness":"sentence","capsuleRecommendation":"3 sentences"}`,700);
      const p=safeJSON(raw);if(!p)throw 0;setAnalysis(p);}
    catch{setErr("Gap analysis failed.");}
    setLoading(false);
  },[budget,profile]);
  useEffect(()=>{run();},[]);
  const pc={High:C.rose,Medium:C.gold,Low:C.success};
  return(
    <div style={{padding:"0 20px 100px"}}>
      <div style={{paddingTop:60,marginBottom:24}}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>Gap Analysis</h1><AIBadge/></div><p style={{color:C.muted,fontSize:13}}>Claude finds exactly what your wardrobe is missing</p></div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:20,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><p style={{color:C.text,fontSize:14,fontWeight:600}}>Shopping Budget</p><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>${budget}</p></div>
        <input type="range" min={50} max={1000} step={50} value={budget} onChange={e=>setBudget(+e.target.value)} style={{width:"100%",accentColor:C.accent,cursor:"pointer"}}/>
        <button onClick={run} style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:12,padding:"11px",fontWeight:700,cursor:"pointer",marginTop:14,fontSize:14}}>✦ Analyse for ${budget} Budget</button>
      </div>
      {loading&&<div style={{textAlign:"center",padding:"40px 20px"}}><Spin s={36}/><p style={{color:C.muted,fontSize:14,marginTop:16}}>Claude is deep-diving your wardrobe…</p></div>}
      {err&&<Err msg={err} onRetry={run}/>}
      {analysis&&(<div>
        <div style={{background:`${C.accent}14`,border:`1px solid ${C.accent}33`,borderRadius:18,padding:20,marginBottom:20}}>
          <p style={{color:C.accent,fontSize:12,fontWeight:700,marginBottom:8}}>✦ Overall Assessment</p>
          <p style={{color:C.text,fontSize:14,lineHeight:1.6,marginBottom:16}}>{analysis.summary}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {[["Combos Now",analysis.outfitCombosNow],["Balance",`${analysis.balanceScore}/10`],["Categories",Object.keys(cats).length]].map(([l,v])=>(
              <div key={l} style={{background:C.card,borderRadius:12,padding:"12px 8px",textAlign:"center"}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>{v}</p><p style={{color:C.muted,fontSize:10}}>{l}</p></div>
            ))}
          </div>
        </div>
        <div style={{background:`${C.rose}18`,border:`1px solid ${C.rose}33`,borderRadius:14,padding:16,marginBottom:20}}>
          <p style={{color:C.rose,fontSize:12,fontWeight:700,marginBottom:4}}>⚠️ Biggest Weakness</p>
          <p style={{color:C.text,fontSize:13,lineHeight:1.5}}>{analysis.biggestWeakness}</p>
        </div>
        <p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Missing Pieces — Ranked by Impact</p>
        {analysis.gaps?.map((gap,i)=>(
          <div key={i} onClick={()=>setExpanded(expanded===i?null:i)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,padding:18,marginBottom:12,cursor:"pointer"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div style={{flex:1}}><div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}><span style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>#{i+1} {gap.item}</span><span style={{background:`${pc[gap.priority]||C.muted}22`,color:pc[gap.priority]||C.muted,fontSize:9,padding:"2px 8px",borderRadius:10,fontWeight:700}}>{gap.priority}</span></div><p style={{color:C.muted,fontSize:12,lineHeight:1.4}}>{gap.why}</p></div>
              <div style={{textAlign:"right",marginLeft:12,flexShrink:0}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif",fontWeight:700}}>${gap.estimatedPrice}</p><p style={{color:C.success,fontSize:11}}>{gap.impact}</p></div>
            </div>
            {expanded===i&&(<div style={{marginTop:16,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
              <p style={{color:C.muted,fontSize:12,marginBottom:12}}>🎨 Pairs with: <span style={{color:C.text}}>{gap.colorsItWorks}</span></p>
              <button style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:10,padding:"10px",fontWeight:700,cursor:"pointer",fontSize:12}} onClick={e=>e.stopPropagation()}>Shop This →</button>
            </div>)}
          </div>
        ))}
        <div style={{background:`${C.gold}12`,border:`1px solid ${C.gold}33`,borderRadius:16,padding:18,marginTop:8}}>
          <p style={{color:C.gold,fontSize:12,fontWeight:700,marginBottom:8}}>💛 Capsule Wardrobe Tip</p>
          <p style={{color:C.text,fontSize:13,lineHeight:1.6}}>{analysis.capsuleRecommendation}</p>
        </div>
      </div>)}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── DISCOVER SCREEN ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function DiscoverScreen({ wardrobe }) {
  const [tab,setTab]=useState("inspo");
  const looks=[{title:"Clean Girl Aesthetic",tags:["Minimal","Neutral"],emoji:"🤍",desc:"Slicked bun, gold hoops, linen everything."},{title:"Parisian Workday",tags:["Classic","Chic"],emoji:"🗼",desc:"Striped top, tailored trousers, loafers."},{title:"Desert Luxe",tags:["Boho","Warm"],emoji:"🏜️",desc:"Flowing silks, earthy tones, layered gold."},{title:"The Boardroom",tags:["Power","Formal"],emoji:"💼",desc:"Sharp blazer, wide leg, pointed toe."},{title:"Sunday Softness",tags:["Cozy","Casual"],emoji:"☁️",desc:"Oversized knit, straight jeans, white kicks."},{title:"Night Out Edit",tags:["Evening","Bold"],emoji:"🌙",desc:"Silk slip, leather jacket, barely-there heels."}];
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:20}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400,marginBottom:16}}>Discover</h1><div style={{display:"flex",gap:10}}>{[["inspo","Inspiration"],["scan","📸 Outfit Scanner"]].map(([id,label])=><button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?C.accent:C.card,color:tab===id?"#0F0D0B":C.muted,border:`1px solid ${tab===id?C.accent:C.border}`,borderRadius:12,padding:10,fontSize:13,fontWeight:600,cursor:"pointer"}}>{label}</button>)}</div></div>
    {tab==="inspo"?<div style={{display:"flex",flexDirection:"column",gap:14}}>{looks.map(d=><div key={d.title} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20,display:"flex",gap:16,alignItems:"center"}}><div style={{fontSize:36,background:C.surface,borderRadius:14,width:64,height:64,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{d.emoji}</div><div style={{flex:1}}><h3 style={{color:C.text,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600,marginBottom:4}}>{d.title}</h3><p style={{color:C.muted,fontSize:12,marginBottom:8}}>{d.desc}</p><div style={{display:"flex",gap:6}}>{d.tags.map(t=><span key={t} style={{background:`${C.accent}18`,color:C.accent,fontSize:10,padding:"3px 8px",borderRadius:20}}>{t}</span>)}</div></div></div>)}</div>:<OutfitScanner wardrobe={wardrobe}/>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function AddItemModal({ onClose, profile }) {
  const [step,setStep]=useState(1);const [desc,setDesc]=useState("");const [loading,setLoading]=useState(false);const [result,setResult]=useState(null);const [err,setErr]=useState(null);
  const analyze=async()=>{if(!desc.trim())return;setLoading(true);setErr(null);try{const raw=await askClaude("Fashion classifier for ClothBuddy.",`Classify: "${desc}"\nReturn ONLY JSON: {"category":"Tops|Bottoms|Shoes|Accessories|Outerwear|Dress","subcategory":"type","colorName":"color","pattern":"solid|striped|floral|checked","material":"fabric","seasons":["Spring"],"occasions":["Casual"]}`,300);const p=safeJSON(raw);if(!p)throw 0;setResult(p);setStep(3);}catch{setErr("Couldn't classify. Try again.");}setLoading(false);};
  return(<div style={{position:"fixed",inset:0,background:"#000000DD",zIndex:200,display:"flex",alignItems:"flex-end"}}>
    <div style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxHeight:"88vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}><div style={{display:"flex",gap:10,alignItems:"center"}}><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:C.text}}>Add to Closet</h2><AIBadge/></div><button onClick={onClose} style={{background:C.card,border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.muted,fontSize:18}}>×</button></div>
      {step===1&&<div style={{textAlign:"center"}}><div style={{border:`2px dashed ${C.border}`,borderRadius:20,padding:40,marginBottom:20}}><div style={{fontSize:52,marginBottom:12}}>📷</div><p style={{color:C.text,fontSize:15,marginBottom:4}}>Describe your clothing item</p><p style={{color:C.muted,fontSize:12}}>Claude auto-classifies category, color, occasions & more</p></div><button onClick={()=>setStep(2)} style={{width:"100%",background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",fontSize:15}}>Describe Your Item →</button></div>}
      {step===2&&<div><p style={{color:C.muted,fontSize:13,marginBottom:12}}>Describe your item in detail:</p><textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="e.g. Dark forest green wide-leg linen trousers, high waist, side pockets" style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,color:C.text,fontSize:14,resize:"none",height:110,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>{err&&<Err msg={err}/>}<button onClick={analyze} disabled={loading||!desc.trim()} style={{width:"100%",background:loading?C.border:C.accent,color:loading?C.muted:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer",marginTop:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>{loading?<><Spin s={16}/><span>Analysing…</span></>:"✨ Analyse with Claude"}</button></div>}
      {step===3&&result&&<div><div style={{background:`${C.success}18`,border:`1px solid ${C.success}44`,borderRadius:12,padding:"10px 14px",marginBottom:20,color:C.success,fontSize:13}}>✓ Claude classified your item</div>{[["Category",result.category],["Type",result.subcategory],["Color",result.colorName],["Pattern",result.pattern],["Material",result.material],["Seasons",result.seasons?.join(", ")],["Occasions",result.occasions?.join(", ")]].map(([l,v])=><div key={l} style={{display:"flex",justifyContent:"space-between",padding:"13px 0",borderBottom:`1px solid ${C.border}`}}><span style={{color:C.muted,fontSize:13}}>{l}</span><span style={{color:C.text,fontSize:13,fontWeight:500,textAlign:"right",maxWidth:"60%"}}>{v}</span></div>)}<div style={{display:"flex",gap:10,marginTop:20}}><button onClick={()=>setStep(2)} style={{flex:1,background:C.card,color:C.muted,border:`1px solid ${C.border}`,borderRadius:14,padding:14,cursor:"pointer"}}>Edit</button><button onClick={onClose} style={{flex:2,background:C.accent,color:"#0F0D0B",border:"none",borderRadius:14,padding:14,fontWeight:700,cursor:"pointer"}}>Save to Closet ✓</button></div></div>}
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOSET ANALYSIS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ClosetAnalysis({ profile, wardrobe }) {
  const [data,setData]=useState(null);const [loading,setLoading]=useState(false);const [err,setErr]=useState(null);
  const load=useCallback(async()=>{setLoading(true);setErr(null);setData(null);
    const sys = buildSys(profile, wardrobe);
    try{const raw=await askClaude(sys,`Analyse my wardrobe for my profile. Return ONLY JSON:\n{"gapItem":"missing piece","gapReason":"why + new outfits","unwornTip":"style least-worn item","colorInsight":"palette insight for my season","bestValue":"item + cpw","worstValue":"item + cpw"}`,400);const p=safeJSON(raw);if(!p)throw 0;setData(p);}catch{setErr("Analysis failed.");}setLoading(false);},[profile,wardrobe]);
  useEffect(()=>{load();},[]);
  return(<div style={{marginBottom:24}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{display:"flex",alignItems:"center",gap:8}}><h3 style={{color:C.text,fontSize:18,fontFamily:"'Cormorant Garamond',serif"}}>AI Wardrobe Analysis</h3><AIBadge/></div><button onClick={load} style={{background:"none",border:"none",color:C.muted,cursor:"pointer"}}><Ico d={IC.refresh} s={14}/></button></div>
    {loading&&<div style={{display:"flex",gap:10,alignItems:"center",padding:"16px 0"}}><Spin s={16}/><span style={{color:C.muted,fontSize:13}}>Analysing wardrobe…</span></div>}
    {err&&<Err msg={err} onRetry={load}/>}
    {data&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{background:`${C.accent}18`,border:`1px solid ${C.accent}33`,borderRadius:16,padding:16}}><p style={{color:C.accent,fontSize:12,fontWeight:700,marginBottom:6}}>🛍️ Missing Piece</p><p style={{color:C.text,fontSize:14,fontWeight:600,marginBottom:4}}>{data.gapItem}</p><p style={{color:C.muted,fontSize:12,lineHeight:1.5}}>{data.gapReason}</p></div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:16}}><p style={{color:C.gold,fontSize:12,fontWeight:700,marginBottom:6}}>💛 Color Insight</p><p style={{color:C.muted,fontSize:13,lineHeight:1.5}}>{data.colorInsight}</p></div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:16}}><p style={{color:C.success,fontSize:12,fontWeight:700,marginBottom:6}}>🔄 Styling Tip</p><p style={{color:C.muted,fontSize:13,lineHeight:1.5}}>{data.unwornTip}</p></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{background:`${C.success}18`,border:`1px solid ${C.success}33`,borderRadius:14,padding:14}}><p style={{color:C.success,fontSize:10,fontWeight:700,marginBottom:4}}>BEST VALUE</p><p style={{color:C.text,fontSize:12}}>{data.bestValue}</p></div>
        <div style={{background:`${C.rose}18`,border:`1px solid ${C.rose}33`,borderRadius:14,padding:14}}><p style={{color:C.rose,fontSize:10,fontWeight:700,marginBottom:4}}>NEEDS MORE WEAR</p><p style={{color:C.text,fontSize:12}}>{data.worstValue}</p></div>
      </div>
    </div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function HomeScreen({ setScreen, profile, wardrobe, user }) {
  const firstName = user?.name?.split(" ")[0] || profile?.name || "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:28}}>
      <p style={{color:C.muted,fontSize:11,letterSpacing:3,textTransform:"uppercase"}}>{greeting}</p>
      <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:36,color:C.text,margin:"4px 0 0",fontWeight:400,lineHeight:1.1}}>Hey, {firstName} 👋<br/><em style={{color:C.accent}}>Style it your way.</em></h1>
      {profile?.bodyShape && <p style={{color:C.muted,fontSize:12,marginTop:8}}>{profile.gender} · {profile.bodyShape} · {profile.colorSeason} · {profile.location}</p>}
    </div>
    <WeatherCard profile={profile} wardrobe={wardrobe}/>
    <div style={{display:"flex",gap:12,marginBottom:20}}>{[{l:"Items",v:wardrobe.length},{l:"Outfits",v:3},{l:"Unworn",v:wardrobe.filter(w=>w.wears<3).length}].map(s=><div key={s.l} style={{flex:1,background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:"16px 12px",textAlign:"center"}}><p style={{fontSize:24,fontFamily:"'Cormorant Garamond',serif",color:C.accent,fontWeight:600}}>{s.v}</p><p style={{color:C.muted,fontSize:11,marginTop:2}}>{s.l}</p></div>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
      {[{icon:"✨",label:"Generate Outfit",screen:"generator",accent:true},{icon:"💬",label:"Ask Stylist",screen:"chat",accent:false},{icon:"📅",label:"Outfit Calendar",screen:"calendar",accent:false},{icon:"🕵️",label:"Gap Analysis",screen:"gap",accent:false},{icon:"🧍",label:"Try-On Studio",screen:"tryon",accent:false},{icon:"🔍",label:"Scan Outfit",screen:"discover",accent:false}].map(({icon,label,screen,accent})=>(
        <button key={screen} onClick={()=>setScreen(screen)} style={{background:accent?C.accent:C.card,color:accent?"#0F0D0B":C.text,border:`1px solid ${accent?C.accent:C.border}`,borderRadius:16,padding:"14px 12px",fontSize:13,fontWeight:accent?700:500,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:18}}>{icon}</span>{label}</button>
      ))}
    </div>
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:20}}><p style={{color:C.muted,fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:14}}>Your Wardrobe</p><div style={{display:"flex",flexWrap:"wrap",gap:10}}>{wardrobe.map(i=><span key={i.id} style={{fontSize:28}}>{i.img}</span>)}</div><button onClick={()=>setScreen("closet")} style={{marginTop:14,color:C.accent,background:"none",border:"none",fontSize:13,cursor:"pointer"}}>View all {wardrobe.length} items →</button></div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOSET SCREEN ────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ClosetScreen({ setAddItem, wardrobe }) {
  const [filter,setFilter]=useState("All");const [sel,setSel]=useState(null);
  const cats=["All","Tops","Bottoms","Dresses","Outerwear","Shoes","Accessories"];
  const filtered=filter==="All"?wardrobe:wardrobe.filter(w=>w.category===filter);
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}><h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,color:C.text,fontWeight:400}}>My Closet</h1><button onClick={()=>setAddItem(true)} style={{background:C.accent,color:"#0F0D0B",border:"none",borderRadius:12,width:40,height:40,fontSize:22,cursor:"pointer"}}>+</button></div>
    <div style={{display:"flex",gap:8,marginBottom:24,overflowX:"auto",paddingBottom:4}}>{cats.map(c=><button key={c} onClick={()=>setFilter(c)} style={{background:filter===c?C.accent:C.card,color:filter===c?"#0F0D0B":C.muted,border:`1px solid ${filter===c?C.accent:C.border}`,borderRadius:20,padding:"7px 16px",fontSize:12,cursor:"pointer",whiteSpace:"nowrap",fontWeight:filter===c?700:400}}>{c}</button>)}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>{filtered.map(item=><div key={item.id} onClick={()=>setSel(item)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:16,cursor:"pointer"}}><div style={{fontSize:44,textAlign:"center",marginBottom:12,background:C.surface,borderRadius:12,padding:"16px 0"}}>{item.img}</div><p style={{color:C.text,fontSize:12,fontWeight:500,marginBottom:4}}>{item.name}</p><p style={{color:C.muted,fontSize:11}}>Worn {item.wears}× · ${(item.price/item.wears).toFixed(1)}/wear</p></div>)}</div>
    {sel&&(<div style={{position:"fixed",inset:0,background:"#000000CC",zIndex:100,display:"flex",alignItems:"flex-end"}} onClick={()=>setSel(null)}><div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:"24px 24px 0 0",padding:28,width:"100%",maxWidth:430,margin:"0 auto"}}><div style={{textAlign:"center",fontSize:64,marginBottom:12}}>{sel.img}</div><h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:24,color:C.text,marginBottom:4}}>{sel.name}</h2><p style={{color:C.muted,fontSize:13,marginBottom:20}}>{sel.category} · {sel.colorName}</p><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:20}}>{[["Worn",`${sel.wears}×`],["Paid",`$${sel.price}`],["Per Wear",`$${(sel.price/sel.wears).toFixed(1)}`]].map(([l,v])=><div key={l} style={{background:C.card,borderRadius:12,padding:12,textAlign:"center"}}><p style={{color:C.accent,fontSize:18,fontFamily:"'Cormorant Garamond',serif"}}>{v}</p><p style={{color:C.muted,fontSize:11}}>{l}</p></div>)}</div><button onClick={()=>setSel(null)} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:14,color:C.muted,cursor:"pointer"}}>Close</button></div></div>)}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PROFILE SCREEN ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
function ProfileScreen({ setScreen, profile, user, wardrobe, onEditProfile, onLogout }) {
  const tv=wardrobe.reduce((s,i)=>s+i.price,0);const tw=wardrobe.reduce((s,i)=>s+i.wears,0);
  return(<div style={{padding:"0 20px 100px"}}>
    <div style={{paddingTop:60,marginBottom:24}}>
      {/* User header */}
      <div style={{display:"flex",gap:16,alignItems:"center",marginBottom:24}}>
        {user?.picture ? (
          <img src={user.picture} alt="" style={{width:68,height:68,borderRadius:"50%",objectFit:"cover",border:`2px solid ${C.accent}`,flexShrink:0}}/>
        ) : (
          <div style={{width:68,height:68,borderRadius:"50%",background:`linear-gradient(135deg,${C.accent},${C.rose})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,flexShrink:0}}>👤</div>
        )}
        <div style={{flex:1}}>
          <h2 style={{color:C.text,fontSize:22,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{user?.name || "Your Profile"}</h2>
          <p style={{color:C.muted,fontSize:12,marginTop:2}}>{user?.email}</p>
          <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
            {profile?.gender && <span style={{background:`${C.accent}18`,color:C.accent,fontSize:10,padding:"2px 8px",borderRadius:20}}>{profile.gender}</span>}
            {profile?.colorSeason && <span style={{background:`${C.gold}18`,color:C.gold,fontSize:10,padding:"2px 8px",borderRadius:20}}>{profile.colorSeason}</span>}
            {profile?.styleVibe && <span style={{background:`${C.rose}18`,color:C.rose,fontSize:10,padding:"2px 8px",borderRadius:20}}>{profile.styleVibe}</span>}
          </div>
        </div>
      </div>

      {/* Profile details */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",marginBottom:20}}>
        {[
          ["Gender", profile?.gender || "—"],
          ["Age", profile?.age ? `${profile.age} years old` : "—"],
          ["Body Shape", profile?.bodyShape || "—"],
          ["Location", profile?.location || "—"],
          ["Color Season", profile?.colorSeason || "—"],
          ["Style Vibe", profile?.styleVibe || "—"],
        ].map(([l,v],i,arr)=>(
          <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",borderBottom:i<arr.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{color:C.muted,fontSize:13}}>{l}</span>
            <span style={{color:C.text,fontSize:13,fontWeight:500}}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:24}}>{[["Value",`$${tv}`],["Wears",tw],["Items",wardrobe.length],["CPW",`$${(tv/tw).toFixed(1)}`]].map(([l,v])=><div key={l} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 8px",textAlign:"center"}}><p style={{color:C.accent,fontSize:16,fontFamily:"'Cormorant Garamond',serif",fontWeight:600}}>{v}</p><p style={{color:C.muted,fontSize:10}}>{l}</p></div>)}</div>
    </div>

    <ClosetAnalysis profile={profile} wardrobe={wardrobe}/>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
      {[{icon:"📅",label:"Outfit Calendar",screen:"calendar"},{icon:"🕵️",label:"Gap Analysis",screen:"gap"},{icon:"🧍",label:"Try-On Studio",screen:"tryon"},{icon:"💬",label:"Style Chat",screen:"chat"}].map(({icon,label,screen})=>(
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
  const [editingProfile, setEditingProfile] = useState(false);

  // Auth state — persisted per device
  const [user, setUser] = useState(() => LS.get("cb_user"));
  const [profile, setProfile] = useState(() => LS.get("cb_profile"));
  const [wardrobe] = useState(DEFAULT_WARDROBE);

  const CSS=`*{margin:0;padding:0;box-sizing:border-box}body{background:#0F0D0B}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}textarea,input{font-family:inherit}::-webkit-scrollbar{display:none}input[type=range]{-webkit-appearance:none;height:4px;border-radius:2px;background:${C.border}}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:${C.accent};cursor:pointer}`;
  const fonts=<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/>;

  const handleLogin = (googleUser) => {
    LS.set("cb_user", googleUser);
    setUser(googleUser);
    // Check if profile exists for this user
    const savedProfile = LS.get(`cb_profile_${googleUser.id}`);
    if (savedProfile) {
      setProfile(savedProfile);
    }
  };

  const handleProfileDone = (profileData) => {
    const fullProfile = { ...profileData, userId: user.id };
    LS.set(`cb_profile_${user.id}`, fullProfile);
    LS.set("cb_profile", fullProfile);
    setProfile(fullProfile);
    setEditingProfile(false);
  };

  const handleLogout = () => {
    LS.del("cb_user");
    LS.del("cb_profile");
    setUser(null);
    setProfile(null);
    setScreen("home");
    // Reload to clear Google session
    if (window.google) window.google.accounts.id.disableAutoSelect();
  };

  // Not logged in → show Google login
  if (!user) return (
    <>{fonts}<style>{CSS}</style>
    <div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:C.bg}}>
      <GoogleLoginScreen onLogin={handleLogin}/>
    </div>
    </>
  );

  // Logged in but no profile → show profile setup
  if (!profile?.setupDone || editingProfile) return (
    <>{fonts}<style>{CSS}</style>
    <div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:C.bg}}>
      <ProfileSetupScreen user={user} existingProfile={editingProfile ? profile : null} onDone={handleProfileDone}/>
    </div>
    </>
  );

  // Chat screen (full screen)
  if (screen === "chat") return (
    <>{fonts}<style>{CSS}</style>
    <ChatScreen setScreen={setScreen} profile={profile} wardrobe={wardrobe}/>
    </>
  );

  return(
    <>{fonts}<style>{CSS}</style>
    <div style={{maxWidth:430,margin:"0 auto",minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Inter',system-ui,sans-serif",position:"relative",overflowX:"hidden"}}>
      {screen==="home" && <HomeScreen setScreen={setScreen} profile={profile} wardrobe={wardrobe} user={user}/>}
      {screen==="closet" && <ClosetScreen setAddItem={setAddItem} wardrobe={wardrobe}/>}
      {screen==="generator" && <OutfitGenerator profile={profile} wardrobe={wardrobe}/>}
      {screen==="tryon" && <TryOnScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="calendar" && <CalendarScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="gap" && <GapAnalysisScreen profile={profile} wardrobe={wardrobe}/>}
      {screen==="discover" && <DiscoverScreen wardrobe={wardrobe}/>}
      {screen==="profile" && <ProfileScreen setScreen={setScreen} profile={profile} user={user} wardrobe={wardrobe} onEditProfile={()=>setEditingProfile(true)} onLogout={handleLogout}/>}
      <BottomNav screen={screen} setScreen={setScreen}/>
      {addItem && <AddItemModal onClose={()=>setAddItem(false)} profile={profile}/>}
    </div>
    </>
  );
}
