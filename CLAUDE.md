# DG-STOK-THEME-V1 — CLAUDE CODE ÇALIŞMA ANAYASASI

## 1. DİL
- Kullanıcıyla tüm iletişim Türkçe yapılacaktır.
- Planlar, analizler, hata açıklamaları, test raporları ve sonuçlar Türkçe olacaktır.
- Kullanıcıdan onay istenmesi gerektiğinde soru ve risk açıklaması Türkçe olacaktır.
- Kod, terminal komutları, dosya isimleri ve teknik API isimleri gerektiğinde İngilizce olabilir; açıklamaları Türkçe olmalıdır.

## 2. PROJE SINIRI
- Ana çalışma alanı yalnızca DG-STOK-THEME-V1 projesidir.
- Proje kökü: C:\PROJE 1\DG-STOK-THEME-V1
- Kullanıcı açıkça istemedikçe başka proje, repository veya çalışma klasörüne geçme.
- Başka projelerden kod veya mimariyi kaynak olarak alma.
- Mevcut proje yapısını koru.

## 3. TEMEL ÇALIŞMA PRENSİBİ
Her anlamlı değişiklikten önce:
1. Mevcut kodu ve ilgili dosyaları oku.
2. Sorunun veya isteğin kök nedenini belirle.
3. PLAN oluştur.
4. Etkilenecek dosyaları belirle.
5. Riskleri değerlendir.
6. Gerekli minimum değişikliği uygula.
7. Build/test yap.
8. UI değişikliğiyse gerçek tarayıcı/Playwright doğrulaması yap.
9. Sonucu Türkçe PASS/FAIL olarak raporla.

Tahmin ederek dosya değiştirme.
Mevcut implementasyonu okumadan yeniden yazma.
Çalışan kodu gereksiz yere refactor etme.

## 4. KÖK NEDEN KURALI
Bir hata görüldüğünde yalnızca semptomu düzeltme.
Önce:
- hatanın kaynağını,
- hangi kod yolundan oluştuğunu,
- hangi dosyaların etkilendiğini,
- düzeltmenin başka modüllere etkisini
belirle.

Aynı hatanın farklı yerde tekrar oluşma riskini kontrol et.

## 5. MINIMUM DE��İŞİKLİK
- Gereken en küçük değişikliği yap.
- Çalışan modülleri yeniden yazma.
- Gereksiz refactor yapma.
- Dependency değiştirme zorunlu değilse dependency değiştirme.
- Mimariyi değiştirme.
- Mevcut çalışan davranışı koru.

## 6. TEMA / UI KURALI
Tema veya UI görevi verildiğinde:
- Öncelik görsel ve kullanıcı deneyimidir.
- Gereksiz API, database veya backend değişikliği yapma.
- Tema görevi için backend mantığını değiştirme.
- Mevcut çalışan event handler, route, API bağlantısı ve iş mantığını koru.
- Light/Dark tema davranışını birlikte kontrol et.
- Responsive davranışı kontrol et.
- Modal, form, buton, tablo, sidebar, header ve navigation davranışlarını kontrol et.

UI değişikliği build başarılı olduğu anda tamamlanmış sayılmaz.

## 7. GÖRSEL DO��RULAMA — ZORUNLU
UI/tema değişikliklerinden sonra:
1. Uygulamayı çalıştır.
2. İlgili route'u aç.
3. Playwright ile gerçek tarayıcı kontrolü yap.
4. Sayfanın görsel durumunu kontrol et.
5. Butonları ve etkileşimleri kontrol et.
6. Modal/form davranışını kontrol et.
7. Console/runtime hatalarını kontrol et.
8. Mümkünse ilgili ekranın önceki durumuyla karşılaştır.
9. Sonucu PASS/FAIL olarak raporla.

Sadece `npm run build` başarılı diye UI değişikliğini tamamlandı kabul etme.

## 8. OTOMATİK ÇALIŞABİLECEK NORMAL İŞLEMLER
Kullanıcıdan gereksiz onay isteme.

Aşağıdaki rutin işlemleri normal geliştirme kapsamında yapabilirsin:
- dosya okuma
- dosya arama
- kod analizi
- kod düzenleme
- normal npm scriptleri
- npm run build
- npm run test
- npm run test:e2e
- TypeScript kontrolü
- lint
- Playwright testleri
- dev server başlatma/durdurma
- mevcut dependency'lerle normal test/build işlemleri
- Context7 dokümantasyon sorguları
- git status
- git diff
- git log

## 9. DEPENDENCY GÜVENLİ��İ
Aşağıdaki işlemleri kullanıcıdan açık onay almadan yapma:
- npm install
- npm uninstall
- npm update
- yeni dependency ekleme
- dependency kaldırma
- package.json/package-lock değişikliğini gerektiren işlemler

Onay isterken:
- ne değişeceğini,
- neden gerektiğini,
- olası riskleri
Türkçe açıkla.

## 10. VERİTABANI / PRISMA
Kullanıcı açıkça izin vermedikçe:
- migration yapma
- Prisma schema değiştirme
- seed çalıştırma
- DB reset yapma
- veri silme
- toplu veri değiştirme
- database yapısını değiştirme

Bunlardan biri gerekiyorsa önce kullanıcıya Türkçe olarak:
- PLAN
- KÖK NEDEN
- ETKİLENEN DOSYALAR/MODELLER
- RİSK
- GEREKÇE
sun ve açık onay bekle.

## 11. MİMARİ DE��İŞİKLİK
Açık kullanıcı izni olmadan:
- büyük refactor
- framework değiştirme
- mimari değiştirme
- klasör yapısını büyük ölçekte değiştirme
- çalışan modülü yeniden tasarlama
- API kontratını değiştirme

yapma.

## 12. KRİTİK PAZARYERİ ALANLARI
Marketplace/pazaryeri modülünde mevcut çalışan kritik alanları koru.

Özellikle:
- Marketplace adı
- Seller ID / Satıcı ID
- API Key
- API Secret
- pazaryerine özel diğer kimlik bilgileri

kullanıcı açıkça istemedikçe silinemez, gizlenemez veya işlevsiz hale getirilemez.

Bir pazaryerinin ek bilgi alanları diğer pazaryerlerden farklı olabilir.
API Key + API Secret + Marketplace adı gibi temel alanların davranışını bozma.

## 13. GİT ANAYASASI — KESİN KURAL
Kullanıcı açıkça söylemeden Git geçmişini değiştiren hiçbir işlem yapma.

YASAK:
- git commit
- git push
- git reset
- git clean
- git merge
- git rebase
- remote değiştirme
- branch geçmişini değiştirme

Kullanıcı açıkça "commit et", "pushla", "GitHub'a gönder" gibi bir talimat vermedikçe bunları yapma.

git status / git diff / git log yalnızca bilgi ve inceleme amacıyla kullanılabilir.

Kullanıcının Git'e ne zaman göndereceğine kullanıcı karar verir.

## 14. SİLME / GERİ DÖNDÜRME
Kullanıcı açıkça izin vermedikçe:
- toplu dosya silme
- çalışan dosyayı silme
- git ile değişiklikleri geri alma
- backup üzerine yazma
- eski sürümü zorla geri getirme

yapma.

Bir şeyi silmek gerekiyorsa önce Türkçe onay iste.

## 15. GÜVENLİK
- API key, API secret, token, password ve encryption key gibi secret değerleri kaynak koda yazma.
- Secret değerleri kullanıcıya tekrar yazdırma veya rapora koyma.
- .env ve secret dosyalarını gereksiz yere açma/değiştirme.
- Bir secret'ın açığa çıktığı düşünülüyorsa kullanıcıyı Türkçe uyar.
- Secret değerlerini Git'e gönderme.

## 16. TEST VE VERIFICATION
Bir görevi tamamlandı olarak raporlamadan önce mümkün olan en uygun doğrulamaları çalıştır.

Öncelik:
1. Build
2. TypeScript
3. İlgili unit/integration test
4. Playwright/E2E
5. UI görsel kontrol
6. Console/runtime kontrolü

Çalıştırılmayan testi çalıştırılmış gibi gösterme.
Başarısız testi başarılı gösterme.

## 17. RED TEAM
Önemli değişikliklerden önce şu soruları değerlendir:
- Bu değişiklik çalışan başka bir modülü bozabilir mi?
- API kontratı etkileniyor mu?
- DB etkileniyor mu?
- Theme dışına taşan bir değişiklik var mı?
- Dependency değişiyor mu?
- Route kırılabilir mi?
- Light/Dark tema bozulabilir mi?
- Marketplace işlevi etkilenebilir mi?
- Kullanıcının mevcut verileri etkilenebilir mi?
- Geri alınabilir mi?

Risk varsa kullanıcıya Türkçe bildir.

## 18. TAMAMLAMA STANDARDI
Bir görev ancak:
- istenen değişiklik yapılmış,
- build/test doğrulanmış,
- UI göreviyse Playwright ile kontrol edilmiş,
- kritik regresyonlar kontrol edilmiş
ve sonuç açıkça raporlanmışsa tamamlandı kabul edilir.

Final raporu Türkçe yaz:
- YAPILAN
- DE��İŞEN DOSYALAR
- TESTLER
- PLAYWRIGHT/UI SONUCU
- RİSK/NOTLAR
- PASS veya FAIL

## 19. KULLANICI KONTROLÜ
Kullanıcı projenin sahibidir.
Claude hızlı çalışabilir ancak kritik kararları kullanıcıdan alamaz.

Amaç:
"Her şeyi soran Claude" değil,
"Normal işleri kendisi yapan, projeyi bozabilecek işlemlerde kullanıcıdan açık onay alan Claude" olmaktır.

Bu anayasa ile çelişen daha riskli bir işlem gerektiğinde güvenli olan yaklaşımı seç ve kullanıcıdan Türkçe onay iste.