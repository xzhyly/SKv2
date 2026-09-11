# Floating Speech Debugger Design Spec

**Goal:** Floating panel in bottom-right corner of screen. Track Speech Recognition state, errors, and events to diagnose Raspberry Pi mic failures.

## Design

### 1. UI Markup (index.html)
Add overlay container at bottom of `index.html`:
```html
<div id="speech-debugger" class="speech-debugger-collapsed">
    <div id="speech-debugger-header">Speech Debugger (Tap to Toggle)</div>
    <div id="speech-debugger-body">
        <div><strong>Active:</strong> <span id="debug-active">NO</span></div>
        <div><strong>Recognizing:</strong> <span id="debug-recognizing">NO</span></div>
        <div><strong>Last Error:</strong> <span id="debug-error">None</span></div>
        <div><strong>Segment:</strong> <span id="debug-segment">""</span></div>
        <div><strong>Final:</strong> <span id="debug-final">""</span></div>
        <div id="debug-logs"></div>
    </div>
</div>
```

### 2. Styling (index.html)
Add styles in `<style>` block:
- Fixed positioning at bottom-right.
- Semi-transparent background, white text.
- Collapsible on header click.

### 3. Logic (js/script.js)
- Update debug UI fields inside `startListening`, `stopListening`, `onresult`, `onend`, `onerror`.
- Log events to `debug-logs` panel.
