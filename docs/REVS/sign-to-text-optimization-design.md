# Sign to Text Performance Optimization Design

## 1. Problem Statement
The `sign-to-text.html` page takes 10-20 seconds to load and initialize its translation capabilities on a Raspberry Pi 4. This delay is caused by:
- Database querying that triggers heavy directory listing and file scanning (`sync_disk_to_db` and `sync_db_to_disk` functions in `save_gesture.php`) on every load.
- No client-side preloading of the trained KNN model on startup.
- Overlapping camera stream init, MediaPipe load, and DB calls creating a CPU spike.

## 2. Proposed Solution
Implement a **Zero-API Kiosk Cache Architecture**:
1. **Preload on DOMContentLoaded:** Immediately retrieve the compiled KNN model from `localStorage` on page load, removing the initial "AI is getting ready" overlay instantly if a cache exists.
2. **Read-Only API Option:** Optimize `save_gesture.php` with a `no_sync=1` bypass parameter to skip folder scanning when simply querying the active gesture list.
3. **Database Load Avoidance:** Bypass database fetches altogether during startup if a valid cached model is loaded.

## 3. Interfaces & Code Structure

### 3.1. Frontend Optimization (`js/sign-to-text-ui.js`)
On page load:
```javascript
window.addEventListener('DOMContentLoaded', async () => {
  const initLang = (signLang === 'fil' ? 'FSL' : 'ESL');
  if (loadKnnFromCache(initLang)) {
    tlModelReady = true;
    // Hide overlay and enable start button instantly
    const overlay = document.getElementById('tlAiLoadingOverlay1');
    if (overlay) overlay.style.display = 'none';
    const b1 = document.getElementById('tlTranslateBtn1');
    if (b1) {
      b1.disabled = false;
      b1.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> START';
    }
  }
});
```

### 3.2. Backend Optimization (`php/api/save_gesture.php`)
```php
function list_samples($defaultRoot) {
    global $conn;
    if (!isset($_GET['no_sync'])) {
        sync_db_to_disk($conn, $defaultRoot);
        sync_disk_to_db($conn, $defaultRoot);
    }
    // ... rest of list query
}
```
