# Seck Uzak Masaustu Destek

Bu proje, Windows bilgisayarlar arasinda calisan, bilgisayar koduna gore lisanslanan ve GitHub uzerinden guncellenebilen uzak masaustu destek uygulamasidir.

Saglanan ozellikler:

- Her cihaz icin kalici bilgisayar kodu
- Her 30 saniyede yenilenen otomatik sifre
- Istege bagli sabit sifre tanimlama
- Bilgisayar koduna gore GitHub tabanli lisans dogrulama
- GitHub Release tabanli guncelleme bildirimi
- Ekran paylasimi
- Fare ve temel klavye kontrolu
- Dosya transferi

Not: Sunucu ve guncelleme adresleri kullanicidan gizlidir. Uygulama arka plandaki servis bilgilerini kendi icinde kullanir.

## Surum ve Lisans Dosyalari

- version.json: Surum numarasi ve GitHub repo bilgisi buradan yonetilir.
- licenses.json: Bilgisayar kodu bazli lisans kayitlari, aktiflik ve son kullanma tarihi buradan yonetilir.

Ornek version.json:

```json
{
	"appVersion": "0.1.0",
	"githubRepo": "SelimCa/seck-uzak-masaustu-destek",
	"licenseFile": "licenses.json"
}
```

Ornek licenses.json:

```json
{
	"devices": {
		"123-456-789": {
			"name": "Musteri Unvani",
			"active": true,
			"expires": "2027-12-31"
		}
	}
}
```

Lisans mantigi:

- Uygulama acilinca cihaz kodu gorunur.
- Bu kod normal kullanimda sabit kalir; config silinirse yeniden uretilir.
- GitHub uzerindeki licenses.json dosyasinda ayni kod varsa lisans aktif olur.
- Kullanici arayuzunden Lisansi Yenile diyerek yeni lisans durumunu aninda cekebilir.
- Lisans Talep Et butonu version.json icindeki licenseRequestWebhookUrl adresine webhook POST atar.

Varsayilan webhook yolu [version.json](version.json) icinde /license-request olarak tanimlidir.
Bu yol, istemcinin bagli oldugu signalServerUrl adresi uzerinden gercek webhook adresine cozulur.
Ornek: signal sunucun http://destek.firma.com:3131 ise lisans talebi http://destek.firma.com:3131/license-request adresine gider.

## Gereksinimler

- Windows 10 veya Windows 11
- Node.js
- Ayni sinyal sunucusuna erisebilen iki bilgisayar

## Kurulum

1. Bu klasorde terminal ac.
2. Bagimliliklari yukle:

```powershell
cmd /c npm install
```

## Calistirma

### Yerel gelistirme icin

Bu komut hem sinyal sunucusunu hem Electron uygulamasini ayni bilgisayarda baslatir:

```powershell
cmd /c npm run dev
```

## EXE Kurulum Paketi Uretme

Kurulum dosyasi olusturmak icin:

```powershell
cmd /c npm install
cmd /c npm run build-win
```

Not: Build komutlari calismadan once version.json icindeki appVersion degeri package.json dosyasina otomatik senkronlanir.

Hazir bat dosyalari:

- KUR_VE_CALISTIR.bat: npm install yapip uygulamayi baslatir.
- CALISTIR.bat: uygulamayi dogrudan baslatir.
- build_tools/0_GITHUB_ILK_KURULUM.bat: GitHub repo kurulumunu yapar.
- build_tools/1_EXE_OLUSTUR.bat: Windows installer uretir.
- build_tools/2_GUNCELLEME_YAYINLA.bat: release ve update dosyalarini GitHub'a yukler.
- build_tools/3_TUM_DEGISIKLIKLERI_PUSH.bat: tum kaynak kodu commit edip push eder.

Olusan dosyalar:

- dist/*.exe (NSIS kurulum)
- dist/*-portable.exe (portable surum)
- dist/latest.yml (otomatik guncelleme metadata dosyasi)

## AnyDesk Benzeri Arka Plan Davranisi

- Uygulama kapat tusuna basinca tepsiye (tray) gizlenir.
- Windows acilisinda arka planda otomatik calisma secenegi vardir.
- Ilk acilista gerekli izinler sorulur:
	- Baslangicta otomatik calisma izni
	- TCP 3131 firewall izni (yonetici onayi gerekebilir)

## GitHub Uzerinden Guncelleme Dagitimi

Kurulu bilgisayarlar programi actiginda guncelleme uyarisi alsin istiyorsan su akisi kullan:

1. version.json icindeki appVersion degerini arttir.
2. cmd /c npm run build-win komutunu calistir.
3. GitHub Releases uzerinde yeni bir release yayinla.
4. dist klasorundeki kurulum exe dosyasini, blockmap dosyasini ve latest.yml dosyasini release asset olarak yukle.
5. Musteri bilgisayarlari uygulamayi actiginda yeni surum kontrolu yapar ve link gostermeden guncelleme akisini baslatir.

## Lisans Dagitimi

1. licenses.json dosyasina yeni bilgisayar kodunu ekle.
2. active alanini true yap.
3. Gerekirse expires tarihi ver.
4. Dosyayi GitHub repo kokune gonder.
5. Musteri uygulamada Lisansi Yenile butonuna basin.

Gecerli lisans yoksa uygulama acilir ama baglanti ozellikleri kilitli kalir.

Webhook tabanli lisans talebi icin version.json icine ornek olarak su alan yazilir:

```json
{
	"licenseRequestWebhookUrl": "/license-request"
}
```

Node webhook alicisi artik mevcut signal server icine gomulu gelir.
Istersen bu endpoint gelen talepleri Discord veya Telegram'a da iletebilir:

- SECK_DISCORD_WEBHOOK_URL: Discord webhook adresi
- SECK_TELEGRAM_BOT_TOKEN: Telegram bot token
- SECK_TELEGRAM_CHAT_ID: Telegram chat id

Gelen lisans talepleri sunucu tarafinda license_requests.json dosyasina kaydedilir.

## Yonetici Paneli

- Ana ekrandaki Yonetici anahtari alanina version.json icindeki adminAccessKey degerini gir.
- Yonetici Modunu Ac dugmesine bastiginda bu bilgisayarda yonetim paneli kalici olarak acilir.
- Lisans Talepleri sekmesinde gelen talepleri gorur, tek tikla onaylar veya silersin.
- Lisanslari Yonet sekmesinde yeni lisans ekler, mevcut lisansi gunceller veya silersin.
- Hazir sure alanindan 1 ay, 3 ay, 6 ay, 1 yil veya suresiz secerek bitis tarihini hizli doldurabilirsin.
- Ozel Gun Sayisi secenegiyle 15, 30, 45 gibi ozel sureleri gun bazinda tanimlayabilirsin.
- Talep onaylarken de secili hazir sure dogrudan kullanilir.
- Uygulama yonetim listesini belirli araliklarla yeniledigi icin yaptigin onay ve silme islemleri ekrana hemen yansir.

## Arka Plan Sunucu Adresi (Yonetici Ayari)

Kullanici arayuzunde sunucu alani yoktur. Sunucu adresi uygulama tarafinda otomatik gelir.

Varsayilan:

```text
http://127.0.0.1:3131
```

Farkli bir sabit IP/domain icin uygulamayi calistirmadan once bu ortam degiskenlerini set edebilirsin:

```powershell
$env:SECK_SIGNAL_SERVER_URL="http://SABIT_IP_ADRESIN:3131"
$env:SECK_TURN_SERVER_URL="turn:SABIT_IP_ADRESIN:3478"
$env:SECK_TURN_USERNAME="turnkullanici"
$env:SECK_TURN_PASSWORD="turnsifre"
cmd /c npm run dev
```

### Iki ayri bilgisayar icin

1. Erisilebilir bir Windows bilgisayarda veya VPS uzerinde sinyal sunucusunu calistir:

```powershell
cmd /c npm run start-server
```

2. Sunucunun IP veya alan adini not et. Ornek:

```text
http://192.168.1.50:3131
```

3. Her iki bilgisayarda da uygulamayi ac:

```powershell
cmd /c npm start
```

4. Her iki bilgisayarda ayni sinyal sunucusu ve gerekiyorsa TURN ayarlari kullanilsin.
5. Baglanti kabul edecek bilgisayarda kod ve sifreyi gor.
6. Diger bilgisayarda hedef kod ve sifreyi girip Baglan dugmesine bas.

## Kullanim Notlari

- Ekran paylasimi icin Bu Bilgisayar alanindaki Ekran Paylasimini Hazirla dugmesine bas.
- Siyah ekran sorunlarini azaltmak icin ekran yakalama artik getDisplayMedia akisi uzerinden yapilir.
- Kontrol icin uzak goruntuye tikla.
- Gelen dosyalar varsayilan olarak Indirilenler/Seck Uzak Masaustu Gelenler klasorune yazilir.
- Sabit sifre tanimlanmazsa yalnizca degisen sifre ile baglanti kabul edilir.

## Farkli Sehirlerden Baglanti

Farkli internet aglarindan baglanti icin genellikle su iki parca gerekir:

- Her iki istemcinin ulasabildigi acik bir sinyal sunucusu
- NAT engellerini asmada kullanilan bir TURN sunucusu

Sadece STUN bircok durumda yeterli olmaz. En saglikli kurulum, bir VPS uzerinde Node sinyal sunucusu ile birlikte coturn calistirmaktir.

deployment klasorunde ornek dosyalar var:

- deployment/docker-compose.yml
- deployment/turnserver.conf.example

Temel mantik:

1. Bir VPS uzerinde 3131 portunda sinyal sunucusunu ac.
2. Ayni VPS veya ayri bir sunucuda TURN calistir.
3. Uygulamadaki Sunucu alanina ornegin http://sunucu-adresin:3131 yaz.
4. TURN alanina ornegin turn:sunucu-adresin:3478 yaz.
5. TURN kullanici ve sifre bilgilerini istemcilere gir.

## Bilinen Sinirlar

- NAT arkasindaki zor aglarda TURN sunucusu olmadigi icin baglanti kurulamamayabilir.
- Klavye kontrolu temel seviye icin tasarlanmistir; cok ozel kisayollar icin genisletme gerekebilir.
- GitHub release yukleme ve repo olusturma adimi manuel olarak yonetici hesabiyla yapilmalidir.