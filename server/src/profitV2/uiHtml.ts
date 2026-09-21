// ============================================================
// PROFIT-V2 (VENDORED) — AYRI PROFIT/LOSS SAYFASI
// Self-contained HTML. Baseline'a dokunmaz; /api/profit-v2/* çağırır.
// ============================================================

export const PROFIT_V2_PAGE = `<!DOCTYPE html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kâr/Zarar (Profit V2)</title>
<style>
:root{--bg:#0f1117;--panel:#171a23;--panel2:#1e2230;--text:#e6e9ef;--muted:#97a0b3;--line:#2a3040;--primary:#4f7cff;--pos:#2ecc71;--neg:#ff5c6c;--warn:#f5b041;--unk:#6b7280}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:14px}
.topbar{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line)}
h1{font-size:17px;margin:0}.sub{color:var(--muted);font-size:12px;margin:2px 0 0}
.badge{padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
.KNOWN{background:rgba(46,204,113,.18);color:var(--pos)}.PARTIAL{background:rgba(245,176,65,.18);color:var(--warn)}.UNKNOWN,.INSUFFICIENT_DATA{background:rgba(107,114,128,.2);color:#b8c0cf}
.warn{background:rgba(245,176,65,.2);color:var(--warn)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin:14px 18px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;margin:0 18px}
.grid2 .panel{margin:0}
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:end}
button,input,select{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:7px 10px;font-size:13px}
button{cursor:pointer;font-weight:600}.seg button.active,.btn.primary{background:var(--primary);color:#fff;border-color:var(--primary)}
.kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0 18px}
.kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px}
.kpi .t{color:var(--muted);font-size:12px}.kpi .v{font-size:18px;font-weight:700}.v.unk{color:var(--unk);font-size:14px}
.tbl{width:100%;border-collapse:collapse;font-size:13px}.tbl th{text-align:left;color:var(--muted);padding:6px;border-bottom:1px solid var(--line)}.tbl td{padding:6px;border-bottom:1px solid rgba(255,255,255,.05)}
.wf-row{display:grid;grid-template-columns:1.4fr 1fr;gap:6px;padding:6px 8px;border-radius:7px}.wf-row.total{font-weight:800;border-top:1px solid var(--line);margin-top:6px}
.wf-v{text-align:right}.neg{color:var(--neg)}.pos{color:var(--pos)}.unk-t{color:var(--unk)}
.empty{padding:22px;text-align:center;color:var(--muted)}.err{background:rgba(255,92,108,.15);border:1px solid var(--neg);color:#ffd0d5;padding:8px 12px;border-radius:10px;margin:0 18px}
.prod{display:flex;justify-content:space-between;padding:8px;border:1px solid var(--line);border-radius:9px;margin-bottom:5px;cursor:pointer}
.ai{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin-bottom:5px;font-size:13px}
@media(max-width:720px){.wf-row{grid-template-columns:1.2fr 1fr}}
</style></head><body>
<div class="topbar"><div><h1>Kâr/Zarar (Profit V2)</h1><p class="sub" id="ds">veri</p></div>
<div class="seg" id="dseg"><button data-dataset="real" class="active">Gerçek</button><button data-dataset="test">Test (izole)</button></div></div>
<div class="panel filters">
<div class="seg" id="pseg"><button data-period="DAILY">Bugün</button><button data-period="WEEKLY">Hafta</button><button data-period="MONTHLY" class="active">Ay</button><button data-period="YEARLY">Yıl</button><button data-period="CUSTOM">Özel</button></div>
<label>Pazaryeri <select id="mp"><option value="">Tümü</option></select></label>
<label>Ürün ara <input id="q" placeholder="ad/SKU/barkod"></label>
<input id="dstart" type="date" style="display:none"><input id="dend" type="date" style="display:none">
</div>
<div id="err" class="err" style="display:none"></div>
<div class="kpis" id="kpis" data-testid="kpis"></div>
<div class="panel"><h2 style="font-size:15px;margin:0 0 8px">Kâr Waterfall</h2><div id="wf" data-testid="waterfall"></div></div>
<div class="grid2">
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">Kâr Trendi</h2><div id="c1" data-testid="chart-profit"></div></div>
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">Maliyet Dağılımı</h2><div id="c2" data-testid="chart-cost"></div></div>
</div>
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">Pazaryeri Karşılaştırma</h2><div id="mpt" data-testid="marketplace-table"></div></div>
<div class="grid2">
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">Ürün Arama</h2><div id="plist" data-testid="product-list"></div><div id="pinfo" style="color:var(--muted);text-align:center;margin-top:6px"></div></div>
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">Öğrenme (OFFICIAL/OBSERVED/LEARNED/ESTIMATE)</h2><div id="learn" data-testid="learning"></div></div>
</div>
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">AI Analiz <span class="badge warn">YALNIZCA YORUM</span></h2><div id="ai" data-testid="ai-insights"></div></div>
<div class="panel"><h2 style="font-size:14px;margin:0 0 8px">SİMÜLASYON <span class="badge warn">GERÇEK DEĞİLDİR</span></h2>
<div class="filters"><label>Satış ₺<input id="ss" type="number" value="1000"></label><label>Maliyet ₺<input id="sc" type="number" value="500"></label><label>Komisyon %<input id="sk" type="number" value="15"></label><label>Kargo ₺<input id="sh" type="number" value="60"></label><button id="srun" class="btn primary" data-testid="sim-run">Hesapla</button></div>
<div id="sres" data-testid="sim-result" style="margin-top:8px"></div></div>
<script>
(function(){
 var S={dataset:'real',period:'MONTHLY',marketplace:'',q:'',page:1,start:'',end:''};
 var API='/api/profit-v2';
 function $(s){return document.querySelector(s);}
 function fmt(v){if(v===null||v===undefined||v==='')return 'VERİ YOK';var n=Number(v)/100;if(!isFinite(n))return 'VERİ YOK';return n.toLocaleString('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2});}
 function pct(v){return (v===null||v===undefined)?'VERİ YOK':'%'+Number(v).toFixed(2);}
 function qs(extra){var p='dataset='+S.dataset+'&period='+S.period;if(S.marketplace)p+='&marketplace='+encodeURIComponent(S.marketplace);if(S.period==='CUSTOM'&&S.start&&S.end){p+='&start='+encodeURIComponent(S.start)+'&end='+encodeURIComponent(S.end);}if(extra)for(var k in extra)p+='&'+k+'='+encodeURIComponent(extra[k]);return p;}
 function api(p,opts){opts=opts||{};var tk=null;try{tk=localStorage.getItem('dgstok_token');}catch(e){}var h=Object.assign({'Accept':'application/json'},opts.headers||{});if(tk)h['Authorization']='Bearer '+tk;var o=Object.assign({credentials:'include'},opts);o.headers=h;return fetch(API+p,o).then(function(r){if(!r.ok)throw new Error('API '+r.status);return r.json();});}
 function setErr(m){var e=$('#err');if(m){e.style.display='';e.textContent='Hata: '+m;}else{e.style.display='none';}}
 function mcell(m){if(!m)return '<div class="v unk">VERİ YOK</div>';return '<div class="v '+(m.valueCents===null?'unk':'')+'">'+fmt(m.valueCents)+'</div><div style="margin-top:4px"><span class="badge '+m.status+'">'+(m.status==='KNOWN'?'TAM':m.status==='PARTIAL'?'KISMİ':'VERİ YOK')+'</span></div>';}
 function render(agg){
   var k=$('#kpis');if(!agg||agg.recordCount===0){k.innerHTML='<div class="empty" style="grid-column:1/-1">VERİ YOK — seçili dönemde kayıt yok.</div>';return;}
   var m=agg.metrics;var tc=(m.netSales.valueCents!==null&&m.netProfit.valueCents!==null)?(BigInt(m.netSales.valueCents)-BigInt(m.netProfit.valueCents)).toString():null;
   var cards=[['Ciro',m.revenue],['Net Kâr',m.netProfit],['Komisyon',m.commission],['Kargo',m.shipping],['İade',m.returnCost],['KDV (Net)',m.netVat]];
   var h='';for(var i=0;i<cards.length;i++)h+='<div class="kpi"><div class="t">'+cards[i][0]+'</div>'+mcell(cards[i][1])+'</div>';
   h+='<div class="kpi"><div class="t">Toplam Maliyet</div>'+(tc===null?'<div class="v unk">VERİ YOK</div>':'<div class="v">'+fmt(tc)+'</div>')+'</div>';
   h+='<div class="kpi"><div class="t">Sipariş</div><div class="v">'+agg.orderCount+'</div></div>';
   h+='<div class="kpi"><div class="t">Kâr Marjı</div><div class="v '+(agg.margin.value===null?'unk':'')+'">'+pct(agg.margin.value)+'</div></div>';
   h+='<div class="kpi"><div class="t">ROI</div><div class="v '+(agg.roi.value===null?'unk':'')+'">'+pct(agg.roi.value)+'</div></div>';
   k.innerHTML=h;
 }
 function wf(rows){var el=$('#wf');if(!rows||!rows.length){el.innerHTML='<div class="empty">VERİ YOK</div>';return;}var h='';for(var i=0;i<rows.length;i++){var r=rows[i];var cls=r.valueCents===null?'unk-t':(BigInt(r.valueCents)<0n?'neg':'pos');h+='<div class="wf-row'+(r.key==='netProfit'?' total':'')+'"><div>'+r.label+'</div><div class="wf-v '+cls+'">'+(r.valueCents===null?'VERİ YOK':fmt(r.valueCents))+'</div></div>';}el.innerHTML=h;}
 function bars(el,data){if(!data.length||data.every(function(d){return d.v===null;})){el.innerHTML='<div class="empty">VERİ YOK</div>';return;}var mx=Math.max.apply(null,data.map(function(d){return Math.abs(d.v||0);}).concat([1]));var w=Math.max(320,el.clientWidth||480),ht=150,pad=24,bw=(w-pad*2)/data.length;var s='<svg viewBox="0 0 '+w+' '+ht+'" width="100%" height="'+ht+'">';for(var i=0;i<data.length;i++){var x=pad+i*bw+bw*0.15,val=data[i].v;if(val===null){s+='<rect x="'+x+'" y="'+(ht-pad-2)+'" width="'+(bw*0.7)+'" height="2" fill="#6b7280"/>';}else{var bh=Math.max(1,Math.abs(val)/mx*(ht-pad*2));var y=val>=0?ht-pad-bh:ht-pad;s+='<rect x="'+x+'" y="'+y+'" width="'+(bw*0.7)+'" height="'+bh+'" fill="'+(val>=0?'#4f7cff':'#ff5c6c')+'"/>';}}s+='</svg>';el.innerHTML=s;}
 function hbar(el,rows){if(!rows.length||rows.every(function(r){return r.v===null;})){el.innerHTML='<div class="empty">VERİ YOK</div>';return;}var mx=Math.max.apply(null,rows.map(function(r){return Math.abs(r.v||0);}).concat([1]));var h='';for(var i=0;i<rows.length;i++){var r=rows[i];var w=r.v===null?0:Math.min(100,Math.abs(r.v)/mx*100);h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><div style="width:120px;color:var(--muted);font-size:12px">'+r.l+'</div><div style="flex:1;height:12px;background:var(--panel2);border-radius:6px;overflow:hidden"><div style="height:100%;width:'+w+'%;background:'+(r.v<0?'#ff5c6c':'#4f7cff')+'"></div></div><div style="width:100px;text-align:right;font-size:12px">'+(r.v===null?'VERİ YOK':fmt(r.raw))+'</div></div>';}el.innerHTML=h;}
 function mpTable(rows){var el=$('#mpt');if(!rows||!rows.length){el.innerHTML='<div class="empty">VERİ YOK</div>';return;}var names={tt:'Trendyol',he:'Hepsiburada',n11:'N11'};var h='<table class="tbl"><thead><tr><th>Pazaryeri</th><th>Ciro</th><th>Komisyon</th><th>Kargo</th><th>İade</th><th>Net Kâr</th><th>Marj</th><th>Sipariş</th></tr></thead><tbody>';for(var i=0;i<rows.length;i++){var a=rows[i].result,m=a.metrics;h+='<tr data-mp="'+rows[i].marketplace+'"><td><b>'+(names[rows[i].marketplace]||rows[i].marketplace)+'</b></td><td>'+fmt(m.revenue.valueCents)+'</td><td>'+fmt(m.commission.valueCents)+'</td><td>'+fmt(m.shipping.valueCents)+'</td><td>'+fmt(m.returnCost.valueCents)+'</td><td>'+fmt(m.netProfit.valueCents)+'</td><td>'+pct(a.margin.value)+'</td><td>'+a.orderCount+'</td></tr>';}h+='</tbody></table>';el.innerHTML=h;}
 function loadProducts(){return api('/products?'+qs({query:S.q,page:S.page,pageSize:10})).then(function(r){var d=r.data;var el=$('#plist');if(!d||!d.items||!d.items.length){el.innerHTML='<div class="empty">VERİ YOK</div>';}else{var h='';for(var i=0;i<d.items.length;i++){var it=d.items[i];h+='<div class="prod"><div><div>'+((it.productName||it.productId))+'</div><div style="color:var(--muted);font-size:11px">'+((it.sku||'-')+' · '+(it.barcode||'-'))+'</div></div><div style="text-align:right">'+(it.profit!==undefined?('<span class="unk-t">'+it.profit+'</span>'):fmt(it.aggregate&&it.aggregate.metrics.netProfit.valueCents))+'</div></div>';}el.innerHTML=h;}$('#pinfo').textContent=d.page+' / '+Math.max(1,Math.ceil(d.total/d.pageSize))+' ('+d.total+')';});}
 function loadLearn(){return api('/learning').then(function(r){var d=r.data;var el=$('#learn');if(!d||!d.estimates.length){el.innerHTML='<div class="empty">OBSERVED yok — öğrenme gözlemi bulunmuyor.</div>';return;}var h='<table class="tbl"><thead><tr><th>Metrik</th><th>Pazaryeri</th><th>LEARNED</th><th>Örnek</th><th>Güven</th><th>Durum</th></tr></thead><tbody>';for(var i=0;i<d.estimates.length;i++){var e=d.estimates[i];h+='<tr><td>'+e.metric+'</td><td>'+e.marketplace+'</td><td>'+fmt(e.learnedValueCents)+'</td><td>'+e.sampleCount+'</td><td>'+(e.confidence*100).toFixed(0)+'%</td><td><span class="badge '+(e.status==='CONFIRMED'?'KNOWN':'PARTIAL')+'">'+e.status+'</span></td></tr>';}h+='</tbody></table>';el.innerHTML=h;});}
 function loadAi(){return api('/ai/insights?'+qs()).then(function(r){var d=r.data;var el=$('#ai');if(!d||!d.rendered||!d.rendered.length){el.innerHTML='<div class="empty">AI yorumu yok.</div>';return;}var h='<div style="color:var(--muted);font-size:12px;margin-bottom:6px">AI finansal hesap yapmaz; değerler deterministic motordan gelir.</div>';for(var i=0;i<d.rendered.length;i++){h+='<div class="ai"><b>'+(d.rendered[i].kind)+'</b> — '+d.rendered[i].rendered+'</div>';}el.innerHTML=h;});}
 function loadMpList(){return api('/marketplaces?'+qs()).then(function(r){var sel=$('#mp');var cur=sel.value;var rows=r.data||[];sel.innerHTML='<option value="">Tümü</option>'+rows.map(function(x){return '<option value="'+x.marketplace+'">'+x.marketplace+'</option>';}).join('');sel.value=cur;return rows;});}
 function refresh(){setErr(null);$('#ds').textContent='veri: '+S.dataset+(S.dataset==='test'?' (İZOLE TEST VERİSİ)':' (gerçek)');
   return Promise.all([api('/aggregate?'+qs()),api('/waterfall?'+qs()),api('/trend?'+qs({metric:'netProfit'})),api('/marketplaces?'+qs())]).then(function(r){
     render(r[0].data);wf(r[1].data);
     var tr=r[2].data;bars($('#c1'),tr.map(function(p){return {v:p.metric.valueCents===null?null:Number(p.metric.valueCents)/100};}));
     var agg=r[0].data,m=agg.metrics;hbar($('#c2'),[{l:'Maliyet',v:m.purchaseCost.valueCents===null?null:Number(m.purchaseCost.valueCents)/100,raw:m.purchaseCost.valueCents},{l:'Komisyon',v:m.commission.valueCents===null?null:Number(m.commission.valueCents)/100,raw:m.commission.valueCents},{l:'Kargo',v:m.shipping.valueCents===null?null:Number(m.shipping.valueCents)/100,raw:m.shipping.valueCents}]);
     mpTable(r[3].data);
     return Promise.all([loadProducts(),loadLearn(),loadAi(),loadMpList()]);
   }).catch(function(e){setErr(e.message);});
 }
 function sim(){var sale=Number($('#ss').value||0)*100;var body={salePriceCents:String(Math.round(sale)),purchaseCostCents:String(Math.round(Number($('#sc').value||0)*100)),commissionCents:String(Math.round(sale*Number($('#sk').value||0)/100)),shippingCents:String(Math.round(Number($('#sh').value||0)*100)),saleVatRate:20,purchaseVatRate:20,commissionVatRate:20,shippingVatRate:20};api('/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(function(r){var d=r.data;$('#sres').innerHTML='<span class="badge warn">SİMÜLASYON — gerçek sonuç değildir</span><div style="margin-top:6px">Net Kâr: <b>'+fmt(d.netProfitCents)+'</b> · Marj: <b>'+pct(d.netMarginPercent)+'</b> · ROI: <b>'+pct(d.roiPercent)+'</b></div>';});}
 document.addEventListener('DOMContentLoaded',function(){
   $('#dseg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;S.dataset=b.getAttribute('data-dataset');$('#dseg').querySelectorAll('button').forEach(function(x){x.classList.remove('active');});b.classList.add('active');refresh();});
   $('#pseg').addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;S.period=b.getAttribute('data-period');$('#pseg').querySelectorAll('button').forEach(function(x){x.classList.remove('active');});b.classList.add('active');var c=S.period==='CUSTOM';$('#dstart').style.display=c?'':'none';$('#dend').style.display=c?'':'none';refresh();});
   $('#mp').addEventListener('change',function(e){S.marketplace=e.target.value;refresh();});
   var t=null;$('#q').addEventListener('input',function(e){S.q=e.target.value;S.page=1;clearTimeout(t);t=setTimeout(loadProducts,250);});
   $('#dstart').addEventListener('change',function(e){S.start=e.target.value?e.target.value+'T00:00:00.000Z':'';refresh();});
   $('#dend').addEventListener('change',function(e){S.end=e.target.value?e.target.value+'T00:00:00.000Z':'';refresh();});
   $('#srun').addEventListener('click',sim);
   refresh();
 });
 window.__pv2={refresh:refresh,state:S};
})();
</script></body></html>`;
