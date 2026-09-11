# 🚀 Raspberry Pi Startup & Commands Guide — Sining Kamay

Gabay para sa mga commands at setups na kailangan para patakbuhin ang Sining Kamay sa iyong Raspberry Pi.

---

## 📞 1. SSH Connection (Mula sa Laptop CMD)
Buksan ang Command Prompt (CMD) sa laptop at i-run ito para pumasok sa Pi:
```cmd
ssh crystelle@192.168.68.114
```
*(Password: Ilagay ang password ng iyong Raspberry Pi)*

---

## 🔊 2. Audio & TTS Installation (One-time Setup sa Pi Terminal)
Kung walang tunog ang speaker, i-run ang mga commands na ito sa SSH terminal ng Pi para i-install ang Text-To-Speech engine:

```bash
# I-update ang system packages
sudo apt update

# I-install ang Speech Dispatcher at Espeak
sudo apt install speech-dispatcher espeak-ng -y

# I-test kung gagana ang boses (dapat may tunog sa speaker)
spd-say "Hello crystelle"
```

> 💡 **Audio Selector Tip:** Kung walang tunog, i-right-click ang Speaker Icon sa desktop screen ng Pi at piliin ang iyong **USB Speaker/Audio Device** bilang default output.

---

## 🌐 3. Pagpapatakbo ng Chrome sa Pi (Via SSH Terminal)

### A. I-close muna ang lumang Chrome
Bago magbukas ng bago, patayin ang mga lumang browser process:
```bash
pkill chromium
```

### B. Buksan ang Chrome sa Kiosk Mode (May Audio & Keyring Bypass)
Gamitin ang command na ito para mag-open ang browser sa physical HDMI monitor ng Pi gamit ang tamang parameters:

* **Option 1: Kung ang project files ay nasa `/Sining_kamay/` folder:**
  ```bash
  DISPLAY=:0 chromium --kiosk --password-store=basic --enable-speech-dispatcher http://localhost/Sining_kamay/ &
  ```

* **Option 2: Kung ang project files ay direktang nasa root `/var/www/html/`:**
  ```bash
  DISPLAY=:0 chromium --kiosk --password-store=basic --enable-speech-dispatcher http://localhost/ &
  ```

---

## 📂 4. Pag-transfer ng Files Mula Laptop (Laptop CMD)
Kung may binago kang code sa laptop at gusto mong kopyahin sa Pi:

* **Para sa Voice-to-Sign JS Logic (`script.js`):**
  ```cmd
  scp c:\xampp\htdocs\Sining_kamay\js\script.js crystelle@192.168.68.114:/var/www/html/Sining_kamay/js/
  ```

* **Para sa CSS at Touch fixes (`index.html`):**
  ```cmd
  scp c:\xampp\htdocs\Sining_kamay\index.html crystelle@192.168.68.114:/var/www/html/Sining_kamay/
  ```

* **Para sa specific na CSS file:**
  ```cmd
  scp c:\xampp\htdocs\Sining_kamay\css\gesture-training.css crystelle@192.168.68.114:/var/www/html/Sining_kamay/css/
  ```

* **Para sa updated preloader (`preload.html`):**
  ```cmd
  scp c:\xampp\htdocs\Sining_kamay\preload.html crystelle@192.168.68.114:/var/www/html/Sining_kamay/
  ```

* **Para sa updated JavaScript logic (`gesture-data.js`):**
  ```cmd
  scp c:\xampp\htdocs\Sining_kamay\js\gesture-data.js crystelle@192.168.68.114:/var/www/html/Sining_kamay/js/
  ```
