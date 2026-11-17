# Execution Plan: Kiosk Glove Auto-Detection & Camera-Screen Connect

**Date:** 2026-11-17  
**Base Branch:** `touch-ux` (Commit `8977b0f`)  
**Target Feature Branch:** `glove-kiosk-ux` (o `glove-auto-connect`)  
**Target Platforms:** Raspberry Pi 4B (1024×600 Kiosk Touchscreen) & Laptop / Dev PC (Web Serial / Simulator)  

---

## 1. Background & Rationale

Sa kasalukuyang sistema:
* Gumagana na ang hardware (ESP32 + 16-channel mux para sa 10 flex sensors), firmware v2.0, at ang k-NN score re-ranking (`js/glove-bend.js`).
* Nakatago ang koneksyon sa **Admin -> Settings -> Glove** (`settings.html`), kaya ang mga **Guest** at **Regular Users** ay hindi magamit ang gloves nang walang admin intervention.
* Sa `talk.html`, kusang nakatago (`hidden = true`) ang `#glove-chip` kapag hindi pa `ready()` ang glove.

**Layunin ng Planong Ito:**
Paganahin ang **Zero-Click Auto-Detection** at **Direct Camera-Screen Connection** para sa kahit sinong user (Admin, User, o Guest) nang hindi nagdudulot ng lag sa Raspberry Pi 4B, habang pinapanatiling **100% OPTIONAL** ang paggamit ng gloves (Default: OFF / Camera-only).

---

## 2. Git Branching Strategy (Safety & Reversibility)

Bago simulan ang anumang pagbabago sa code, gagawa muna ng bagong branch mula sa `touch-ux` upang manatiling buo at laging pwedeng balikan ang kasalukuyang working version:

```bash
# Siguraduhing nasa touch-ux
git checkout touch-ux

# Gumawa at lumipat sa bagong branch
git checkout -b glove-kiosk-ux
```

* Kung sakaling may problema o kailangang ibalik sa dati, isang command lang:
  `git checkout touch-ux`

---

## 3. Core Requirements & Behavior Specification

### 3.1 Flow & States ng `#glove-chip` sa Camera (`talk.html`)

Ang chip sa kanang itaas ng camera (`#glove-chip`) ay magkakaroon ng sumusunod na states:

| State | Chip Label & Visuals | Kondisyon | Aksyon kapag Pinindot (Tap) |
|---|---|---|---|
| **1. Disconnected / Need Permission** | `🔌 Connect Glove` (Translucent gray pill) | Walang bukas na serial port o kailangan ng user permission (`status !== 'connected'`). | Tatawagin ang `SKGlove.connect()` para buksan ang Web Serial port dialog / auto-link. |
| **2. Connecting** | `⏳ Connecting…` (Pulsing / amber dot) | Kasalukuyang nagha-handshake o binabasa ang hello/calibration. | Walang aksyon (sandali lang ito, ~0.5s). |
| **3. Ready / Standby (Default)** | `🧤 Gloves` (Translucent dark backdrop, white text) | Connected na ang glove at may valid calibration sa ESP32 flash memory, pero **OFF** pa. | **Magiging ON!** Magpapalit sa State 4. |
| **4. Active (ON)** | `🧤 ON` (Solid white pill, navy text, green dot) | Aktibong tumutulong ang gloves sa camera translation. | **Magiging OFF!** Babalik sa State 3. |
| **5. Idle / Camera Only** | `Camera only` (Amber outline at amber dot) | Naka-ON ang button pero hindi gumagalaw ang mga daliri ng 3s (hindi suot), o walang kamay sa camera frame. | Magiging OFF (babalik sa State 3). |
| **6. Unsupported** | *Hidden* | Kung hindi Web Serial capable ang browser o hindi secure context (hal. lumang browser). | N/A |

### 3.2 Offline & Performance Rules (Raspberry Pi Friendly)
1. **Zero Polling Loop:** Walang `setInterval` para sa hardware scanning. Event-driven lamang gamit ang browser native event listener: `navigator.serial.addEventListener('connect', ...)`.
2. **Zero Layout Thrashing:** Ang chip lamang sa camera ang mag-a-update ng text/class. Walang finger bars animation sa camera screen.
3. **100% Optional:** Kapag binuksan ang Let's Talk, **laging OFF ang default**. Normal camera-only sign translation (MediaPipe) ang tatakbo kung hindi i-tap ng user ang chip.
4. **Permanent Flash Memory:** Dahil naka-save na sa ESP32 ang calibration (`open`/`fist`), pagkasaksak ay handa na ito agad nang hindi na kailangang dumaan sa 3-step calibration.

---

## 4. Mga Files na Babaguhin at Exact Technical Tasks

### Task 1: Ayusin ang USB Hotplug Event sa `js/glove.js`
* **File:** `js/glove.js`
* **Problema:**
  ```javascript
  // Kasalukuyan sa js/glove.js:440
  navigator.serial.addEventListener('connect', function () {
    if (state === 'reconnecting' && !userClosed) retry();
  });
  ```
  Kapag kargado ang page habang `disconnected`, hindi tinatawag ang `retry()` kapag isinaksak ang USB cable.
* **Solusyon:**
  Baguhin ang listener upang kapag may sumaksak ng USB device (`connect` event) at `!userClosed`:
  - Kung `state === 'disconnected'` o `'reconnecting'`, tawagin ang `autoReconnect()`.

### Task 2: I-update ang Chip State Logic sa `js/glove-assist.js`
* **File:** `js/glove-assist.js`
* **Problema:**
  Kasalukuyang nagbabalik ng `'hidden'` ang `chipStateNow()` kapag hindi pa `ready()`.
* **Solusyon:**
  1. I-update ang `chipStateNow()`:
     - Kung Web Serial is available pero hindi connected: ibalik ang `'disconnected'` (ipapakita ang `🔌 Connect Glove`).
     - Kung connecting: ibalik ang `'connecting'`.
     - Kung connected at ready pero `!on`: ibalik ang `'off'` (`🧤 Gloves`).
     - Kung connected at ready at `on`: ibalik ang `'on'` (`🧤 ON`) o `'idle'`.
  2. Sa click handler ng chip:
     - Kung ang state ay `'disconnected'`: tawagin ang `SKGlove.connect()`. Pagka-connect, kusa itong magiging ready at magiging `🧤 Gloves` o `🧤 ON`.
     - Kung ready na: mag-toggle sa pagitan ng `ON` at `OFF`.

### Task 3: Suporta sa CSS & Visuals sa `talk.html`
* **File:** `talk.html`
* **Solusyon:**
  1. Siguraduhing may tamang CSS styling para sa disconnected at connecting states ng `.glove-chip`:
     - `.glove-chip.disconnected`: banayad na translucent button na may icon na `🔌` o dimmed glove.
     - `.glove-chip.connecting`: may banayad na animasyon o "Connecting…" text.
  2. Panatilihing 44px ang touch target para madaling pindutin sa 1024×600 touchscreen ng Raspberry Pi.

---

## 5. Test at Verification Checklist

Bago i-declare na tapos na ang trabaho, kailangang ma-verify ang sumusunod:

- [ ] **Kiosk Pi Auto-Detect Test:** Isaksak ang ESP32 sa Raspberry Pi habang nakabukas ang `talk.html` — dapat kusa itong mag-connect at magpakita ng `🧤 Gloves`.
- [ ] **Guest / Regular User Access Test:** Buksan ang `talk.html` nang hindi nagla-login sa Admin. Pindutin ang chip — dapat matagumpay na makakonekta ang glove nang hindi nanghihingi ng admin credentials.
- [ ] **Optionality Test:** Pumasok sa Let's Talk at mag-sign nang HINDI pinipindot ang chip — dapat 100% gumagana ang normal camera translation (MediaPipe k-NN) nang walang anumang error o delay.
- [ ] **One-Tap Activation Test:** Pindutin ang `🧤 Gloves` — dapat maging `🧤 ON` (green dot) at mag-assist sa recognition. Pindutin ulit — dapat bumalik sa `🧤 Gloves` (OFF).
- [ ] **Unplug & Safety Test:** Habang naka-ON, hugutin ang USB cable — dapat bumalik ang chip sa disconnected state nang hindi nagha-hang o nagka-crash ang camera.
