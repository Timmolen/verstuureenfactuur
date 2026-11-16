const KEY = 'facturen.v1';
const MAIL_ONDERWERP = 'Factuur {nummer} {bedrijf}';
const MAIL_TEKST = `Geachte heer/mevrouw,

Bedankt voor de samenwerking. In de bijlage vindt u de factuur met factuurnummer: {nummer}.
Mochten er vragen of opmerkingen zijn dan verneem ik het graag.
`;
const DEF = {
  me:{bedrijf:'',naam:'',adres:'',postcode:'',plaats:'',email:'',tel:'',kvk:'',btw:'',iban:'',tnv:'',
      prefix:new Date().getFullYear()+'-',volgnr:1,cijfers:3,termijn:14,boekhoud:'',mailonderwerp:MAIL_ONDERWERP,mailtekst:MAIL_TEKST,mailvia:'app',gmail:'',qr:'ja',voorwaarden:'',logo:'',kleur:'#2b45d4'},
  klanten:[], facturen:[], draft:null
};
const $ = s => document.querySelector(s);
const safeLogo = s => /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+\/=]+$/.test(s||'') ? s : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/\s/g,'').replace(',','.')); return isNaN(n) ? 0 : n; };
const r2 = n => Math.round(n*100)/100;
const eur = n => new Intl.NumberFormat('nl-NL',{style:'currency',currency:'EUR'}).format(n);
const nrf = n => new Intl.NumberFormat('nl-NL',{maximumFractionDigits:2}).format(n);
const iso = d => new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const lang = s => s ? new Date(s+'T12:00').toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'}) : '';
const maand = d => d.toLocaleDateString('nl-NL',{month:'long',year:'numeric'});
const uid = () => Math.random().toString(36).slice(2,10);
const vast = r => r.eenheid === 'vast';
const qty = r => vast(r) ? 1 : num(r.aantal);
const EENHEDEN = {uur:'uur', dag:'dag', stuk:'stuk', km:'km', vast:'vast'};

let S = load();
let view = null;          // gekozen factuur in archief
let tab = 'nieuw';
let editKlant = null;

function load(){
  try{
    const r = JSON.parse(localStorage.getItem(KEY));
    if (r) return {...structuredClone(DEF), ...r, me:{...DEF.me, ...r.me}};
  }catch(e){}
  return structuredClone(DEF);
}
function save(){
  try{ localStorage.setItem(KEY, JSON.stringify(S)); }
  catch(e){ if (!save.warned){ save.warned = true; alert('Opslaan lukt niet in deze browser. Open dit bestand in Safari of Chrome.'); } }
}

function nummer(n = S.me.volgnr){ return (S.me.prefix||'') + String(parseInt(n)||1).padStart(parseInt(S.me.cijfers)||1,'0'); }
function addDays(s, d){ const x = new Date(s+'T12:00'); x.setDate(x.getDate()+(parseInt(d)||0)); return iso(x); }
function klant(id){ return S.klanten.find(k => k.id === id); }

/* EPC QR code (Europese standaard voor SEPA overboekingen): bankapp vult IBAN, naam, bedrag en omschrijving in */
function epcQR(me, bedrag, nr){   // nr = omschrijving bij de overboeking
  const iban = (me.iban||'').replace(/\s/g,'').toUpperCase();
  if (me.qr === 'nee' || !iban || !(bedrag > 0)) return '';
  const data = ['BCD','002','1','SCT','', (me.tnv||me.bedrijf||'').slice(0,70), iban, 'EUR'+bedrag.toFixed(2), '', '', (nr).slice(0,140)].join('\n');
  qrcode.stringToBytes = t => Array.from(new TextEncoder().encode(t));
  const q = qrcode(0,'M'); q.addData(data,'Byte'); q.make();
  return q.createSvgTag({cellSize:2, margin:0, scalable:true});
}

function blankLine(){
  const k = klant(S.draft?.klantId);
  return k?.werkwijze === 'vast' ? {oms:'', aantal:'', eenheid:'vast', prijs:'', btw:21}
                                 : {oms:'', aantal:'', eenheid:'uur', prijs:k?.tarief ?? '', btw:21};
}
function newDraft(){
  const d = new Date();
  return {klantId:S.klanten[0]?.id || '', datum:iso(d), periode:maand(d), ref:klant(S.klanten[0]?.id)?.ref || '', regels:[], notitie:''};
}
if (!S.draft){ S.draft = newDraft(); S.draft.regels = [blankLine()]; }

function calc(regels){
  let sub = 0; const per = {};
  regels.forEach(r => { const b = r2(qty(r)*num(r.prijs)); sub += b; per[r.btw] = (per[r.btw]||0) + b; });
  const btw = Object.entries(per).map(([p,g]) => ({p:+p, grond:r2(g), bedrag:r2(g*p/100)})).sort((a,b)=>b.p-a.p);
  const totaal = r2(sub + btw.reduce((a,x)=>a+x.bedrag,0));
  return {sub:r2(sub), btw, totaal};
}

/* Factuur uit concept opbouwen */
function fromDraft(){
  const d = S.draft;
  return {nummer:nummer(), datum:d.datum, verval:addDays(d.datum,S.me.termijn), periode:d.periode, ref:d.ref || '',
          klant:klant(d.klantId) || null, regels:d.regels, notitie:d.notitie, me:S.me};
}

/* ===== Render: de factuur ===== */
function renderInvoice(inv){
  const me = inv.me, k = inv.klant, t = calc(inv.regels);
  const ph = (v, label) => v ? esc(v) : `<span class="ph">${label}</span>`;
  const regels = inv.regels.filter(r => r.oms || num(r.aantal) || num(r.prijs));
  const rows = regels.map(r => `<tr>
      <td class="d">${esc(r.oms)}</td>
      <td class="r">${vast(r) ? '' : nrf(num(r.aantal)) + ' ' + esc(r.eenheid)}</td>
      <td class="r">${vast(r) ? '' : eur(num(r.prijs))}</td>
      <td class="r">${r.btw}%</td>
      <td class="r">${eur(r2(qty(r)*num(r.prijs)))}</td></tr>`).join('')
    || `<tr><td class="d" colspan="5" style="color:#9aa0a6">Nog geen regels</td></tr>`;
  const btwRows = t.btw.map(b => `<div><span>BTW ${b.p}% over ${eur(b.grond)}</span><span>${eur(b.bedrag)}</span></div>`).join('');
  const to = k ? `<b>${esc(k.naam)}</b>${k.contact?'<br>t.a.v. '+esc(k.contact):''}<br>${esc(k.adres)}<br>${esc(k.postcode)} ${esc(k.plaats)}${k.btw?'<br>BTW '+esc(k.btw):''}`
               : `<span class="ph">Kies een klant</span>`;
  return `<article class="inv" style="--c:${esc(me.kleur||'#2b45d4')}">
    <div class="top">
      <div class="brand">${safeLogo(me.logo) ? `<img src="${esc(safeLogo(me.logo))}" alt="">` : `<div class="name">${ph(me.bedrijf,'Bedrijfsnaam')}</div>`}</div>
      <div class="from">${me.logo && me.bedrijf ? `<b style="color:#15171a">${esc(me.bedrijf)}</b><br>` : ''}${ph(me.naam,'Je naam')}<br>${ph(me.adres,'Adres')}<br>${ph(me.postcode,'Postcode')} ${ph(me.plaats,'Plaats')}<br>${esc(me.email)}${me.tel?'<br>'+esc(me.tel):''}</div>
    </div>
    <div class="title"><span class="w">Factuur</span><span class="nr">${esc(inv.nummer)}</span>${inv.ref ? `<span class="ref">Uw referentie <b>${esc(inv.ref)}</b></span>` : ''}</div>
    <div class="meta">
      <div class="to"><div class="k">Aan</div><div class="v">${to}</div></div>
      <div><div class="k">Factuurdatum</div><div class="v">${lang(inv.datum)}</div></div>
      <div><div class="k">Vervaldatum</div><div class="v">${lang(inv.verval)}</div></div>
      <div><div class="k">Periode</div><div class="v">${esc(inv.periode)}</div></div>
    </div>
    <table>
      <thead><tr><th>Omschrijving</th><th class="r">Aantal</th><th class="r">Tarief</th><th class="r">BTW</th><th class="r">Bedrag</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div><span>Subtotaal</span><span>${eur(t.sub)}</span></div>
      ${btwRows}
      <div class="g"><span>Totaal</span><span>${eur(t.totaal)}</span></div>
    </div>
    ${inv.notitie ? `<div class="memo">${esc(inv.notitie)}</div>` : ''}
    <div class="paygroup">
    <div class="pay"><div>Graag <b>${eur(t.totaal)}</b> overmaken vóór <b>${lang(inv.verval)}</b> op <span class="nw">${ph(me.iban,'IBAN')}</span> t.n.v. ${ph(me.tnv||me.bedrijf,'naam')}, onder vermelding van factuurnummer ${esc(inv.nummer)}.</div></div>
    ${(q => q ? `<figure class="qr">${q}<figcaption><b>Betalen met QR code</b>Scan de code met je bankapp. De overboeking staat dan klaar met het juiste bedrag en factuurnummer. Let op: niet elke bank ondersteunt deze code (EPC QR).</figcaption></figure>` : '')(epcQR(me, t.totaal, 'Factuur ' + inv.nummer + (inv.ref ? ' ref ' + inv.ref : '')))}
    </div>
    <div class="grow"></div>
    <div class="endgroup">
    ${me.voorwaarden ? `<div class="terms">${esc(me.voorwaarden)}</div>` : ''}
    <div class="foot">
      <span><b>${esc(me.bedrijf)}</b></span>
      <span>KvK ${ph(me.kvk,'KvK nummer')}</span>
      ${me.btw ? `<span>BTW ${esc(me.btw)}</span>` : ''}
      <span>IBAN ${ph(me.iban,'IBAN')}</span>
    </div>
    </div>
  </article>`;
}

/* ===== Render: formulieren ===== */
function renderKlantSelect(){
  const sel = $('#d-klant');
  sel.innerHTML = S.klanten.length
    ? S.klanten.map(k => `<option value="${esc(k.id)}">${esc(k.naam)}</option>`).join('')
    : `<option value="">Nog geen klanten</option>`;
  sel.value = S.draft.klantId || '';
}
function renderLines(){
  $('#lines').innerHTML = S.draft.regels.map((r,i) => `<div class="line" data-i="${i}">
      <textarea rows="1" data-k="oms" placeholder="Omschrijving, bijvoorbeeld Fotoshoot portret">${esc(r.oms)}</textarea>
      <div class="nums">
        <div><label>Aantal</label><input data-k="aantal" inputmode="decimal" value="${vast(r) ? '' : esc(r.aantal)}" ${vast(r) ? 'disabled placeholder="1"' : ''}></div>
        <div><label>Soort</label><select data-k="eenheid">${Object.entries(EENHEDEN).map(([v,t])=>`<option value="${v}" ${v===r.eenheid?'selected':''}>${t}</option>`).join('')}</select></div>
        <div><label>${vast(r) ? 'Bedrag' : 'Prijs'}</label><input data-k="prijs" inputmode="decimal" value="${esc(r.prijs)}"></div>
        <div><label>BTW</label><select data-k="btw">${[21,9,0].map(p=>`<option value="${p}" ${+r.btw===p?'selected':''}>${p}%</option>`).join('')}</select></div>
        <button class="del" data-del="${i}" aria-label="Regel verwijderen" title="Regel verwijderen">✕</button>
      </div></div>`).join('');
}
function renderSum(){
  const t = calc(S.draft.regels);
  $('#sum').innerHTML = `<div><span>Subtotaal</span><span>${eur(t.sub)}</span></div>`
    + t.btw.map(b=>`<div><span>BTW ${b.p}%</span><span>${eur(b.bedrag)}</span></div>`).join('')
    + `<div class="tot"><span>Totaal · factuur ${esc(nummer())}</span><span>${eur(t.totaal)}</span></div>`;
}
function renderDraftForm(){
  renderKlantSelect();
  $('#d-datum').value = S.draft.datum;
  $('#d-periode').value = S.draft.periode;
  $('#d-ref').value = S.draft.ref || '';
  $('#d-notitie').value = S.draft.notitie;
  renderLines(); renderSum();
  renderStartlist();
  if (!S.klanten.length && !editKlant) $('#newk').hidden = false;   // nog geen klanten: formulier staat meteen open
}
// Startlijstje: zichtbaar tot de eerste factuur, of tot iemand het verbergt
const ME_VERPLICHT = [['bedrijf','bedrijfsnaam'],['adres','adres'],['postcode','postcode'],['plaats','plaats'],['kvk','KvK nummer'],['iban','IBAN']];
const meOntbreekt = () => ME_VERPLICHT.filter(([f]) => !String(S.me[f]||'').trim());
function startHidden(){ try { return localStorage.getItem('start.verborgen') === '1'; } catch(e){ return false; } }
function renderStartlist(){
  const mis = meOntbreekt(), meKlaar = !mis.length;
  $('#sl-miss').textContent = (!meKlaar && mis.length < ME_VERPLICHT.length) ? 'Nog nodig: ' + mis.map(m => m[1]).join(', ') : '';
  $('#startlist').hidden = S.facturen.length > 0 || startHidden();
  $('#sl-1').classList.toggle('done', meKlaar);
  $('#sl-2').classList.toggle('done', S.klanten.length > 0);
  $('#sl-3').classList.toggle('done', S.facturen.length > 0);
}
function renderArchief(){
  const list = [...S.facturen].reverse();
  $('#archlist').innerHTML = list.length ? `<table class="list"><thead><tr><th>Nummer</th><th>Klant</th><th>Datum</th><th class="r">Totaal</th><th></th></tr></thead><tbody>`
    + list.map(f => `<tr data-nr="${esc(f.nummer)}" class="${view===f.nummer?'sel':''}">
        <td class="n">${esc(f.nummer)}</td><td>${esc(f.klant?.naam)}</td><td class="n">${new Date(f.datum+'T12:00').toLocaleDateString('nl-NL')}</td>
        <td class="r">${eur(calc(f.regels).totaal)}</td>
        <td class="r"><button class="pill ${f.betaald?'paid':''}" data-paid="${esc(f.nummer)}">${f.betaald?'Betaald':'Open'}</button></td></tr>`).join('')
    + `</tbody></table>` : `<p class="empty">Nog niets verstuurd. Je eerste factuur verschijnt hier na "Opslaan en PDF maken".</p>`;
  $('#archactions').hidden = !view;
  const last = S.facturen[S.facturen.length-1];
  $('#a-del').hidden = !(view && last && last.nummer === view);
}
function renderKlanten(){
  $('#klantlist').innerHTML = S.klanten.length ? `<table class="list"><thead><tr><th>Klant</th><th>Plaats</th><th class="r">Tarief</th></tr></thead><tbody>`
    + S.klanten.map(k => `<tr data-k="${esc(k.id)}" class="${editKlant===k.id?'sel':''}"><td>${esc(k.naam)}</td><td>${esc(k.plaats)}</td><td class="r">${k.werkwijze==='vast' ? 'Vast bedrag' : k.tarief ? eur(num(k.tarief))+' p/u' : ''}</td></tr>`).join('')
    + `</tbody></table>` : `<p class="empty">Nog geen klanten. Voeg je eerste klant hieronder toe.</p>`;
}
function renderMe(){
  document.querySelectorAll('[data-me]').forEach(el => { if (document.activeElement !== el) el.value = S.me[el.dataset.me] ?? ''; });
  $('#nrvoorbeeld').textContent = `Je volgende factuur wordt ${nummer()}. Zet dit op het nummer na je laatste factuur.`;
}
function renderPreview(){
  const f = (tab === 'archief' && view) ? S.facturen.find(x => x.nummer === view) : null;
  $('#sheet').innerHTML = renderInvoice(f || fromDraft());
  $('#cap').textContent = f ? `Factuur ${f.nummer}, zoals verstuurd.` : 'Voorbeeld. Zo ziet de PDF eruit.';
}
function renderAll(){
  renderDraftForm(); renderArchief(); renderKlanten(); renderMe(); renderPreview();
}

/* ===== Tabs ===== */
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
function showTab(t){
  tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'v-'+t);
  renderAll();
}

/* ===== Concept bewerken ===== */
$('#d-klant').onchange = e => {
  S.draft.klantId = e.target.value;
  S.draft.ref = klant(S.draft.klantId)?.ref || '';
  S.draft.regels = S.draft.regels.map(r => (r.oms || num(r.aantal) || (vast(r) && num(r.prijs))) ? r : blankLine());
  save(); renderLines(); renderSum(); renderPreview();
};
$('#d-datum').oninput = e => { S.draft.datum = e.target.value; save(); renderPreview(); };
$('#d-periode').oninput = e => { S.draft.periode = e.target.value; save(); renderPreview(); };
$('#d-ref').oninput = e => { S.draft.ref = e.target.value; save(); renderPreview(); };
$('#d-notitie').oninput = e => { S.draft.notitie = e.target.value; save(); renderPreview(); };
$('#lines').addEventListener('input', e => {
  const line = e.target.closest('.line'); if (!line || !e.target.dataset.k) return;
  const k = e.target.dataset.k, r = S.draft.regels[+line.dataset.i];
  r[k] = k==='btw' ? +e.target.value : e.target.value;
  if (k === 'eenheid'){   // wisselen tussen uren en vast bedrag: velden opnieuw tekenen
    if (vast(r)) r.aantal = '';
    else if (!num(r.prijs)) r.prijs = klant(S.draft.klantId)?.tarief ?? '';
    renderLines(); line.parentNode.querySelector(`[data-i="${line.dataset.i}"] [data-k=prijs]`)?.focus();
  }
  save(); renderSum(); renderPreview();
});
$('#lines').addEventListener('click', e => {
  const d = e.target.closest('[data-del]'); if (!d) return;
  S.draft.regels.splice(+d.dataset.del, 1);
  if (!S.draft.regels.length) S.draft.regels.push(blankLine());
  save(); renderLines(); renderSum(); renderPreview();
});
$('#addline').onclick = () => { S.draft.regels.push(blankLine()); save(); renderLines(); renderSum(); renderPreview(); $('#lines .line:last-child textarea').focus(); };
$('#copylast').onclick = () => {
  const vorige = [...S.facturen].reverse().find(f => f.klant?.id === S.draft.klantId) || S.facturen[S.facturen.length-1];
  if (!vorige) return alert('Er is nog geen eerdere factuur.');
  S.draft.regels = structuredClone(vorige.regels).map(r => ({...r, aantal:'', prijs: vast(r) ? '' : r.prijs}));
  S.draft.notitie = vorige.notitie || '';
  save(); renderDraftForm(); renderPreview();
};
$('#reset').onclick = () => {
  if (!confirm('Concept leegmaken?')) return;
  S.draft = newDraft(); S.draft.regels = [blankLine()]; save(); $('#saved').hidden = true; renderAll();
};

/* ===== Afronden: opslaan, PDF, mail ===== */
function missing(inv){
  const m = [];
  if (!inv.klant) m.push('een klant');
  if (!S.me.bedrijf) m.push('je bedrijfsnaam');
  if (!S.me.kvk) m.push('je KvK nummer');
  if (!S.me.iban) m.push('je IBAN');
  if (!inv.regels.some(r => r.oms && qty(r) && num(r.prijs))) m.push('minstens één regel met omschrijving, aantal en bedrag');
  return m;
}
function printInvoice(f){
  const old = document.title;
  document.title = `Factuur ${f.nummer} ${f.klant?.naam || ''}`.trim();   // wordt de bestandsnaam van de PDF
  renderPreview();
  setTimeout(() => { window.print(); document.title = old; }, 50);
}
function mail(f){
  const t = calc(f.regels), me = f.me, k = f.klant || {};
  // {velden} in onderwerp en tekst vervangen door de gegevens van deze factuur
  const velden = {nummer:f.nummer, periode:f.periode, totaal:eur(t.totaal), vervaldatum:lang(f.verval),
                  klant:k.naam||'', contact:k.contact||'', referentie:f.ref||'', bedrijf:me.bedrijf||'', naam:me.naam||''};
  const vul = tekst => String(tekst||'').replace(/\{(\w+)\}/g, (m, v) => v in velden ? velden[v] : m);
  const body = vul(S.me.mailtekst || MAIL_TEKST);
  const subject = vul(S.me.mailonderwerp || MAIL_ONDERWERP), bcc = S.me.boekhoud;
  if (S.me.mailvia === 'app'){
    let url = `mailto:${encodeURIComponent(k.email||'')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (bcc) url += `&bcc=${encodeURIComponent(bcc)}`;
    location.href = url;
    return;
  }
  // Gmail opstellen; authuser (hoofdadres van het Google account) kiest het juiste account bij meerdere logins
  const q = [['authuser', S.me.gmail || ''], ['view','cm'], ['fs','1'], ['to', k.email||''], ['su', subject], ['body', body]];
  if (bcc) q.push(['bcc', bcc]);
  const a = document.createElement('a');
  a.href = 'https://mail.google.com/mail/?' + q.filter(([,v]) => v).map(([k,v]) => k + '=' + encodeURIComponent(v)).join('&');
  a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); a.remove();
  // Vangnet: mailtekst ook op het klembord
  try { navigator.clipboard.writeText(body); } catch(e){}
}
$('#finish').onclick = () => {
  const inv = fromDraft(), m = missing(inv);
  if (m.length) return alert('Nog nodig: ' + m.join(', ') + '.');
  if (S.facturen.some(f => f.nummer === inv.nummer)) return alert(`Nummer ${inv.nummer} bestaat al. Pas het volgende nummer aan bij Mijn gegevens.`);
  const f = structuredClone({...inv, regels:inv.regels.filter(r => r.oms || num(r.aantal) || (vast(r) && num(r.prijs))), me:{...S.me}, betaald:false, gemaakt:new Date().toISOString()});
  S.facturen.push(f);
  S.me.volgnr = (parseInt(S.me.volgnr)||1) + 1;
  const kid = S.draft.klantId;
  S.draft = newDraft(); S.draft.klantId = kid; S.draft.ref = klant(kid)?.ref || ''; S.draft.regels = [blankLine()];
  save();
  view = f.nummer; tab = 'archief';
  showTab('archief');
  printInvoice(f);
  const n = $('#saved'); n.hidden = false;
  n.textContent = `Factuur ${f.nummer} is opgeslagen. Kies in het printvenster "Opslaan als PDF" en daarna "Mail opstellen" bij Verstuurd.`;
};

/* ===== Archief ===== */
$('#archlist').addEventListener('click', e => {
  const p = e.target.closest('[data-paid]');
  if (p){ const f = S.facturen.find(x => x.nummer === p.dataset.paid); f.betaald = !f.betaald; save(); renderArchief(); return; }
  const tr = e.target.closest('tr[data-nr]'); if (!tr) return;
  view = tr.dataset.nr; renderArchief(); renderPreview();
});
const cur = () => S.facturen.find(x => x.nummer === view);
$('#a-pdf').onclick = () => cur() && printInvoice(cur());
$('#a-mail').onclick = () => cur() && mail(cur());
$('#a-copy').onclick = () => {
  const f = cur(); if (!f) return;
  S.draft = newDraft(); S.draft.klantId = f.klant?.id || ''; S.draft.ref = f.ref || ''; S.draft.regels = structuredClone(f.regels).map(r=>({...r, aantal:'', prijs: vast(r) ? '' : r.prijs})); S.draft.notitie = f.notitie || '';
  save(); showTab('nieuw');
};
$('#a-del').onclick = () => {
  const f = cur(); if (!f || !confirm(`Factuur ${f.nummer} verwijderen? Het nummer wordt dan opnieuw gebruikt. Doe dit alleen als hij nog niet verstuurd is.`)) return;
  S.facturen.pop(); S.me.volgnr = Math.max(1, (parseInt(S.me.volgnr)||2) - 1); view = null; save(); renderAll();
};

/* ===== Klanten ===== */
const KF = ['naam','contact','adres','postcode','plaats','email','werkwijze','tarief','btw','ref'];
function fillKlantForm(k){
  KF.forEach(f => $('#k-'+f).value = k?.[f] ?? (f === 'werkwijze' ? 'uur' : ''));
  $('#k-kop').textContent = k ? 'Klant bewerken' : 'Nieuwe klant';
  $('#k-save').textContent = k ? 'Wijzigingen opslaan' : 'Klant opslaan';
  $('#k-cancel').hidden = $('#k-del').hidden = !k;
}
$('#klantlist').addEventListener('click', e => {
  const tr = e.target.closest('tr[data-k]'); if (!tr) return;
  editKlant = tr.dataset.k; fillKlantForm(klant(editKlant)); renderKlanten();
});
$('#klantform').onsubmit = e => {
  e.preventDefault();
  const data = Object.fromEntries(KF.map(f => [f, $('#k-'+f).value.trim()]));
  if (editKlant){ Object.assign(klant(editKlant), data); if (S.draft.klantId === editKlant && !S.draft.ref) S.draft.ref = data.ref; }
  else { const k = {id:uid(), ...data}; S.klanten.push(k); if (!S.draft.klantId){ S.draft.klantId = k.id; S.draft.ref = k.ref; S.draft.regels.forEach(r => { if (!r.prijs) r.prijs = k.tarief; }); } }
  const opgeslagen = editKlant ? klant(editKlant) : S.klanten[S.klanten.length-1];
  editKlant = null; fillKlantForm(null); save(); renderAll();
  $('#k-saved-txt').textContent = `${opgeslagen.naam} is opgeslagen.`;
  $('#k-saved').hidden = false; $('#k-tofactuur').dataset.k = opgeslagen.id;
};
$('#k-tofactuur').onclick = e => {
  S.draft.klantId = e.target.dataset.k; S.draft.ref = klant(S.draft.klantId)?.ref || '';
  S.draft.regels = S.draft.regels.map(r => (r.oms || num(r.aantal)) ? r : blankLine());
  $('#k-saved').hidden = true; save(); showTab('nieuw');
};
$('#k-cancel').onclick = () => { editKlant = null; fillKlantForm(null); renderKlanten(); };
$('#k-del').onclick = () => {
  if (!confirm('Klant verwijderen? Oude facturen blijven bewaard.')) return;
  S.klanten = S.klanten.filter(k => k.id !== editKlant);
  if (S.draft.klantId === editKlant) S.draft.klantId = S.klanten[0]?.id || '';
  editKlant = null; fillKlantForm(null); save(); renderAll();
};

/* ===== Mijn gegevens ===== */
document.querySelectorAll('[data-me]').forEach(el => el.addEventListener('input', () => {
  S.me[el.dataset.me] = el.value; save(); renderMe(); renderSum(); renderPreview();
}));
$('#m-logo').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const img = new Image();
  img.onload = () => {   // verkleinen zodat het in de browseropslag past
    const s = Math.min(1, 600/img.width), c = document.createElement('canvas');
    c.width = img.width*s; c.height = img.height*s;
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    S.me.logo = c.toDataURL('image/png'); save(); renderPreview();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
};
$('#m-mailreset').onclick = () => { S.me.mailonderwerp = MAIL_ONDERWERP; S.me.mailtekst = MAIL_TEKST; save(); renderMe(); };
$('#m-logodel').onclick = () => { S.me.logo = ''; $('#m-logo').value = ''; save(); renderPreview(); };

/* ===== Back-up ===== */
$('#b-export').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S,null,2)], {type:'application/json'}));
  a.download = `facturen-backup-${iso(new Date())}.json`; a.click();
};
$('#b-import').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(t => {
    try{
      const r = JSON.parse(t);
      if (!r.me || !Array.isArray(r.facturen)) throw 0;
      if (!confirm(`Back-up met ${r.facturen.length} facturen en ${r.klanten?.length||0} klanten terugzetten? Wat er nu staat wordt vervangen.`)) return;
      S = {...structuredClone(DEF), ...r, me:{...DEF.me, ...r.me}}; save(); renderAll();
    }catch(err){ alert('Dit bestand is geen back-up van deze factuurpagina.'); }
  });
};

// Melding op de telefoon, één keer wegklikken
try { if (!localStorage.getItem('melding.telefoon')) $('#mobile-note').hidden = false; } catch(e){ $('#mobile-note').hidden = false; }
$('#mobile-ok').onclick = () => { $('#mobile-note').hidden = true; try { localStorage.setItem('melding.telefoon','1'); } catch(e){} };

/* ===== Nieuwe klant direct bij de factuur ===== */
const NK = ['naam','email','tarief','adres','postcode','plaats'];
function openNieuweKlant(){ $('#newk').hidden = false; $('#nk-naam').focus(); }
$('#nk-open').onclick = () => $('#newk').hidden ? openNieuweKlant() : ($('#newk').hidden = true);
$('#nk-cancel').onclick = () => { NK.forEach(f => $('#nk-'+f).value = ''); $('#newk').hidden = true; };
$('#nk-save').onclick = () => {
  const d = Object.fromEntries(NK.map(f => [f, $('#nk-'+f).value.trim()]));
  if (!d.naam) { $('#nk-naam').focus(); return alert('Vul de bedrijfsnaam van je klant in.'); }
  const k = {id:uid(), contact:'', btw:'', ref:'', werkwijze:'uur', ...d};
  S.klanten.push(k);
  S.draft.klantId = k.id; S.draft.ref = '';
  S.draft.regels.forEach(r => { if (r.eenheid === 'uur' && !num(r.prijs)) r.prijs = k.tarief; });
  NK.forEach(f => $('#nk-'+f).value = '');
  $('#newk').hidden = true;
  save(); renderAll();
};

/* ===== Mijn gegevens: opslaan en verder ===== */
document.querySelectorAll('[data-save-me]').forEach(b => b.onclick = () => {
  const mis = meOntbreekt();
  ME_VERPLICHT.forEach(([f]) => $('#m-'+f).classList.toggle('invalid', mis.some(m => m[0] === f)));
  if (mis.length){
    const n = $('#me-missing'); n.hidden = false;
    n.textContent = 'Nog nodig: ' + mis.map(m => m[1]).join(', ') + '.';
    $('#m-'+mis[0][0]).focus();
    return;
  }
  $('#me-missing').hidden = true;
  save(); showTab('nieuw'); window.scrollTo({top:0});
});
document.querySelectorAll('[data-me]').forEach(el => el.addEventListener('input', () => {
  if (el.classList.contains('invalid') && el.value.trim()) el.classList.remove('invalid');
}));

/* ===== Startlijstje ===== */
$('#sl-hide').onclick = () => { try { localStorage.setItem('start.verborgen','1'); } catch(e){} $('#startlist').hidden = true; };
$('#sl-klant').onclick = () => { showTab('nieuw'); openNieuweKlant(); };
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showTab(b.dataset.go));

/* ===== Hulp ===== */
const help = $('#help');
$('#help-open').onclick = () => help.showModal();
$('#help-close').onclick = () => help.close();
help.addEventListener('click', e => { if (e.target === help) help.close(); });   // klik naast het paneel sluit het

renderAll();
