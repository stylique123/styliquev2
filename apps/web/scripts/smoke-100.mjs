// 100-user live smoke test of Mira — sales-funnel scorecard.
// Runs varied shopper conversations against the live API, scores each turn for
// salesperson behavior (asks before showing / recommends / closes / fallback),
// and prints an aggregate scorecard + the notable failing turns.
const API = process.env.MIRA_API ?? "https://stylique-web-production.up.railway.app/api/mira";

const HANDLES = ["onyx-silk-slip","ivory-silk-camisole","atelier-wide-leg-trouser","linen-relaxed-shirt","wrap-coat-camel","cashmere-v-neck","midnight-silk-gown","tailored-blazer-double","pleated-midi-skirt","merino-ribbed-turtleneck","leather-trench","wide-leg-denim"];

// Each scenario: list of user turns; optional pdp handle. Multi-turn feeds history.
const S = [];
const add = (turns, pdp=null, tag="") => S.push({ turns: Array.isArray(turns)?turns:[turns], pdp, tag });

// occasion (15)
["a summer wedding guest dress","outfit for a job interview","first date, something elegant","a black tie gala","brunch with the girls","what do I wear to a funeral","vacation in italy","my graduation","cocktail party friday","dinner with his parents","a winter work event","weekend getaway","art gallery opening","engagement photos","baby shower"].forEach(m=>add([m,"something not too flashy"],null,"occasion"));
// vague (15)
["just looking","not sure what I want","show me something nice","you pick for me","I can't decide","surprise me","what's good here","help me","idk just browsing","what should I get","something for me","treat myself","what's new","I need a refresh","dress me"].forEach(m=>add([m],null,"vague"));
// on-PDP questions (15)
[["is this good?"],["will this suit me?"],["does it run small?"],["what's it made of?"],["is it worth it?"],["is this too formal?"],["can I wear this to work?"],["how do I style this?"],["is the fabric nice?"],["does this come in black?"],["what size am I?"],["is this warm enough?"],["honest opinion?"],["would you wear this?"],["is this flattering?"]].forEach((t,i)=>add(t,HANDLES[i%HANDLES.length],"pdp_q"));
// price (10)
[["too expensive"],["anything cheaper"],["why is it so much"],["how much is this"],["that's a lot of money"],["do you have a budget option"],["is there a sale"],["cheapest thing you have"],["under 300?"],["is it worth the price"]].forEach((t,i)=>add(t,HANDLES[i%HANDLES.length],"price"));
// objection (10)
[["I'm not sure about it"],["let me think about it"],["I don't usually wear this"],["is it too much?"],["I'm worried it won't fit"],["not really my style"],["I always return things"],["what if I don't like it"],["it's a bit bold for me"],["I never know my size"]].forEach((t,i)=>add(t,HANDLES[i%HANDLES.length],"objection"));
// buy-ready (10)
[["I'll take it"],["add it to my bag"],["I'm sold"],["ship it"],["yes this is the one"],["I want this"],["let's do it"],["I'll get it"],["bag it"],["this is perfect, buy"]].forEach((t,i)=>add(t,HANDLES[i%HANDLES.length],"buy"));
// gap/near-miss (10)
[["do you have shoes"],["any handbags"],["anything under $50"],["do you sell jewelry"],["this but cropped"],["do you have it in red"],["a leather mini skirt"],["sneakers?"],["plus size options"],["petite sizing"]].forEach((t,i)=>add(t,HANDLES[i%HANDLES.length],"gap"));
// comparison (10)
[["slip or gown"],["coat or blazer for a wedding"],["which is warmer, cashmere or merino"],["trouser or skirt for work"],["denim or trouser"],["camisole or shirt"],["which dress is more formal"],["leather trench or wrap coat"],["what's better for summer"],["dressy or casual one"]].forEach((m)=>add([m[0]],null,"compare"));
// emotional/loyalty (5)
[["I bought the linen shirt before and loved it"],["I always shop here"],["I'm treating myself today"],["I've been looking for ages and can't decide"],["nothing ever fits me right"]].forEach((t)=>add(t,null,"emotion"));

async function call(message, pdp, history){
  try{
    const r = await fetch(API,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message,currentProductHandle:pdp,history})});
    return await r.json();
  }catch(e){ return {source:"error",decision:null,_err:String(e).slice(0,60)}; }
}

const ASK_ROUTES = new Set(["talk_only","fit","size_form","returns","fabric"]);
const SHOW_ROUTES = new Set(["reco_handle","reco_category","reco_filter","navigate","look","search"]);
const CLOSE_ROUTES = new Set(["add_to_cart","try_on"]);

const rows=[];
let fallback=0, total=0;
for(const sc of S){
  const history=[];
  let last=null;
  for(const t of sc.turns){
    const res = await call(t, sc.pdp, history.slice());
    total++;
    const d = res.decision;
    if(res.source!=="gemini"||!d) fallback++;
    history.push({from:"user",text:t});
    if(d?.voice) history.push({from:"mira",text:d.voice});
    last={tag:sc.tag,pdp:sc.pdp,msg:t,source:res.source,route:d?.route??"NULL",voice:(d?.voice??"").slice(0,120),handle:d?.productHandle??null,chips:d?.quickReplies??[],intent:d?.intent??null,unmet:!!d?.unmet};
    rows.push(last);
  }
}

// Metrics
const byTag={};
for(const r of rows){ (byTag[r.tag] ||= []).push(r); }
const pct=(n,d)=>d?Math.round(100*n/d):0;
const firstTurns = S.map(sc=>rows.find(r=>r.msg===sc.turns[0]&&r.tag===sc.tag)).filter(Boolean);

const vagueAsk = (byTag.vague||[]).filter(r=>ASK_ROUTES.has(r.route)).length;
const occasionAsk = (byTag.occasion||[]).filter(r=>r.msg===( S.find(s=>s.tag==='occasion')?.turns[0])); // n/a
const buyClose = (byTag.buy||[]).filter(r=>CLOSE_ROUTES.has(r.route)).length;
const priceNoTryon = (byTag.price||[]).filter(r=>r.route!=="try_on").length;
const gapFlagged = (byTag.gap||[]).filter(r=>r.unmet||r.route==="talk_only").length;
const objConsult = (byTag.objection||[]).filter(r=>ASK_ROUTES.has(r.route)||r.route==="suitability").length;
const showWithChipsOut = rows.filter(r=>SHOW_ROUTES.has(r.route)).filter(r=>r.chips.some(c=>/another|else|not quite|different|show me|other/i.test(c))).length;
const showTotal = rows.filter(r=>SHOW_ROUTES.has(r.route)).length;

console.log("\n================ MIRA 100-USER SMOKE TEST ================");
console.log(`Scenarios: ${S.length}  |  Total turns: ${total}  |  Fallback/null: ${fallback} (${pct(fallback,total)}%)`);
console.log("\n--- FUNNEL ---");
console.log(`Vague shoppers ASKED a question (not dumped):   ${vagueAsk}/${(byTag.vague||[]).length}  (${pct(vagueAsk,(byTag.vague||[]).length)}%)`);
console.log(`Buy-ready shoppers CLOSED (add_to_cart/try_on): ${buyClose}/${(byTag.buy||[]).length}  (${pct(buyClose,(byTag.buy||[]).length)}%)`);
console.log(`Price turns NOT mis-routed to try_on:           ${priceNoTryon}/${(byTag.price||[]).length}  (${pct(priceNoTryon,(byTag.price||[]).length)}%)`);
console.log(`Gap requests handled honestly:                  ${gapFlagged}/${(byTag.gap||[]).length}  (${pct(gapFlagged,(byTag.gap||[]).length)}%)`);
console.log(`Objections handled consultatively:              ${objConsult}/${(byTag.objection||[]).length}  (${pct(objConsult,(byTag.objection||[]).length)}%)`);
console.log(`Product shows that OFFER an alternative chip:    ${showWithChipsOut}/${showTotal}  (${pct(showWithChipsOut,showTotal)}%)`);

console.log("\n--- ROUTE DISTRIBUTION ---");
const routeCount={}; rows.forEach(r=>routeCount[r.route]=(routeCount[r.route]||0)+1);
console.log(Object.entries(routeCount).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  "));

// Notable failures: fallbacks, buy-not-closed, price->tryon, navigate w/null handle
const fails = rows.filter(r=>
  r.source!=="gemini" ||
  (r.tag==="buy" && !CLOSE_ROUTES.has(r.route)) ||
  (r.tag==="price" && r.route==="try_on") ||
  ((r.route==="navigate"||r.route==="reco_handle") && !r.handle)
);
console.log(`\n--- NOTABLE FAILURES (${fails.length}) ---`);
for(const f of fails.slice(0,25)) console.log(`[${f.tag}] "${f.msg}" -> ${f.route}${f.handle?'/'+f.handle:''} (${f.source}) :: ${f.voice}`);

// Sample of buy-ready closes (good or bad)
console.log("\n--- BUY-READY SAMPLE ---");
for(const r of (byTag.buy||[]).slice(0,6)) console.log(`"${r.msg}" -> ${r.route} :: ${r.voice}`);
console.log("\n--- OBJECTION SAMPLE ---");
for(const r of (byTag.objection||[]).slice(0,6)) console.log(`"${r.msg}" -> ${r.route} :: ${r.voice}`);
console.log("\n========================================================\n");
