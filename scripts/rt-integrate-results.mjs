// scripts/rt-integrate-results.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html';
let c = readFileSync(P, 'utf8');
if (c.includes('id="page-send-results"')) { console.log('already integrated'); process.exit(0); }

const CSS = `
<style id="sr-style">
#page-send-results{--sr-bg:#f5f7fa;--sr-panel:#fff;--sr-ink:#0e1726;--sr-muted:#6b7a90;--sr-line:#e8edf4;--sr-green:#12b76a;--sr-green-bg:#eafaf1;--sr-amber:#f79009;--sr-amber-bg:#fff6e8;--sr-red:#f04438;--sr-red-bg:#fdecea;--sr-blue:#2e6ff2;--sr-blue-bg:#eaf1ff;--sr-gray:#98a4b5;--sr-r:14px;--sr-sh:0 1px 2px rgba(14,23,38,.04),0 6px 18px rgba(14,23,38,.05)}
#page-send-results .sr-h1{font-size:12px;font-weight:700;color:var(--sr-muted);text-transform:uppercase;letter-spacing:.06em;margin:0 0 12px}
#page-send-results .sr-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
#page-send-results .sr-sc{background:var(--sr-panel);border:1px solid var(--sr-line);border-radius:var(--sr-r);box-shadow:var(--sr-sh);padding:16px 18px;position:relative;overflow:hidden;cursor:pointer;transition:.15s}
#page-send-results .sr-sc:hover{transform:translateY(-2px)}
#page-send-results .sr-sc.sr-active{outline:2px solid var(--sr-ink);outline-offset:-2px}
#page-send-results .sr-sc .sr-bar{position:absolute;left:0;top:0;bottom:0;width:4px}
#page-send-results .sr-sc .sr-n{font-size:38px;font-weight:800;line-height:1;letter-spacing:-.02em}
#page-send-results .sr-sc .sr-l{font-size:12.5px;color:var(--sr-muted);font-weight:600;margin-top:8px}
#page-send-results .sr-sc .sr-s{font-size:11px;color:var(--sr-gray);margin-top:3px}
#page-send-results .sr-row2{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;margin-top:16px}
#page-send-results .sr-card{background:var(--sr-panel);border:1px solid var(--sr-line);border-radius:var(--sr-r);box-shadow:var(--sr-sh)}
#page-send-results .sr-card>h3{margin:0;font-size:13px;font-weight:700;padding:15px 18px;border-bottom:1px solid var(--sr-line);display:flex;align-items:center;justify-content:space-between}
#page-send-results .sr-card>h3 .sr-mut{font-weight:600;color:var(--sr-gray);font-size:11.5px}
#page-send-results .sr-chart-body{display:flex;align-items:center;gap:22px;padding:20px}
#page-send-results .sr-legend{flex:1}
#page-send-results .sr-lg{display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px dashed var(--sr-line);font-size:13px}
#page-send-results .sr-lg:last-child{border-bottom:none}
#page-send-results .sr-lg .sr-sw{width:11px;height:11px;border-radius:3px;flex:0 0 auto}
#page-send-results .sr-lg .sr-nm{flex:1;color:var(--sr-muted)}
#page-send-results .sr-lg .sr-vl{font-weight:800}
#page-send-results .sr-mp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
#page-send-results .sr-mp{padding:16px 18px;cursor:pointer;transition:.15s;background:var(--sr-panel);border:1px solid var(--sr-line);border-radius:var(--sr-r);box-shadow:var(--sr-sh)}
#page-send-results .sr-mp:hover{transform:translateY(-2px)}
#page-send-results .sr-mp.sr-active{outline:2px solid var(--sr-blue);outline-offset:-2px}
#page-send-results .sr-mp .sr-nm{font-weight:800;font-size:14.5px;display:flex;align-items:center;justify-content:space-between}
#page-send-results .sr-mp .sr-nm .sr-k{font-size:10px;font-weight:700;color:var(--sr-muted);background:#f1f5f9;border-radius:6px;padding:2px 7px}
#page-send-results .sr-mp .sr-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:14px}
#page-send-results .sr-mp .sr-st{text-align:center;background:#fafbfe;border-radius:10px;padding:8px 4px}
#page-send-results .sr-mp .sr-st .sr-v{font-weight:800;font-size:16px}
#page-send-results .sr-mp .sr-st .sr-t{font-size:9.5px;color:var(--sr-muted);font-weight:700;text-transform:uppercase;margin-top:2px}
#page-send-results .sr-issues,#page-send-results .sr-actions{padding:16px 18px}
#page-send-results .sr-ib{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--sr-line);border-radius:12px;margin-bottom:9px}
#page-send-results .sr-ib .sr-ic{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto}
#page-send-results .sr-ib .sr-tx{flex:1}
#page-send-results .sr-ib .sr-tx .sr-t{font-weight:700;font-size:13.5px}
#page-send-results .sr-ib .sr-tx .sr-d{font-size:11.5px;color:var(--sr-muted);margin-top:2px}
#page-send-results .sr-ib .sr-n{font-weight:800;font-size:16px;margin-right:6px}
#page-send-results .sr-bar-track{height:8px;background:#eef2f7;border-radius:99px;overflow:hidden;margin-top:7px}
#page-send-results .sr-bar-fill{height:100%;border-radius:99px}
#page-send-results .sr-btn{border:none;border-radius:10px;padding:9px 15px;font-size:13px;font-weight:700;cursor:pointer;background:var(--sr-ink);color:#fff;white-space:nowrap}
#page-send-results .sr-btn:hover{filter:brightness(1.06)}
#page-send-results .sr-btn.sr-ghost{background:#eef2f7;color:var(--sr-ink)}
#page-send-results .sr-btn.sr-blue{background:var(--sr-blue)}
#page-send-results .sr-btn.sr-sm{padding:7px 11px;font-size:12px}
#page-send-results .sr-empty{padding:34px 18px;text-align:center;color:var(--sr-muted);font-size:13px}
#page-send-results .sr-okmsg{padding:16px 18px;display:flex;align-items:center;gap:12px;font-size:13.5px;color:#0b6b3f}
#page-send-results .sr-okmsg .sr-ic{width:36px;height:36px;border-radius:10px;background:var(--sr-green-bg);display:flex;align-items:center;justify-content:center;font-size:17px}
#page-send-results .sr-section{margin-top:8px}
#page-send-results .sr-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
#page-send-results .sr-chip{border:1px solid var(--sr-line);background:#fff;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;color:var(--sr-muted)}
#page-send-results .sr-chip.sr-active{background:var(--sr-ink);color:#fff;border-color:var(--sr-ink)}
#page-send-results .sr-chip .sr-c{opacity:.65;margin-left:5px}
#page-send-results .sr-search{flex:1;min-width:200px;border:1px solid var(--sr-line);border-radius:10px;padding:9px 12px;font-size:13px;background:#fff}
#page-send-results table{width:100%;border-collapse:collapse}
#page-send-results th{text-align:left;font-size:10.5px;text-transform:uppercase;color:var(--sr-muted);padding:11px 14px;border-bottom:1px solid var(--sr-line);background:#fafbfe;letter-spacing:.04em;font-weight:700}
#page-send-results td{padding:11px 14px;border-bottom:1px solid var(--sr-line);font-size:13px;vertical-align:middle}
#page-send-results tr.sr-row{cursor:pointer}#page-send-results tr.sr-row:hover{background:#f9fbff}
#page-send-results .sr-thumb{width:38px;height:38px;border-radius:9px;object-fit:cover;background:#eef2f7}
#page-send-results .sr-bcode{font-family:ui-monospace,Consolas,monospace;font-weight:700;letter-spacing:.02em}
#page-send-results .sr-badge{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap}
#page-send-results .sr-b-approved{background:var(--sr-green-bg);color:#0b6b3f}
#page-send-results .sr-b-pending{background:var(--sr-amber-bg);color:#a15c00}
#page-send-results .sr-b-rejected{background:var(--sr-red-bg);color:#a82419}
#page-send-results .sr-dbg{position:fixed;inset:0;background:rgba(14,23,38,.38);opacity:0;pointer-events:none;transition:.2s;z-index:60}
#page-send-results .sr-dbg.sr-on{opacity:1;pointer-events:auto}
#page-send-results .sr-drawer{position:fixed;top:0;right:0;height:100%;width:560px;max-width:96vw;background:#fff;transform:translateX(100%);transition:.25s cubic-bezier(.4,0,.2,1);z-index:61;overflow-y:auto;box-shadow:-16px 0 48px rgba(14,23,38,.2)}
#page-send-results .sr-drawer.sr-on{transform:translateX(0)}
#page-send-results .sr-drawer .sr-hd{padding:20px 22px;border-bottom:1px solid var(--sr-line);position:sticky;top:0;background:#fff;z-index:2}
#page-send-results .sr-drawer .sr-bd{padding:20px 22px 60px}
#page-send-results .sr-dtop{display:flex;gap:14px}
#page-send-results .sr-dtop img{width:76px;height:76px;border-radius:12px;object-fit:cover;background:#eef2f7;flex:0 0 auto}
#page-send-results .sr-dtop .sr-t{font-size:15px;font-weight:800;line-height:1.3}
#page-send-results .sr-dtop .sr-m{font-size:12px;color:var(--sr-muted);margin-top:6px}
#page-send-results .sr-dtop .sr-bc{font-family:ui-monospace,Consolas,monospace;font-size:14px;font-weight:700;margin-top:6px}
#page-send-results .sr-htl{display:flex;margin:22px 0 8px}
#page-send-results .sr-hstep{flex:1;text-align:center;position:relative}
#page-send-results .sr-hstep .sr-b{width:26px;height:26px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;background:#cbd5e1;position:relative;z-index:2}
#page-send-results .sr-hstep .sr-lb{font-size:10px;font-weight:700;color:var(--sr-muted);text-transform:uppercase}
#page-send-results .sr-hstep .sr-tm{font-size:9.5px;color:var(--sr-gray);margin-top:2px}
#page-send-results .sr-hstep:after{content:'';position:absolute;top:13px;left:50%;width:100%;height:2px;background:#e2e8f0;z-index:1}
#page-send-results .sr-hstep:last-child:after{display:none}
#page-send-results .sr-redbox{border-radius:12px;padding:16px;background:var(--sr-red-bg);border:1px solid #f6cfcb;margin:16px 0}
#page-send-results .sr-redbox h4{margin:0 0 4px;font-size:15px;color:#a82419}
#page-send-results .sr-redbox p{margin:6px 0 0;font-size:13px;color:#7f241c;line-height:1.5}
#page-send-results .sr-kv{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px dashed var(--sr-line);font-size:13px}
#page-send-results .sr-kv .sr-k{color:var(--sr-muted);font-weight:600}
#page-send-results details{margin-top:14px;border:1px solid var(--sr-line);border-radius:10px;padding:11px 13px}
#page-send-results details summary{cursor:pointer;font-size:12.5px;font-weight:700;color:var(--sr-muted)}
#page-send-results pre{background:#0e1726;color:#bbf7d0;padding:13px;border-radius:9px;font-size:11.5px;overflow:auto;margin:10px 0 0}
#page-send-results .sr-modal-bg{position:fixed;inset:0;background:rgba(14,23,38,.5);display:none;align-items:center;justify-content:center;z-index:70;padding:16px}
#page-send-results .sr-modal-bg.sr-on{display:flex}
#page-send-results .sr-modal{background:#fff;border-radius:16px;max-width:600px;width:100%;max-height:88vh;overflow-y:auto;padding:24px}
#page-send-results .sr-modal h3{margin:0 0 16px;font-size:17px}
#page-send-results .sr-spin{width:16px;height:16px;border:2px solid #cbd5e1;border-top-color:var(--sr-blue);border-radius:50%;display:inline-block;animation:srsp .7s linear infinite;vertical-align:middle}
@keyframes srsp{to{transform:rotate(360deg)}}
@media(max-width:900px){#page-send-results .sr-summary{grid-template-columns:repeat(2,1fr)}#page-send-results .sr-row2{grid-template-columns:1fr}#page-send-results .sr-mp-grid{grid-template-columns:1fr}}
</style>
`;

const PAGE = `<!-- ==================== PAGE: PAZARYERİ SONUÇ MERKEZİ ==================== -->
                <div id="page-send-results" class="hidden space-y-5">
                    <div>
                        <h2 class="text-xl font-extrabold text-slate-800 dark:text-white">Pazaryeri Sonuç Merkezi</h2>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Gönderime Hazır / Pazaryeri Sonuç Merkezi</p>
                    </div>
                    <div class="sr-h1">Genel Durum</div>
                    <div class="sr-summary" id="sr-summary">
                        <div class="sr-sc" data-r="APPROVED"><div class="sr-bar" style="background:var(--sr-green)"></div><div class="sr-n" style="color:var(--sr-green)" id="sr-n-approved">-</div><div class="sr-l">\u{1F7E2} Onayland\u0131</div><div class="sr-s">Pazaryeri listeledi</div></div>
                        <div class="sr-sc sr-active" data-r="APPROVAL_PENDING"><div class="sr-bar" style="background:var(--sr-amber)"></div><div class="sr-n" style="color:var(--sr-amber)" id="sr-n-pending">-</div><div class="sr-l">\u{1F7E1} Beklemede</div><div class="sr-s">Pazaryeri i\u015fliyor</div></div>
                        <div class="sr-sc" data-r="REJECTED"><div class="sr-bar" style="background:var(--sr-red)"></div><div class="sr-n" style="color:var(--sr-red)" id="sr-n-rejected">-</div><div class="sr-l">\u{1F534} Sorunlu</div><div class="sr-s">Pazaryeri reddetti</div></div>
                        <div class="sr-sc" data-r="ACTION"><div class="sr-bar" style="background:var(--sr-blue)"></div><div class="sr-n" style="color:var(--sr-blue)" id="sr-n-action">-</div><div class="sr-l">\u26A0\uFE0F Aksiyon Gerekli</div><div class="sr-s">M\u00fcdahale gerekiyor</div></div>
                    </div>
                    <div class="sr-row2">
                        <div class="sr-card"><h3>Durum Da\u011f\u0131l\u0131m\u0131 <span class="sr-mut" id="sr-chart-total"></span></h3><div class="sr-chart-body"><div id="sr-donut"></div><div class="sr-legend" id="sr-legend"></div></div></div>
                        <div class="sr-card"><h3>\u015eimdi Ne Yapmal\u0131y\u0131m? <span class="sr-mut" id="sr-todo-count"></span></h3><div id="sr-actions"></div></div>
                    </div>
                    <div class="sr-h1" style="margin-top:6px">Pazaryeri Durumu</div>
                    <div class="sr-mp-grid" id="sr-mpgrid"></div>
                    <div id="sr-issues-wrap" style="display:none"><div class="sr-h1" style="margin-top:6px">Sorunlar\u0131n Kayna\u011f\u0131</div><div class="sr-card"><div class="sr-issues" id="sr-issues"></div></div></div>
                    <div class="sr-section">
                        <div class="sr-h1">Sonu\u00e7lar</div>
                        <div class="sr-filters">
                            <button class="sr-chip" data-srf="APPROVED">Ba\u015far\u0131l\u0131 <span class="sr-c" id="sr-fc-approved">0</span></button>
                            <button class="sr-chip sr-active" data-srf="">T\u00fcm Sonu\u00e7lar <span class="sr-c" id="sr-fc-all">0</span></button>
                            <button class="sr-chip" data-srf="APPROVAL_PENDING">Beklemede <span class="sr-c" id="sr-fc-pending">0</span></button>
                            <button class="sr-chip" data-srf="REJECTED">Sorunlu <span class="sr-c" id="sr-fc-rejected">0</span></button>
                            <input class="sr-search" id="sr-search" placeholder="\u00dcr\u00fcn ad\u0131 / barkod ara..."/>
                        </div>
                        <div class="sr-card"><table><thead><tr><th></th><th>\u00dcr\u00fcn</th><th>Barkod</th><th>Pazaryeri</th><th>G\u00f6nderim</th><th>Sonu\u00e7</th><th>Sorun</th><th>Son \u0130\u015flem</th><th></th></tr></thead><tbody id="sr-tbody"></tbody></table><div class="sr-empty" id="sr-empty" style="display:none">Kay\u0131t yok.</div></div>
                    </div>
                    <div class="sr-dbg" id="sr-dbg"></div>
                    <div class="sr-drawer" id="sr-drawer"><div class="sr-hd" id="sr-d-head"></div><div class="sr-bd" id="sr-d-body"></div></div>
                    <div class="sr-modal-bg" id="sr-ai-bg"><div class="sr-modal" id="sr-ai-modal"></div></div>
                </div>
`;

const JS = `
<script id="sr-script">
(function(){
  var ALL=[],MP='',RF='',SEARCH='';
  var MPN={tt:'Trendyol',he:'Hepsiburada',n11:'N11'};
  var REASON={BANNED_WORD:{ic:'\\u{1F6AB}',c:'var(--sr-red)'},CATEGORY:{ic:'\\u{1F5C2}',c:'var(--sr-red)'},REQUIRED_ATTRIBUTE:{ic:'\\u{1F9E9}',c:'var(--sr-red)'},IMAGE:{ic:'\\u{1F5BC}',c:'var(--sr-red)'},BRAND:{ic:'\\u{1F3F7}',c:'var(--sr-red)'},VARIANT:{ic:'\\u{1F500}',c:'var(--sr-red)'},TEMPLATE:{ic:'\\u{1F4C4}',c:'var(--sr-red)'},PRICE:{ic:'\\u{1F4B0}',c:'var(--sr-red)'},STOCK:{ic:'\\u{1F4E6}',c:'var(--sr-red)'},OTHER:{ic:'\\u2753',c:'var(--sr-red)'}};
  function fmt(n){return n==null?'-':Number(n).toLocaleString('tr-TR')}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function dt(s){if(!s)return '-';try{return new Date(s).toLocaleString('tr-TR')}catch(e){return '-'}}
  function badge(i){if(i.result==='APPROVED')return '<span class="sr-badge sr-b-approved">\\u{1F7E2} Onayland\\u0131</span>';if(i.result==='APPROVAL_PENDING')return '<span class="sr-badge sr-b-pending">\\u{1F7E1} Beklemede</span>';return '<span class="sr-badge sr-b-rejected">\\u{1F534} Sorunlu</span>'}
  function sendLabel(s){return s==='SENDING'?'G\\u00f6nderildi':(s==='ACTIVE'?'Aktif':(s==='ERROR'?'Hata':s))}
  function modLabel(m){return {category:'Kategori E\\u015fle\\u015ftirme',brand:'Marka E\\u015fle\\u015ftirme',variant:'Variant E\\u015fle\\u015ftirme',template:'Listing \\u015eablonu',product:'\\u00dcr\\u00fcn D\\u00fczenleme',pricing:'Fiyatland\\u0131rma',stock:'Stok','':'\\u2014'}[m]||m}
  function cnt(){var c={approved:0,pending:0,rejected:0,action:0};ALL.forEach(function(i){if(i.result==='APPROVED')c.approved++;else if(i.result==='APPROVAL_PENDING')c.pending++;else{c.rejected++;if(i.targetModule)c.action++;}});return c}
  function mpCnt(k){var c={approved:0,pending:0,rejected:0,action:0};ALL.filter(function(i){return i.marketplaceKey===k}).forEach(function(i){if(i.result==='APPROVED')c.approved++;else if(i.result==='APPROVAL_PENDING')c.pending++;else{c.rejected++;if(i.targetModule)c.action++;}});return c}
  function sum(){var c=cnt();
    document.getElementById('sr-n-approved').textContent=fmt(c.approved);
    document.getElementById('sr-n-pending').textContent=fmt(c.pending);
    document.getElementById('sr-n-rejected').textContent=fmt(c.rejected);
    document.getElementById('sr-n-action').textContent=fmt(c.action);
    document.getElementById('sr-fc-all').textContent=fmt(ALL.length);
    document.getElementById('sr-fc-approved').textContent=fmt(c.approved);
    document.getElementById('sr-fc-pending').textContent=fmt(c.pending);
    document.getElementById('sr-fc-rejected').textContent=fmt(c.rejected);
  }
  function chart(){var c=cnt();var tot=ALL.length||1;var data=[['Onayland\\u0131',c.approved,'var(--sr-green)'],['Beklemede',c.pending,'var(--sr-amber)'],['Sorunlu',c.rejected,'var(--sr-red)']];
    var R=64,SW=22,C=2*Math.PI*R,drawn=0,svg='<svg width="170" height="170" viewBox="0 0 170 170"><g transform="translate(85,85) rotate(-90)">';
    data.forEach(function(d){if(d[1]<=0)return;var len=d[1]/tot*C;svg+='<circle r="'+R+'" fill="none" stroke="'+d[2]+'" stroke-width="'+SW+'" stroke-dasharray="'+len+' '+(C-len)+'" stroke-dashoffset="'+(-drawn)+'"></circle>';drawn+=len;});
    if(drawn===0)svg+='<circle r="'+R+'" fill="none" stroke="#e2e8f0" stroke-width="'+SW+'"></circle>';
    svg+='</g><text x="85" y="80" text-anchor="middle" font-size="26" font-weight="800" fill="#0e1726">'+fmt(ALL.length)+'</text><text x="85" y="98" text-anchor="middle" font-size="10" font-weight="700" fill="#6b7a90">G\\u00d6NDER\\u0130M</text></svg>';
    document.getElementById('sr-donut').innerHTML=svg;
    document.getElementById('sr-chart-total').textContent=ALL.length?('toplam '+fmt(ALL.length)+' \\u00fcr\\u00fcn'):'';
    document.getElementById('sr-legend').innerHTML=data.map(function(d){var p=ALL.length?Math.round(d[1]/tot*100):0;return '<div class="sr-lg"><span class="sr-sw" style="background:'+d[2]+'"></span><span class="sr-nm">'+d[0]+'</span><span class="sr-vl" style="color:'+d[2]+'">'+fmt(d[1])+' <span style="color:var(--sr-gray);font-weight:600">('+p+'%)</span></span></div>';}).join('');
  }
  function mp(){var keys=['tt','he','n11'];document.getElementById('sr-mpgrid').innerHTML=keys.map(function(k){var c=mpCnt(k);return '<div class="sr-mp'+(MP===k?' sr-active':'')+'" data-mp="'+k+'"><div class="sr-nm">'+(MPN[k]||k)+'<span class="sr-k">'+fmt(c.approved+c.pending+c.rejected)+' \\u00fcr\\u00fcn</span></div><div class="sr-stats"><div class="sr-st"><div class="sr-v" style="color:var(--sr-green)">'+fmt(c.approved)+'</div><div class="sr-t">Ba\\u015far\\u0131l\\u0131</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-amber)">'+fmt(c.pending)+'</div><div class="sr-t">Bekleyen</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-red)">'+fmt(c.rejected)+'</div><div class="sr-t">Red</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-blue)">'+fmt(c.action)+'</div><div class="sr-t">Aksiyon</div></div></div></div>';}).join('');
    document.querySelectorAll('#sr-mpgrid .sr-mp').forEach(function(el){el.onclick=function(){var k=el.getAttribute('data-mp');MP=(MP===k?'':k);mp();render();};});
  }
  function issues(){var rej=ALL.filter(function(i){return i.result==='REJECTED'});var w=document.getElementById('sr-issues-wrap');if(!rej.length){w.style.display='none';return;}w.style.display='block';
    var bt={};rej.forEach(function(i){bt[i.reasonType]=(bt[i.reasonType]||0)+1;});var max=Math.max.apply(null,Object.keys(bt).map(function(k){return bt[k]}));
    document.getElementById('sr-issues').innerHTML=Object.keys(bt).sort(function(a,b){return bt[b]-bt[a]}).map(function(t){var m=REASON[t]||REASON.OTHER;var n=bt[t];var lbl=(rej.filter(function(i){return i.reasonType===t})[0]||{}).reasonLabel||t;
      return '<div class="sr-ib"><div class="sr-ic" style="background:'+m.c+'1a">'+m.ic+'</div><div class="sr-tx"><div class="sr-t">'+esc(lbl)+'</div><div class="sr-d">'+n+' \\u00fcr\\u00fcn etkilendi</div><div class="sr-bar-track"><div class="sr-bar-fill" style="width:'+Math.round(n/max*100)+'%;background:'+m.c+'"></div></div></div><div class="sr-n" style="color:'+m.c+'">'+n+'</div></div>';}).join('');
  }
  function actions(){var el=document.getElementById('sr-actions');var rej=ALL.filter(function(i){return i.result==='REJECTED'});document.getElementById('sr-todo-count').textContent=rej.length?(rej.length+' \\u00fcr\\u00fcn'):'';
    if(!rej.length){el.innerHTML='<div class="sr-okmsg"><div class="sr-ic">\\u2713</div><div>Aksiyon gerektiren \\u00fcr\\u00fcn <b>yok</b>. '+(ALL.length?'Bekleyen \\u00fcr\\u00fcnler pazaryeri taraf\\u0131ndan i\\u015fleniyor.':'Hen\\u00fcz g\\u00f6nderim yok.')+'</div></div>';return;}
    var bt={};rej.forEach(function(i){bt[i.reasonType]=(bt[i.reasonType]||0)+1;});
    el.innerHTML=Object.keys(bt).sort(function(a,b){return bt[b]-bt[a]}).map(function(t){var m=REASON[t]||REASON.OTHER;var n=bt[t];var lbl=(rej.filter(function(i){return i.reasonType===t})[0]||{}).reasonLabel||t;
      return '<div class="sr-ib"><div class="sr-ic" style="background:'+m.c+'1a">'+m.ic+'</div><div class="sr-tx"><div class="sr-t"><span class="sr-n" style="color:'+m.c+'">'+n+'</span> \\u00fcr\\u00fcn \\u2014 '+esc(lbl)+'</div></div><button class="sr-btn sr-blue sr-sm" onclick="SRfilter(\\''+t+'\\')">\\u00c7\\u00f6z</button></div>';}).join('');
  }
  window.SRfilter=function(){RF='REJECTED';document.querySelectorAll('.sr-chip[data-srf]').forEach(function(x){x.classList.toggle('sr-active',x.getAttribute('data-srf')==='REJECTED')});render();};
  function render(){var items=ALL.filter(function(i){
      if(MP&&i.marketplaceKey!==MP)return false;
      if(RF&&i.result!==RF)return false;
      if(SEARCH){var q=SEARCH.toLowerCase();if(!((i.barcode||'').toLowerCase().includes(q)||(i.title||'').toLowerCase().includes(q)))return false;}
      return true;});
    var tb=document.getElementById('sr-tbody');tb.innerHTML='';
    document.getElementById('sr-empty').style.display=items.length?'none':'block';
    items.forEach(function(i){var tr=document.createElement('tr');tr.className='sr-row';
      tr.onclick=function(e){if(e.target.tagName!=='BUTTON')openD(i);};
      tr.innerHTML='<td>'+(i.image?'<img class="sr-thumb" src="'+esc(i.image)+'" onerror="this.style.visibility=\\'hidden\\'"/>':'<div class="sr-thumb"></div>')+'</td>'+
        '<td style="max-width:300px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(i.title)+'">'+esc(i.title||'-')+'</div></td>'+
        '<td><span class="sr-bcode">'+esc(i.barcode||'-')+'</span></td><td>'+esc(i.marketplaceName)+'</td><td>'+esc(sendLabel(i.sendStatus))+'</td><td>'+badge(i)+'</td>'+
        '<td style="max-width:200px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sr-muted)" title="'+esc(i.reasonDetail)+'">'+esc(i.reasonLabel||'-')+'</div></td>'+
        '<td style="color:var(--sr-muted);white-space:nowrap">'+dt(i.lastActionAt)+'</td>'+
        '<td>'+(i.result==='REJECTED'?'<button class="sr-btn sr-sm" onclick="SRopen(\\''+i.productId+'\\')">\\u00c7\\u00f6z</button>':'<button class="sr-btn sr-ghost sr-sm" onclick="SRopen(\\''+i.productId+'\\')">Detay</button>')+'</td>';
      tb.appendChild(tr);});
  }
  function hstep(color,icon,lbl,tm){return '<div class="sr-hstep"><div class="sr-b" style="background:'+color+'">'+icon+'</div><div class="sr-lb">'+esc(lbl)+'</div><div class="sr-tm">'+esc(tm||'')+'</div></div>'}
  function openD(i){var d=document.getElementById('sr-drawer');
    document.getElementById('sr-d-head').innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="font-size:12px;color:var(--sr-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">\\u00dcr\\u00fcn Detay\\u0131</div><button class="sr-btn sr-ghost sr-sm" onclick="SRclose()">\\u2715</button></div>';
    var t=dt(i.lastActionAt);
    var tl='<div class="sr-htl">'+hstep(i.externalRef?'#12b76a':'#94a3b8',i.externalRef?'\\u2713':'\\u2022','G\\u00f6nderildi',t)+hstep(i.externalRef?'#12b76a':'#cbd5e1',i.externalRef?'\\u2713':'\\u2022','Batch Kabul','')+hstep(i.result==='APPROVAL_PENDING'?'#f79009':(i.result==='APPROVED'?'#12b76a':'#f04438'),i.result==='APPROVAL_PENDING'?'\\u2026':'\\u2713','\\u0130\\u015fleniyor',i.result==='APPROVAL_PENDING'?t:'')+hstep(i.result==='APPROVED'?'#12b76a':(i.result==='REJECTED'?'#f04438':'#e2e8f0'),i.result==='APPROVED'?'\\u2713':(i.result==='REJECTED'?'\\u2715':'\\u2022'),i.result==='APPROVED'?'Onay':'Red',i.result!=='APPROVAL_PENDING'?t:'')+'</div>';
    var red='';if(i.result==='REJECTED'){red='<div class="sr-redbox"><h4>\\u{1F534} NEDEN REDDED\\u0130LD\\u0130? \\u2014 '+esc((i.reasonLabel||'').toUpperCase())+'</h4><p>'+esc(i.reasonDetail)+'</p><div class="sr-kv" style="border:none;padding-top:10px"><span class="sr-k">Etkilenen alan</span><span>'+esc(modLabel(i.targetModule))+'</span></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="sr-btn" onclick="SRgo(\\''+esc(i.targetModule)+'\\')">\\u00c7\\u00f6z \\u2192 '+esc(modLabel(i.targetModule))+'</button><button class="sr-btn sr-blue" onclick="SRai(\\''+i.productId+'\\')">\\u2728 AI ile \\u00c7\\u00f6z</button></div></div>';}
    var kv='<div class="sr-kv"><span class="sr-k">G\\u00f6nderim</span><span>'+esc(sendLabel(i.sendStatus))+'</span></div><div class="sr-kv"><span class="sr-k">Sonu\\u00e7</span><span>'+badge(i)+'</span></div><div class="sr-kv"><span class="sr-k">Batch / Ref</span><span class="sr-bcode" style="font-size:11px">'+esc(i.externalRef||'-')+'</span></div><div class="sr-kv"><span class="sr-k">Son i\\u015flem</span><span>'+dt(i.lastActionAt)+'</span></div>';
    var tech='<details><summary>Teknik detay (ham)</summary><pre>'+esc(JSON.stringify({productId:i.productId,xmlKey:i.xmlKey,barcode:i.barcode,marketplace:i.marketplaceKey,sendStatus:i.sendStatus,result:i.result,externalRef:i.externalRef,errorMessage:i.errorMessage,lastActionAt:i.lastActionAt},null,2))+'</pre></details>';
    document.getElementById('sr-d-body').innerHTML='<div class="sr-dtop">'+(i.image?'<img src="'+esc(i.image)+'" onerror="this.style.visibility=\\'hidden\\'"/>':'<img/>')+'<div><div class="sr-t">'+esc(i.title||'-')+'</div><div class="sr-bc">'+esc(i.barcode||'-')+'</div><div class="sr-m">'+esc(i.marketplaceName)+' \\u00b7 '+badge(i)+'</div></div></div>'+tl+red+kv+tech;
    d.classList.add('sr-on');document.getElementById('sr-dbg').classList.add('sr-on');
  }
  window.SRclose=function(){document.getElementById('sr-drawer').classList.remove('sr-on');document.getElementById('sr-dbg').classList.remove('sr-on');};
  window.SRopen=function(pid){var i=ALL.filter(function(x){return x.productId===pid})[0];if(i)openD(i);};
  window.SRgo=function(m){var map={category:'prep-categories',brand:'prep-brands',variant:'prep-variants',template:'prep-listings',product:'products',pricing:'prep-listings',stock:'products'};if(typeof showPage==='function')showPage(map[m]||'dashboard');};
  window.SRcloseAi=function(){document.getElementById('sr-ai-bg').classList.remove('sr-on');};
  window.SRai=async function(pid){var i=ALL.filter(function(x){return x.productId===pid})[0];if(!i)return;
    var bg=document.getElementById('sr-ai-bg'),m=document.getElementById('sr-ai-modal');bg.classList.add('sr-on');
    m.innerHTML='<h3>\\u2728 AI \\u00c7\\u00f6z\\u00fcm \\u00d6nerisi</h3><div><span class="sr-spin"></span> Ger\\u00e7ek hata + \\u00fcr\\u00fcn verisi analiz ediliyor...</div>';
    var prompt='Bir pazaryeri (Trendyol) \\u00fcr\\u00fcn reddini analiz et. SADECE verilen ger\\u00e7ek veriyi kullan, uydurma.\\n\\u00dcr\\u00fcn: '+(i.title||'')+'\\nBarkod: '+(i.barcode||'')+'\\nHata mesaj\\u0131: '+(i.errorMessage||'')+'\\nSonu\\u00e7: '+i.result+'\\nSADECE JSON: {"sorun":"","tespit":"","oneri":"","degisecek_alan":""}';
    var out;try{var r=await fetch('/api/ai-settings/master/test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:prompt}],taskType:'GENERAL',maxTokens:500,temperature:0})});out=await r.json();}catch(e){out={error:String(e)};}
    var txt='';var d=out&&(out.content||(out.data&&(out.data.content||out.data.text))||out.text);if(typeof d==='string')txt=d;else if(d)txt=JSON.stringify(d);if(!txt)txt=JSON.stringify(out);
    var p={};var s=txt.indexOf('{'),e2=txt.lastIndexOf('}');if(s>=0&&e2>s){try{p=JSON.parse(txt.slice(s,e2+1))}catch(e){}}
    m.innerHTML='<h3>\\u2728 AI \\u00c7\\u00f6z\\u00fcm \\u00d6nerisi</h3>'+
      '<div class="sr-redbox" style="background:var(--sr-blue-bg);border-color:#cdddff"><h4 style="color:#1d4ed8">SORUN</h4><p style="color:#334155">'+esc(p.sorun||i.reasonLabel||'-')+'</p></div>'+
      '<div class="sr-kv"><span class="sr-k">TESP\\u0130T</span><span style="text-align:right;max-width:60%">'+esc(p.tespit||'-')+'</span></div>'+
      '<div class="sr-kv"><span class="sr-k">\\u00d6NER\\u0130</span><span style="text-align:right;max-width:60%">'+esc(p.oneri||'-')+'</span></div>'+
      '<div class="sr-kv"><span class="sr-k">DE\\u011e\\u0130\\u015eECEK ALAN</span><span>'+esc(p.degisecek_alan||modLabel(i.targetModule))+'</span></div>'+
      '<details><summary>Ham AI yan\\u0131t\\u0131</summary><pre>'+esc(txt.slice(0,1500))+'</pre></details>'+
      '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end"><button class="sr-btn sr-ghost" onclick="SRcloseAi()">\\u0130ptal</button><button class="sr-btn sr-ghost" onclick="SRgo(\\''+esc(i.targetModule)+'\\');SRcloseAi()">\\u00dcr\\u00fcn\\u00fc Kendim D\\u00fczenle</button><button class="sr-btn" disabled title="Kullan\\u0131c\\u0131 onay\\u0131 olmadan yazma yok">\\u00d6neriyi Uygula (onay gerekli)</button></div>';
  };
  window.srLoad=async function(){try{var r=await fetch('/api/ready-to-ship/results',{credentials:'include'});
    if(r.status===401){document.getElementById('sr-tbody').innerHTML='<tr><td colspan="9" class="sr-empty">Oturum gerekli.</td></tr>';return;}
    var j=await r.json();ALL=(j.items||[]);sum();chart();mp();issues();actions();render();
   }catch(e){document.getElementById('sr-tbody').innerHTML='<tr><td colspan="9" class="sr-empty">Y\\u00fcklenemedi: '+esc(e.message)+'</td></tr>';}};
  document.getElementById('sr-dbg').onclick=window.SRclose;
  document.getElementById('sr-ai-bg').onclick=function(e){if(e.target===this)window.SRcloseAi();};
  document.querySelectorAll('#sr-summary .sr-sc').forEach(function(b){b.onclick=function(){var r=b.getAttribute('data-r');var rr=(r==='ACTION')?'REJECTED':r;document.querySelectorAll('#sr-summary .sr-sc').forEach(function(x){x.classList.remove('sr-active')});b.classList.add('sr-active');RF=rr;document.querySelectorAll('.sr-chip[data-srf]').forEach(function(x){x.classList.toggle('sr-active',x.getAttribute('data-srf')===rr)});render();};});
  document.querySelectorAll('.sr-chip[data-srf]').forEach(function(b){b.onclick=function(){RF=b.getAttribute('data-srf');document.querySelectorAll('.sr-chip[data-srf]').forEach(function(x){x.classList.remove('sr-active')});b.classList.add('sr-active');render();};});
  document.getElementById('sr-search').oninput=function(){SEARCH=this.value;render();};
})();
</script>
`;

// 1) CSS before </head>
c = c.replace('</head>', CSS + '</head>');
// 2) page div before prep-not-going page
c = c.replace('<div id="page-prep-not-going"', PAGE + '                <div id="page-prep-not-going"');
// 3) pages array
c = c.replace("'prep-not-going', 'ready-to-ship'", "'prep-not-going', 'send-results', 'ready-to-ship'");
// 4) load hook
c = c.replace("if (name === 'prep-not-going') notGoingLoad();", "if (name === 'prep-not-going') notGoingLoad();\n            if (name === 'send-results') srLoad();");
// 5) nav link -> in-app
c = c.replace('<a href="/send-results.html" id="nav-send-results"', '<a href="#" id="nav-send-results" onclick="showPage(\'send-results\'); return false;"');
// 6) JS before </body>
c = c.replace('</body>', JS + '</body>');

writeFileSync(P, c);
console.log('integrated OK');
