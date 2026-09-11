// js/camera-helper.js
const FEAT_W = 16;
const FEAT_H = 12;
const FEATURES = FEAT_W * FEAT_H;

async function initCameraWithFallback(idealWidth, idealHeight, successCallback, errorCallback) {
  if (!navigator.mediaDevices) {
    let msg = '⚠️ Ang camera API ay hindi magagamit. Siguraduhing naka-HTTPS o localhost ang URL!';
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      msg = '⚠️ Insecure context! Kailangan ng HTTPS o localhost para ma-access ang camera.';
    }
    console.error(msg);
    if (errorCallback) errorCallback(new Error('InsecureContext'), msg);
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    if (videoDevices.length === 0) {
      if (errorCallback) errorCallback(new Error('NotFoundError'), '⚠️ Walang webcam na nade-detect!');
      return;
    }

    let selectedDeviceId = null;
    const cleanDevices = videoDevices.filter(d => {
      const label = (d.label || "").toLowerCase();
      return !label.includes('metadata') && !label.includes('virtual') && !label.includes('control');
    });

    selectedDeviceId = cleanDevices.length > 0 ? cleanDevices[0].deviceId : videoDevices[0].deviceId;

    const constraints = {
      video: { width: { ideal: idealWidth }, height: { ideal: idealHeight } }
    };
    if (selectedDeviceId) constraints.video.deviceId = { exact: selectedDeviceId };

    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      if (successCallback) successCallback(s);
    } catch (err) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        if (successCallback) successCallback(s);
      } catch (fbErr) {
        if (errorCallback) errorCallback(fbErr, '⚠️ Hindi mabuksan ang camera. Pakisuri ang permissions.');
      }
    }
  } catch (err) {
    if (errorCallback) errorCallback(err, '⚠️ Error habang hinahanap ang camera: ' + err.message);
  }
}

function extractFeatures(vid) {
  vid = vid || document.getElementById('videoFeed') || document.getElementById('tlVideo1');
  if (typeof window.extractLandmarkFeatures === 'function') {
    const lf = window.extractLandmarkFeatures();
    if (lf && lf.length) return lf;
  }
  const c = document.createElement('canvas');
  c.width = FEAT_W; c.height = FEAT_H;
  const ctx = c.getContext('2d');
  ctx.save(); ctx.scale(-1,1); ctx.drawImage(vid,-FEAT_W,0,FEAT_W,FEAT_H); ctx.restore();
  const d = ctx.getImageData(0,0,FEAT_W,FEAT_H).data;
  const f = [];
  for (let i=0;i<d.length;i+=4) f.push((d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114)/255);
  return f;
}
