// scripts/rt-patch-send-select.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'C:/PROJE 1/DG-STOK-THEME-V1/dist/index.html';
let c = readFileSync(P, 'utf8');
if (c.includes('sr-sendbtn')) { console.log('already patched'); process.exit(0); }

// 1) toolbar after filters
const filtersEnd = '<input class="sr-search" id="sr-search" placeholder="Ürün adı / barkod ara..."/>\n                            <select id="sr-cat"';
// safer: insert toolbar right after the select#sr-cat closing tag
const catAnchor = '</select>\n                        </div>\n                        <div class="sr-card"><table>';
if (!c.includes(catAnchor)) { console.log('cat anchor NOT FOUND'); process.exit(1); }
const toolbar = '</select>\n                        </div>\n                        <div id="sr-toolbar" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap"><span id="sr-selinfo" style="font-size:13px;color:var(--sr-muted);font-weight:600">Hiç ürün seçilmedi</span><button id="sr-sendbtn" class="sr-btn" disabled style="background:var(--sr-green)">GÖNDER</button></div>\n                        <div class="sr-card"><table>';
c = c.replace(catAnchor, toolbar);

// 2) header: add checkbox th
c = c.replace('<thead><tr><th></th><th>Ürün</th>', '<thead><tr><th style="width:34px"><input type="checkbox" id="sr-selall" style="cursor:pointer"/></th><th></th><th>Ürün</th>');

// 3) replace sr-script
const start = c.indexOf('<script id="sr-script">');
const end = c.indexOf('</script>', start);
if (start < 0 || end < 0) { process.exit(1); }

const SCRIPT = `<script id="sr-script">
(function(){
  var ALL=[],MPS=[],MP='',RF='',RTYPE='',RCAT='',SEARCH='',SEL={};
  var REASON={BANNED_WORD:{ic:'\\u{1F6AB}',c:'var(--sr-red)'},CATEGORY:{ic:'\\u{1F5C2}',c:'var(--sr-red)'},REQUIRED_ATTRIBUTE:{ic:'\\u{1F9E9}',c:'var(--sr-red)'},IMAGE:{ic:'\\u{1F5BC}',c:'var(--sr-red)'},BRAND:{ic:'\\u{1F3F7}',c:'var(--sr-red)'},VARIANT:{ic:'\\u{1F500}',c:'var(--sr-red)'},TEMPLATE:{ic:'\\u{1F4C4}',c:'var(--sr-red)'},PRICE:{ic:'\\u{1F4B0}',c:'var(--sr-red)'},STOCK:{ic:'\\u{1F4E6}',c:'var(--sr-red)'},OTHER:{ic:'\\u2753',c:'var(--sr-red)'}};
  function fmt(n){return n==null?'-':Number(n).toLocaleString('tr-TR')}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function dt(s){if(!s)return '-';try{return new Date(s).toLocaleString('tr-TR')}catch(e){return '-'}}
  function toast(msg,type){if(typeof window.showToast==='function')window.showToast(msg,type||'info');else alert(msg);}
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
  function mp(){document.getElementById('sr-mpgrid').innerHTML=MPS.map(function(m){var c=mpCnt(m.key);return '<div class="sr-mp'+(MP===m.key?' sr-active':'')+'" data-mp="'+esc(m.key)+'"><div class="sr-nm">'+esc(m.name)+'<span class="sr-k">'+fmt(c.approved+c.pending+c.rejected)+' \\u00fcr\\u00fcn</span></div><div class="sr-stats"><div class="sr-st"><div class="sr-v" style="color:var(--sr-green)">'+fmt(c.approved)+'</div><div class="sr-t">Ba\\u015far\\u0131l\\u0131</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-amber)">'+fmt(c.pending)+'</div><div class="sr-t">Bekleyen</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-red)">'+fmt(c.rejected)+'</div><div class="sr-t">Red</div></div><div class="sr-st"><div class="sr-v" style="color:var(--sr-blue)">'+fmt(c.action)+'</div><div class="sr-t">Aksiyon</div></div></div></div>';}).join('');
    document.querySelectorAll('#sr-mpgrid .sr-mp').forEach(function(el){el.onclick=function(){var k=el.getAttribute('data-mp');MP=(MP===k?'':k);RTYPE='';RCAT='';SEL={};mp();refreshFilters();render();};});
  }
  function mpScope(){return ALL.filter(function(i){return !MP||i.marketplaceKey===MP;});}
  function refreshFilters(){var sc=mpScope();
    var types={};sc.forEach(function(i){if(i.result==='REJECTED')types[i.reasonType]=(types[i.reasonType]||0)+1;});
    var tk=Object.keys(types).sort(function(a,b){return types[b]-types[a]});
    var wrap=document.getElementById('sr-rtype-wrap');
    if(tk.length){wrap.style.display='inline-flex';document.getElementById('sr-rtypes').innerHTML=tk.map(function(t){var lb=(sc.filter(function(i){return i.reasonType===t})[0]||{}).reasonLabel||t;return '<button class="sr-chip'+(RTYPE===t?' sr-active':'')+'" data-rt="'+esc(t)+'">'+esc(lb)+' <span class="sr-c">'+types[t]+'</span></button>';}).join('');}
    else{wrap.style.display='none';document.getElementById('sr-rtypes').innerHTML='';RTYPE='';}
    document.querySelectorAll('#sr-rtypes .sr-chip').forEach(function(b){b.onclick=function(){RTYPE=(RTYPE===b.getAttribute('data-rt')?'':b.getAttribute('data-rt'));refreshFilters();render();};});
    var cats={};sc.forEach(function(i){if(i.categoryId)cats[i.categoryId]=i.categoryName;});
    document.getElementById('sr-cat').innerHTML='<option value="">Tüm kategoriler</option>'+Object.keys(cats).map(function(id){return '<option value="'+esc(id)+'"'+(RCAT===id?' selected':'')+'>'+esc(cats[id])+'</option>';}).join('');
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
  window.SRfilter=function(t){RF='REJECTED';RTYPE=t;refreshFilters();document.querySelectorAll('.sr-chip[data-srf]').forEach(function(x){x.classList.toggle('sr-active',x.getAttribute('data-srf')==='REJECTED')});render();};
  function visibleItems(){return ALL.filter(function(i){
      if(MP&&i.marketplaceKey!==MP)return false;
      if(RF&&i.result!==RF)return false;
      if(RTYPE&&i.reasonType!==RTYPE)return false;
      if(RCAT&&i.categoryId!==RCAT)return false;
      if(SEARCH){var q=SEARCH.toLowerCase();if(!((i.barcode||'').toLowerCase().includes(q)||(i.title||'').toLowerCase().includes(q)))return false;}
      return true;});}
  function updateToolbar(){var n=Object.keys(SEL).length;var btn=document.getElementById('sr-sendbtn');
    var m=MP?MPS.filter(function(x){return x.key===MP})[0]:null;
    document.getElementById('sr-selinfo').textContent=n?(n+' ürün seçili'+(m?(' · '+m.name):'')):'Hiç ürün seçilmedi'+(m?(' · '+m.name):'');
    btn.disabled=!(n>0&&m);btn.textContent=n?('GÖNDER ('+n+')'):'GÖNDER';
    var vis=visibleItems();var selAll=vis.length>0&&vis.every(function(i){return SEL[i.productId]});
    var sa=document.getElementById('sr-selall');if(sa)sa.checked=selAll;
  }
  function render(){var items=visibleItems();var tb=document.getElementById('sr-tbody');tb.innerHTML='';
    document.getElementById('sr-empty').style.display=items.length?'none':'block';
    items.forEach(function(i){var tr=document.createElement('tr');tr.className='sr-row';
      tr.onclick=function(e){if(e.target.tagName!=='BUTTON'&&e.target.tagName!=='INPUT')openD(i);};
      tr.innerHTML='<td><input type="checkbox" style="cursor:pointer" '+(SEL[i.productId]?'checked':'')+' onchange="SRsel(\\''+i.productId+'\\',this.checked)"/></td>'+
        '<td>'+(i.image?'<img class="sr-thumb" src="'+esc(i.image)+'" onerror="this.style.visibility=\\'hidden\\'"/>':'<div class="sr-thumb"></div>')+'</td>'+
        '<td style="max-width:300px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(i.title)+'">'+esc(i.title||'-')+'</div><div style="font-size:11px;color:var(--sr-gray)">'+esc(i.categoryName||'')+'</div></td>'+
        '<td><span class="sr-bcode">'+esc(i.barcode||'-')+'</span></td><td>'+esc(i.marketplaceName)+'</td><td>'+esc(sendLabel(i.sendStatus))+'</td><td>'+badge(i)+'</td>'+
        '<td style="max-width:170px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sr-muted)" title="'+esc(i.reasonDetail)+'">'+esc(i.reasonLabel||'-')+'</div></td>'+
        '<td style="color:var(--sr-muted);white-space:nowrap">'+dt(i.lastActionAt)+'</td>'+
        '<td style="white-space:nowrap">'+(i.result==='REJECTED'?'<button class="sr-btn sr-sm" onclick="SRopen(\\''+i.productId+'\\')">\\u00c7\\u00f6z</button> ':'')+'<button class="sr-btn sr-ghost sr-sm" style="background:var(--sr-green);color:#fff" onclick="SRsingle(\\''+i.productId+'\\')">G\\u00d6NDER</button></td>';
      tb.appendChild(tr);});
    updateToolbar();
  }
  window.SRsel=function(pid,on){if(on)SEL[pid]=true;else delete SEL[pid];updateToolbar();};
  window.SRsingle=function(pid){SEL={};SEL[pid]=true;render();SRsend();};
  window.SRsend=async function(){var ids=Object.keys(SEL);if(!ids.length){toast('Önce ürün seçin','error');return;}
    if(!MP){toast('Önce pazaryeri seçin','error');return;}
    var m=MPS.filter(function(x){return x.key===MP})[0];if(!m){toast('Pazaryeri bulunamadı','error');return;}
    if(!confirm(ids.length+' ürün '+m.name+' pazaryerine gönderilecek.\\n\\nOnaylıyor musunuz?'))return;
    // TÜM seçili ürünler seçili pazaryerine ait mi? (güvenlik)
    var wrong=ids.filter(function(id){var i=ALL.filter(function(x){return x.productId===id})[0];return !i||i.marketplaceKey!==MP;});
    if(wrong.length){toast('Seçili ürünler seçili pazaryerine ait değil','error');return;}
    var xmlIds=[...new Set(ids.map(function(id){var i=ALL.filter(function(x){return x.productId===id})[0];return i&&i.xmlSourceId;}).filter(Boolean))];
    try{
      var r=await fetch('/api/ready-to-ship/send',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({productIds:ids,marketplaceId:m.id,xmlSourceIds:xmlIds})});
      var j=await r.json().catch(function(){return{};});
      if(r.ok&&j.ok){toast(ids.length+' ürün '+m.name+' için gönderim başlatıldı','success');SEL={};}
      else{var msg=(j.error&&(typeof j.error==='string'?j.error:(j.error.message||j.error.code)))||('HTTP '+r.status);toast('Gönderim reddedildi: '+msg,'error');}
    }catch(e){toast('Gönderim hatası: '+e.message,'error');}
    await window.srLoad();
  };
  function hstep(color,icon,lbl,tm){return '<div class="sr-hstep"><div class="sr-b" style="background:'+color+'">'+icon+'</div><div class="sr-lb">'+esc(lbl)+'</div><div class="sr-tm">'+esc(tm||'')+'</div></div>'}
  function openD(i){var d=document.getElementById('sr-drawer');
    document.getElementById('sr-d-head').innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start"><div style="font-size:12px;color:var(--sr-muted);font-weight:700;text-transform:uppercase;letter-spacing:.05em">\\u00dcr\\u00fcn Detay\\u0131</div><button class="sr-btn sr-ghost sr-sm" onclick="SRclose()">\\u2715</button></div>';
    var t=dt(i.lastActionAt);
    var tl='<div class="sr-htl">'+hstep(i.externalRef?'#12b76a':'#94a3b8',i.externalRef?'\\u2713':'\\u2022','G\\u00f6nderildi',t)+hstep(i.externalRef?'#12b76a':'#cbd5e1',i.externalRef?'\\u2713':'\\u2022','Batch Kabul','')+hstep(i.result==='APPROVAL_PENDING'?'#f79009':(i.result==='APPROVED'?'#12b76a':'#f04438'),i.result==='APPROVAL_PENDING'?'\\u2026':'\\u2713','\\u0130\\u015fleniyor',i.result==='APPROVAL_PENDING'?t:'')+hstep(i.result==='APPROVED'?'#12b76a':(i.result==='REJECTED'?'#f04438':'#e2e8f0'),i.result==='APPROVED'?'\\u2713':(i.result==='REJECTED'?'\\u2715':'\\u2022'),i.result==='APPROVED'?'Onay':'Red',i.result!=='APPROVAL_PENDING'?t:'')+'</div>';
    var red='';if(i.result==='REJECTED'){red='<div class="sr-redbox"><h4>\\u{1F534} NEDEN REDDED\\u0130LD\\u0130? \\u2014 '+esc((i.reasonLabel||'').toUpperCase())+'</h4><p>'+esc(i.reasonDetail)+'</p><div class="sr-kv" style="border:none;padding-top:10px"><span class="sr-k">Etkilenen alan</span><span>'+esc(modLabel(i.targetModule))+'</span></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="sr-btn" onclick="SRgo(\\''+esc(i.targetModule)+'\\')">\\u00c7\\u00f6z \\u2192 '+esc(modLabel(i.targetModule))+'</button><button class="sr-btn sr-blue" onclick="SRai(\\''+i.productId+'\\')">\\u2728 AI ile \\u00c7\\u00f6z</button></div></div>';}
    var kv='<div class="sr-kv"><span class="sr-k">Kategori</span><span>'+esc(i.categoryName||'-')+'</span></div><div class="sr-kv"><span class="sr-k">G\\u00f6nderim</span><span>'+esc(sendLabel(i.sendStatus))+'</span></div><div class="sr-kv"><span class="sr-k">Sonu\\u00e7</span><span>'+badge(i)+'</span></div><div class="sr-kv"><span class="sr-k">Batch / Ref</span><span class="sr-bcode" style="font-size:11px">'+esc(i.externalRef||'-')+'</span></div><div class="sr-kv"><span class="sr-k">Son i\\u015flem</span><span>'+dt(i.lastActionAt)+'</span></div>';
    var tech='<details><summary>Teknik detay (ham)</summary><pre>'+esc(JSON.stringify({productId:i.productId,xmlKey:i.xmlKey,barcode:i.barcode,marketplace:i.marketplaceKey,category:i.categoryName,sendStatus:i.sendStatus,result:i.result,externalRef:i.externalRef,errorMessage:i.errorMessage,lastActionAt:i.lastActionAt},null,2))+'</pre></details>';
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
    if(r.status===401){document.getElementById('sr-tbody').innerHTML='<tr><td colspan="10" class="sr-empty">Oturum gerekli.</td></tr>';return;}
    var j=await r.json();ALL=(j.items||[]);MPS=(j.marketplaces||[]);SEL={};sum();chart();mp();refreshFilters();issues();actions();render();
   }catch(e){document.getElementById('sr-tbody').innerHTML='<tr><td colspan="10" class="sr-empty">Y\\u00fcklenemedi: '+esc(e.message)+'</td></tr>';}};
  document.getElementById('sr-dbg').onclick=window.SRclose;
  document.getElementById('sr-ai-bg').onclick=function(e){if(e.target===this)window.SRcloseAi();};
  document.getElementById('sr-sendbtn').onclick=window.SRsend;
  document.getElementById('sr-selall').onchange=function(){var on=this.checked;visibleItems().forEach(function(i){if(on)SEL[i.productId]=true;else delete SEL[i.productId];});render();};
  document.querySelectorAll('#sr-summary .sr-sc').forEach(function(b){b.onclick=function(){var r=b.getAttribute('data-r');var rr=(r==='ACTION')?'REJECTED':r;document.querySelectorAll('#sr-summary .sr-sc').forEach(function(x){x.classList.remove('sr-active')});b.classList.add('sr-active');RF=rr;render();};});
  document.querySelectorAll('.sr-chip[data-srf]').forEach(function(b){b.onclick=function(){RF=b.getAttribute('data-srf');document.querySelectorAll('.sr-chip[data-srf]').forEach(function(x){x.classList.remove('sr-active')});b.classList.add('sr-active');render();};});
  document.getElementById('sr-search').oninput=function(){SEARCH=this.value;render();};
  document.getElementById('sr-cat').onchange=function(){RCAT=this.value;render();};
})();
</script>`;

c = c.slice(0, start) + SCRIPT + c.slice(end + '</script>'.length);
writeFileSync(P, c);
console.log('patched OK (select+send)');
