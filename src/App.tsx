import React from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import Dashboard from './pages/Dashboard';
import XmlSources from './pages/XmlSources';
import ProductPool from './pages/ProductPool';
import ProductPreparation from './pages/ProductPreparation';
import ReadyToSend from './pages/ReadyToSend';
import MarketplaceControlCenter from './pages/MarketplaceControlCenter';
import SaasLogin from './pages/saas/SaasLogin';
import SaasApp from './pages/saas/SaasApp';
import SaasCustomers from './pages/saas/SaasCustomers';
import Orders from './pages/Orders';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Automation from './pages/Automation';
import VariantExceptionScreen from './pages/VariantExceptionScreen';
import AIImageCenter from './pages/AIImageCenter';
import AISalesCenter from './pages/AISalesCenter';
import AICopilot from './pages/AICopilot';
import AIControlCenter from './pages/AIControlCenter';
import ProfitEngine from './pages/ProfitEngine';
import { MarketplaceProvider } from './context/MarketplaceContext';
import ToastContainer from './components/ui/Toast';

type PageKey = 'kontrol' | 'xml' | 'urunhavuzu' | 'urunhazirlama' | 'urunhazirlama-kategori' | 'urunhazirlama-marka' | 'urunhazirlama-varyant' | 'urunhazirlama-listeleme' | 'gonderimehazir' | 'pazaryeri' | 'siparis' | 'rapor' | 'ayar' | 'varyant' | 'ai-image' | 'ai-sales' | 'copilot' | 'musteriler' | 'ai-kontrol' | 'automation' | 'kar-zarar';

const MENU_ITEMS: Array<{ key: PageKey; label: string; icon: string }> = [
  { key: 'kontrol', label: 'Kontrol Paneli', icon: '📊' },
  { key: 'xml', label: 'XML Kaynakları', icon: '🔗' },
  { key: 'urunhavuzu', label: 'Ürün Havuzu', icon: '📦' },
  { key: 'urunhazirlama', label: 'Ürün Hazırlama', icon: '⚙️' },
  { key: 'gonderimehazir', label: 'Gönderime Hazır', icon: '✅' },
  { key: 'varyant', label: 'Varyant İstisnaları', icon: '🔀' },
  { key: 'ai-kontrol', label: 'AI Kontrol Merkezi', icon: '🧠' },
  { key: 'ai-image', label: 'AI Görsel Merkezi', icon: '🖼️' },
  { key: 'ai-sales', label: 'AI Satış Asistanı', icon: '💰' },
  { key: 'copilot', label: 'AI Copilot', icon: '🤖' },
  { key: 'kar-zarar', label: 'Kâr/Zarar Motoru', icon: '📈' },
  { key: 'pazaryeri', label: 'Pazaryeri Yönetimi', icon: '🛒' },
  { key: 'siparis', label: 'Siparişler', icon: '📑' },
  { key: 'rapor', label: 'Raporlar', icon: '📊' },
  { key: 'ayar', label: 'Ayarlar', icon: '⚙️' },
];

function parseStoredUser(): any {
  try {
    const raw = localStorage.getItem('dgstok_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [auth, setAuth] = React.useState(() => {
    const loggedIn = localStorage.getItem('dgstok_loggedin') === 'true';
    const role = localStorage.getItem('dgstok_role') || '';
    const user = parseStoredUser();
    return { loggedIn, role, user };
  });

  const [activePage, setActivePage] = React.useState('kontrol');
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  // Dark mode başlatma
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('dg_theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      document.documentElement.classList.add('dark');
    }
  }, []);

React.useEffect(() => {
     const onNavigate = (e: Event) => {
       const key = (e as CustomEvent<string>).detail;
       if (typeof key === 'string' && key) setActivePage(key);
     };
     window.addEventListener('dgstok:navigate', onNavigate);
     return () => window.removeEventListener('dgstok:navigate', onNavigate);
   }, []);

   // Sync URL profit-v2 route to kar-zarar page
   React.useEffect(() => {
     if (window.location.pathname.includes('/profit-v2')) {
       setActivePage('kar-zarar');
     }
   }, [window.location.pathname]);

  const handleLoginSuccess = (role: string, user: any) => {
    setAuth({ loggedIn: true, role, user });
  };

  const handleLogout = () => {
    localStorage.removeItem('dgstok_loggedin');
    localStorage.removeItem('dgstok_token');
    localStorage.removeItem('dgstok_role');
    localStorage.removeItem('dgstok_user');
    localStorage.removeItem('dgstok_tenantId');
    window.location.reload();
  };

  const handlePageChange = (key: string) => {
    if (key === 'toggle-collapse') {
      setSidebarCollapsed((prev) => !prev);
    } else {
      setActivePage(key);
    }
  };

  const getPageTitle = () => {
    const titles: Record<string, string> = {
      kontrol: 'Kontrol Paneli',
      xml: 'XML Kaynakları',
      urunhavuzu: 'Ürün Havuzu',
      urunhazirlama: 'Ürün Hazırlama',
      'urunhazirlama-kategori': 'Kategori Eşleştirme',
      'urunhazirlama-marka': 'Marka Eşleştirme',
      'urunhazirlama-varyant': 'Varyant Eşleştirme',
      'urunhazirlama-listeleme': 'Listeleme Şablonları',
      gonderimehazir: 'Gönderime Hazır',
      varyant: 'Varyant İstisna Yönetimi',
      'ai-image': 'AI Görsel Kalite Merkezi',
      'ai-sales': 'AI Satış ve Karlılık Asistanı',
      copilot: 'AI Copilot',
      pazaryeri: 'Pazaryeri Yönetimi',
      siparis: 'Siparişler',
      rapor: 'Raporlar',
      ayar: 'Ayarlar',
      musteriler: 'Müşteri Yönetimi',
      automation: 'Stok Otomasyonu',
      'kar-zarar': 'Kâr/Zarar Motoru',
    };
    return titles[activePage] || 'Kontrol Paneli';
  };

  const renderPage = () => {
    switch (activePage) {
      case 'kontrol': return <Dashboard />;
      case 'xml': return <XmlSources />;
      case 'urunhavuzu': return <ProductPool />;
      case 'urunhazirlama': return <ProductPreparation />;
      case 'urunhazirlama-kategori': return <ProductPreparation defaultTab="kategori" />;
      case 'urunhazirlama-marka': return <ProductPreparation defaultTab="marka" />;
      case 'urunhazirlama-varyant': return <ProductPreparation defaultTab="varyant" />;
      case 'urunhazirlama-listeleme': return <ProductPreparation defaultTab="listeleme" />;
      case 'gonderimehazir': return <ReadyToSend />;
      case 'varyant': return <VariantExceptionScreen />;
      case 'ai-image': return <AIImageCenter />;
      case 'ai-sales': return <AISalesCenter />;
      case 'copilot': return <AICopilot />;
      case 'ai-kontrol': return <AIControlCenter />;
      case 'pazaryeri': return <MarketplaceControlCenter />;
      case 'siparis': return <Orders />;
      case 'rapor': return <Reports onNavigate={setActivePage} />;
      case 'ayar': return <Settings />;
      case 'musteriler': return <SaasCustomers />;
      case 'automation': return <Automation />;
      case 'kar-zarar': return <ProfitEngine />;
      default: return <Dashboard />;
    }
  };

  if (!auth.loggedIn) {
    return <SaasLogin onLoginSuccess={handleLoginSuccess} />;
  }

  // Müşteri (CUSTOMER) rolünde ise bağımsız SaaS paneli göster
  if (auth.role === 'CUSTOMER') {
    return <SaasApp />;
  }

  // Admin/Operatör: mevcut layout
  return (
    <MarketplaceProvider>
      <div className="flex h-screen bg-slate-100 dark:bg-[#090d16] transition-colors duration-300">
        <Sidebar activePage={activePage} onPageChange={handlePageChange} collapsed={sidebarCollapsed} userRole={auth.role} />
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
          <Header
            title={getPageTitle()}
            subtitle="DG STOK V5.0 Profesyonel Entegratör"
            onRefresh={() => window.location.reload()}
            notifications={0}
            user={auth.user}
            onLogout={handleLogout}
          />
          <main className="flex-1 overflow-y-auto p-4 space-y-6">
            <ErrorBoundary>
              {renderPage()}
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <ToastContainer />
    </MarketplaceProvider>
  );
}
