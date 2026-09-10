import React from 'react';

const API_BASE = '';

const PROVIDER_TYPES = [
 { type: 'json', name: 'JSON', icon: '📄', color: 'bg-transparent border-current' },
 { type: 'csv', name: 'CSV', icon: '📊', color: 'bg-transparent border-current' },
 { type: 'excel', name: 'Excel', icon: '📗', color: 'bg-transparent border-current' },
 { type: 'api', name: 'API', icon: '🌐', color: 'bg-transparent border-current' },
 { type: 'ftp', name: 'FTP', icon: '📁', color: 'bg-transparent border-current' },
 { type: 'sftp', name: 'SFTP', icon: '🔒', color: 'bg-transparent border-current' },
];

export default function ProviderTestCenter() {
 const [selectedType, setSelectedType] = React.useState('json');
 const [config, setConfig] = React.useState<Record<string, string>>({});
 const [testResult, setTestResult] = React.useState<any>(null);
 const [fetchResult, setFetchResult] = React.useState<any>(null);
 const [loading, setLoading] = React.useState(false);
 const [error, setError] = React.useState<string | null>(null);

 const updateConfig = (key: string, value: string) => {
 setConfig(prev => ({ ...prev, [key]: value }));
 };

 const getDefaultConfig = (type: string): Record<string, string> => {
 switch (type) {
 case 'json': return { url: 'https://example.com/products.json' };
 case 'csv': return { url: 'https://example.com/products.csv', delimiter: ',' };
 case 'excel': return { url: 'https://example.com/products.xlsx', sheetName: 'Sheet1' };
 case 'api': return { url: 'https://api.example.com/products', apiKey: '' };
 case 'ftp': return { host: '', username: '', password: '', filePath: 'products.xml' };
 case 'sftp': return { host: '', username: '', password: '', privateKey: '', filePath: 'products.xml' };
 default: return {};
 }
 };

 React.useEffect(() => {
 setConfig(getDefaultConfig(selectedType));
 setTestResult(null);
 setFetchResult(null);
 }, [selectedType]);

 const handleTest = async () => {
 setLoading(true);
 setError(null);
 setTestResult(null);
 try {
 const res = await fetch(`${API_BASE}/api/providers/test`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ type: selectedType, config }),
 });
 const data = await res.json();
 setTestResult(data);
 } catch (err: any) {
 setError(err.message);
 } finally {
 setLoading(false);
 }
 };

 const handleFetch = async () => {
 setLoading(true);
 setError(null);
 setFetchResult(null);
 try {
 const res = await fetch(`${API_BASE}/api/providers/fetch`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ type: selectedType, config }),
 });
 const data = await res.json();
 setFetchResult(data);
 } catch (err: any) {
 setError(err.message);
 } finally {
 setLoading(false);
 }
 };

 return (
 <div className="space-y-6">
 <div>
 <h1 className="text-2xl font-bold text-current">Provider Test Merkezi</h1>
 <p className="text-slate-700 dark:text-slate-300 mt-1">Veri kaynagi baglantilarini test et ve onizle</p>
 </div>

 {/* Provider Tipi Secimi */}
 <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
 {PROVIDER_TYPES.map(p => (
 <button
 key={p.type}
 onClick={() => setSelectedType(p.type)}
 className={`p-3 rounded-lg border text-center transition ${
 selectedType === p.type
 ? 'bg-transparent border-current ring-2 ring-primary/30'
 : `${p.color} hover:scale-105`
 }`}
 >
 <div className="text-2xl">{p.icon}</div>
 <div className="text-xs text-current mt-1">{p.name}</div>
 </button>
 ))}
 </div>

 {/* Yapilandirma */}
 <div className="p-4 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg">
 <h2 className="text-lg font-semibold text-current mb-3">
 {PROVIDER_TYPES.find(p => p.type === selectedType)?.name} Yapilandirmasi
 </h2>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {Object.keys(getDefaultConfig(selectedType)).map(key => (
 <div key={key}>
 <label className="text-xs text-current block mb-1 uppercase">{key}</label>
 <input
 type={key.includes('password') || key.includes('secret') || key.includes('key') ? 'password' : 'text'}
 value={config[key] || ''}
 onChange={e => updateConfig(key, e.target.value)}
 placeholder={key}
 className="w-full p-2 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded text-sm text-slate-600 dark:text-slate-400"
 />
 </div>
 ))}
 </div>
 <div className="flex gap-3 mt-4">
 <button
 onClick={handleTest}
 disabled={loading}
 className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary rounded transition"
 >{loading ? 'Test ediliyor...' : '🔌 Baglantiyi Test Et'}</button>
 <button
 onClick={handleFetch}
 disabled={loading}
 className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:bg-primary/10 text-primary rounded transition"
 >{loading ? 'Yukleniyor...' : '📥 Veriyi Cek'}</button>
 </div>
 </div>

 {/* Hata */}
 {error && (
 <div className="p-3 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg text-current">{error}</div>
 )}

 {/* Test Sonucu */}
 {testResult && (
 <div className="p-4 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg">
 <h3 className="text-lg font-semibold text-current mb-3">Test Sonucu</h3>
 {testResult.ok ? (
 <div className="space-y-2">
 <div className="flex items-center gap-2 text-current">
 <span>✅</span> Baglanti basarili
 </div>
 <div className="text-slate-700 dark:text-slate-300 text-sm">{testResult.result?.message}</div>
 </div>
 ) : (
 <div className="text-slate-700 dark:text-slate-300">❌ {testResult.error || 'Baglanti hatasi'}</div>
 )}
 </div>
 )}

 {/* Veri Onizleme */}
 {fetchResult?.ok && fetchResult.result?.products?.length > 0 && (
 <div className="p-4 bg-transparent border border-slate-200 dark:border-slate-800/60 rounded-lg">
 <h3 className="text-lg font-semibold text-current mb-3">
 Veri Onizleme (ilk 10 kayit)
 </h3>
 <div className="text-sm text-current mb-2">
 Toplam: {fetchResult.result.totalCount} urun | Isleme: {fetchResult.result.durationMs}ms
 </div>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="text-current border-b border-slate-100 dark:border-slate-800/60">
 <th className="p-2 text-left">SKU</th>
 <th className="p-2 text-left">Urun</th>
 <th className="p-2 text-left">Barkod</th>
 <th className="p-2 text-right">Stok</th>
 <th className="p-2 text-right">Fiyat</th>
 <th className="p-2 text-left">Marka</th>
 <th className="p-2 text-left">Kategori</th>
 </tr>
 </thead>
 <tbody>
 {fetchResult.result.products.slice(0, 10).map((p: any, i: number) => (
 <tr key={i} className="border-b border-slate-100 dark:border-slate-800/60 text-current">
 <td className="p-2 font-mono text-xs">{p.xmlKey}</td>
 <td className="p-2">{p.title?.substring(0, 40) || '-'}</td>
 <td className="p-2 font-mono text-xs">{p.barcode || '❌'}</td>
 <td className="p-2 text-right">{p.stock}</td>
 <td className="p-2 text-right">{p.price ? `${p.price} TL` : '-'}</td>
 <td className="p-2">{p.brand || '-'}</td>
 <td className="p-2">{p.category || '-'}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}
 </div>
 );
}
