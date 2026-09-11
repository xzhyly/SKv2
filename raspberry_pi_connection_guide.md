# Paano I-connect ang Laptop sa Raspberry Pi (SSH Guide)

Gabay kung paano matagumpay na nakonekta ang Windows laptop sa Raspberry Pi gamit ang parehong Wi-Fi network via SSH (Secure Shell).

---

## 📋 Mga Detalye ng Connection Mo
* **Username ng Pi:** `crystelle`
* **IP Address ng Pi:** `192.168.68.114`
* **Hostname ng Pi:** `raspberrypicrystelle`
* **Laptop OS:** Windows (via Command Prompt / CMD)

---

## 🛠️ Mga Hakbang na Ginawa Natin

### Hakbang 1: Pagkuha ng Impormasyon sa Raspberry Pi
Bago kumonekta gamit ang laptop, nakuha natin ang IP Address at Username gamit ang terminal ng Raspberry Pi:
1. Para malaman ang IP Address:
   ```bash
   hostname -I
   ```
   *Ang nakuha nating IP Address:* **`192.168.68.114`**
2. Para malaman ang Username:
   ```bash
   whoami
   ```
   *Ang nakuha nating Username:* **`crystelle`**

---

### Hakbang 2: Pag-konekta Gamit ang CMD sa Laptop
1. Binuksan ang **Command Prompt (CMD)** sa Windows laptop.
2. Tinype ang SSH command para kumonekta gamit ang username at IP address ng Pi:
   ```cmd
   ssh crystelle@192.168.68.114
   ```

---

### Hakbang 3: Pag-tanggap ng Security Fingerprint (First-time Connection)
Dahil ito ang unang pagkakataon na kumonekta ang laptop sa Pi gamit ang IP na ito, nagtanong ang CMD:
```text
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```
* **Solusyon:** Tinype natin ang **`yes`** at pinindot ang **Enter** para permanenteng irehistro ang Raspberry Pi sa listahan ng kilalang hosts ng laptop.

---

### Hakbang 4: Pag-login gamit ang Password
1. Lumabas ang prompt para sa password:
   ```text
   crystelle@192.168.68.114's password:
   ```
2. Tinype ang password ng iyong Raspberry Pi (Tandaan: Hindi ito nagpapakita sa screen habang tinatype) at pinindot ang **Enter**.

---

### Hakbang 5: Matagumpay na Koneksyon! 🎉
Pagkatapos ng tamang password, nagbago ang command prompt line ng iyong CMD mula sa `C:\Users\Techlife>` at naging:
```text
crystelle@raspberrypicrystelle:~ $
```
Ibig sabihin, ang CMD mo sa laptop ay direktang kontrolado na ang iyong Raspberry Pi. Anumang command ang i-run mo dito ay mag-eeffect sa Pi.

---

## 💡 Quick Tips para sa Susunod na Koneksyon
Sa susunod na kokonekta ka ulit, mas madali na ang gagawin mo dahil na-save na ang fingerprint ng Pi:
1. Buksan ang CMD sa laptop.
2. I-run ang: `ssh crystelle@192.168.68.114` (o kung nagbago ang IP, gamitin ang bagong IP).
3. I-type ang password at pindutin ang Enter.
4. Para tapusin o mag-logout sa koneksyon kapag tapos ka na, i-type lamang ang:
   ```bash
   exit
   ```
